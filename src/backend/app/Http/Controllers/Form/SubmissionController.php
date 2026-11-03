<?php

namespace App\Http\Controllers\Form;

use App\Enums\AppAbility;
use App\Http\Controllers\Controller;
use App\Http\Resources\Form\SubmissionResource;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Organization;
use App\Support\Forms\Forms;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** Filling forms and viewing responses. Routes require the Form app (app:form). */
class SubmissionController extends Controller
{
    public function store(Request $request, Organization $organization, Form $form): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewForm($user, $form), 404);
        abort_unless(Permissions::canFillForm($user, $form), 422, 'This form is not accepting responses from you.');
        $request->validate(['values' => ['present', 'array']]);

        $submission = Forms::submit($organization, $form, $user, $request->input('values', []));

        return response()->json(['data' => $this->detail($submission, $request)], 201);
    }

    /** Responses to one form, for the people who manage it. */
    public function forForm(Request $request, Organization $organization, Form $form): AnonymousResourceCollection
    {
        $user = $request->user();
        abort_unless(Permissions::canViewForm($user, $form), 404);
        abort_unless(Permissions::canManageForm($user, $form) || Permissions::hasAppAbility($user, $organization->id, 'form', AppAbility::Admin), 403);

        return SubmissionResource::collection($this->filtered($request, $form->submissions()->getQuery()));
    }

    /** "My submissions" (default) or, for Form admins, every response in the workspace. */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate(['scope' => ['nullable', Rule::in(['mine', 'all'])], 'form_id' => ['nullable', 'integer']]);
        $user = $request->user();
        $query = $organization->formSubmissions()->getQuery();

        if ($request->input('scope') === 'all') {
            abort_unless(Permissions::hasAppAbility($user, $organization->id, 'form', AppAbility::Admin), 403);
        } else {
            $query->where('submitter_id', $user->id);
        }
        $query->when($request->filled('form_id'), fn ($q) => $q->where('form_id', $request->integer('form_id')));

        return SubmissionResource::collection($this->filtered($request, $query));
    }

    public function show(Request $request, Organization $organization, FormSubmission $formSubmission): JsonResponse
    {
        abort_unless(Permissions::canViewSubmission($request->user(), $formSubmission), 404);

        return response()->json(['data' => $this->detail($formSubmission, $request)]);
    }

    /** Edit and resubmit a response that was returned for changes. */
    public function update(Request $request, Organization $organization, FormSubmission $formSubmission): JsonResponse
    {
        abort_unless(Permissions::canViewSubmission($request->user(), $formSubmission), 404);
        $request->validate(['values' => ['present', 'array']]);

        $submission = Forms::resubmit($formSubmission, $request->user(), $request->input('values', []));

        return response()->json(['data' => $this->detail($submission, $request)]);
    }

    public function withdraw(Request $request, Organization $organization, FormSubmission $formSubmission): JsonResponse
    {
        abort_unless(Permissions::canViewSubmission($request->user(), $formSubmission), 404);

        return response()->json(['data' => $this->detail(Forms::withdraw($formSubmission, $request->user()), $request)]);
    }

    private function filtered(Request $request, $query)
    {
        $request->validate([
            'status' => ['nullable', Rule::in(['all', ...FormSubmission::STATUSES])],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return $query->with(['form', 'submitter', 'version'])
            ->when($request->filled('status') && $request->input('status') !== 'all', fn ($q) => $q->where('status', $request->input('status')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $input = trim($request->input('q'));
                $term = '%'.addcslashes($input, '%_\\').'%';
                // "FRM-000012" or "12" also matches the reference number.
                $id = preg_match('/^(?:FRM-)?0*(\d{1,12})$/i', $input, $m) ? (int) $m[1] : null;
                $q->where(fn ($w) => $w
                    ->whereHas('submitter', fn ($u) => $u->where('name', 'ilike', $term))
                    ->orWhereHas('form', fn ($f) => $f->where('name', 'ilike', $term))
                    ->when($id, fn ($r) => $r->orWhere('form_submissions.id', $id)));
            })
            ->orderByDesc('submitted_at')->orderByDesc('id')
            ->paginate($request->integer('per_page', 20));
    }

    private function detail(FormSubmission $submission, Request $request): array
    {
        $submission->load(['form', 'submitter', 'version.fields', 'values', 'attachments.uploader', 'approvalRequest']);
        $approval = $submission->approvalRequest;
        $step = $approval ? ApprovalRequestStep::where('approval_request_id', $approval->id)->where('round', $approval->round)
            ->where('status', ApprovalRequestStep::STATUS_PENDING)->orderBy('position')->first() : null;

        return [
            ...(new SubmissionResource($submission))->resolve($request),
            'approval' => $approval ? [
                'id' => $approval->id,
                'status' => $approval->status,
                'current_step' => $step?->name,
                // Only participants can open the request itself.
                'can_view' => Permissions::canViewApprovalRequest($request->user(), $approval),
            ] : null,
        ];
    }
}
