<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Auth\AuthController;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ProfileController extends Controller
{
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'job_title' => ['nullable', 'string', 'max:120'],
            'phone' => ['nullable', 'string', 'max:40'],
        ]);

        $request->user()->update($data);

        return response()->json(['data' => AuthController::userPayload($request->user())]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $request->user()->forceFill(['password' => Hash::make($request->input('password'))])->save();

        return response()->json(['message' => 'Password updated.']);
    }

    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            'avatar' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:'.config('rakanspace.avatars.max_size'), 'dimensions:max_width=4000,max_height=4000'],
        ]);

        $user = $request->user();
        $file = $request->file('avatar');
        $disk = Storage::disk(config('rakanspace.attachments.disk'));
        $path = 'avatars/'.$user->id.'/'.Str::uuid().'.'.$file->extension();
        $disk->putFileAs(dirname($path), $file, basename($path));

        if ($user->avatar_path) {
            $disk->delete($user->avatar_path);
        }
        $user->forceFill(['avatar_path' => $path])->save();

        return response()->json(['data' => AuthController::userPayload($user)]);
    }

    public function deleteAvatar(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->avatar_path) {
            Storage::disk(config('rakanspace.attachments.disk'))->delete($user->avatar_path);
            $user->forceFill(['avatar_path' => null])->save();
        }

        return response()->json(['data' => AuthController::userPayload($user)]);
    }

    /** Avatars are only visible to signed-in users. */
    public function showAvatar(User $user): StreamedResponse
    {
        abort_unless($user->avatar_path, 404);
        $disk = Storage::disk(config('rakanspace.attachments.disk'));
        abort_unless($disk->exists($user->avatar_path), 404);

        return $disk->response($user->avatar_path, 'avatar', [
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
