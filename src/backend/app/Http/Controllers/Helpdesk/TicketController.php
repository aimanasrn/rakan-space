<?php

namespace App\Http\Controllers\Helpdesk;

use App\Http\Controllers\Controller;
use App\Http\Resources\AttachmentResource;
use App\Http\Resources\Helpdesk\TicketResource;
use App\Http\Resources\UserSummaryResource;
use App\Models\Activity;
use App\Models\Attachment;
use App\Models\Helpdesk\Ticket;
use App\Models\Helpdesk\TicketMessage;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Helpdesk\Helpdesk;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Tickets. Routes require the Helpdesk app (app:helpdesk). */
class TicketController extends Controller
{
    /** What the member can do here, the categories, and queue counts for agents. */
    public function summary(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $isAgent = Permissions::isHelpdeskAgent($user, $organization->id);
        $active = fn () => Ticket::where('organization_id', $organization->id)->whereIn('status', Ticket::ACTIVE);

        return response()->json(['data' => [
            'is_agent' => $isAgent,
            'can_raise' => Permissions::canRaiseTickets($user, $organization->id),
            'can_manage' => Permissions::canManageHelpdesk($user, $organization->id),
            'categories' => Helpdesk::settings($organization)->categoryList(),
            'counts' => [
                'my_open' => $active()->where('requester_id', $user->id)->count(),
                'assigned' => $isAgent ? $active()->where('assignee_id', $user->id)->count() : null,
                'unassigned' => $isAgent ? $active()->whereNull('assignee_id')->count() : null,
                'missed' => $isAgent ? $active()->where(fn ($q) => $q->where('resolution_due_at', '<=', now())
                    ->orWhere(fn ($w) => $w->whereNull('first_responded_at')->where('first_response_due_at', '<=', now())))->count() : null,
            ],
        ]]);
    }

    /** mine (raised by me) | assigned (to me) | unassigned | all — the last three for agents. */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'scope' => ['nullable', Rule::in(['mine', 'assigned', 'unassigned', 'all'])],
            'status' => ['nullable', Rule::in(['active', 'all', ...Ticket::STATUSES])],
            'priority' => ['nullable', Rule::in(Ticket::PRIORITIES)],
            'category' => ['nullable', 'string', 'max:60'],
            'q' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', Rule::in(['updated', 'due'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $scope = $request->input('scope', 'mine');
        $query = Permissions::visibleTicketsQuery($user, $organization->id);

        if ($scope === 'mine') {
            $query->where('requester_id', $user->id);
        } else {
            abort_unless(Permissions::isHelpdeskAgent($user, $organization->id), 403);
            $query->when($scope === 'assigned', fn ($q) => $q->where('assignee_id', $user->id))
                ->when($scope === 'unassigned', fn ($q) => $q->whereNull('assignee_id'));
        }

        $status = $request->input('status', 'active');
        $query->when($status === 'active', fn ($q) => $q->whereIn('status', Ticket::ACTIVE))
            ->when(! in_array($status, ['active', 'all'], true), fn ($q) => $q->where('status', $status))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->input('priority')))
            ->when($request->filled('category'), fn ($q) => $q->where('category', $request->input('category')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $input = trim($request->input('q'));
                $term = '%'.addcslashes($input, '%_\\').'%';
                $id = preg_match('/^(?:HD-)?0*(\d{1,12})$/i', $input, $m) ? (int) $m[1] : null;
                $q->where(fn ($w) => $w->where('subject', 'ilike', $term)
                    ->orWhereHas('requester', fn ($u) => $u->where('name', 'ilike', $term))
                    ->when($id, fn ($r) => $r->orWhere('helpdesk_tickets.id', $id)));
            });

        if ($request->input('sort') === 'due') {
            $query->orderByRaw('resolution_due_at asc nulls last');
        }

        return TicketResource::collection($query->with(['requester', 'assignee'])
            ->orderByDesc('last_activity_at')->orderByDesc('id')
            ->paginate($request->integer('per_page', 20)));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canRaiseTickets($user, $organization->id), 403);
        $data = $request->validate([
            'subject' => ['required', 'string', 'max:200'],
            'description' => ['required', 'string', 'max:20000'],
            'priority' => ['nullable', Rule::in(Ticket::PRIORITIES)],
            'category' => ['nullable', 'string', 'max:60'],
            'requester_id' => ['nullable', 'integer'],
            'assignee_id' => ['nullable', 'integer'],
            'attachment_ids' => ['nullable', 'array', 'max:10'],
            'attachment_ids.*' => ['integer'],
        ]);

        $ticket = Helpdesk::create($organization, $user, $data);

        return response()->json(['data' => $this->detail($ticket, $request)], 201);
    }

    public function show(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        abort_unless(Permissions::canViewTicket($request->user(), $ticket), 404);

        return response()->json(['data' => $this->detail($ticket, $request)]);
    }

    public function update(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        abort_unless(Permissions::canViewTicket($request->user(), $ticket), 404);
        $data = $request->validate([
            'subject' => ['sometimes', 'string', 'max:200'],
            'status' => ['sometimes', Rule::in(Ticket::STATUSES)],
            'priority' => ['sometimes', Rule::in(Ticket::PRIORITIES)],
            'category' => ['sometimes', 'nullable', 'string', 'max:60'],
            'assignee_id' => ['sometimes', 'nullable', 'integer'],
        ]);

        $ticket = Helpdesk::update($ticket, $request->user(), $data);

        return response()->json(['data' => $this->detail($ticket, $request)]);
    }

    public function destroy(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTicket($user, $ticket), 404);
        abort_unless(Permissions::canDeleteTicket($user, $ticket), 403);
        DB::transaction(function () use ($organization, $user, $ticket) {
            ActivityLog::audit($organization->id, $user, 'helpdesk.deleted', null, ['reference' => $ticket->reference()]);
            // Files become unattached and are removed by rakanspace:prune-attachments.
            Attachment::where('organization_id', $organization->id)
                ->where(fn ($q) => $q->where(fn ($w) => $w->where('attachable_type', $ticket->getMorphClass())->where('attachable_id', $ticket->id))
                    ->orWhere(fn ($w) => $w->where('attachable_type', 'helpdesk_message')
                        ->whereIn('attachable_id', TicketMessage::where('ticket_id', $ticket->id)->select('id'))))
                ->update(['attachable_type' => null, 'attachable_id' => null]);
            $ticket->delete();
        });

        return response()->json(null, 204);
    }

    public function reply(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTicket($user, $ticket), 404);
        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
            'internal' => ['nullable', 'boolean'],
            'status' => ['nullable', Rule::in(Ticket::STATUSES)],
            'attachment_ids' => ['nullable', 'array', 'max:10'],
            'attachment_ids.*' => ['integer'],
        ]);

        Helpdesk::reply($ticket, $user, $data['body'], (bool) ($data['internal'] ?? false), $data['status'] ?? null, $data['attachment_ids'] ?? []);

        return response()->json(['data' => $this->detail($ticket->fresh(), $request)], 201);
    }

    /** Agents a ticket can be assigned to. */
    public function agents(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::isHelpdeskAgent($request->user(), $organization->id), 403);
        $users = User::whereIn('id', Helpdesk::agentIds($organization->id))->orderBy('name')->get();

        return response()->json(['data' => UserSummaryResource::collection($users)]);
    }

    private function detail(Ticket $ticket, Request $request): array
    {
        $user = $request->user();
        $isAgent = Permissions::isHelpdeskAgent($user, $ticket->organization_id);
        $ticket->load(['requester', 'assignee', 'attachments.uploader']);
        $messages = $ticket->messages()
            ->when(! $isAgent, fn ($q) => $q->where('is_internal', false))
            ->with(['author', 'attachments.uploader'])->get();
        $activity = Activity::where('subject_type', $ticket->getMorphClass())->where('subject_id', $ticket->id)
            ->where('organization_id', $ticket->organization_id)
            ->with('actor')->orderBy('id')->limit(200)->get()
            // Requesters see status changes only (not who it was reassigned to, etc.).
            ->filter(fn ($a) => $isAgent || in_array($a->event, ['helpdesk.created', 'helpdesk.status_changed'], true));
        $names = User::whereIn('id', $activity->filter(fn ($a) => $a->event === 'helpdesk.assignee_id_changed')
            ->flatMap(fn ($a) => [$a->properties['from'] ?? null, $a->properties['to'] ?? null])->filter()->unique()->values())
            ->pluck('name', 'id');
        $mine = $ticket->requester_id === $user->id;

        return [
            ...(new TicketResource($ticket))->resolve($request),
            'description' => $ticket->description,
            'attachments' => AttachmentResource::collection($ticket->attachments)->resolve($request),
            'messages' => $messages->map(fn ($m) => [
                'id' => $m->id,
                'body' => $m->body,
                'internal' => $m->is_internal,
                'author' => $m->author ? (new UserSummaryResource($m->author))->resolve($request) : null,
                'from_requester' => $m->author_id === $ticket->requester_id,
                'attachments' => AttachmentResource::collection($m->attachments)->resolve($request),
                'created_at' => $m->created_at->toIso8601String(),
            ])->values(),
            'activity' => $activity->map(fn ($a) => [
                'id' => $a->id,
                'event' => $a->event,
                'actor' => $a->actor?->name,
                'from' => $a->event === 'helpdesk.assignee_id_changed' ? ($names[$a->properties['from'] ?? 0] ?? null) : ($a->properties['from'] ?? null),
                'to' => $a->event === 'helpdesk.assignee_id_changed' ? ($names[$a->properties['to'] ?? 0] ?? null) : ($a->properties['to'] ?? null),
                'created_at' => $a->created_at->toIso8601String(),
            ])->values(),
            'permissions' => [
                'work' => $isAgent,
                'reply' => $ticket->status !== Ticket::STATUS_CLOSED,
                'resolve' => $mine && ! $isAgent && $ticket->isActive(),
                'delete' => Permissions::canDeleteTicket($user, $ticket),
            ],
        ];
    }
}
