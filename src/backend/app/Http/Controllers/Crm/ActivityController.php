<?php

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Models\Crm\Activity;
use App\Models\Organization;
use App\Support\Crm\Pipeline;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Notes, calls, meetings, emails and follow-up tasks. Routes require the Opportunity app. */
class ActivityController extends Controller
{
    /** The member's follow-up tasks (open by default), soonest first. */
    public function myTasks(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['done' => ['nullable', 'boolean']]);
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);

        $tasks = Activity::where('organization_id', $organization->id)->where('user_id', $user->id)->where('type', 'task')
            ->when(! $request->boolean('done'), fn ($q) => $q->whereNull('done_at'))
            ->with(['user', 'opportunity', 'account'])
            ->orderByRaw('due_at asc nulls last')->orderBy('id')->limit(200)->get()
            // The opportunity may have changed hands since; keep only what is still visible.
            ->filter(fn ($a) => Permissions::canViewCrmActivity($user, $a));

        return response()->json(['data' => $tasks->map(fn ($a) => Present::activity($a, $user))->values()]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);
        $data = $request->validate([
            'type' => ['required', Rule::in(Activity::TYPES)],
            'subject' => ['required', 'string', 'max:200'],
            'body' => ['nullable', 'string', 'max:10000'],
            'due_at' => ['nullable', 'date'],
            'opportunity_id' => ['nullable', 'integer', 'required_without:account_id'],
            'account_id' => ['nullable', 'integer'],
        ]);

        if (! empty($data['opportunity_id'])) {
            $opportunity = $organization->opportunities()->find($data['opportunity_id']);
            // Same answer for "does not exist" and "not yours".
            if (! $opportunity || ! Permissions::canViewOpportunity($user, $opportunity)) {
                throw ValidationException::withMessages(['opportunity_id' => 'Choose an opportunity.']);
            }
            Pipeline::authorizeEdit($user, $opportunity);
            $data['account_id'] = $opportunity->account_id;
        } elseif (! empty($data['account_id'])) {
            abort_unless(Permissions::canCreateCrmRecords($user, $organization->id), 403);
            $data['account_id'] = $organization->accounts()->whereKey($data['account_id'])->value('id')
                ?? throw ValidationException::withMessages(['account_id' => 'Choose an account.']);
        }

        $activity = $organization->crmActivities()->create([
            ...$data,
            'due_at' => $data['type'] === 'task' ? ($data['due_at'] ?? null) : null,
            'user_id' => $user->id,
        ]);
        if (isset($opportunity)) {
            $opportunity->touch();
        }

        return response()->json(['data' => Present::activity($activity->load(['user', 'opportunity', 'account']), $user)], 201);
    }

    /** Edit, or tick a task done / not done. */
    public function update(Request $request, Organization $organization, Activity $crmActivity): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewCrmActivity($user, $crmActivity), 404);
        abort_unless(Permissions::canEditCrmActivity($user, $crmActivity), 403);
        $data = $request->validate([
            'subject' => ['sometimes', 'string', 'max:200'],
            'body' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'due_at' => ['sometimes', 'nullable', 'date'],
            'done' => ['sometimes', 'boolean'],
        ]);
        if (array_key_exists('done', $data)) {
            $crmActivity->done_at = $data['done'] ? ($crmActivity->done_at ?? now()) : null;
            unset($data['done']);
        }
        $crmActivity->fill($data)->save();

        return response()->json(['data' => Present::activity($crmActivity->load(['user', 'opportunity', 'account']), $user)]);
    }

    public function destroy(Request $request, Organization $organization, Activity $crmActivity): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewCrmActivity($user, $crmActivity), 404);
        abort_unless(Permissions::canEditCrmActivity($user, $crmActivity), 403);
        $crmActivity->delete();

        return response()->json(null, 204);
    }
}
