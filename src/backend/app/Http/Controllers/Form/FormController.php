<?php

namespace App\Http\Controllers\Form;

use App\Enums\AppAbility;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Resources\Form\FormFieldResource;
use App\Http\Resources\Form\FormResource;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Form\FormVersion;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Forms\Forms;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Form builder and the list of forms. Routes require the Form app (app:form). */
class FormController extends Controller
{
    private const WITH = ['workflow', 'currentVersion', 'creator', 'draftVersion'];

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'mode' => ['nullable', Rule::in(['fill', 'manage'])],
            'status' => ['nullable', Rule::in(['all', Form::STATUS_DRAFT, Form::STATUS_PUBLISHED, Form::STATUS_CLOSED])],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $manage = $request->input('mode') === 'manage';

        if ($manage) {
            $editor = Permissions::hasAppAbility($user, $organization->id, 'form', AppAbility::Edit);
            abort_unless($editor || Permissions::canBuildForms($user, $organization->id), 403);
            $query = Permissions::visibleFormsQuery($user, $organization->id);
            if (! $editor) {
                $query->where('created_by', $user->id);
            }
            $query->withCount('submissions');
        } else {
            $query = Permissions::fillableFormsQuery($user, $organization->id);
        }

        $query->with(self::WITH)
            ->withCount(['submissions as my_submissions_count' => fn ($q) => $q->where('submitter_id', $user->id)
                ->where('status', '!=', FormSubmission::STATUS_WITHDRAWN)])
            ->when($manage && $request->filled('status') && $request->input('status') !== 'all', fn ($q) => $q->where('status', $request->input('status')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('forms.name', 'ilike', $term)->orWhere('forms.description', 'ilike', $term));
            })
            ->orderBy($manage ? 'updated_at' : 'name', $manage ? 'desc' : 'asc');

        return FormResource::collection($query->paginate($request->integer('per_page', 20)));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::canBuildForms($request->user(), $organization->id), 403, 'You cannot create forms.');
        $data = $this->validatedSettings($request, $organization);

        $form = DB::transaction(function () use ($organization, $data, $request) {
            $form = $organization->forms()->create([...$data, 'created_by' => $request->user()->id]);
            Forms::draft($form);
            ActivityLog::audit($organization->id, $request->user(), 'form.created', $form, ['name' => $form->name]);

            return $form;
        });

        return response()->json(['data' => $this->payload($form, $request)], 201);
    }

    public function show(Request $request, Organization $organization, Form $form): JsonResponse
    {
        abort_unless(Permissions::canViewForm($request->user(), $form), 404);

        return response()->json(['data' => $this->payload($form, $request)]);
    }

    public function update(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);
        $data = $this->validatedSettings($request, $organization, partial: true);

        $form->update($data);
        ActivityLog::audit($organization->id, $request->user(), 'form.updated', $form, ['fields' => array_keys($data)]);

        return response()->json(['data' => $this->payload($form, $request)]);
    }

    /** Saves the builder's fields to the draft version. */
    public function saveDraft(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);
        $request->validate(['fields' => ['present', 'array']]);

        Forms::saveDraft($form, $request->input('fields', []));

        return response()->json(['data' => $this->payload($form->fresh(), $request)]);
    }

    /** Throws away unpublished changes (only when a published version exists). */
    public function discardDraft(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);
        abort_unless($form->current_version_id, 422, 'This form has never been published.');
        $form->draftVersion()->delete();

        return response()->json(['data' => $this->payload($form->fresh(), $request)]);
    }

    public function publish(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);

        return response()->json(['data' => $this->payload(Forms::publish($form, $request->user()), $request)]);
    }

    public function unpublish(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);
        abort_unless($form->status === Form::STATUS_PUBLISHED, 422, 'This form is not published.');

        return response()->json(['data' => $this->payload(Forms::unpublish($form, $request->user()), $request)]);
    }

    public function destroy(Request $request, Organization $organization, Form $form): JsonResponse
    {
        abort_unless(Permissions::canViewForm($request->user(), $form) || Permissions::canDeleteForm($request->user(), $form), 404);
        abort_unless(Permissions::canDeleteForm($request->user(), $form), 403, 'You cannot delete this form.');
        abort_if($form->submissions()->exists(), 422, 'This form has responses. Close it instead so they are kept.');

        DB::transaction(function () use ($form) {
            $form->update(['current_version_id' => null]);
            $form->delete();
        });
        ActivityLog::audit($organization->id, $request->user(), 'form.deleted', null, ['name' => $form->name]);

        return response()->json(['message' => 'Form deleted.']);
    }

    public function versions(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $this->authorizeManage($request, $form);
        $versions = $form->versions()->withCount('fields')->with('form')->get()->map(fn (FormVersion $v) => [
            'id' => $v->id,
            'version' => $v->version,
            'status' => $v->isDraft() ? 'draft' : ($v->id === $form->current_version_id ? 'current' : 'previous'),
            'fields_count' => $v->fields_count,
            'published_at' => $v->published_at?->toIso8601String(),
            'submissions_count' => FormSubmission::where('form_version_id', $v->id)->count(),
        ]);

        return response()->json(['data' => $versions]);
    }

    /** Form plus the fields to fill (published) and, for managers, the draft fields. */
    private function payload(Form $form, Request $request): array
    {
        $form->load(self::WITH);
        $manage = Permissions::canManageForm($request->user(), $form);
        $published = $form->currentVersion?->fields()->get() ?? collect();
        $draft = $manage ? ($form->draftVersion?->fields()->get() ?? $published) : null;

        return [
            ...(new FormResource($form))->resolve($request),
            'fields' => FormFieldResource::collection($published)->resolve($request),
            'draft_fields' => $draft !== null ? FormFieldResource::collection($draft)->resolve($request) : null,
        ];
    }

    private function validatedSettings(Request $request, Organization $organization, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';
        $data = $request->validate([
            'name' => [$required, 'string', 'min:2', 'max:160'],
            'description' => ['nullable', 'string', 'max:2000'],
            'audience' => ['sometimes', 'nullable', 'array'],
            'audience.roles' => ['nullable', 'array'],
            'audience.roles.*' => [Rule::in(Role::values())],
            'audience.department_ids' => ['nullable', 'array', 'max:100'],
            'audience.department_ids.*' => ['integer'],
            'workflow_id' => ['sometimes', 'nullable', 'integer'],
            'allow_multiple' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('audience', $data)) {
            $departmentIds = array_values(array_unique(array_map('intval', $data['audience']['department_ids'] ?? [])));
            $valid = $organization->departments()->whereIn('id', $departmentIds)->pluck('id')->map(fn ($id) => (int) $id)->all();
            if (count($valid) !== count($departmentIds)) {
                throw ValidationException::withMessages(['audience.department_ids' => 'Choose departments from this workspace.']);
            }
            $data['audience'] = ['roles' => array_values(array_unique($data['audience']['roles'] ?? [])), 'department_ids' => $valid];
        }
        if (! empty($data['workflow_id'])) {
            $exists = $organization->approvalWorkflows()->whereKey($data['workflow_id'])->where('is_active', true)->exists();
            if (! $exists) {
                throw ValidationException::withMessages(['workflow_id' => 'Choose an active workflow from this workspace.']);
            }
        }

        return $data;
    }

    private function authorizeManage(Request $request, Form $form): void
    {
        $user = $request->user();
        if (! Permissions::canManageForm($user, $form)) {
            // Fillers can see the form but not change it; others do not learn it exists.
            abort(Permissions::canViewForm($user, $form) ? 403 : 404);
        }
    }
}
