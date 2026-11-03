<?php

namespace Database\Seeders;

use App\Support\AppCatalog;
use Illuminate\Database\Seeder;

/** Syncs the launcher app catalogue. Safe in production. */
class AppCatalogSeeder extends Seeder
{
    public function run(): void
    {
        AppCatalog::sync();
    }
}
