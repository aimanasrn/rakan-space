<?php

use App\Http\Middleware\RequireApp;
use App\Http\Middleware\ResolveOrganization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Cookie/session based authentication for the first-party SPA.
        $middleware->statefulApi();
        $middleware->alias([
            'org' => ResolveOrganization::class,
            'app' => RequireApp::class,
        ]);
        // Never redirect API clients to a login page.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(function (AuthorizationException $e, Request $request) {
            return response()->json(['message' => $e->getMessage() ?: 'This action is unauthorized.'], 403);
        });
        // Keep secrets out of logs and error reports.
        $exceptions->dontFlash(['password', 'password_confirmation', 'current_password', 'token']);
    })->create();
