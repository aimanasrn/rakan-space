<?php

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Models\Activity as ActivityLogEntry;
use App\Models\Crm\Activity;
use App\Models\Crm\Opportunity;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Crm\Pipeline;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Opportunities, the pipeline board and the forecast. Routes require the Opportunity app. */
class OpportunityController extends Controller
{
    /** Abilities, stages and the member's open follow-ups. */
    public function summary(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();

        return response()->json(['data' => [
            'can_create' => Permissions::canCreateCrmRecords($user, $organization->id),
            'see_all' => Permissions::canSeeAllOpportunities($user, $organization->id),
            'can_delete' => Permissions::canDeleteCrmRecords($user, $organization->id),
            'can_manage_pipeline' => Permissions::canManagePipeline($user, $organization->id),
            'currency' => 'MYR',
            'stages' => Pipeline::stages($organization)->map->only(['id', 'name', 'position', 'probability', 'kind'])->values(),
            'open_tasks' => Activity::where('organization_id', $organization->id)->where('user_id', $user->id)
                ->where('type', 'task')->whereNull('done_at')->count(),
        ]]);
    }

    /** Every visible opportunity (the board shows all stages), filtered. */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $request->validate([
            'owner' => ['nullable', 'in:me,all'],
            'q' => ['nullable', 'string', 'max:100'],
            'account_id' => ['nullable', 'integer'],
            'closed' => ['nullable', 'in:recent,all,none'],
        ]);
        $user = $request->user();
        $q = trim((string) $request->input('q'));
        $closed = $request->input('closed', 'recent');

        $opportunities = Permissions::visibleOpportunitiesQuery($user, $organization->id)
            ->when($request->input('owner') === 'me', fn ($w) => $w->where('owner_id', $user->id))
            ->when($request->filled('account_id'), fn ($w) => $w->where('account_id', $request->integer('account_id')))
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('crm_opportunities.name', 'ilike', '%'.addcslashes($q, '%_\\').'%')
                ->orWhereHas('account', fn ($a) => $a->where('name', 'ilike', '%'.addcslashes($q, '%_\\').'%'))))
            // Won/lost columns would grow forever: by default only the last 90 days.
            ->when($closed === 'recent', fn ($w) => $w->where(fn ($x) => $x->whereNull('closed_at')->orWhere('closed_at', '>=', now()->subDays(90))))
            ->when($closed === 'none', fn ($w) => $w->whereNull('closed_at'))
            ->with(['account', 'contact', 'owner'])
            ->orderBy('position')->orderByDesc('id')->limit(1000)->get();

        return response()->json(['data' => $opportunities->map(fn ($o) => Present::opportunity($o, $user))->values()]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canCreateCrmRecords($user, $organization->id), 403);
        $opportunity = Pipeline::create($organization, $user, $this->validated($request, true));

        return response()->json(['data' => $this->detail($opportunity, $request)], 201);
    }

    public function show(Request $request, Organization $organization, Opportunity $opportunity): JsonResponse
    {
        abort_unless(Permissions::canViewOpportunity($request->user(), $opportunity), 404);

        return response()->json(['data' => $this->detail($opportunity, $request)]);
    }

    public function update(Request $request, Organization $organization, Opportunity $opportunity): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewOpportunity($user, $opportunity), 404);
        Pipeline::authorizeEdit($user, $opportunity);
        $opportunity = Pipeline::update($opportunity, $user, $this->validated($request, false));

        return response()->json(['data' => $this->detail($opportunity, $request)]);
    }

    public function move(Request $request, Organization $organization, Opportunity $opportunity): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewOpportunity($user, $opportunity), 404);
        Pipeline::authorizeEdit($user, $opportunity);
        $data = $request->validate([
            'stage_id' => ['required', 'integer'],
            'lost_reason' => ['nullable', 'string', 'max:300'],
            'ordered_ids' => ['sometimes', 'array', 'max:1000'],
            'ordered_ids.*' => ['integer'],
        ]);
        if (! empty($data['lost_reason'])) {
            $opportunity = Pipeline::update($opportunity, $user, ['stage_id' => $data['stage_id'], 'lost_reason' => $data['lost_reason']]);
        }
        $opportunity = Pipeline::move($opportunity, $user, (int) $data['stage_id'], $data['ordered_ids'] ?? []);

        return response()->json(['data' => Present::opportunity($opportunity->load(['account', 'contact', 'owner']), $user)]);
    }

    public function destroy(Request $request, Organization $organization, Opportunity $opportunity): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewOpportunity($user, $opportunity), 404);
        abort_unless(Permissions::canDeleteCrmRecords($user, $organization->id), 403);
        ActivityLog::audit($organization->id, $user, 'crm.opportunity_deleted', null, ['name' => $opportunity->name]);
        $opportunity->delete();

        return response()->json(null, 204);
    }

    public function forecast(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['owner' => ['nullable', 'in:me,all'], 'months' => ['nullable', 'integer', 'min:1', 'max:12']]);
        $user = $request->user();

        return response()->json(['data' => Pipeline::forecast($user, $organization, $request->integer('months', 6),
            $request->input('owner') === 'me' ? $user->id : null)]);
    }

    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$required, 'string', 'max:200'],
            'amount' => ['sometimes', 'numeric', 'min:0', 'max:999999999999'],
            'account_id' => ['sometimes', 'nullable', 'integer'],
            'contact_id' => ['sometimes', 'nullable', 'integer'],
            'stage_id' => ['sometimes', 'integer'],
            'owner_id' => ['sometimes', 'integer'],
            'expected_close_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'lost_reason' => ['sometimes', 'nullable', 'string', 'max:300'],
        ]);
    }

    private function detail(Opportunity $opportunity, Request $request): array
    {
        $user = $request->user();
        $opportunity->load(['account', 'contact', 'owner']);
        $history = ActivityLogEntry::where('organization_id', $opportunity->organization_id)
            ->where('subject_type', $opportunity->getMorphClass())->where('subject_id', $opportunity->id)
            ->with('actor')->orderBy('id')->limit(100)->get();

        return [
            ...Present::opportunity($opportunity, $user),
            'description' => $opportunity->description,
            'activities' => $opportunity->activities()->with(['user', 'opportunity', 'account'])->limit(200)->get()
                ->map(fn ($a) => Present::activity($a, $user))->values(),
            'history' => $history->map(fn ($h) => [
                'id' => $h->id, 'event' => $h->event, 'actor' => $h->actor?->name,
                'from' => $h->properties['from'] ?? null, 'to' => $h->properties['to'] ?? null,
                'created_at' => $h->created_at->toIso8601String(),
            ])->values(),
            'permissions' => [
                'edit' => Permissions::canEditOpportunity($user, $opportunity),
                'delete' => Permissions::canDeleteCrmRecords($user, $opportunity->organization_id),
                'reassign' => Permissions::canSeeAllOpportunities($user, $opportunity->organization_id),
            ],
        ];
    }
}
