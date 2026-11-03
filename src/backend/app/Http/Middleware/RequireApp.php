<?php

namespace App\Http\Middleware;

use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Usage: ->middleware('app:form'). Requires the app to be installed in the
 * organisation and the member's role to have "view". Responds 404 otherwise.
 * Runs after the "org" middleware.
 */
class RequireApp
{
    public function handle(Request $request, Closure $next, string $appKey): Response
    {
        $organization = $request->route('organization');
        abort_unless(Permissions::hasAppAbility($request->user(), $organization->id, $appKey), 404);

        return $next($request);
    }
}
