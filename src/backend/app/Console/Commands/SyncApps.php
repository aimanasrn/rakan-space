<?php

namespace App\Console\Commands;

use App\Support\AppCatalog;
use Illuminate\Console\Command;

class SyncApps extends Command
{
    protected $signature = 'rakanspace:sync-apps';

    protected $description = 'Sync the launcher app catalogue from code into the apps table';

    public function handle(): int
    {
        AppCatalog::sync();
        $this->info(count(AppCatalog::DEFINITIONS).' apps synced.');

        return self::SUCCESS;
    }
}
