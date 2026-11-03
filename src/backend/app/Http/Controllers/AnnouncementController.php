<?php

namespace App\Http\Controllers;

use App\Http\Resources\AttachmentResource;
use App\Http\Resources\UserSummaryResource;
use App\Models\Announcement;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Attachments;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AnnouncementController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $request->validate(['q' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:50']]);

        $page = Permissions::visibleAnnouncementsQuery($user, $organization->id)
            ->with(['author', 'department', 'attachments.uploader'])
            ->withCount('acknowledgements')
            ->withExists(['acknowledgements as acknowledged_by_me' => fn ($q) => $q->where('user_id', $user->id)])
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('title', 'ilike', $term)->orWhere('body', 'ilike', $term));
            })
            ->orderByRaw('pinned_at IS NULL')->orderByDesc('pinned_at')->latest('id')
            ->paginate($request->integer('per_page', 15));

        return response()->json([
            'data' => $page->getCollection()->map(fn ($a) => $this->present($a, $user, $request))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function show(Request $request, Organization $organization, Announcement $announcement): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAnnouncement($user, $announcement), 404);

        return response()->json(['data' => $this->present($this->load($announcement, $user), $user, $request)]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canPublishAnnouncements($user, $organization->id), 403, 'Only managers, admins and owners can publish announcements.');
        $data = $this->validated($request, $organization);

        $announcement = DB::transaction(function () use ($organization, $data, $user) {
            $announcement = $organization->announcements()->create([
                ...collect($data)->except(['attachment_ids', 'pinned'])->all(),
                'author_id' => $user->id,
                'pinned_at' => ! empty($data['pinned']) ? now() : null,
            ]);
            Attachments::attach($user, $organization, $data['attachment_ids'] ?? [], $announcement);
            ActivityLog::record($organization->id, $user, 'announcement.published', $announcement, ['title' => $announcement->title]);

            return $announcement;
        });

        Notifier::send($organization->id, $this->audienceIds($organization, $announcement), 'announcement',
            'New announcement: '.$announcement->title,
            $announcement->requires_acknowledgement ? 'Please read and acknowledge.' : null,
            '/announcements?id='.$announcement->id, $user->id, 'announcement:'.$announcement->id);

        return response()->json(['data' => $this->present($this->load($announcement, $user), $user, $request)], 201);
    }

    public function update(Request $request, Organization $organization, Announcement $announcement): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAnnouncement($user, $announcement), 404);
        abort_unless(Permissions::canManageAnnouncement($user, $announcement), 403, 'Only the author or an admin can edit this announcement.');
        $data = $this->validated($request, $organization, true);

        DB::transaction(function () use ($announcement, $data, $user, $organization) {
            $pinned = $data['pinned'] ?? null;
            $announcement->fill(collect($data)->except(['attachment_ids', 'pinned'])->all());
            if ($pinned !== null) {
                $announcement->pinned_at = $pinned ? ($announcement->pinned_at ?? now()) : null;
            }
            $announcement->save();
            Attachments::attach($user, $organization, $data['attachment_ids'] ?? [], $announcement);
        });

        return response()->json(['data' => $this->present($this->load($announcement, $user), $user, $request)]);
    }

    public function destroy(Request $request, Organization $organization, Announcement $announcement): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAnnouncement($user, $announcement), 404);
        abort_unless(Permissions::canManageAnnouncement($user, $announcement), 403, 'Only the author or an admin can delete this announcement.');

        DB::transaction(function () use ($announcement, $organization, $user) {
            $announcement->attachments()->update(['attachable_type' => null, 'attachable_id' => null]);
            ActivityLog::record($organization->id, $user, 'announcement.deleted', null, ['title' => $announcement->title]);
            $announcement->delete();
        });

        return response()->json(['message' => 'Announcement deleted.']);
    }

    public function acknowledge(Request $request, Organization $organization, Announcement $announcement): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAnnouncement($user, $announcement), 404);
        abort_unless($announcement->requires_acknowledgement, 422, 'This announcement does not need acknowledgement.');

        $announcement->acknowledgements()->firstOrCreate(['user_id' => $user->id], ['acknowledged_at' => now()]);

        return response()->json(['data' => $this->present($this->load($announcement, $user), $user, $request)]);
    }

    /** Acknowledgement status for the author and administrators. */
    public function acknowledgements(Request $request, Organization $organization, Announcement $announcement): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAnnouncement($user, $announcement), 404);
        abort_unless(Permissions::canManageAnnouncement($user, $announcement), 403, 'Only the author or an admin can see acknowledgement status.');

        $acks = $announcement->acknowledgements()->get()->keyBy('user_id');
        $audience = User::whereIn('id', $this->audienceIds($organization, $announcement))->orderBy('name')->get();

        return response()->json(['data' => $audience->map(fn ($u) => [
            'user' => new UserSummaryResource($u),
            'acknowledged_at' => $acks->get($u->id)?->acknowledged_at?->toIso8601String(),
        ])->values(), 'meta' => [
            'audience' => $audience->count(),
            'acknowledged' => $audience->filter(fn ($u) => $acks->has($u->id))->count(),
        ]]);
    }

    /** @return list<int> */
    private function audienceIds(Organization $organization, Announcement $announcement): array
    {
        $members = $organization->activeMemberships()->select('user_id');
        if ($announcement->audience === Announcement::AUDIENCE_DEPARTMENT) {
            return DB::table('department_user')->where('department_id', $announcement->department_id)
                ->whereIn('user_id', $members)->pluck('user_id')->map(fn ($id) => (int) $id)->all();
        }

        return $members->pluck('user_id')->map(fn ($id) => (int) $id)->all();
    }

    private function validated(Request $request, Organization $organization, bool $updating = false): array
    {
        $req = $updating ? 'sometimes' : 'required';
        $data = $request->validate([
            'title' => [$req, 'string', 'max:200'],
            'body' => [$req, 'string', 'max:20000'],
            'audience' => [$req, Rule::in([Announcement::AUDIENCE_ORGANIZATION, Announcement::AUDIENCE_DEPARTMENT])],
            'department_id' => ['nullable', 'required_if:audience,department', 'integer',
                Rule::exists('departments', 'id')->where('organization_id', $organization->id)],
            'requires_acknowledgement' => ['sometimes', 'boolean'],
            'pinned' => ['sometimes', 'boolean'],
            'attachment_ids' => ['sometimes', 'array', 'max:10'],
            'attachment_ids.*' => ['integer'],
        ]);

        if (($data['audience'] ?? null) === Announcement::AUDIENCE_DEPARTMENT) {
            abort_unless(Permissions::canPublishToDepartment($request->user(), $organization->id, (int) $data['department_id']), 403,
                'Managers can only publish to departments they belong to.');
        } elseif (isset($data['audience'])) {
            $data['department_id'] = null;
        }

        return $data;
    }

    private function load(Announcement $announcement, User $user): Announcement
    {
        return $announcement->load(['author', 'department', 'attachments.uploader'])
            ->loadCount('acknowledgements')
            ->loadExists(['acknowledgements as acknowledged_by_me' => fn ($q) => $q->where('user_id', $user->id)]);
    }

    private function present(Announcement $a, User $user, Request $request): array
    {
        return [
            'id' => $a->id,
            'title' => $a->title,
            'body' => $a->body,
            'audience' => $a->audience,
            'department' => $a->department ? ['id' => $a->department->id, 'name' => $a->department->name] : null,
            'author' => $a->author ? new UserSummaryResource($a->author) : null,
            'pinned' => $a->pinned_at !== null,
            'requires_acknowledgement' => $a->requires_acknowledgement,
            'acknowledged' => (bool) $a->acknowledged_by_me,
            'acknowledgements_count' => (int) $a->acknowledgements_count,
            'attachments' => AttachmentResource::collection($a->attachments)->resolve($request),
            'can_manage' => Permissions::canManageAnnouncement($user, $a),
            'created_at' => $a->created_at->toIso8601String(),
            'updated_at' => $a->updated_at->toIso8601String(),
        ];
    }
}
