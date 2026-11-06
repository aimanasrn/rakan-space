<?php

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Models\Crm\Account;
use App\Models\Crm\Activity;
use App\Models\Crm\Contact;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/** Accounts and contacts: the shared customer directory. Routes require the Opportunity app. */
class DirectoryController extends Controller
{
    // ------------------------------------------------------------- accounts

    public function accounts(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['q' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);
        $q = trim((string) $request->input('q'));

        $page = $organization->accounts()->getQuery()
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('name', 'ilike', '%'.addcslashes($q, '%_\\').'%')
                ->orWhere('industry', 'ilike', '%'.addcslashes($q, '%_\\').'%')))
            ->withCount('contacts')->with('owner')->orderBy('name')
            ->paginate($request->integer('per_page', 25));

        return response()->json([
            'data' => collect($page->items())->map(fn ($a) => Present::account($a, $user))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function storeAccount(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canCreateCrmRecords($user, $organization->id), 403);
        $data = $this->accountData($request, $organization, true);
        $account = $organization->accounts()->create([...$data, 'owner_id' => $data['owner_id'] ?? $user->id, 'created_by' => $user->id]);
        ActivityLog::record($organization->id, $user, 'crm.account_created', $account, ['name' => $account->name]);

        return response()->json(['data' => Present::account($account->load('owner'), $user)], 201);
    }

    public function showAccount(Request $request, Organization $organization, Account $account): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAccount($user, $account), 404);
        $account->load(['owner', 'contacts.account']);
        $opportunities = Permissions::visibleOpportunitiesQuery($user, $organization->id)
            ->where('account_id', $account->id)->with(['account', 'contact', 'owner'])->orderByDesc('updated_at')->limit(100)->get();
        // Activities on this account, plus those on opportunities the member can see.
        $activities = Activity::where('organization_id', $organization->id)
            ->where(fn ($w) => $w->where(fn ($x) => $x->where('account_id', $account->id)->whereNull('opportunity_id'))
                ->orWhereIn('opportunity_id', $opportunities->pluck('id')))
            ->with(['user', 'opportunity', 'account'])->latest('id')->limit(200)->get();

        return response()->json(['data' => [
            ...Present::account($account, $user),
            'contacts' => $account->contacts->map(fn ($c) => Present::contact($c, $user))->values(),
            'opportunities' => $opportunities->map(fn ($o) => Present::opportunity($o, $user))->values(),
            'activities' => $activities->map(fn ($a) => Present::activity($a, $user))->values(),
        ]]);
    }

    public function updateAccount(Request $request, Organization $organization, Account $account): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAccount($user, $account), 404);
        abort_unless(Permissions::canEditAccount($user, $account), 403);
        $account->update($this->accountData($request, $organization, false));

        return response()->json(['data' => Present::account($account->load('owner'), $user)]);
    }

    public function destroyAccount(Request $request, Organization $organization, Account $account): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAccount($user, $account), 404);
        abort_unless(Permissions::canDeleteCrmRecords($user, $organization->id), 403);
        // Opportunities and contacts stay (account cleared); account notes go.
        ActivityLog::audit($organization->id, $user, 'crm.account_deleted', null, ['name' => $account->name]);
        $account->delete();

        return response()->json(null, 204);
    }

    // ------------------------------------------------------------- contacts

    public function contacts(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['q' => ['nullable', 'string', 'max:100'], 'account_id' => ['nullable', 'integer'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:200']]);
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);
        $q = trim((string) $request->input('q'));

        $page = $organization->contacts()->getQuery()
            ->when($request->filled('account_id'), fn ($w) => $w->where('account_id', $request->integer('account_id')))
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('name', 'ilike', '%'.addcslashes($q, '%_\\').'%')
                ->orWhere('email', 'ilike', '%'.addcslashes($q, '%_\\').'%')))
            ->with('account')->orderBy('name')
            ->paginate($request->integer('per_page', 25));

        return response()->json([
            'data' => collect($page->items())->map(fn ($c) => Present::contact($c, $user))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function storeContact(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canCreateCrmRecords($user, $organization->id), 403);
        $contact = $organization->contacts()->create([...$this->contactData($request, $organization, true), 'created_by' => $user->id]);

        return response()->json(['data' => Present::contact($contact->load('account'), $user)], 201);
    }

    public function updateContact(Request $request, Organization $organization, Contact $contact): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);
        abort_unless(Permissions::canEditContact($user, $contact), 403);
        $contact->update($this->contactData($request, $organization, false));

        return response()->json(['data' => Present::contact($contact->load('account'), $user)]);
    }

    public function destroyContact(Request $request, Organization $organization, Contact $contact): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canUseCrm($user, $organization->id), 404);
        abort_unless(Permissions::canDeleteCrmRecords($user, $organization->id), 403);
        $contact->delete();

        return response()->json(null, 204);
    }

    // ------------------------------------------------------------- helpers

    private function accountData(Request $request, Organization $organization, bool $creating): array
    {
        $data = $request->validate([
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:160'],
            'industry' => ['sometimes', 'nullable', 'string', 'max:80'],
            'website' => ['sometimes', 'nullable', 'url:http,https', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'owner_id' => ['sometimes', 'nullable', 'integer'],
        ]);
        if (! empty($data['owner_id'])) {
            $data['owner_id'] = $organization->filterActiveMemberIds([$data['owner_id']])[0]
                ?? throw ValidationException::withMessages(['owner_id' => 'Choose an active member.']);
        }

        return $data;
    }

    private function contactData(Request $request, Organization $organization, bool $creating): array
    {
        $data = $request->validate([
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:160'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'job_title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'account_id' => ['sometimes', 'nullable', 'integer'],
        ]);
        if (! empty($data['account_id'])) {
            $data['account_id'] = $organization->accounts()->whereKey($data['account_id'])->value('id')
                ?? throw ValidationException::withMessages(['account_id' => 'Choose an account.']);
        }

        return $data;
    }
}
