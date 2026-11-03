<?php

namespace App\Console\Commands;

use App\Models\Attachment;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class PrunePendingAttachments extends Command
{
    protected $signature = 'rakanspace:prune-attachments';

    protected $description = 'Delete uploads that were never linked to a message, task, project or announcement';

    public function handle(): int
    {
        $deleted = 0;
        Attachment::query()
            ->whereNull('attachable_type')
            ->where('created_at', '<', now()->subHours(config('rakanspace.attachments.pending_ttl_hours')))
            ->chunkById(200, function ($attachments) use (&$deleted) {
                foreach ($attachments as $attachment) {
                    Storage::disk($attachment->disk)->delete($attachment->path);
                    $attachment->delete();
                    $deleted++;
                }
            });

        $this->info("Deleted {$deleted} unattached uploads.");

        return self::SUCCESS;
    }
}
