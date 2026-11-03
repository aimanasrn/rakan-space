<?php

use Illuminate\Support\Facades\Route;

// The backend is API-only; the user interface is the Next.js app.
Route::get('/', fn () => response()->json([
    'name' => 'RakanSpace API',
    'tagline' => 'Satu ruang. Satu pasukan.',
    'frontend' => config('rakanspace.frontend_url'),
]));
