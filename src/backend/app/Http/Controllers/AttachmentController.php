<?php

namespace App\Http\Controllers;

use App\Http\Resources\AttachmentResource;
use App\Models\Announcement;
use App\Models\Attachment;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Support\Attachments;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AttachmentController extends Controller
{
    /** Files page: every attachment the user can currently access. */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', Rule::in(['image', 'document', 'other'])],
            'source' => ['nullable', Rule::in(['task', 'project', 'message', 'announcement'])],
            'project_id' => ['nullable', 'integer'],
            'mine' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        $query = Attachments::visibleQuery($user, $organization->id)
            ->with('uploader')
            ->when($request->filled('q'), fn ($q) => $q->where('original_name', 'ilike', '%'.addcslashes($request->input('q'), '%_\\').'%'))
            ->when($request->input('type') === 'image', fn ($q) => $q->where('mime_type', 'like', 'image/%'))
            ->when($request->input('type') === 'document', fn ($q) => $q->whereIn('extension', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'md']))
            ->when($request->input('type') === 'other', fn ($q) => $q->where('mime_type', 'not like', 'image/%')->whereNotIn('extension', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'md']))
            ->when($request->filled('source'), fn ($q) => $q->where('attachable_type', $request->input('source')))
            ->when($request->filled('project_id'), function ($q) use ($request) {
                $pid = $request->integer('project_id');
                $q->where(fn ($w) => $w->where(fn ($p) => $p->where('attachable_type', 'project')->where('attachable_id', $pid))
                    ->orWhere(fn ($t) => $t->where('attachable_type', 'task')->whereIn('attachable_id', Task::where('project_id', $pid)->select('id'))));
            })
            ->when($request->boolean('mine'), fn ($q) => $q->where('uploader_id', $user->id))
            ->latest('attachments.id');

        $page = $query->paginate($request->integer('per_page', 30));
        $page->getCollection()->loadMorph('attachable', [
            Message::class => ['conversation:id,type,name'],
            Task::class => ['project:id,name'],
        ]);

        return response()->json([
            'data' => $page->getCollection()->map(fn (Attachment $a) => [
                ...(new AttachmentResource($a))->resolve($request),
                'context' => $this->context($a),
            ])->values(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    /** Upload a file. It stays private to the uploader until linked to a resource. */
    public function store(Request $request, Organization $organization): JsonResponse
    {
        $allowed = config('rakanspace.attachments.allowed_extensions');
        $request->validate([
            'file' => ['required', 'file', 'max:'.config('rakanspace.attachments.max_size'), 'mimes:'.implode(',', $allowed)],
        ]);

        $file = $request->file('file');
        $clientExt = Str::lower($file->getClientOriginalExtension());
        abort_unless(in_array($clientExt, $allowed, true), 422, 'This file type is not allowed.');

        // Extension derived from the file content, not the client-supplied name.
        $ext = Str::lower($file->guessExtension() ?: $clientExt);
        if ($ext === 'jpeg') {
            $ext = 'jpg';
        }
        abort_unless(in_array($ext, [...$allowed, 'jpg'], true), 422, 'This file type is not allowed.');

        $disk = config('rakanspace.attachments.disk');
        $path = sprintf('attachments/%d/%s/%s.%s', $organization->id, now()->format('Y/m'), Str::uuid(), $ext);
        Storage::disk($disk)->putFileAs(dirname($path), $file, basename($path));

        $name = Str::limit(preg_replace('/[\x00-\x1F\x7F\/\\\\]/u', '_', $file->getClientOriginalName()), 250, '');

        $attachment = Attachment::create([
            'organization_id' => $organization->id,
            'uploader_id' => $request->user()->id,
            'disk' => $disk,
            'path' => $path,
            'original_name' => $name,
            'extension' => $ext,
            'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
            'size' => $file->getSize(),
        ]);

        return response()->json(['data' => (new AttachmentResource($attachment->load('uploader')))->resolve($request)], 201);
    }

    /** Attach files directly to a project's file list. */
    public function attachToProject(Request $request, Organization $organization, Project $project): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewProject($user, $project), 404);
        abort_unless(Permissions::canContributeToProject($user, $project), 403, 'Only project members can add files.');
        $data = $request->validate(['attachment_ids' => ['required', 'array', 'min:1', 'max:10'], 'attachment_ids.*' => ['integer']]);

        \DB::transaction(fn () => Attachments::attach($user, $organization, $data['attachment_ids'], $project));

        return response()->json(['message' => 'Files added.']);
    }

    public function show(Request $request, Organization $organization, Attachment $attachment): JsonResponse
    {
        abort_unless(Permissions::canViewAttachment($request->user(), $attachment), 404);

        return response()->json(['data' => (new AttachmentResource($attachment->load('uploader')))->resolve($request)]);
    }

    /**
     * Authorised, streamed download. Never a public URL. Inline display is
     * limited to safe types and sandboxed.
     */
    public function download(Request $request, Organization $organization, Attachment $attachment): StreamedResponse
    {
        abort_unless(Permissions::canViewAttachment($request->user(), $attachment), 404);

        $storage = Storage::disk($attachment->disk);
        abort_unless($storage->exists($attachment->path), 404, 'File missing from storage.');

        $inline = $request->boolean('inline') && in_array($attachment->mime_type, config('rakanspace.attachments.inline_mime_types'), true);
        $disposition = HeaderUtils::makeDisposition(
            $inline ? HeaderUtils::DISPOSITION_INLINE : HeaderUtils::DISPOSITION_ATTACHMENT,
            $attachment->original_name,
            Str::ascii($attachment->original_name) ?: 'download.'.$attachment->extension,
        );

        $contentType = $attachment->mime_type === 'text/plain' ? 'text/plain; charset=utf-8' : $attachment->mime_type;
        $csp = $attachment->mime_type === 'application/pdf'
            ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:"
            : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

        return $storage->response($attachment->path, null, [
            'Content-Type' => $inline ? $contentType : 'application/octet-stream',
            'Content-Disposition' => $disposition,
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => $csp,
            'Cache-Control' => 'private, no-store',
            'Cross-Origin-Resource-Policy' => 'same-site',
        ]);
    }

    public function destroy(Request $request, Organization $organization, Attachment $attachment): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewAttachment($user, $attachment), 404);
        abort_unless(Permissions::canDeleteAttachment($user, $attachment), 403, 'You cannot delete this file.');

        Storage::disk($attachment->disk)->delete($attachment->path);
        $attachment->delete();

        return response()->json(['message' => 'File deleted.']);
    }

    private function context(Attachment $a): ?array
    {
        $p = $a->attachable;

        return match (true) {
            $p instanceof Task => ['type' => 'task', 'label' => $p->title, 'sublabel' => $p->project?->name, 'link' => '/projects/'.$p->project_id.'?task='.$p->id],
            $p instanceof Project => ['type' => 'project', 'label' => $p->name, 'sublabel' => null, 'link' => '/projects/'.$p->id],
            $p instanceof Message => ['type' => 'message', 'label' => $p->conversation?->type === 'direct' ? 'Direct message' : '#'.$p->conversation?->name, 'sublabel' => null, 'link' => '/chat/'.$p->conversation_id.'?message='.$p->id],
            $p instanceof Announcement => ['type' => 'announcement', 'label' => $p->title, 'sublabel' => null, 'link' => '/announcements?id='.$p->id],
            default => null,
        };
    }
}
