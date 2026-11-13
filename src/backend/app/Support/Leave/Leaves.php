<?php

namespace App\Support\Leave;

use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Leave\LeaveEntitlement;
use App\Models\Leave\LeaveRequest;
use App\Models\Leave\LeaveSetting;
use App\Models\Leave\LeaveType;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\User;
use App\Support\Approvals\Approvals;
use App\Support\Notifier;
use App\Support\ReportingLine;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Leave applications and balances. Days are working days (Monday to Friday);
 * a single day can be taken as a half day. Balances run per calendar year
 * in the organisation's time zone. Callers check that the user may use the
 * Leave app first.
 */
class Leaves
{
    public const ENTITY = 'leave_request';

    /**
     * Created for every organisation the first time the app is used. Days per
     * year; null = no limit. Admins change these in the Leave settings.
     */
    public const DEFAULT_TYPES = [
        ['key' => 'annual', 'name' => 'Annual Leave', 'color' => '#2563eb', 'days' => 14],
        ['key' => 'medical', 'name' => 'Medical Leave', 'color' => '#dc2626', 'days' => 14],
        ['key' => 'paternity', 'name' => 'Govt Paid Paternity Leave', 'color' => '#0891b2', 'days' => 7],
        ['key' => 'business_travel', 'name' => 'Business Travel', 'color' => '#7c3aed', 'days' => null],
        ['key' => 'calamity', 'name' => 'Calamity Leave', 'color' => '#ea580c', 'days' => 3],
        ['key' => 'off_in_lieu', 'name' => 'Claim Off-in-Lieu', 'color' => '#16a34a', 'days' => 0],
        ['key' => 'compassionate', 'name' => 'Compassionate Leave', 'color' => '#475569', 'days' => 3],
        ['key' => 'marriage', 'name' => 'Marriage Leave', 'color' => '#db2777', 'days' => 3],
        ['key' => 'training', 'name' => 'Training Leave', 'color' => '#ca8a04', 'days' => null],
        ['key' => 'unpaid', 'name' => 'Unpaid Leave', 'color' => '#71717a', 'days' => null],
        ['key' => 'hospitalization', 'name' => 'Hospitalization Leave', 'color' => '#9333ea', 'days' => 60],
    ];

    /** @return Collection<int, LeaveType> every leave type of the organisation, in display order */
    public static function types(Organization $organization): Collection
    {
        if (! LeaveType::where('organization_id', $organization->id)->exists()) {
            $now = now();
            $rows = [];
            foreach (self::DEFAULT_TYPES as $i => $t) {
                $rows[] = [
                    'organization_id' => $organization->id, 'key' => $t['key'], 'name' => $t['name'], 'color' => $t['color'],
                    'entitlement_days' => $t['days'], 'is_active' => true, 'position' => ($i + 1) * 10,
                    'created_at' => $now, 'updated_at' => $now,
                ];
            }
            // Two first visits at once: the unique key makes the second insert a no-op.
            LeaveType::query()->insertOrIgnore($rows);
        }

        return LeaveType::where('organization_id', $organization->id)->orderBy('position')->orderBy('id')->get();
    }

    public static function today(Organization $organization): CarbonImmutable
    {
        return CarbonImmutable::now($organization->timezone ?: config('app.timezone'))->startOfDay();
    }

    /** Working days between two dates (inclusive); 0.5 for a half day. */
    public static function workingDays(CarbonInterface $start, CarbonInterface $end, string $halfDay = 'none'): float
    {
        $days = 0;
        for ($d = CarbonImmutable::parse($start)->startOfDay(); $d->lte($end); $d = $d->addDay()) {
            if (! $d->isWeekend()) {
                $days++;
            }
        }

        return $halfDay !== 'none' && $days === 1 ? 0.5 : (float) $days;
    }

    /**
     * Eligible, taken, pending and balance per leave type for a member and year.
     * "Taken" counts approved leave; "pending" counts applications waiting for
     * a decision. Balance = eligible − taken (null when there is no limit).
     *
     * @return list<array<string, mixed>>
     */
    public static function balances(Organization $organization, int $userId, int $year): array
    {
        $types = self::types($organization);
        $overrides = LeaveEntitlement::where('organization_id', $organization->id)
            ->where('user_id', $userId)->where('year', $year)->pluck('days', 'leave_type_id');
        $used = LeaveRequest::where('organization_id', $organization->id)
            ->where('user_id', $userId)
            ->whereIn('status', LeaveRequest::HOLDS_DATES)
            ->whereYear('start_date', $year)
            ->selectRaw('leave_type_id, status, sum(days) as days')
            ->groupBy('leave_type_id', 'status')->get();

        return $types->map(function (LeaveType $type) use ($overrides, $used) {
            $eligible = $overrides->has($type->id) ? (float) $overrides[$type->id] : $type->entitlement_days;
            $taken = (float) $used->where('leave_type_id', $type->id)->where('status', LeaveRequest::STATUS_APPROVED)->sum('days');
            $pending = (float) $used->where('leave_type_id', $type->id)->whereIn('status', LeaveRequest::OPEN)->sum('days');

            return [
                'id' => $type->id,
                'key' => $type->key,
                'name' => $type->name,
                'color' => $type->color,
                'is_active' => $type->is_active,
                'adjusted' => $overrides->has($type->id),
                'eligible' => $eligible,
                'taken' => $taken,
                'pending' => $pending,
                'balance' => $eligible === null ? null : round($eligible - $taken, 1),
            ];
        })->values()->all();
    }

    /**
     * Submits a new application for the member.
     *
     * @param  array{leave_type_id: int, start_date: string, end_date: string, half_day?: string|null, reason?: string|null}  $input
     */
    public static function apply(Organization $organization, User $user, array $input): LeaveRequest
    {
        return DB::transaction(function () use ($organization, $user, $input) {
            self::lockMember($organization, $user);
            $clean = self::validate($organization, $user, $input);
            $type = $clean['type_model'];
            unset($clean['type_model']);

            $leave = LeaveRequest::create([
                ...$clean,
                'organization_id' => $organization->id,
                'user_id' => $user->id,
                'status' => LeaveRequest::STATUS_PENDING_APPROVAL,
                'submitted_at' => now(),
            ]);
            $leave->setRelation('type', $type);

            $request = Approvals::submitForApproval(
                $organization, $user, self::ENTITY, $leave->id, self::workflow($organization, $user),
                self::title($leave, $user), self::approvalData($leave), self::summary($leave), $leave->link(),
            );
            // The approval may already be complete (every step skipped); the listener then set the status.
            $leave->refresh();
            $leave->approval_request_id = $request->id;
            if ($leave->status === LeaveRequest::STATUS_PENDING_APPROVAL) {
                $leave->status = self::statusFor($request->status);
            }
            $leave->save();

            return $leave->fresh(['type', 'user']);
        });
    }

    /** The owner changes an application that was returned for changes and sends it again. */
    public static function resubmit(Organization $organization, LeaveRequest $leave, User $user, array $input): LeaveRequest
    {
        return DB::transaction(function () use ($organization, $leave, $user, $input) {
            self::lockMember($organization, $user);
            $leave = LeaveRequest::whereKey($leave->id)->lockForUpdate()->firstOrFail();
            if ($leave->user_id !== $user->id) {
                throw new HttpException(403, 'Only the applicant can change this application.');
            }
            if ($leave->status !== LeaveRequest::STATUS_RETURNED) {
                throw new HttpException(422, 'Only applications returned for changes can be edited.');
            }
            $clean = self::validate($organization, $user, $input, $leave);
            $type = $clean['type_model'];
            unset($clean['type_model']);
            $leave->fill([...$clean, 'submitted_at' => now()])->save();
            $leave->setRelation('type', $type);

            $request = $leave->approval_request_id ? ApprovalRequest::find($leave->approval_request_id) : null;
            if (! $request) {
                throw new HttpException(422, 'This application can no longer be resubmitted.');
            }
            // The listener sets the status back to pending approval.
            Approvals::resubmit($request, $user, self::approvalData($leave), self::title($leave, $user), self::summary($leave));

            return $leave->fresh(['type', 'user']);
        });
    }

    /**
     * The applicant withdraws an application waiting for a decision, or cancels
     * approved leave that has not started yet.
     */
    public static function cancel(Organization $organization, LeaveRequest $leave, User $user): LeaveRequest
    {
        return DB::transaction(function () use ($organization, $leave, $user) {
            $leave = LeaveRequest::whereKey($leave->id)->lockForUpdate()->firstOrFail();
            if ($leave->user_id !== $user->id) {
                throw new HttpException(403, 'Only the applicant can cancel this application.');
            }

            if (in_array($leave->status, LeaveRequest::OPEN, true)) {
                $request = $leave->approval_request_id ? ApprovalRequest::find($leave->approval_request_id) : null;
                if ($request && $request->isOpen()) {
                    // The listener marks the application cancelled.
                    Approvals::cancel($request, $user);
                }
                $leave->refresh();
                if ($leave->status !== LeaveRequest::STATUS_CANCELLED) {
                    $leave->update(['status' => LeaveRequest::STATUS_CANCELLED, 'cancelled_at' => now()]);
                }

                return $leave->fresh(['type', 'user']);
            }

            if ($leave->status === LeaveRequest::STATUS_APPROVED) {
                // Compare calendar dates: the stored date has no time zone.
                if ($leave->start_date->toDateString() <= self::today($organization)->toDateString()) {
                    throw new HttpException(422, 'Leave that has already started cannot be cancelled. Ask your manager or HR.');
                }
                $leave->update(['status' => LeaveRequest::STATUS_CANCELLED, 'cancelled_at' => now()]);
                if ($managerId = ReportingLine::managerOf($organization->id, $user->id)) {
                    Notifier::send($organization->id, [$managerId], 'leave.cancelled',
                        $user->name.' cancelled approved leave',
                        $leave->type?->name.' · '.self::dateRange($leave), $leave->link(), $user->id, 'leave-cancelled:'.$leave->id);
                }

                return $leave->fresh(['type', 'user']);
            }

            throw new HttpException(422, 'This application can no longer be cancelled.');
        });
    }

    /**
     * The workflow used for applications. When none is chosen, a default
     * "reporting manager approves" workflow is created once and remembered.
     */
    public static function workflow(Organization $organization, ?User $actor = null): ApprovalWorkflow
    {
        $settings = self::settings($organization, lock: true);
        $workflow = $settings->workflow_id ? ApprovalWorkflow::find($settings->workflow_id) : null;

        if (! $workflow) {
            $workflow = ApprovalWorkflow::create([
                'organization_id' => $organization->id,
                'name' => 'Leave app approval',
                'description' => 'Reporting manager approves leave applications. Used by the Leave app.',
                'created_by' => $actor?->id,
            ]);
            $workflow->steps()->create([
                'organization_id' => $organization->id, 'position' => 1, 'name' => 'Reporting manager',
                'mode' => 'any', 'approvers' => [['type' => 'manager']], 'sla_hours' => 24,
            ]);
            $settings->update(['workflow_id' => $workflow->id]);
        }

        return $workflow;
    }

    public static function settings(Organization $organization, bool $lock = false): LeaveSetting
    {
        LeaveSetting::query()->insertOrIgnore([
            'organization_id' => $organization->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $query = LeaveSetting::where('organization_id', $organization->id);

        return ($lock ? $query->lockForUpdate() : $query)->firstOrFail();
    }

    public static function statusFor(string $approvalStatus): string
    {
        return match ($approvalStatus) {
            ApprovalRequest::STATUS_APPROVED => LeaveRequest::STATUS_APPROVED,
            ApprovalRequest::STATUS_REJECTED => LeaveRequest::STATUS_REJECTED,
            ApprovalRequest::STATUS_RETURNED => LeaveRequest::STATUS_RETURNED,
            ApprovalRequest::STATUS_CANCELLED => LeaveRequest::STATUS_CANCELLED,
            default => LeaveRequest::STATUS_PENDING_APPROVAL,
        };
    }

    /** "12 Nov 2026" or "12 – 14 Nov 2026" (with "(morning)" / "(afternoon)" for half days). */
    public static function dateRange(LeaveRequest $leave): string
    {
        $s = $leave->start_date;
        $e = $leave->end_date;
        $range = $s->isSameDay($e) ? $s->format('j M Y')
            : ($s->isSameMonth($e) ? $s->format('j').' – '.$e->format('j M Y') : $s->format('j M').' – '.$e->format('j M Y'));

        return $range.match ($leave->half_day) {
            'am' => ' (morning)',
            'pm' => ' (afternoon)',
            default => '',
        };
    }

    public static function formatDays(float $days): string
    {
        $n = rtrim(rtrim(number_format($days, 1, '.', ''), '0'), '.');

        return $n.' '.($days == 1 ? 'day' : 'days');
    }

    private static function title(LeaveRequest $leave, User $user): string
    {
        return ($leave->type?->name ?? 'Leave').' · '.$user->name.' · '.self::dateRange($leave);
    }

    /** Values approval steps can use in conditions (e.g. days > 3). */
    private static function approvalData(LeaveRequest $leave): array
    {
        return [
            'days' => $leave->days,
            'leave_type' => $leave->type?->key,
            'start_date' => $leave->start_date->toDateString(),
        ];
    }

    private static function summary(LeaveRequest $leave): string
    {
        return ($leave->type?->name ?? 'Leave').' · '.self::formatDays($leave->days).' · '.self::dateRange($leave);
    }

    /** Serialises a member's applications so balance and overlap checks cannot race. */
    private static function lockMember(Organization $organization, User $user): void
    {
        OrganizationMembership::where('organization_id', $organization->id)
            ->where('user_id', $user->id)->lockForUpdate()->first();
    }

    /**
     * Checks an application and returns the columns to store (plus the type
     * model under "type_model"). The leave type ID comes from the client, so it
     * is resolved inside the organisation.
     */
    private static function validate(Organization $organization, User $user, array $input, ?LeaveRequest $existing = null): array
    {
        $type = LeaveType::where('organization_id', $organization->id)
            ->whereKey((int) ($input['leave_type_id'] ?? 0))->where('is_active', true)->first();
        if (! $type) {
            throw ValidationException::withMessages(['leave_type_id' => 'Choose a leave type.']);
        }

        try {
            $start = CarbonImmutable::createFromFormat('!Y-m-d', (string) ($input['start_date'] ?? ''));
            $end = CarbonImmutable::createFromFormat('!Y-m-d', (string) ($input['end_date'] ?? ''));
        } catch (\Throwable) {
            $start = $end = false;
        }
        if (! $start || ! $end) {
            throw ValidationException::withMessages(['start_date' => 'Choose the dates.']);
        }
        if ($end->lt($start)) {
            throw ValidationException::withMessages(['end_date' => 'The last day must be on or after the first day.']);
        }
        if ($start->year !== $end->year) {
            throw ValidationException::withMessages(['end_date' => 'Leave across two years needs two applications (one per year).']);
        }
        $thisYear = self::today($organization)->year;
        if ($start->year < $thisYear - 1 || $start->year > $thisYear + 1) {
            throw ValidationException::withMessages(['start_date' => 'Choose dates in last year, this year or next year.']);
        }

        $halfDay = (string) ($input['half_day'] ?? 'none') ?: 'none';
        if (! in_array($halfDay, LeaveRequest::HALF_DAYS, true)) {
            throw ValidationException::withMessages(['half_day' => 'Choose morning, afternoon or a full day.']);
        }
        if ($halfDay !== 'none' && ! $start->isSameDay($end)) {
            throw ValidationException::withMessages(['half_day' => 'A half day must start and end on the same day.']);
        }

        $days = self::workingDays($start, $end, $halfDay);
        if ($days <= 0) {
            throw ValidationException::withMessages(['start_date' => 'These dates fall on a weekend. Leave counts working days only.']);
        }

        $reason = isset($input['reason']) ? trim((string) $input['reason']) : '';
        if (mb_strlen($reason) > 1000) {
            throw ValidationException::withMessages(['reason' => 'Keep the reason under 1,000 characters.']);
        }

        // No overlap with the member's other applications that hold dates.
        $overlap = LeaveRequest::where('organization_id', $organization->id)
            ->where('user_id', $user->id)
            ->whereIn('status', LeaveRequest::HOLDS_DATES)
            ->when($existing, fn ($q) => $q->whereKeyNot($existing->id))
            ->whereDate('start_date', '<=', $end->toDateString())
            ->whereDate('end_date', '>=', $start->toDateString())
            ->get();
        foreach ($overlap as $other) {
            // Two half days on the same day are fine when one is the morning and the other the afternoon.
            $halves = $other->start_date->isSameDay($other->end_date) && $start->isSameDay($end)
                && $other->half_day !== 'none' && $halfDay !== 'none' && $other->half_day !== $halfDay;
            if (! $halves) {
                throw ValidationException::withMessages(['start_date' => 'You already have leave on '.self::dateRange($other).'.']);
            }
        }

        // Enough balance (counting other applications still waiting for a decision).
        $balance = collect(self::balances($organization, $user->id, $start->year))->firstWhere('id', $type->id);
        if ($balance['eligible'] !== null) {
            $alreadyCounted = $existing && $existing->leave_type_id === $type->id && $existing->start_date->year === $start->year
                && in_array($existing->status, LeaveRequest::OPEN, true) ? $existing->days : 0;
            $available = round($balance['eligible'] - $balance['taken'] - $balance['pending'] + $alreadyCounted, 1);
            if ($days > $available) {
                throw ValidationException::withMessages(['leave_type_id' => $available > 0
                    ? 'Only '.self::formatDays($available).' of '.$type->name.' left for '.$start->year.' (this application is '.self::formatDays($days).').'
                    : 'No '.$type->name.' left for '.$start->year.'.']);
            }
        }

        return [
            'leave_type_id' => $type->id,
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'half_day' => $halfDay,
            'days' => $days,
            'reason' => $reason !== '' ? $reason : null,
            'type_model' => $type,
        ];
    }
}
