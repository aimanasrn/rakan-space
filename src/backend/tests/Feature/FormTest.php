<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Attachment;
use App\Models\Form\FormSubmission;
use App\Models\Organization;
use App\Models\User;
use App\Support\AppCatalog;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FormTest extends TestCase
{
    private function org(string $name = 'Acme'): Organization
    {
        $org = $this->createOrganization(null, $name);
        AppCatalog::installDefaults($org, $this->owner($org));

        return $org;
    }

    private function purchaseFields(): array
    {
        return [
            ['type' => 'text', 'label' => 'Item', 'required' => true],
            ['type' => 'number', 'label' => 'Amount (RM)', 'key' => 'amount', 'required' => true, 'validation' => ['min' => 1, 'max' => 100000]],
            ['type' => 'dropdown', 'label' => 'Category', 'options' => ['choices' => ['Hardware', 'Software', 'Other']], 'required' => true],
            ['type' => 'textarea', 'label' => 'Other details', 'required' => true, 'visibility' => ['field' => 'category', 'operator' => 'eq', 'value' => 'Other']],
            ['type' => 'checkbox', 'label' => 'Tags', 'options' => ['choices' => ['Urgent', 'Budgeted']]],
            ['type' => 'date', 'label' => 'Needed by'],
            ['type' => 'table', 'label' => 'Line items', 'options' => ['columns' => [
                ['label' => 'Description', 'type' => 'text'], ['label' => 'Qty', 'type' => 'number'],
            ]], 'validation' => ['max_rows' => 3]],
            ['type' => 'file', 'label' => 'Quotation', 'validation' => ['max_files' => 2]],
        ];
    }

    /** Creates and publishes a form as the owner; returns its id. */
    private function publishedForm(Organization $org, array $settings = [], ?array $fields = null): int
    {
        $this->actingAs($this->owner($org));
        $id = $this->postJson($this->api($org, '/forms'), ['name' => 'Purchase request', ...$settings])->assertCreated()->json('data.id');
        $this->putJson($this->api($org, "/forms/{$id}/draft"), ['fields' => $fields ?? $this->purchaseFields()])->assertOk();
        $this->postJson($this->api($org, "/forms/{$id}/publish"))->assertOk()->assertJsonPath('data.status', 'published');

        return $id;
    }

    private function upload(Organization $org, User $user, string $name = 'quote.pdf'): int
    {
        return $this->actingAs($user)->postJson($this->api($org, '/attachments'), [
            'file' => UploadedFile::fake()->createWithContent('quote.txt', 'Quotation from vendor'),
        ])->assertCreated()->json('data.id');
    }

    public function test_builder_normalises_fields_and_rejects_bad_definitions(): void
    {
        $org = $this->org();
        $this->actingAs($this->owner($org));
        $id = $this->postJson($this->api($org, '/forms'), ['name' => 'Survey'])->assertCreated()->json('data.id');

        $res = $this->putJson($this->api($org, "/forms/{$id}/draft"), ['fields' => [
            ['type' => 'text', 'label' => 'Full name'],
            ['type' => 'text', 'label' => 'Full name'],
            ['type' => 'radio', 'label' => 'Happy?', 'options' => ['choices' => ['Yes', 'No', 'Yes', ' ']]],
        ]])->assertOk();
        $this->assertSame(['full_name', 'full_name_2', 'happy'], array_column($res->json('data.draft_fields'), 'key'));
        $this->assertSame(['Yes', 'No'], $res->json('data.draft_fields.2.options.choices'));

        $this->putJson($this->api($org, "/forms/{$id}/draft"), ['fields' => [['type' => 'dropdown', 'label' => 'Pick']]])
            ->assertJsonValidationErrors('fields.0.options.choices');
        $this->putJson($this->api($org, "/forms/{$id}/draft"), ['fields' => [['type' => 'shell', 'label' => 'x']]])
            ->assertJsonValidationErrors('fields.0.type');
        // A condition may only use a field above it (prevents loops).
        $this->putJson($this->api($org, "/forms/{$id}/draft"), ['fields' => [
            ['type' => 'text', 'label' => 'A', 'visibility' => ['field' => 'b', 'operator' => 'filled']],
            ['type' => 'text', 'label' => 'B'],
        ]])->assertJsonValidationErrors('fields.0.visibility.field');

        // Publishing an empty form is refused.
        $empty = $this->postJson($this->api($org, '/forms'), ['name' => 'Empty'])->json('data.id');
        $this->postJson($this->api($org, "/forms/{$empty}/publish"))->assertJsonValidationErrors('fields');
    }

    public function test_submission_validation_and_conditional_fields(): void
    {
        Storage::fake('local');
        $org = $this->org();
        $formId = $this->publishedForm($org);
        $staff = $this->addMember($org);
        $this->actingAs($staff);
        $url = $this->api($org, "/forms/{$formId}/submissions");

        $this->postJson($url, ['values' => []])->assertJsonValidationErrors(['values.item', 'values.amount', 'values.category']);
        $this->postJson($url, ['values' => ['item' => 'Laptop', 'amount' => 0, 'category' => 'Hardware']])->assertJsonValidationErrors('values.amount');
        $this->postJson($url, ['values' => ['item' => 'Laptop', 'amount' => 'ten', 'category' => 'Hardware']])->assertJsonValidationErrors('values.amount');
        $this->postJson($url, ['values' => ['item' => 'Laptop', 'amount' => 10, 'category' => 'Food']])->assertJsonValidationErrors('values.category');
        $this->postJson($url, ['values' => ['item' => 'Laptop', 'amount' => 10, 'category' => 'Hardware', 'needed_by' => '2026-02-30']])->assertJsonValidationErrors('values.needed_by');
        $this->postJson($url, ['values' => ['item' => 'Laptop', 'amount' => 10, 'category' => 'Hardware', 'line_items' => array_fill(0, 4, ['description' => 'x'])]])
            ->assertJsonValidationErrors('values.line_items');
        // "Other details" is required only when Category is Other.
        $this->postJson($url, ['values' => ['item' => 'Chairs', 'amount' => 10, 'category' => 'Other']])->assertJsonValidationErrors('values.other_details');

        $id = $this->postJson($url, ['values' => [
            'item' => '  Laptop ', 'amount' => '4500.50', 'category' => 'Hardware',
            'other_details' => 'hidden, so dropped', 'tags' => ['Urgent'],
            'line_items' => [['description' => 'MacBook', 'qty' => '2', 'ignored' => 'x'], ['description' => '']],
        ]])->assertCreated()->assertJsonPath('data.status', 'submitted')->json('data.id');

        $data = $this->getJson($this->api($org, "/form-submissions/{$id}"))->assertOk()->json('data');
        $this->assertSame('Laptop', $data['values']['item']);
        $this->assertEquals(4500.5, $data['values']['amount']);
        $this->assertArrayNotHasKey('other_details', $data['values']);
        // JSON storage may reorder keys, so compare without key order.
        $this->assertEquals([['description' => 'MacBook', 'qty' => 2]], $data['values']['line_items']);
    }

    public function test_files_must_be_the_submitters_own_unused_uploads(): void
    {
        Storage::fake('local');
        $org = $this->org();
        $formId = $this->publishedForm($org);
        $staff = $this->addMember($org);
        $colleague = $this->addMember($org);
        $theirs = $this->upload($org, $colleague);
        $mine = $this->upload($org, $staff);

        $this->actingAs($staff);
        $base = ['item' => 'Desk', 'amount' => 300, 'category' => 'Hardware'];
        $url = $this->api($org, "/forms/{$formId}/submissions");
        $this->postJson($url, ['values' => [...$base, 'quotation' => [$theirs]]])->assertJsonValidationErrors('values.quotation');

        $id = $this->postJson($url, ['values' => [...$base, 'quotation' => [$mine]]])->assertCreated()->json('data.id');
        $this->assertSame('form_submission', Attachment::find($mine)->attachable_type);
        // The same file cannot be reused on another response.
        $this->postJson($url, ['values' => [...$base, 'quotation' => [$mine]]])->assertJsonValidationErrors('values.quotation');

        // The colleague cannot see the response or download its file; the owner (form manager) can.
        $this->actingAs($colleague)->getJson($this->api($org, "/form-submissions/{$id}"))->assertNotFound();
        $this->get($this->api($org, "/attachments/{$mine}/download"))->assertNotFound();
        $this->actingAs($this->owner($org))->get($this->api($org, "/attachments/{$mine}/download"))->assertOk();
    }

    public function test_form_with_workflow_end_to_end(): void
    {
        $org = $this->org();
        $owner = $this->owner($org);
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $this->membership($org, $staff)->update(['manager_id' => $manager->id]);

        $this->actingAs($owner);
        $workflowId = $this->postJson($this->api($org, '/approval/workflows'), ['name' => 'Purchases', 'steps' => [
            ['name' => 'Line manager', 'mode' => 'any', 'approvers' => [['type' => 'manager']]],
            ['name' => 'Finance', 'mode' => 'any', 'approvers' => [['type' => 'role', 'role' => 'owner']], 'condition' => ['field' => 'amount', 'operator' => 'gt', 'value' => 5000]],
        ]])->assertCreated()->json('data.id');
        $formId = $this->publishedForm($org, ['workflow_id' => $workflowId]);

        // Submit → waiting for the line manager.
        $this->actingAs($staff);
        $sub = $this->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['item' => 'Server', 'amount' => 8000, 'category' => 'Hardware']])
            ->assertCreated()->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval.current_step', 'Line manager')->json('data');
        $requestId = $sub['approval_request_id'];

        // The manager is an approver, so they can read the response.
        $this->actingAs($manager)->getJson($this->api($org, "/form-submissions/{$sub['id']}"))->assertOk();
        $this->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'return', 'comment' => 'Add a quotation'])->assertOk();
        $this->assertSame('returned', FormSubmission::find($sub['id'])->status);

        // Resubmit with changes → a new approval round.
        $this->actingAs($staff)->putJson($this->api($org, "/form-submissions/{$sub['id']}"), ['values' => ['item' => 'Server', 'amount' => 7000, 'category' => 'Hardware']])
            ->assertOk()->assertJsonPath('data.status', 'pending_approval');
        $this->actingAs($manager)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'approve'])->assertOk();
        $this->assertSame('pending_approval', FormSubmission::find($sub['id'])->status);
        $this->actingAs($owner)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'approve'])
            ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.data.amount', 7000);

        $this->actingAs($staff)->getJson($this->api($org, '/form-submissions'))->assertJsonPath('data.0.status', 'approved');
        // Approved responses can no longer be withdrawn or edited.
        $this->postJson($this->api($org, "/form-submissions/{$sub['id']}/withdraw"))->assertUnprocessable();
        $this->putJson($this->api($org, "/form-submissions/{$sub['id']}"), ['values' => []])->assertUnprocessable();
    }

    public function test_withdraw_cancels_the_approval(): void
    {
        $org = $this->org();
        $workflow = ApprovalWorkflow::create(['organization_id' => $org->id, 'name' => 'Simple']);
        $workflow->steps()->create(['organization_id' => $org->id, 'position' => 1, 'name' => 'Owner', 'mode' => 'any', 'approvers' => [['type' => 'role', 'role' => 'owner']]]);
        $formId = $this->publishedForm($org, ['workflow_id' => $workflow->id]);
        $staff = $this->addMember($org);

        $sub = $this->actingAs($staff)->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['item' => 'Pens', 'amount' => 5, 'category' => 'Other', 'other_details' => 'Blue']])->json('data');
        $this->postJson($this->api($org, "/form-submissions/{$sub['id']}/withdraw"))->assertOk()->assertJsonPath('data.status', 'withdrawn');
        $this->actingAs($this->owner($org))->getJson($this->api($org, "/approval/requests/{$sub['approval_request_id']}"))->assertJsonPath('data.status', 'cancelled');
    }

    public function test_versions_keep_old_answers_and_drafts_do_not_leak_to_fillers(): void
    {
        $org = $this->org();
        $formId = $this->publishedForm($org, [], [['type' => 'text', 'label' => 'Name', 'required' => true]]);
        $staff = $this->addMember($org);
        $first = $this->actingAs($staff)->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['name' => 'Siti']])->json('data.id');

        $owner = $this->owner($org);
        $this->actingAs($owner)->putJson($this->api($org, "/forms/{$formId}/draft"), ['fields' => [
            ['type' => 'text', 'label' => 'Name', 'required' => true], ['type' => 'number', 'label' => 'Age', 'required' => true],
        ]])->assertJsonPath('data.has_unpublished_changes', true);

        // Fillers still see version 1 until it is published.
        $this->actingAs($staff)->getJson($this->api($org, "/forms/{$formId}"))->assertJsonCount(1, 'data.fields')->assertJsonPath('data.draft_fields', null);
        $this->actingAs($owner)->postJson($this->api($org, "/forms/{$formId}/publish"))->assertJsonPath('data.version', 2);
        $this->actingAs($staff)->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['name' => 'Siti']])->assertJsonValidationErrors('values.age');

        $this->getJson($this->api($org, "/form-submissions/{$first}"))->assertJsonPath('data.version', 1)->assertJsonCount(1, 'data.fields');
        $this->actingAs($owner)->getJson($this->api($org, "/forms/{$formId}/versions"))->assertJsonPath('data.0.status', 'current')->assertJsonPath('data.1.submissions_count', 1);

        // Closed forms stop accepting responses; forms with responses cannot be deleted.
        $this->postJson($this->api($org, "/forms/{$formId}/unpublish"))->assertJsonPath('data.status', 'closed');
        $this->actingAs($staff)->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['name' => 'A', 'age' => 3]])->assertNotFound();
        $this->actingAs($owner)->deleteJson($this->api($org, "/forms/{$formId}"))->assertUnprocessable();
    }

    public function test_audience_single_response_and_who_can_build(): void
    {
        $org = $this->org();
        $hr = $org->departments()->create(['name' => 'HR']);
        $inHr = $this->addMember($org);
        $hr->users()->attach($inHr->id, ['organization_id' => $org->id]);
        $outside = $this->addMember($org);
        $manager = $this->addMember($org, Role::Manager);

        $formId = $this->publishedForm($org, ['audience' => ['roles' => ['manager'], 'department_ids' => [$hr->id]], 'allow_multiple' => false],
            [['type' => 'text', 'label' => 'Feedback']]);

        $this->actingAs($outside)->getJson($this->api($org, "/forms/{$formId}"))->assertNotFound();
        $this->assertSame([], $this->getJson($this->api($org, '/forms'))->json('data'));
        $this->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['feedback' => 'hi']])->assertNotFound();

        $this->actingAs($manager)->getJson($this->api($org, '/forms'))->assertJsonPath('data.0.id', $formId);
        $this->actingAs($inHr)->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['feedback' => 'Great']])->assertCreated();
        $this->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['feedback' => 'Again']])->assertUnprocessable();

        // Staff fill forms but cannot build them by default; managers can.
        $this->actingAs($outside)->postJson($this->api($org, '/forms'), ['name' => 'Mine'])->assertForbidden();
        $this->getJson($this->api($org, '/forms?mode=manage'))->assertForbidden();
        $this->actingAs($inHr)->putJson($this->api($org, "/forms/{$formId}/draft"), ['fields' => []])->assertForbidden();
        $managerForm = $this->actingAs($manager)->postJson($this->api($org, '/forms'), ['name' => 'Team survey'])->assertCreated()->json('data.id');
        // Managers only manage their own forms (no "edit" on others by default).
        $this->assertSame([$managerForm], array_column($this->getJson($this->api($org, '/forms?mode=manage'))->json('data'), 'id'));

        // Department IDs from another workspace are refused.
        $foreign = $this->createOrganization(null, 'Other')->departments()->create(['name' => 'Spies']);
        $this->patchJson($this->api($org, "/forms/{$managerForm}"), ['audience' => ['department_ids' => [$foreign->id]]])->assertJsonValidationErrors('audience.department_ids');
    }

    public function test_other_organisations_and_uninstalled_app_get_404(): void
    {
        $org = $this->org('Alpha');
        $formId = $this->publishedForm($org, [], [['type' => 'text', 'label' => 'Name']]);
        $sub = $this->actingAs($this->addMember($org))->postJson($this->api($org, "/forms/{$formId}/submissions"), ['values' => ['name' => 'A']])->json('data.id');

        $orgB = $this->org('Beta');
        $this->actingAs($this->owner($orgB));
        $this->getJson($this->api($orgB, "/forms/{$formId}"))->assertNotFound();
        $this->putJson($this->api($orgB, "/forms/{$formId}/draft"), ['fields' => []])->assertNotFound();
        $this->postJson($this->api($orgB, "/forms/{$formId}/submissions"), ['values' => ['name' => 'x']])->assertNotFound();
        $this->getJson($this->api($orgB, "/form-submissions/{$sub}"))->assertNotFound();
        $this->getJson($this->api($org, '/forms'))->assertNotFound();

        // Uninstalling the Form app closes the API for everyone in that workspace.
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/admin/apps/form'))->assertOk();
        $this->getJson($this->api($org, '/forms'))->assertNotFound();
    }
}
