<?php

namespace App\Support\Forms;

use App\Models\Approval\ApprovalRequest;
use App\Models\Attachment;
use App\Models\Form\Form;
use App\Models\Form\FormField;
use App\Models\Form\FormSubmission;
use App\Models\Form\FormSubmissionValue;
use App\Models\Form\FormVersion;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Approvals\Approvals;
use App\Support\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Form lifecycle: draft → publish (frozen version) → submissions, optionally
 * sent through an approval workflow. Callers check Permissions first.
 */
class Forms
{
    public const ENTITY = 'form_submission';

    /** The editable draft, created from the published version when needed. */
    public static function draft(Form $form): FormVersion
    {
        return DB::transaction(function () use ($form) {
            Form::whereKey($form->id)->lockForUpdate()->first();
            if ($draft = $form->draftVersion()->first()) {
                return $draft;
            }

            $draft = FormVersion::create([
                'organization_id' => $form->organization_id,
                'form_id' => $form->id,
                'version' => (int) FormVersion::where('form_id', $form->id)->max('version') + 1,
            ]);
            if ($current = $form->currentVersion()->first()) {
                foreach ($current->fields()->get() as $field) {
                    FormField::create([...$field->only(['key', 'type', 'label', 'help_text', 'required', 'position', 'options', 'validation', 'visibility']),
                        'organization_id' => $form->organization_id, 'form_version_id' => $draft->id]);
                }
            }

            return $draft;
        });
    }

    /** Replaces the draft's fields with the builder's list. */
    public static function saveDraft(Form $form, array $fields): FormVersion
    {
        $normalized = FormSchema::normalize($fields);

        return DB::transaction(function () use ($form, $normalized) {
            $draft = self::draft($form);
            FormField::where('form_version_id', $draft->id)->delete();
            foreach ($normalized as $field) {
                FormField::create([...$field, 'organization_id' => $form->organization_id, 'form_version_id' => $draft->id]);
            }
            $draft->touch();
            $form->touch();

            return $draft;
        });
    }

    public static function publish(Form $form, User $actor): Form
    {
        return DB::transaction(function () use ($form, $actor) {
            $draft = $form->draftVersion()->lockForUpdate()->first();
            if (! $draft) {
                // Nothing changed since the last publish: just reopen it.
                if (! $form->current_version_id) {
                    throw ValidationException::withMessages(['fields' => 'Add at least one field before publishing.']);
                }
            } else {
                $fields = $draft->fields()->get();
                if ($fields->isEmpty()) {
                    throw ValidationException::withMessages(['fields' => 'Add at least one field before publishing.']);
                }
                // Re-check the saved fields (choices, conditions) before freezing them.
                FormSchema::normalize($fields->map(fn ($f) => $f->only(['key', 'type', 'label', 'help_text', 'required', 'options', 'validation', 'visibility']))->all());
                $draft->update(['published_at' => now(), 'published_by' => $actor->id]);
                $form->current_version_id = $draft->id;
            }

            $form->status = Form::STATUS_PUBLISHED;
            $form->published_at ??= now();
            $form->save();
            ActivityLog::audit($form->organization_id, $actor, 'form.published', $form, ['name' => $form->name, 'version' => $form->currentVersion()->value('version')]);

            return $form->fresh();
        });
    }

    public static function unpublish(Form $form, User $actor): Form
    {
        $form->update(['status' => Form::STATUS_CLOSED]);
        ActivityLog::audit($form->organization_id, $actor, 'form.closed', $form, ['name' => $form->name]);

        return $form;
    }

    public static function submit(Organization $organization, Form $form, User $user, array $input): FormSubmission
    {
        return DB::transaction(function () use ($organization, $form, $user, $input) {
            $form = Form::whereKey($form->id)->lockForUpdate()->firstOrFail();
            if (! $form->isOpen()) {
                throw new HttpException(422, 'This form is not accepting responses.');
            }
            if (! $form->allow_multiple && FormSubmission::where('form_id', $form->id)->where('submitter_id', $user->id)
                ->where('status', '!=', FormSubmission::STATUS_WITHDRAWN)->exists()) {
                throw new HttpException(422, 'You have already responded to this form.');
            }

            $version = FormVersion::findOrFail($form->current_version_id);
            $fields = $version->fields()->get();
            $clean = SubmissionValidator::validate($fields, $input, $user, $organization->id);

            $submission = FormSubmission::create([
                'organization_id' => $organization->id,
                'form_id' => $form->id,
                'form_version_id' => $version->id,
                'submitter_id' => $user->id,
                'status' => FormSubmission::STATUS_SUBMITTED,
                'submitted_at' => now(),
            ]);
            self::storeValues($submission, $clean);

            if ($form->workflow_id && ($workflow = $form->workflow()->first())) {
                $request = Approvals::submitForApproval(
                    $organization, $user, self::ENTITY, $submission->id, $workflow,
                    $form->name.' · '.$user->name,
                    SubmissionValidator::conditionData($fields, $clean['values']),
                    $submission->reference(),
                    '/apps/form/submissions/'.$submission->id,
                );
                // The approval may already be complete (e.g. every step skipped); the listener set the status.
                $submission->refresh();
                $submission->approval_request_id = $request->id;
                if ($submission->status === FormSubmission::STATUS_SUBMITTED) {
                    $submission->status = self::statusFor($request->status);
                }
                $submission->save();
            } elseif ($form->created_by && $form->created_by !== $user->id) {
                Notifier::send($organization->id, [$form->created_by], 'form.submitted',
                    'New response: '.$form->name, $user->name.' · '.$submission->reference(),
                    '/apps/form/submissions/'.$submission->id, $user->id, 'form-submission:'.$submission->id);
            }

            return $submission->fresh();
        });
    }

    /** After "return for changes": the submitter edits the answers and the approval restarts. */
    public static function resubmit(FormSubmission $submission, User $user, array $input): FormSubmission
    {
        return DB::transaction(function () use ($submission, $user, $input) {
            $submission = FormSubmission::whereKey($submission->id)->lockForUpdate()->firstOrFail();
            if ($submission->submitter_id !== $user->id) {
                throw new HttpException(403, 'Only the person who submitted can change this response.');
            }
            if ($submission->status !== FormSubmission::STATUS_RETURNED || ! $submission->approval_request_id) {
                throw new HttpException(422, 'Only responses returned for changes can be edited.');
            }

            $fields = $submission->version()->firstOrFail()->fields()->get();
            $clean = SubmissionValidator::validate($fields, $input, $user, $submission->organization_id, $submission);
            self::storeValues($submission, $clean);
            $submission->update(['submitted_at' => now()]);

            Approvals::resubmit(ApprovalRequest::findOrFail($submission->approval_request_id), $user,
                SubmissionValidator::conditionData($fields, $clean['values']));

            return $submission->fresh();
        });
    }

    public static function withdraw(FormSubmission $submission, User $user): FormSubmission
    {
        return DB::transaction(function () use ($submission, $user) {
            $submission = FormSubmission::whereKey($submission->id)->lockForUpdate()->firstOrFail();
            if ($submission->submitter_id !== $user->id) {
                throw new HttpException(403, 'Only the person who submitted can withdraw this response.');
            }
            if (! in_array($submission->status, [FormSubmission::STATUS_SUBMITTED, FormSubmission::STATUS_PENDING_APPROVAL, FormSubmission::STATUS_RETURNED], true)) {
                throw new HttpException(422, 'This response can no longer be withdrawn.');
            }

            if ($submission->approval_request_id) {
                // The listener marks the submission withdrawn.
                Approvals::cancel(ApprovalRequest::findOrFail($submission->approval_request_id), $user);
            } else {
                $submission->update(['status' => FormSubmission::STATUS_WITHDRAWN]);
            }

            return $submission->fresh();
        });
    }

    public static function statusFor(string $approvalStatus): string
    {
        return match ($approvalStatus) {
            ApprovalRequest::STATUS_APPROVED => FormSubmission::STATUS_APPROVED,
            ApprovalRequest::STATUS_REJECTED => FormSubmission::STATUS_REJECTED,
            ApprovalRequest::STATUS_RETURNED => FormSubmission::STATUS_RETURNED,
            ApprovalRequest::STATUS_CANCELLED => FormSubmission::STATUS_WITHDRAWN,
            default => FormSubmission::STATUS_PENDING_APPROVAL,
        };
    }

    /** @param array{values: array<string, mixed>, attachment_ids: list<int>} $clean */
    private static function storeValues(FormSubmission $submission, array $clean): void
    {
        FormSubmissionValue::where('form_submission_id', $submission->id)->delete();
        foreach ($clean['values'] as $key => $value) {
            FormSubmissionValue::create([
                'organization_id' => $submission->organization_id,
                'form_submission_id' => $submission->id,
                'field_key' => $key,
                'value' => $value,
            ]);
        }

        // Link new uploads (already checked to be the submitter's own pending files).
        Attachment::whereIn('id', $clean['attachment_ids'])
            ->where('organization_id', $submission->organization_id)
            ->whereNull('attachable_type')
            ->update(['attachable_type' => self::ENTITY, 'attachable_id' => $submission->id]);
    }
}
