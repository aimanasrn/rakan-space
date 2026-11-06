<?php

namespace App\Http\Controllers\Crm;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Support\Crm\Pipeline;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Pipeline stages. Opportunity admins only. */
class StageController extends Controller
{
    public function update(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canManagePipeline($user, $organization->id), 403);
        $data = $request->validate([
            'stages' => ['required', 'array', 'min:3', 'max:15'],
            'stages.*.id' => ['nullable', 'integer'],
            'stages.*.name' => ['required', 'string', 'max:60', 'distinct'],
            'stages.*.probability' => ['required', 'integer', 'min:0', 'max:100'],
            'stages.*.kind' => ['required', Rule::in(['open', 'won', 'lost'])],
        ]);

        // validate() rebuilds nested arrays rule by rule, so rows without an "id"
        // (new stages) would move to the end. Restore the order that was sent.
        $input = $data['stages'];
        ksort($input);
        $stages = Pipeline::saveStages($organization, $user, array_values($input));

        return response()->json(['data' => $stages->map->only(['id', 'name', 'position', 'probability', 'kind'])->values()]);
    }
}
