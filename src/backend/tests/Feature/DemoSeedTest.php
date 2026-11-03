<?php

namespace Tests\Feature;

use App\Models\Approval\ApprovalRequest;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Organization;
use App\Support\Approvals\Approvals;
use App\Support\Forms\Forms;
use Database\Seeders\DatabaseSeeder;
use Tests\TestCase;

/** The demo data must seed cleanly through the real services. */
class DemoSeedTest extends TestCase
{
    public function test_demo_data_seeds_with_consistent_forms_and_approvals(): void
    {
        $this->seed(DatabaseSeeder::class);

        $rakan = Organization::where('slug', 'rakan-tech')->firstOrFail();
        $this->assertSame(4, Form::where('organization_id', $rakan->id)->count());
        $this->assertSame(3, Form::where('organization_id', $rakan->id)->where('status', 'published')->count());

        $statuses = FormSubmission::where('organization_id', $rakan->id)->pluck('status')->countBy()->all();
        $this->assertSame(['pending_approval' => 2, 'approved' => 1, 'returned' => 1, 'submitted' => 2], array_intersect_key($statuses, array_flip(['pending_approval', 'approved', 'returned', 'submitted'])));

        // The workstation (RM 8,200) passed the line manager and now waits for Finance (Daniel).
        $workstation = ApprovalRequest::where('organization_id', $rakan->id)->where('title', 'like', 'Purchase Request · Tan Mei Ling')->firstOrFail();
        $this->assertSame('pending', $workstation->status);
        $this->assertSame('Finance', Approvals::currentStep($workstation)->name);

        // Every submission's status matches its approval request.
        FormSubmission::whereNotNull('approval_request_id')->with('approvalRequest')->get()->each(fn ($s) => $this->assertSame(
            Forms::statusFor($s->approvalRequest->status), $s->status));
    }
}
