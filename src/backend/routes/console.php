<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('rakanspace:send-reminders')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('rakanspace:prune-attachments')->hourly()->withoutOverlapping();
Schedule::command('queue:prune-failed --hours=720')->daily();
