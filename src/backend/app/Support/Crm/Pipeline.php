<?php

namespace App\Support\Crm;

use App\Models\Crm\Account;
use App\Models\Crm\Contact;
use App\Models\Crm\Opportunity;
use App\Models\Crm\Stage;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Notifier;
use App\Support\Permissions;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Opportunity rules. IDs from the client (account, contact, stage, owner) are
 * always resolved inside the organisation. Controllers check visibility first.
 */
class Pipeline
{
    /** The organisation's stages in order; the default pipeline is created on first use. */
    public static function stages(Organization|int $organization): Collection
    {
        $id = $organization instanceof Organization ? $organization->id : $organization;
        if (! Stage::where('organization_id', $id)->exists()) {
            DB::transaction(function () use ($id) {
                DB::table('organizations')->where('id', $id)->lockForUpdate()->first();
                if (Stage::where('organization_id', $id)->exists()) {
                    return;
                }
                foreach (Stage::DEFAULTS as $i => $stage) {
                    Stage::create([...$stage, 'organization_id' => $id, 'position' => $i + 1]);
                }
            });
        }

        return Stage::where('organization_id', $id)->orderBy('position')->get();
    }

    /** @param array<string, mixed> $data */
    public static function create(Organization $organization, User $actor, array $data): Opportunity
    {
        $stages = self::stages($organization);
        $data['stage_id'] ??= $stages->firstWhere('kind', Stage::KIND_OPEN)?->id;
        $data['owner_id'] ??= $actor->id;
        $clean = self::clean($organization, $actor, $data, null, $stages);

        return DB::transaction(function () use ($organization, $actor, $clean) {
            $opportunity = Opportunity::create([
                ...$clean,
                'organization_id' => $organization->id,
                'created_by' => $actor->id,
                'position' => (int) Opportunity::where('organization_id', $organization->id)->where('stage_id', $clean['stage_id'])->max('position') + 1,
            ]);
            ActivityLog::record($organization->id, $actor, 'crm.opportunity_created', $opportunity, ['name' => $opportunity->name]);
            self::notifyOwner($opportunity, $actor);

            return $opportunity;
        });
    }

    /** @param array<string, mixed> $data */
    public static function update(Opportunity $opportunity, User $actor, array $data): Opportunity
    {
        $organization = Organization::findOrFail($opportunity->organization_id);
        $clean = self::clean($organization, $actor, $data, $opportunity, self::stages($organization));

        return DB::transaction(function () use ($opportunity, $actor, $clean) {
            $before = $opportunity->only(['stage_id', 'owner_id', 'amount']);
            $opportunity->fill($clean);
            if ($opportunity->isDirty('stage_id')) {
                $opportunity->position = (int) Opportunity::where('organization_id', $opportunity->organization_id)
                    ->where('stage_id', $opportunity->stage_id)->max('position') + 1;
            }
            $opportunity->save();

            if ((int) $before['stage_id'] !== $opportunity->stage_id) {
                $stage = Stage::find($opportunity->stage_id);
                ActivityLog::record($opportunity->organization_id, $actor, 'crm.stage_changed', $opportunity,
                    ['from' => Stage::find($before['stage_id'])?->name, 'to' => $stage?->name]);
            }
            if ($before['owner_id'] !== $opportunity->owner_id) {
                self::notifyOwner($opportunity, $actor);
            }

            return $opportunity->fresh();
        });
    }

    /** Drag-and-drop: change stage and/or order inside the column. */
    public static function move(Opportunity $opportunity, User $actor, int $stageId, array $orderedIds = []): Opportunity
    {
        $opportunity = self::update($opportunity, $actor, ['stage_id' => $stageId]);
        if ($orderedIds !== []) {
            // Only cards the actor can see, in the same organisation and column.
            $valid = Permissions::visibleOpportunitiesQuery($actor, $opportunity->organization_id)
                ->where('stage_id', $stageId)->whereIn('crm_opportunities.id', $orderedIds)->pluck('crm_opportunities.id')->flip();
            foreach (array_values(array_unique(array_map('intval', $orderedIds))) as $i => $id) {
                if ($valid->has($id)) {
                    Opportunity::whereKey($id)->update(['position' => $i]);
                }
            }
        }

        return $opportunity->fresh();
    }

    /**
     * Expected revenue by month of expected close (open opportunities), with
     * the stage-weighted amount, plus won revenue by month closed.
     */
    public static function forecast(User $user, Organization $organization, int $months = 6, ?int $ownerId = null): array
    {
        $tz = $organization->timezone ?: config('app.timezone');
        $start = CarbonImmutable::now($tz)->startOfMonth();
        $end = $start->addMonths($months);
        $stages = self::stages($organization)->keyBy('id');
        $base = fn () => Permissions::visibleOpportunitiesQuery($user, $organization->id)
            ->when($ownerId, fn ($q) => $q->where('owner_id', $ownerId));

        $open = $base()->whereIn('stage_id', $stages->where('kind', Stage::KIND_OPEN)->keys())->get(['id', 'amount', 'stage_id', 'expected_close_date']);
        $won = $base()->whereIn('stage_id', $stages->where('kind', Stage::KIND_WON)->keys())
            ->where('closed_at', '>=', $start->subMonths($months)->utc())->get(['amount', 'closed_at']);

        $rows = [];
        for ($m = $start->subMonths($months); $m->lt($end); $m = $m->addMonth()) {
            $rows[$m->format('Y-m')] = ['month' => $m->format('Y-m'), 'open_amount' => 0.0, 'weighted_amount' => 0.0, 'won_amount' => 0.0, 'count' => 0];
        }
        $overdue = ['open_amount' => 0.0, 'weighted_amount' => 0.0, 'count' => 0];
        $undated = ['open_amount' => 0.0, 'weighted_amount' => 0.0, 'count' => 0];

        foreach ($open as $o) {
            $amount = (float) $o->amount;
            $weighted = $amount * ($stages[$o->stage_id]->probability / 100);
            if (! $o->expected_close_date) {
                $bucket = &$undated;
            } elseif ($o->expected_close_date->lt($start)) {
                $bucket = &$overdue;
            } elseif ($o->expected_close_date->gte($end)) {
                unset($bucket);

                continue;
            } else {
                $bucket = &$rows[$o->expected_close_date->format('Y-m')];
            }
            $bucket['open_amount'] += $amount;
            $bucket['weighted_amount'] += $weighted;
            $bucket['count']++;
            unset($bucket);
        }
        foreach ($won as $w) {
            $key = CarbonImmutable::parse($w->closed_at)->setTimezone($tz)->format('Y-m');
            if (isset($rows[$key])) {
                $rows[$key]['won_amount'] += (float) $w->amount;
            }
        }

        $round = fn (array $r) => array_map(fn ($v) => is_float($v) ? round($v, 2) : $v, $r);
        $byStage = $base()->selectRaw('stage_id, count(*) as count, coalesce(sum(amount), 0) as amount')->groupBy('stage_id')->get()->keyBy('stage_id');

        return [
            'currency' => 'MYR',
            'months' => array_values(array_map($round, $rows)),
            'current_month' => $start->format('Y-m'),
            'overdue' => $round($overdue),
            'undated' => $round($undated),
            'stages' => $stages->values()->map(fn (Stage $s) => [
                'id' => $s->id, 'name' => $s->name, 'kind' => $s->kind, 'probability' => $s->probability,
                'count' => (int) ($byStage[$s->id]->count ?? 0), 'amount' => round((float) ($byStage[$s->id]->amount ?? 0), 2),
            ])->all(),
        ];
    }

    /**
     * Replaces the pipeline. At least one open stage and exactly one won and one
     * lost stage. Stages with opportunities cannot be removed.
     *
     * @param  list<array{id?: int|null, name: string, probability: int, kind: string}>  $input
     */
    public static function saveStages(Organization $organization, User $actor, array $input): Collection
    {
        $kinds = array_count_values(array_column($input, 'kind'));
        if (($kinds['open'] ?? 0) < 1 || ($kinds['won'] ?? 0) !== 1 || ($kinds['lost'] ?? 0) !== 1) {
            throw ValidationException::withMessages(['stages' => 'Keep at least one open stage and exactly one Won and one Lost stage.']);
        }

        return DB::transaction(function () use ($organization, $actor, $input) {
            $existing = self::stages($organization)->keyBy('id');
            $kept = [];
            foreach (array_values($input) as $i => $row) {
                $stage = isset($row['id']) && $row['id'] ? $existing->get((int) $row['id']) : null;
                if (isset($row['id']) && $row['id'] && ! $stage) {
                    throw ValidationException::withMessages(["stages.$i.id" => 'Unknown stage.']);
                }
                $values = ['name' => trim($row['name']), 'probability' => (int) $row['probability'], 'kind' => $row['kind'], 'position' => $i + 1];
                if ($stage) {
                    if ($stage->kind !== $row['kind'] && Opportunity::where('stage_id', $stage->id)->exists()) {
                        throw ValidationException::withMessages(["stages.$i.kind" => 'Move the opportunities out of "'.$stage->name.'" before changing its type.']);
                    }
                    $stage->update($values);
                } else {
                    $stage = Stage::create([...$values, 'organization_id' => $organization->id]);
                }
                $kept[] = $stage->id;
            }
            foreach ($existing->except($kept) as $removed) {
                if (Opportunity::where('stage_id', $removed->id)->exists()) {
                    throw ValidationException::withMessages(['stages' => 'Move the opportunities out of "'.$removed->name.'" before removing it.']);
                }
                $removed->delete();
            }
            ActivityLog::audit($organization->id, $actor, 'crm.stages_updated', null, ['count' => count($kept)]);

            return self::stages($organization);
        });
    }

    // ---------------------------------------------------------------- internals

    /**
     * Validates references against the organisation and applies stage rules.
     *
     * @return array<string, mixed>
     */
    private static function clean(Organization $organization, User $actor, array $data, ?Opportunity $current, Collection $stages): array
    {
        $out = array_intersect_key($data, array_flip(['name', 'amount', 'expected_close_date', 'description', 'lost_reason']));
        $seeAll = Permissions::canSeeAllOpportunities($actor, $organization->id);

        if (array_key_exists('account_id', $data)) {
            $out['account_id'] = $data['account_id']
                ? (Account::where('organization_id', $organization->id)->whereKey($data['account_id'])->value('id')
                    ?? throw ValidationException::withMessages(['account_id' => 'Choose an account.']))
                : null;
        }
        if (array_key_exists('contact_id', $data)) {
            $contact = $data['contact_id'] ? Contact::where('organization_id', $organization->id)->find($data['contact_id']) : null;
            if ($data['contact_id'] && ! $contact) {
                throw ValidationException::withMessages(['contact_id' => 'Choose a contact.']);
            }
            $accountId = $out['account_id'] ?? $current?->account_id;
            if ($contact && $contact->account_id && $accountId && $contact->account_id !== $accountId) {
                throw ValidationException::withMessages(['contact_id' => 'This contact belongs to another account.']);
            }
            $out['contact_id'] = $contact?->id;
        }
        if (array_key_exists('owner_id', $data) && (int) $data['owner_id'] !== (int) $current?->owner_id) {
            $ownerId = (int) $data['owner_id'];
            if ($ownerId !== $actor->id && ! $seeAll) {
                throw ValidationException::withMessages(['owner_id' => 'Only sales managers can give opportunities to someone else.']);
            }
            $ownerId = $organization->filterActiveMemberIds([$ownerId])[0] ?? null;
            if (! $ownerId || ! Permissions::canUseCrm(User::findOrFail($ownerId), $organization->id)) {
                throw ValidationException::withMessages(['owner_id' => 'Choose a member who uses the Opportunity app.']);
            }
            $out['owner_id'] = $ownerId;
        }

        if (array_key_exists('stage_id', $data)) {
            $stage = $stages->firstWhere('id', (int) $data['stage_id'])
                ?? throw ValidationException::withMessages(['stage_id' => 'Choose a stage.']);
            $out['stage_id'] = $stage->id;
            $wasClosed = $current && $stages->firstWhere('id', $current->stage_id)?->kind !== Stage::KIND_OPEN;
            if ($stage->kind === Stage::KIND_OPEN) {
                $out['closed_at'] = null;
                $out['lost_reason'] = null;
            } elseif (! $wasClosed || $current->stage_id !== $stage->id) {
                $out['closed_at'] = now();
            }
            if ($stage->kind === Stage::KIND_LOST && ! trim((string) ($data['lost_reason'] ?? $current?->lost_reason ?? ''))) {
                throw ValidationException::withMessages(['lost_reason' => 'Say why the opportunity was lost.']);
            }
            if ($stage->kind === Stage::KIND_WON) {
                $out['lost_reason'] = null;
            }
        }

        if ($current === null && empty($out['name'])) {
            throw ValidationException::withMessages(['name' => 'Name the opportunity.']);
        }
        // A lost reason only exists while the opportunity sits in the Lost stage.
        $finalStage = $stages->firstWhere('id', $out['stage_id'] ?? $current?->stage_id);
        if ($finalStage?->kind !== Stage::KIND_LOST) {
            $out['lost_reason'] = null;
        } elseif (array_key_exists('lost_reason', $out)) {
            $out['lost_reason'] = trim((string) $out['lost_reason']) ?: ($current?->lost_reason
                ?? throw ValidationException::withMessages(['lost_reason' => 'Say why the opportunity was lost.']));
        }

        return $out;
    }

    private static function notifyOwner(Opportunity $opportunity, User $actor): void
    {
        if (! $opportunity->owner_id || $opportunity->owner_id === $actor->id) {
            return;
        }
        Notifier::send($opportunity->organization_id, [$opportunity->owner_id], 'crm.assigned',
            $actor->name.' gave you an opportunity: '.$opportunity->name, null,
            $opportunity->link(), $actor->id, 'crm-owner:'.$opportunity->id.':'.$opportunity->owner_id);
    }

    /** Guard used by controllers before changing an opportunity. */
    public static function authorizeEdit(User $user, Opportunity $opportunity): void
    {
        if (! Permissions::canEditOpportunity($user, $opportunity)) {
            throw new HttpException(403, 'Only the owner or a sales manager can change this opportunity.');
        }
    }
}
