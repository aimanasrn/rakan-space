<?php

namespace App\Http\Controllers\Helpdesk;

use App\Http\Controllers\Controller;
use App\Models\Helpdesk\CannedResponse;
use App\Models\Organization;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Saved replies. Agents use them; Helpdesk admins manage them. */
class CannedResponseController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::isHelpdeskAgent($request->user(), $organization->id), 403);

        return response()->json(['data' => $organization->cannedResponses()->orderBy('title')->get(['id', 'title', 'body'])]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::canManageHelpdesk($request->user(), $organization->id), 403);
        $response = $organization->cannedResponses()->create([...$this->validated($request), 'created_by' => $request->user()->id]);

        return response()->json(['data' => $response->only(['id', 'title', 'body'])], 201);
    }

    public function update(Request $request, Organization $organization, CannedResponse $cannedResponse): JsonResponse
    {
        abort_unless(Permissions::isHelpdeskAgent($request->user(), $organization->id), 404);
        abort_unless(Permissions::canManageHelpdesk($request->user(), $organization->id), 403);
        $cannedResponse->update($this->validated($request));

        return response()->json(['data' => $cannedResponse->only(['id', 'title', 'body'])]);
    }

    public function destroy(Request $request, Organization $organization, CannedResponse $cannedResponse): JsonResponse
    {
        abort_unless(Permissions::isHelpdeskAgent($request->user(), $organization->id), 404);
        abort_unless(Permissions::canManageHelpdesk($request->user(), $organization->id), 403);
        $cannedResponse->delete();

        return response()->json(null, 204);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:5000'],
        ]);
    }
}
