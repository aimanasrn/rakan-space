<?php

namespace App\Console\Commands;

use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Support\Notifier;
use Illuminate\Console\Command;

/**
 * Runs every minute from the scheduler. Each reminder carries a dedupe key
 * (stored with a unique index), so overlapping or repeated runs never
 * notify the same person twice.
 */
class SendReminders extends Command
{
    protected $signature = 'rakanspace:send-reminders';

    protected $description = 'Send event reminders and upcoming task deadline notifications';

    public function handle(): int
    {
        $events = $this->eventReminders();
        $tasks = $this->deadlineReminders();
        $this->info("Queued reminders for {$events} events and {$tasks} tasks.");

        return self::SUCCESS;
    }

    private function eventReminders(): int
    {
        $count = 0;
        // Events whose reminder time has passed but which have not started yet.
        Event::query()
            ->whereNotNull('reminder_minutes')
            ->where('starts_at', '>', now())
            ->where('starts_at', '<=', now()->addDay())
            ->with('organization')
            ->chunkById(200, function ($events) use (&$count) {
                foreach ($events as $event) {
                    if ($event->starts_at->copy()->subMinutes($event->reminder_minutes)->isFuture()) {
                        continue;
                    }

                    $recipients = $event->audience === Event::AUDIENCE_EVERYONE
                        ? $event->organization->activeMemberships()->pluck('user_id')->all()
                        : $event->participants()->pluck('users.id')->all();

                    $local = $event->starts_at->copy()->setTimezone($event->organization->timezone);
                    Notifier::send($event->organization_id, $recipients, 'event.reminder',
                        'Starting soon: '.$event->title,
                        $local->format('g:i A').($event->location ? ' · '.$event->location : ''),
                        '/calendar?event='.$event->id, null,
                        // Re-scheduling the event produces a new key, so a new reminder.
                        'event-reminder:'.$event->id.':'.$event->starts_at->timestamp);
                    $count++;
                }
            });

        return $count;
    }

    private function deadlineReminders(): int
    {
        $count = 0;
        // Date-only deadlines: "tomorrow" is evaluated in each organisation's time zone.
        Organization::query()->select(['id', 'timezone'])->chunkById(100, function ($organizations) use (&$count) {
            foreach ($organizations as $organization) {
                $tomorrow = now($organization->timezone)->addDay()->toDateString();

                Task::query()
                    ->where('organization_id', $organization->id)
                    ->whereNotNull('assignee_id')
                    ->where('status', '!=', 'done')
                    ->where('due_date', $tomorrow)
                    ->whereHas('project', fn ($q) => $q->whereNull('archived_at'))
                    ->chunkById(200, function ($tasks) use ($organization, &$count) {
                        foreach ($tasks as $task) {
                            Notifier::send($organization->id, [$task->assignee_id], 'task.due',
                                'Due tomorrow: '.$task->title, null,
                                '/projects/'.$task->project_id.'?task='.$task->id, null,
                                'task-due:'.$task->id.':'.$task->due_date->format('Y-m-d'));
                            $count++;
                        }
                    });
            }
        });

        return $count;
    }
}
