<?php

namespace App\Support\Timesheets;

use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\Timesheet\Timesheet;
use App\Models\Timesheet\TimesheetEntry;
use App\Models\Timesheet\TimesheetSetting;
use App\Models\User;
use App\Support\Approvals\Approvals;
use App\Support\Notifier;
use App\Support\Permissions;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Weekly timesheets: the owner fills a week (Monday to Sunday), submits it,
 * and it goes through the organisation's timesheet approval workflow.
 * Callers check that the user may use the Timesheet app first.
 */
class Timesheets
{
    public const ENTITY = 'timesheet';

    public const MAX_ENTRIES = 300;

    public const DAY_LIMIT_MINUTES = 1440;

    /** Monday of the week that contains the date. */
    public static function weekStart(CarbonInterface|string $date): CarbonImmutable
    {
        return CarbonImmutable::parse($date)->startOfDay()->startOfWeek(CarbonInterface::MONDAY);
    }

    /** Monday of the current week in the organisation's time zone. */
    public static function currentWeek(Organization $organization): CarbonImmutable
    {
        return self::weekStart(CarbonImmutable::now($organization->timezone ?: config('app.timezone'))->toDateString());
    }

    public static function find(Organization $organization, User $user, CarbonInterface $week): ?Timesheet
    {
        return Timesheet::where('organization_id', $organization->id)
            ->where('user_id', $user->id)
            ->whereDate('week_start', $week->toDateString())
            ->first();
    }

    /**
     * Replaces the week's entries.
     *
     * @param  list<array{project_id?: int|null, task_id?: int|null, work_date: string, minutes: int, note?: string|null}>  $input
     */
    public static function save(Organization $organization, User $user, CarbonInterface $week, array $input): Timesheet
    {
        $week = self::weekStart($week);
        if ($week->gt(self::currentWeek($organization))) {
            throw ValidationException::withMessages(['week' => 'You cannot log time for a future week.']);
        }

        return DB::transaction(function () use ($organization, $user, $week, $input) {
            $timesheet = Timesheet::firstOrCreate(
                ['organization_id' => $organization->id, 'user_id' => $user->id, 'week_start' => $week->toDateString()],
            );
            $timesheet = Timesheet::whereKey($timesheet->id)->lockForUpdate()->firstOrFail();
            if (! $timesheet->isEditable()) {
                throw new HttpException(422, $timesheet->status === Timesheet::STATUS_APPROVED
                    ? 'This week is approved and can no longer be changed.'
                    : 'This week is waiting for approval. Withdraw it to make changes.');
            }

            $rows = self::validateEntries($organization, $user, $week, $input, $timesheet);

            TimesheetEntry::where('timesheet_id', $timesheet->id)->delete();
            foreach ($rows as $row) {
                TimesheetEntry::create([...$row, 'organization_id' => $organization->id, 'timesheet_id' => $timesheet->id]);
            }

            $timesheet->total_minutes = array_sum(array_column($rows, 'minutes'));
            // A rejected week starts again as a draft; the old request stays in the approval history.
            if ($timesheet->status === Timesheet::STATUS_REJECTED) {
                $timesheet->status = Timesheet::STATUS_DRAFT;
                $timesheet->approval_request_id = null;
            }
            $timesheet->save();
            $timesheet->touch();

            return $timesheet->fresh();
        });
    }

    public static function submit(Organization $organization, User $user, CarbonInterface $week): Timesheet
    {
        $week = self::weekStart($week);

        return DB::transaction(function () use ($organization, $user, $week) {
            $timesheet = self::find($organization, $user, $week);
            $timesheet = $timesheet ? Timesheet::whereKey($timesheet->id)->lockForUpdate()->first() : null;
            if (! $timesheet || ! $timesheet->entries()->exists()) {
                throw ValidationException::withMessages(['entries' => 'Log some time before submitting the week.']);
            }
            if (! in_array($timesheet->status, [Timesheet::STATUS_DRAFT, Timesheet::STATUS_RETURNED], true)) {
                throw new HttpException(422, 'This week has already been submitted.');
            }

            $data = self::approvalData($timesheet);
            $summary = self::summary($timesheet);
            $timesheet->submitted_at = now();

            if ($timesheet->status === Timesheet::STATUS_RETURNED && $timesheet->approval_request_id
                && ($request = ApprovalRequest::find($timesheet->approval_request_id))) {
                // The listener sets the status back to pending approval.
                $timesheet->save();
                Approvals::resubmit($request, $user, $data, null, $summary);

                return $timesheet->fresh();
            }

            $request = Approvals::submitForApproval(
                $organization, $user, self::ENTITY, $timesheet->id, self::workflow($organization, $user),
                'Timesheet · '.$user->name.' · week of '.$timesheet->week_start->format('j M Y'),
                $data, $summary, $timesheet->link(),
            );
            // The approval may already be complete (every step skipped); the listener then set the status.
            $timesheet->refresh();
            $timesheet->approval_request_id = $request->id;
            $timesheet->submitted_at = now();
            if (in_array($timesheet->status, [Timesheet::STATUS_DRAFT, Timesheet::STATUS_RETURNED], true)) {
                $timesheet->status = self::statusFor($request->status);
            }
            $timesheet->save();

            return $timesheet->fresh();
        });
    }

    /** The owner takes back a week waiting for approval (or returned); it becomes a draft again. */
    public static function withdraw(Timesheet $timesheet, User $user): Timesheet
    {
        return DB::transaction(function () use ($timesheet, $user) {
            $timesheet = Timesheet::whereKey($timesheet->id)->lockForUpdate()->firstOrFail();
            if ($timesheet->user_id !== $user->id) {
                throw new HttpException(403, 'Only the owner can withdraw this timesheet.');
            }
            if (! in_array($timesheet->status, [Timesheet::STATUS_PENDING_APPROVAL, Timesheet::STATUS_RETURNED], true)) {
                throw new HttpException(422, 'This week can no longer be withdrawn.');
            }

            $request = $timesheet->approval_request_id ? ApprovalRequest::find($timesheet->approval_request_id) : null;
            if ($request && in_array($request->status, [ApprovalRequest::STATUS_PENDING, ApprovalRequest::STATUS_RETURNED], true)) {
                // The listener turns the sheet back into a draft.
                Approvals::cancel($request, $user);
            } else {
                $timesheet->update(['status' => Timesheet::STATUS_DRAFT, 'approval_request_id' => null]);
            }

            return $timesheet->fresh();
        });
    }

    /**
     * The workflow used for submitted weeks. When none is chosen, a default
     * "reporting manager approves" workflow is created once and remembered.
     */
    public static function workflow(Organization $organization, ?User $actor = null): ApprovalWorkflow
    {
        $settings = self::settings($organization, lock: true);
        $workflow = $settings->workflow_id ? ApprovalWorkflow::find($settings->workflow_id) : null;

        if (! $workflow) {
            $workflow = ApprovalWorkflow::create([
                'organization_id' => $organization->id,
                'name' => 'Timesheet approval',
                'description' => 'Reporting manager approves weekly timesheets. Used by the Timesheet app.',
                'created_by' => $actor?->id,
            ]);
            $workflow->steps()->create([
                'organization_id' => $organization->id, 'position' => 1, 'name' => 'Reporting manager',
                'mode' => 'any', 'approvers' => [['type' => 'manager']], 'sla_hours' => 48,
            ]);
            $settings->update(['workflow_id' => $workflow->id]);
        }

        return $workflow;
    }

    /**
     * One reminder per sheet: drafts with logged time whose week has ended
     * (in the organisation's time zone), from the last eight weeks.
     */
    public static function remindUnsubmitted(): int
    {
        $count = 0;
        Organization::query()->whereExists(fn ($q) => $q->selectRaw('1')->from('timesheets')
            ->whereColumn('timesheets.organization_id', 'organizations.id')
            ->where('timesheets.status', Timesheet::STATUS_DRAFT)
            ->where('timesheets.total_minutes', '>', 0))
            ->each(function (Organization $organization) use (&$count) {
                $thisWeek = self::currentWeek($organization);
                Timesheet::where('organization_id', $organization->id)
                    ->where('status', Timesheet::STATUS_DRAFT)
                    ->where('total_minutes', '>', 0)
                    ->whereDate('week_start', '<', $thisWeek->toDateString())
                    ->whereDate('week_start', '>=', $thisWeek->subWeeks(8)->toDateString())
                    ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('user_notifications')
                        ->whereColumn('user_notifications.user_id', 'timesheets.user_id')
                        ->whereRaw("user_notifications.dedupe_key = 'timesheet-unsubmitted:' || timesheets.id"))
                    ->each(function (Timesheet $timesheet) use ($organization, &$count) {
                        Notifier::send($organization->id, [$timesheet->user_id], 'timesheet.reminder',
                            'Submit your timesheet for the week of '.$timesheet->week_start->format('j M'),
                            self::hours($timesheet->total_minutes).' logged and not yet submitted.',
                            $timesheet->link(), null, 'timesheet-unsubmitted:'.$timesheet->id);
                        $count++;
                    });
            });

        return $count;
    }

    public static function settings(Organization $organization, bool $lock = false): TimesheetSetting
    {
        TimesheetSetting::query()->insertOrIgnore([
            'organization_id' => $organization->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $query = TimesheetSetting::where('organization_id', $organization->id);

        return ($lock ? $query->lockForUpdate() : $query)->firstOrFail();
    }

    public static function statusFor(string $approvalStatus): string
    {
        return match ($approvalStatus) {
            ApprovalRequest::STATUS_APPROVED => Timesheet::STATUS_APPROVED,
            ApprovalRequest::STATUS_REJECTED => Timesheet::STATUS_REJECTED,
            ApprovalRequest::STATUS_RETURNED => Timesheet::STATUS_RETURNED,
            ApprovalRequest::STATUS_CANCELLED => Timesheet::STATUS_DRAFT,
            default => Timesheet::STATUS_PENDING_APPROVAL,
        };
    }

    /** Values approval steps can use in conditions (e.g. hours > 45). */
    public static function approvalData(Timesheet $timesheet): array
    {
        return [
            'hours' => round($timesheet->total_minutes / 60, 2),
            'week_start' => $timesheet->week_start->toDateString(),
        ];
    }

    /** "38.5 h · Website revamp 30 h, General 8.5 h" */
    public static function summary(Timesheet $timesheet): string
    {
        $byProject = TimesheetEntry::where('timesheet_id', $timesheet->id)
            ->selectRaw("coalesce(project_name, 'General') as name, sum(minutes) as minutes")
            ->groupByRaw("coalesce(project_name, 'General')")
            ->orderByDesc('minutes')->get();
        $parts = $byProject->map(fn ($r) => $r->name.' '.self::hours((int) $r->minutes))->implode(', ');

        return mb_substr(self::hours($timesheet->total_minutes).' · '.$parts, 0, 1000);
    }

    public static function hours(int $minutes): string
    {
        return rtrim(rtrim(number_format($minutes / 60, 2, '.', ''), '0'), '.').' h';
    }

    /**
     * Checks every entry and returns clean rows. Project and task IDs come from
     * the client, so they are resolved inside the organisation and checked
     * against the member's access. A project/task already on the sheet may stay
     * even if it was archived or the member left it since.
     *
     * @return list<array<string, mixed>>
     */
    private static function validateEntries(Organization $organization, User $user, CarbonImmutable $week, array $input, Timesheet $timesheet): array
    {
        if (count($input) > self::MAX_ENTRIES) {
            throw ValidationException::withMessages(['entries' => 'A week can have at most '.self::MAX_ENTRIES.' entries.']);
        }

        $existing = TimesheetEntry::where('timesheet_id', $timesheet->id)
            ->get(['project_id', 'task_id', 'project_name', 'task_title'])
            ->keyBy(fn ($e) => ($e->project_id ?? 0).':'.($e->task_id ?? 0));

        $projectIds = array_values(array_unique(array_filter(array_map(fn ($e) => (int) ($e['project_id'] ?? 0), $input))));
        $taskIds = array_values(array_unique(array_filter(array_map(fn ($e) => (int) ($e['task_id'] ?? 0), $input))));
        $projects = Project::where('organization_id', $organization->id)->whereIn('id', $projectIds)->get()->keyBy('id');
        $tasks = Task::where('organization_id', $organization->id)->whereIn('id', $taskIds)->get()->keyBy('id');

        $end = $week->addDays(6);
        $rows = [];
        $seen = [];
        $perDay = [];
        $allowed = [];
        $errors = [];

        foreach (array_values($input) as $i => $entry) {
            $projectId = isset($entry['project_id']) && $entry['project_id'] !== '' ? (int) $entry['project_id'] : null;
            $taskId = isset($entry['task_id']) && $entry['task_id'] !== '' ? (int) $entry['task_id'] : null;
            $minutes = (int) ($entry['minutes'] ?? 0);
            $note = isset($entry['note']) ? trim((string) $entry['note']) : '';

            try {
                $date = CarbonImmutable::createFromFormat('!Y-m-d', (string) ($entry['work_date'] ?? ''));
            } catch (\Throwable) {
                $date = false;
            }
            if (! $date || $date->lt($week) || $date->gt($end)) {
                $errors["entries.$i.work_date"] = 'Pick a day in this week.';

                continue;
            }
            if ($minutes === 0) {
                continue; // Empty cells are simply not stored.
            }
            if ($minutes < 0 || $minutes > self::DAY_LIMIT_MINUTES) {
                $errors["entries.$i.minutes"] = 'Enter between 0 and 24 hours.';

                continue;
            }
            if (mb_strlen($note) > 500) {
                $errors["entries.$i.note"] = 'Notes can be up to 500 characters.';

                continue;
            }
            if ($taskId && ! $projectId) {
                $errors["entries.$i.project_id"] = 'Choose the task\'s project.';

                continue;
            }

            $key = ($projectId ?? 0).':'.($taskId ?? 0);
            $project = $projectId ? $projects->get($projectId) : null;
            $task = $taskId ? $tasks->get($taskId) : null;

            if (! isset($allowed[$key])) {
                $kept = $existing->get($key);
                $allowed[$key] = match (true) {
                    $projectId === null => true,
                    $kept !== null => true,
                    $project === null => false,
                    ! Permissions::canLogTimeToProject($user, $project) => false,
                    $taskId !== null && ($task === null || $task->project_id !== $project->id) => false,
                    default => true,
                };
            }
            if (! $allowed[$key]) {
                // Same message for "does not exist" and "not yours" (no guessing other IDs).
                $errors["entries.$i.".($taskId && $project ? 'task_id' : 'project_id')] = $taskId && $project
                    ? 'That task is not available in this project.'
                    : 'That project is not available for time logging.';

                continue;
            }

            $cell = $key.':'.$date->toDateString();
            if (isset($seen[$cell])) {
                $errors["entries.$i.work_date"] = 'This project and task already has time on that day.';

                continue;
            }
            $seen[$cell] = true;

            $day = $date->toDateString();
            $perDay[$day] = ($perDay[$day] ?? 0) + $minutes;
            if ($perDay[$day] > self::DAY_LIMIT_MINUTES) {
                $errors["entries.$i.minutes"] = 'More than 24 hours on '.$date->format('D j M').'.';

                continue;
            }

            $kept = $existing->get($key);
            $rows[] = [
                'project_id' => $projectId,
                'task_id' => $taskId,
                'project_name' => $project?->name ?? $kept?->project_name,
                'task_title' => $task?->title ?? $kept?->task_title,
                'work_date' => $day,
                'minutes' => $minutes,
                'note' => $note !== '' ? $note : null,
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $rows;
    }
}
