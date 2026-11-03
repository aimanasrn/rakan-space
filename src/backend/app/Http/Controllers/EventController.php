<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Resources\UserSummaryResource;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Notifier;
use App\Support\Permissions;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Calendar events. Timestamps are stored in UTC (timestamptz) and the API
 * returns ISO-8601 with offset; the client renders them in the organisation
 * time zone. Task deadlines are date-only and returned as plain dates.
 */
class EventController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after:from'],
            'include_tasks' => ['nullable', 'boolean'],
        ]);
        $user = $request->user();
        $from = CarbonImmutable::parse($request->input('from'));
        $to = CarbonImmutable::parse($request->input('to'));
        abort_if($from->diffInDays($to) > 120, 422, 'Choose a range of 120 days or less.');

        $events = Permissions::visibleEventsQuery($user, $organization->id)
            ->with(['participants', 'creator'])
            ->where('starts_at', '<', $to)->where('ends_at', '>', $from)
            ->orderBy('starts_at')->get();

        $deadlines = [];
        if ($request->boolean('include_tasks', true)) {
            $projects = Permissions::visibleProjectsQuery($user, $organization->id)->whereNull('archived_at')->select('id');
            $deadlines = $organization->tasks()->with('project:id,name', 'assignee')
                ->whereIn('project_id', $projects)
                ->whereNotNull('due_date')
                ->whereBetween('due_date', [$from->toDateString(), $to->toDateString()])
                ->orderBy('due_date')->limit(500)->get()
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'title' => $t->title,
                    'due_date' => $t->due_date->format('Y-m-d'),
                    'status' => $t->status->value,
                    'priority' => $t->priority->value,
                    'project' => ['id' => $t->project->id, 'name' => $t->project->name],
                    'assignee' => $t->assignee ? new UserSummaryResource($t->assignee) : null,
                ]);
        }

        return response()->json([
            'data' => $events->map(fn ($e) => $this->present($e, $user))->values(),
            'deadlines' => $deadlines,
            'timezone' => $organization->timezone,
        ]);
    }

    public function show(Request $request, Organization $organization, Event $event): JsonResponse
    {
        abort_unless(Permissions::canViewEvent($request->user(), $event), 404);

        return response()->json(['data' => $this->present($event->load(['participants', 'creator']), $request->user())]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $data = $this->validated($request, $organization);

        $event = DB::transaction(function () use ($organization, $data, $user) {
            $event = $organization->events()->create([
                ...collect($data)->except('participant_ids')->all(),
                'created_by' => $user->id,
            ]);
            $event->participants()->sync(array_unique([...$data['participant_ids'], $user->id]));
            ActivityLog::record($organization->id, $user, 'event.created', $event, ['title' => $event->title]);

            return $event;
        });

        $this->notifyInvitees($organization, $event, $user, 'event.created');

        return response()->json(['data' => $this->present($event->load(['participants', 'creator']), $user)], 201);
    }

    public function update(Request $request, Organization $organization, Event $event): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewEvent($user, $event), 404);
        abort_unless(Permissions::canManageEvent($user, $event), 403, 'Only the organiser can change this event.');
        $data = $this->validated($request, $organization);

        DB::transaction(function () use ($event, $data) {
            $event->update(collect($data)->except('participant_ids')->all());
            $event->participants()->sync(array_unique([...$data['participant_ids'], $event->created_by]));
        });

        $this->notifyInvitees($organization, $event, $user, 'event.updated');

        return response()->json(['data' => $this->present($event->load(['participants', 'creator']), $user)]);
    }

    public function destroy(Request $request, Organization $organization, Event $event): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewEvent($user, $event), 404);
        abort_unless(Permissions::canManageEvent($user, $event), 403, 'Only the organiser can delete this event.');

        $event->delete();
        ActivityLog::record($organization->id, $user, 'event.deleted', null, ['title' => $event->title]);

        return response()->json(['message' => 'Event deleted.']);
    }

    private function validated(Request $request, Organization $organization): array
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:5000'],
            'location' => ['nullable', 'string', 'max:200'],
            'meeting_url' => ['nullable', 'url:https,http', 'max:500'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
            'audience' => ['required', Rule::in([Event::AUDIENCE_EVERYONE, Event::AUDIENCE_PARTICIPANTS])],
            'reminder_minutes' => ['nullable', 'integer', Rule::in([0, 5, 10, 15, 30, 60, 120, 1440])],
            'participant_ids' => ['present', 'array', 'max:500'],
            'participant_ids.*' => ['integer'],
        ]);

        if ($data['audience'] === Event::AUDIENCE_EVERYONE) {
            abort_unless(Permissions::hasRole($request->user(), $organization->id, Role::Manager), 403,
                'Only managers, admins and owners can create organisation-wide events.');
        }

        $ids = array_values(array_unique(array_map('intval', $data['participant_ids'])));
        abort_if(count($organization->filterActiveMemberIds($ids)) !== count($ids), 422, 'Participants must be active members of this workspace.');
        $data['participant_ids'] = $ids;

        // Stored as UTC instants; clients send ISO-8601 with an offset.
        $data['starts_at'] = CarbonImmutable::parse($data['starts_at'])->utc();
        $data['ends_at'] = CarbonImmutable::parse($data['ends_at'])->utc();
        $data['reminder_minutes'] = $data['reminder_minutes'] ?? null;

        return $data;
    }

    private function notifyInvitees(Organization $organization, Event $event, User $actor, string $type): void
    {
        $recipients = $event->audience === Event::AUDIENCE_EVERYONE
            ? $organization->activeMemberships()->pluck('user_id')->all()
            : $event->participants()->pluck('users.id')->all();

        $when = $event->starts_at->copy()->setTimezone($organization->timezone)->format('D, j M Y g:i A');
        $title = $type === 'event.created'
            ? $actor->name.' invited you to "'.$event->title.'"'
            : '"'.$event->title.'" was updated';

        Notifier::send($organization->id, $recipients, $type, $title, $when, '/calendar?event='.$event->id, $actor->id,
            $type.':'.$event->id.':'.$event->updated_at->timestamp);
    }

    private function present(Event $e, User $user): array
    {
        return [
            'id' => $e->id,
            'title' => $e->title,
            'description' => $e->description,
            'location' => $e->location,
            'meeting_url' => $e->meeting_url,
            'starts_at' => $e->starts_at->toIso8601String(),
            'ends_at' => $e->ends_at->toIso8601String(),
            'audience' => $e->audience,
            'reminder_minutes' => $e->reminder_minutes,
            'creator' => $e->creator ? new UserSummaryResource($e->creator) : null,
            'participants' => UserSummaryResource::collection($e->participants),
            'can_manage' => Permissions::canManageEvent($user, $e),
        ];
    }
}
