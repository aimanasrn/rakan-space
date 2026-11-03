<?php

namespace App\Console\Commands;

use App\Support\Approvals\Approvals;
use Illuminate\Console\Command;

/** Reminds approvers after a step's time limit and escalates at twice the limit. */
class ProcessApprovalSla extends Command
{
    protected $signature = 'rakanspace:approval-sla';

    protected $description = 'Send approval reminders and escalations for overdue steps';

    public function handle(): int
    {
        $result = Approvals::processSla();
        $this->info("Reminded {$result['reminded']} steps, escalated {$result['escalated']}.");

        return self::SUCCESS;
    }
}
