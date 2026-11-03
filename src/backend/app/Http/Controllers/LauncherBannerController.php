<?php

namespace App\Http\Controllers;

use App\Http\Resources\LauncherBannerResource;
use App\Models\LauncherBanner;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Permissions;
use Carbon\Carbon;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Launcher banners: Owner/Admin manage them; members see live ones in the launcher. */
class LauncherBannerController extends Controller
{
    public const ILLUSTRATIONS = ['excellence', 'rocket', 'team', 'growth'];

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->requireManager($request, $organization);
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['all', 'live', 'inactive', 'scheduled', 'expired'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = $organization->banners()
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('title', 'ilike', $term)->orWhere('description', 'ilike', $term));
            })
            ->when($request->input('status') === 'live', fn ($q) => $q->whereIn('id', Permissions::visibleBannersQuery($request->user(), $organization->id)->select('id')))
            ->when($request->input('status') === 'inactive', fn ($q) => $q->where('is_active', false))
            ->when($request->input('status') === 'scheduled', fn ($q) => $q->where('is_active', true)->where('starts_at', '>', now()))
            ->when($request->input('status') === 'expired', fn ($q) => $q->where('ends_at', '<=', now()))
            ->orderBy('sort_order')->orderBy('id');

        return LauncherBannerResource::collection($query->paginate($request->integer('per_page', 20)));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->requireManager($request, $organization);
        $data = $this->validated($request);

        $banner = $organization->banners()->create([...$data, 'created_by' => $request->user()->id]);
        ActivityLog::audit($organization->id, $request->user(), 'banner.created', $banner, ['title' => $banner->title]);

        return response()->json(['data' => new LauncherBannerResource($banner)], 201);
    }

    public function update(Request $request, Organization $organization, LauncherBanner $banner): JsonResponse
    {
        $this->requireManager($request, $organization);
        $data = $this->validated($request, partial: true, current: $banner);

        $banner->update($data);
        ActivityLog::audit($organization->id, $request->user(), 'banner.updated', $banner, ['fields' => array_keys($data)]);

        return response()->json(['data' => new LauncherBannerResource($banner)]);
    }

    public function destroy(Request $request, Organization $organization, LauncherBanner $banner): JsonResponse
    {
        $this->requireManager($request, $organization);

        if ($banner->image_path) {
            $this->disk()->delete($banner->image_path);
        }
        $banner->delete();
        ActivityLog::audit($organization->id, $request->user(), 'banner.deleted', null, ['title' => $banner->title]);

        return response()->json(['message' => 'Banner deleted.']);
    }

    public function uploadImage(Request $request, Organization $organization, LauncherBanner $banner): JsonResponse
    {
        $this->requireManager($request, $organization);
        $request->validate([
            // No SVG: it can carry scripts.
            'image' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048', 'dimensions:max_width=4000,max_height=4000'],
        ]);

        $file = $request->file('image');
        $path = 'launcher-banners/'.$organization->id.'/'.Str::uuid().'.'.$file->extension();
        $this->disk()->putFileAs(dirname($path), $file, basename($path));
        if ($banner->image_path) {
            $this->disk()->delete($banner->image_path);
        }
        $banner->forceFill(['image_path' => $path])->save();

        return response()->json(['data' => new LauncherBannerResource($banner)]);
    }

    public function deleteImage(Request $request, Organization $organization, LauncherBanner $banner): JsonResponse
    {
        $this->requireManager($request, $organization);
        if ($banner->image_path) {
            $this->disk()->delete($banner->image_path);
            $banner->forceFill(['image_path' => null])->save();
        }

        return response()->json(['data' => new LauncherBannerResource($banner)]);
    }

    public function image(Request $request, Organization $organization, LauncherBanner $banner): StreamedResponse
    {
        abort_unless(Permissions::canViewBanner($request->user(), $banner), 404);
        abort_unless($banner->image_path && $this->disk()->exists($banner->image_path), 404);

        return $this->disk()->response($banner->image_path, 'banner', [
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);
    }

    private function validated(Request $request, bool $partial = false, ?LauncherBanner $current = null): array
    {
        $required = $partial ? 'sometimes' : 'required';

        $data = $request->validate([
            'title' => [$required, 'string', 'min:2', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'cta_label' => ['nullable', 'string', 'max:40', 'required_with:cta_url'],
            'cta_url' => ['nullable', 'string', 'max:2048', $this->ctaUrlRule()],
            'illustration' => ['nullable', Rule::in(self::ILLUSTRATIONS)],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'between:-1000,1000'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date'],
        ]);

        // The end must follow the start, using stored values for fields not sent.
        $start = array_key_exists('starts_at', $data) ? $data['starts_at'] : $current?->starts_at;
        $end = array_key_exists('ends_at', $data) ? $data['ends_at'] : $current?->ends_at;
        if ($start && $end && Carbon::parse($end)->lte(Carbon::parse($start))) {
            throw ValidationException::withMessages(['ends_at' => 'The end must be after the start.']);
        }

        return $data;
    }

    /** http(s) URLs, or a workspace-relative path such as "/apps/lms". */
    private function ctaUrlRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) {
            if ($value === null || $value === '') {
                return;
            }
            $relative = is_string($value) && preg_match('#^/(?![/\\\\])[^\s]*$#', $value);
            $absolute = is_string($value) && filter_var($value, FILTER_VALIDATE_URL) && preg_match('#^https?://#i', $value);
            if (! $relative && ! $absolute) {
                $fail('Use a full https:// link or a path inside the workspace, such as /apps/lms.');
            }
        };
    }

    private function disk()
    {
        return Storage::disk(config('rakanspace.attachments.disk'));
    }

    private function requireManager(Request $request, Organization $organization): void
    {
        abort_unless(Permissions::canManageApps($request->user(), $organization->id), 403, 'Only owners and admins can manage banners.');
    }
}
