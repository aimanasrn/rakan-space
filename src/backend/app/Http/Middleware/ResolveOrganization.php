<?php

namespace App\Http\Middleware;

use App\Models\Organization;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the {organization} route parameter and requires an *active*
 * membership for the authenticated user. Responds 404 for non-members so
 * the existence of other organisations is not revealed.
 */
class ResolveOrganization
{
    public function handle(Request $request, Closure $next): Response
    {
        $organization = $request->route('organization');

        if (! $organization instanceof Organization) {
            abort(404);
        }

        $membership = $request->user()?->membershipIn($organization);

        if (! $membership) {
            abort(404, 'Workspace not found.');
        }

        $request->attributes->set('membership', $membership);

        return $next($request);
    }
}
