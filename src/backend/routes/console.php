<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('rakanspace:send-reminders')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('rakanspace:approval-sla')->everyFiveMinutes()->withoutOverlapping()->onOneServer();
Schedule::command('rakanspace:prune-attachments')->hourly()->withoutOverlapping();
Schedule::command('queue:prune-failed --hours=720')->daily();
Schedule::command('rakanspace:timesheet-reminders')->dailyAt('09:00')->withoutOverlapping()->onOneServer();
Schedule::command('rakanspace:helpdesk-sla')->everyFiveMinutes()->withoutOverlapping()->onOneServer();
