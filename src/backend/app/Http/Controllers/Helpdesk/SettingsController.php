<?php

namespace App\Http\Controllers\Helpdesk;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserSummaryResource;
use App\Models\Helpdesk\Ticket;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Helpdesk\Helpdesk;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** SLA targets, categories, auto-close and the agent list. Helpdesk admins only. */
class SettingsController extends Controller
{
    public function show(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::canManageHelpdesk($request->user(), $organization->id), 403);

        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    public function update(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canManageHelpdesk($user, $organization->id), 403);
        $rules = [
            'categories' => ['sometimes', 'array', 'max:30'],
            'categories.*' => ['string', 'max:60', 'distinct'],
            'auto_close_days' => ['sometimes', 'integer', 'min:0', 'max:90'],
            'agent_ids' => ['sometimes', 'array', 'max:200'],
            'agent_ids.*' => ['integer'],
            'sla' => ['sometimes', 'array'],
        ];
        foreach (Ticket::PRIORITIES as $p) {
            $rules["sla.$p.first_response_hours"] = ['required_with:sla', 'integer', 'min:1', 'max:2160'];
            $rules["sla.$p.resolution_hours"] = ['required_with:sla', 'integer', 'min:1', 'max:2160', "gte:sla.$p.first_response_hours"];
        }
        $data = $request->validate($rules);

        DB::transaction(function () use ($organization, $user, $data) {
            $settings = Helpdesk::settings($organization);
            if (array_key_exists('categories', $data)) {
                $settings->categories = array_values(array_filter(array_map('trim', $data['categories']), fn ($c) => $c !== ''));
            }
            if (array_key_exists('auto_close_days', $data)) {
                $settings->auto_close_days = $data['auto_close_days'];
            }
            if (array_key_exists('sla', $data)) {
                $settings->sla = collect(Ticket::PRIORITIES)->mapWithKeys(fn ($p) => [$p => [
                    'first_response_hours' => (int) $data['sla'][$p]['first_response_hours'],
                    'resolution_hours' => (int) $data['sla'][$p]['resolution_hours'],
                ]])->all();
            }
            $settings->save();

            if (array_key_exists('agent_ids', $data)) {
                // Never trust client IDs: only active members of this organisation.
                $ids = $organization->filterActiveMemberIds($data['agent_ids']);
                DB::table('helpdesk_agents')->where('organization_id', $organization->id)->whereNotIn('user_id', $ids)->delete();
                DB::table('helpdesk_agents')->insertOrIgnore(array_map(fn ($id) => [
                    'organization_id' => $organization->id, 'user_id' => $id, 'created_at' => now(), 'updated_at' => now(),
                ], $ids));
            }
            ActivityLog::audit($organization->id, $user, 'helpdesk.settings_updated', null, ['fields' => array_keys($data)]);
        });

        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    private function payload(Organization $organization, Request $request): array
    {
        $settings = Helpdesk::settings($organization);
        $listed = DB::table('helpdesk_agents')->where('organization_id', $organization->id)->pluck('user_id');

        return [
            'sla' => $settings->slaPolicy(),
            'categories' => $settings->categoryList(),
            'auto_close_days' => $settings->auto_close_days,
            'agents' => UserSummaryResource::collection(User::whereIn('id', $listed)->orderBy('name')->get())->resolve($request),
        ];
    }
}
