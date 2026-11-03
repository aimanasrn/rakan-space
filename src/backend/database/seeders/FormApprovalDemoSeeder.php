<?php

namespace Database\Seeders;

use App\Models\Approval\ApprovalDelegation;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Organization;
use App\Models\User;
use App\Support\Approvals\Approvals;
use App\Support\Forms\Forms;

/**
 * Fictional Form + Approval demo data. Called from DemoSeeder with its users.
 * Goes through the real services, so statuses, history and notifications are consistent.
 */
class FormApprovalDemoSeeder
{
    /** @param array<string, User> $u */
    public function rakanTech(Organization $org, array $u): void
    {
        $purchase = $this->workflow($org, $u['aisyah'], 'Purchase approval', 'Line manager first; Finance for purchases above RM 5,000.', [
            ['name' => 'Line manager', 'mode' => 'any', 'approvers' => [['type' => 'manager']], 'sla_hours' => 24],
            ['name' => 'Finance', 'mode' => 'any', 'approvers' => [['type' => 'user', 'user_id' => $u['daniel']->id]],
                'condition' => ['field' => 'amount', 'operator' => 'gt', 'value' => 5000], 'sla_hours' => 48, 'escalate_to' => $u['aisyah']->id],
        ]);
        $leave = $this->workflow($org, $u['aisyah'], 'Leave approval', 'Reporting manager approves within one working day.', [
            ['name' => 'Reporting manager', 'mode' => 'any', 'approvers' => [['type' => 'manager']], 'sla_hours' => 24],
        ]);
        $this->workflow($org, $u['aisyah'], 'Policy sign-off', 'CEO and Head of Operations must both approve.', [
            ['name' => 'Leadership', 'mode' => 'all', 'approvers' => [['type' => 'user', 'user_id' => $u['aisyah']->id], ['type' => 'user', 'user_id' => $u['daniel']->id]]],
        ]);

        $purchaseForm = $this->form($org, $u['daniel'], 'Purchase Request', 'Request equipment, software or services. Purchases above RM 5,000 also need Finance approval.', $purchase, [
            ['type' => 'text', 'label' => 'Item or service', 'key' => 'item', 'required' => true],
            ['type' => 'dropdown', 'label' => 'Category', 'required' => true, 'options' => ['choices' => ['Hardware', 'Software', 'Services', 'Other']]],
            ['type' => 'textarea', 'label' => 'Describe the category', 'key' => 'other_category', 'required' => true,
                'visibility' => ['field' => 'category', 'operator' => 'eq', 'value' => 'Other']],
            ['type' => 'number', 'label' => 'Total amount (RM)', 'key' => 'amount', 'required' => true, 'validation' => ['min' => 1, 'max' => 500000]],
            ['type' => 'date', 'label' => 'Needed by', 'key' => 'needed_by'],
            ['type' => 'table', 'label' => 'Line items', 'key' => 'line_items', 'options' => ['columns' => [
                ['label' => 'Description', 'key' => 'description', 'type' => 'text'],
                ['label' => 'Qty', 'key' => 'qty', 'type' => 'number'],
                ['label' => 'Unit price (RM)', 'key' => 'unit_price', 'type' => 'number'],
            ]], 'validation' => ['max_rows' => 20]],
            ['type' => 'textarea', 'label' => 'Justification', 'key' => 'justification', 'required' => true],
            ['type' => 'file', 'label' => 'Quotation', 'key' => 'quotation', 'help_text' => 'PDF or image, up to 3 files.', 'validation' => ['max_files' => 3]],
            ['type' => 'signature', 'label' => 'Requester signature', 'key' => 'signature'],
        ]);

        $leaveForm = $this->form($org, $u['daniel'], 'Leave Application', 'Apply for annual, medical or emergency leave.', $leave, [
            ['type' => 'dropdown', 'label' => 'Leave type', 'key' => 'leave_type', 'required' => true, 'options' => ['choices' => ['Annual', 'Medical', 'Emergency', 'Unpaid']]],
            ['type' => 'date', 'label' => 'First day', 'key' => 'start_date', 'required' => true],
            ['type' => 'date', 'label' => 'Last day', 'key' => 'end_date', 'required' => true],
            ['type' => 'number', 'label' => 'Working days', 'key' => 'days', 'required' => true, 'validation' => ['min' => 0.5, 'max' => 60]],
            ['type' => 'file', 'label' => 'Medical certificate', 'key' => 'mc', 'required' => true,
                'visibility' => ['field' => 'leave_type', 'operator' => 'eq', 'value' => 'Medical']],
            ['type' => 'textarea', 'label' => 'Handover notes', 'key' => 'handover'],
        ]);

        $survey = $this->form($org, $u['aisyah'], 'Quarterly Pulse Survey', 'Anonymous-style pulse check. One response per person.', null, [
            ['type' => 'radio', 'label' => 'How do you feel about work this quarter?', 'key' => 'mood', 'required' => true,
                'options' => ['choices' => ['Great', 'Good', 'Okay', 'Not great']]],
            ['type' => 'textarea', 'label' => 'What could we do better?', 'key' => 'improve', 'required' => true,
                'visibility' => ['field' => 'mood', 'operator' => 'eq', 'value' => 'Not great']],
            ['type' => 'checkbox', 'label' => 'What is going well?', 'key' => 'going_well',
                'options' => ['choices' => ['Team', 'Projects', 'Tools', 'Learning', 'Work-life balance']]],
            ['type' => 'textarea', 'label' => 'Anything else?', 'key' => 'comments'],
        ], ['allow_multiple' => false]);

        // A draft that is not published yet.
        $draft = $org->forms()->create(['name' => 'IT Equipment Return', 'description' => 'Return laptops and accessories when leaving.', 'created_by' => $u['priya']->id]);
        Forms::saveDraft($draft, [['type' => 'text', 'label' => 'Asset tag', 'required' => true], ['type' => 'signature', 'label' => 'Signature']]);

        // Responses in different states.
        $this->submit($org, $purchaseForm, $u['hafiz'], ['item' => 'Mechanical keyboard', 'category' => 'Hardware', 'amount' => 450, 'needed_by' => now()->addDays(10)->toDateString(),
            'line_items' => [['description' => 'Keychron K8', 'qty' => 1, 'unit_price' => 450]], 'justification' => 'Current keyboard has failing keys.']);

        $workstation = $this->submit($org, $purchaseForm, $u['meiling'], ['item' => 'Design workstation', 'category' => 'Hardware', 'amount' => 8200,
            'line_items' => [['description' => 'Workstation', 'qty' => 1, 'unit_price' => 7400], ['description' => '27" colour-calibrated monitor', 'qty' => 1, 'unit_price' => 800]],
            'justification' => 'Rendering the new brand assets takes 20+ minutes on the current laptop.']);
        $this->decide($workstation, $u['priya'], 'approve', 'Agreed, this blocks the website revamp.');

        $leaveOk = $this->submit($org, $leaveForm, $u['hafiz'], ['leave_type' => 'Annual', 'start_date' => now()->addDays(14)->toDateString(),
            'end_date' => now()->addDays(16)->toDateString(), 'days' => 3, 'handover' => 'Meiling covers design QA; API on-call swapped with Priya.']);
        $this->decide($leaveOk, $u['priya'], 'approve', 'Enjoy the break!');

        $leaveReturned = $this->submit($org, $leaveForm, $u['meiling'], ['leave_type' => 'Annual', 'start_date' => now()->addDays(5)->toDateString(),
            'end_date' => now()->addDays(9)->toDateString(), 'days' => 5]);
        $this->decide($leaveReturned, $u['priya'], 'return', 'Please add handover notes for the homepage design before I approve.');

        $this->submit($org, $survey, $u['hafiz'], ['mood' => 'Good', 'going_well' => ['Team', 'Learning']]);
        $this->submit($org, $survey, $u['daniel'], ['mood' => 'Not great', 'improve' => 'Fewer meetings on Fridays.', 'going_well' => ['Team']]);

        // A request made directly in the Approval app.
        Approvals::submitForApproval($org, $u['priya'], 'manual', null, $purchase, 'Team offsite in Port Dickson',
            ['amount' => 3200], 'Two-day offsite for the engineering team (6 people), including transport.');

        // Daniel is away next week; Aisyah covers his approvals.
        ApprovalDelegation::create([
            'organization_id' => $org->id, 'delegator_id' => $u['daniel']->id, 'delegate_id' => $u['aisyah']->id,
            'starts_at' => now()->startOfWeek()->addWeek(), 'ends_at' => now()->startOfWeek()->addWeeks(2), 'reason' => 'Annual leave',
        ]);
    }

    /** @param array<string, User> $u */
    public function kopiKita(Organization $org, array $u): void
    {
        $stock = $this->workflow($org, $u['farah'], 'Outlet requests', 'Outlet manager approves.', [
            ['name' => 'Outlet manager', 'mode' => 'any', 'approvers' => [['type' => 'manager']], 'sla_hours' => 12],
        ]);
        $incident = $this->form($org, $u['farah'], 'Outlet Incident Report', 'Report equipment faults, accidents or customer complaints.', $stock, [
            ['type' => 'dropdown', 'label' => 'Outlet', 'key' => 'outlet', 'required' => true, 'options' => ['choices' => ['SS2', 'Bangsar', 'Shah Alam']]],
            ['type' => 'radio', 'label' => 'Type', 'key' => 'type', 'required' => true, 'options' => ['choices' => ['Equipment', 'Safety', 'Customer']]],
            ['type' => 'textarea', 'label' => 'What happened?', 'key' => 'details', 'required' => true],
            ['type' => 'number', 'label' => 'Estimated repair cost (RM)', 'key' => 'amount', 'visibility' => ['field' => 'type', 'operator' => 'eq', 'value' => 'Equipment']],
        ]);
        $this->submit($org, $incident, $u['siti'], ['outlet' => 'SS2', 'type' => 'Equipment', 'details' => 'Espresso machine group head is leaking.', 'amount' => 650]);
    }

    private function workflow(Organization $org, User $creator, string $name, string $description, array $steps): ApprovalWorkflow
    {
        $workflow = ApprovalWorkflow::create(['organization_id' => $org->id, 'name' => $name, 'description' => $description, 'created_by' => $creator->id]);
        foreach ($steps as $i => $step) {
            $workflow->steps()->create(['organization_id' => $org->id, 'position' => $i + 1, ...$step]);
        }

        return $workflow;
    }

    private function form(Organization $org, User $creator, string $name, string $description, ?ApprovalWorkflow $workflow, array $fields, array $extra = []): Form
    {
        $form = $org->forms()->create(['name' => $name, 'description' => $description, 'workflow_id' => $workflow?->id, 'created_by' => $creator->id, ...$extra]);
        Forms::saveDraft($form, $fields);

        return Forms::publish($form, $creator);
    }

    private function submit(Organization $org, Form $form, User $user, array $values): FormSubmission
    {
        return Forms::submit($org, $form, $user, $values);
    }

    private function decide(FormSubmission $submission, User $approver, string $decision, string $comment): void
    {
        Approvals::decide(ApprovalRequest::findOrFail($submission->approval_request_id), $approver, $decision, $comment);
    }
}
