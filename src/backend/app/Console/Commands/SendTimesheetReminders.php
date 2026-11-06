<?php

namespace App\Console\Commands;

use App\Support\Timesheets\Timesheets;
use Illuminate\Console\Command;

/** Reminds members once about past weeks they logged time for but never submitted. */
class SendTimesheetReminders extends Command
{
    protected $signature = 'rakanspace:timesheet-reminders';

    protected $description = 'Remind members to submit last week\'s timesheet';

    public function handle(): int
    {
        $count = Timesheets::remindUnsubmitted();
        $this->info("Reminded {$count} unsubmitted timesheets.");

        return self::SUCCESS;
    }
}
