<?php

namespace App\Console\Commands;

use App\Support\Helpdesk\Helpdesk;
use Illuminate\Console\Command;

/** Warns about Helpdesk SLA targets due within the hour, reports misses and auto-closes resolved tickets. */
class ProcessHelpdeskSla extends Command
{
    protected $signature = 'rakanspace:helpdesk-sla';

    protected $description = 'Send Helpdesk SLA warnings and auto-close resolved tickets';

    public function handle(): int
    {
        $r = Helpdesk::processSla();
        $this->info("SLA warnings {$r['warned']}, misses {$r['breached']}, auto-closed {$r['closed']}.");

        return self::SUCCESS;
    }
}
