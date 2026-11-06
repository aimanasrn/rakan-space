<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use App\Support\Crm\Pipeline;

/**
 * Fictional customers and deals for Rakan Teknologi. Hafiz (Staff) owns some
 * deals and reports to Priya (Manager), who sees the whole pipeline.
 */
class CrmDemoSeeder
{
    /** @param array<string, User> $u */
    public function rakanTech(Organization $org, array $u): void
    {
        $stages = Pipeline::stages($org)->keyBy('name');
        $date = fn (int $days) => now($org->timezone)->addDays($days)->toDateString();

        $kedai = $org->accounts()->create(['name' => 'Kedai Maju Sdn Bhd', 'industry' => 'Retail', 'website' => 'https://kedaimaju.example',
            'phone' => '+60 3-7712 3456', 'owner_id' => $u['hafiz']->id, 'created_by' => $u['hafiz']->id]);
        $klinik = $org->accounts()->create(['name' => 'Klinik Sihat Bangsar', 'industry' => 'Healthcare',
            'owner_id' => $u['priya']->id, 'created_by' => $u['priya']->id]);
        $logistik = $org->accounts()->create(['name' => 'Pantas Logistik Berhad', 'industry' => 'Logistics', 'website' => 'https://pantas.example',
            'owner_id' => $u['priya']->id, 'created_by' => $u['priya']->id]);

        $rahim = $org->contacts()->create(['account_id' => $kedai->id, 'name' => 'Encik Rahim Osman', 'email' => 'rahim@kedaimaju.example',
            'job_title' => 'Operations Director', 'created_by' => $u['hafiz']->id]);
        $org->contacts()->create(['account_id' => $klinik->id, 'name' => 'Dr. Nadia Karim', 'email' => 'nadia@kliniksihat.example',
            'job_title' => 'Clinic Manager', 'created_by' => $u['priya']->id]);
        $wong = $org->contacts()->create(['account_id' => $logistik->id, 'name' => 'Wong Kar Hoe', 'email' => 'kh.wong@pantas.example',
            'phone' => '+60 12-345 6789', 'job_title' => 'Head of IT', 'created_by' => $u['priya']->id]);

        $pos = Pipeline::create($org, $u['hafiz'], ['name' => 'Kedai Maju online shop', 'amount' => 38000, 'account_id' => $kedai->id,
            'contact_id' => $rahim->id, 'stage_id' => $stages['Proposal']->id, 'expected_close_date' => $date(18),
            'description' => 'Shopify-style online shop with stock sync to their three outlets.']);
        Pipeline::create($org, $u['hafiz'], ['name' => 'Kedai Maju loyalty app', 'amount' => 15000, 'account_id' => $kedai->id,
            'stage_id' => $stages['Lead']->id, 'expected_close_date' => $date(60)]);
        Pipeline::create($org, $u['priya'], ['name' => 'Patient booking portal', 'amount' => 52000, 'account_id' => $klinik->id,
            'stage_id' => $stages['Negotiation']->id, 'expected_close_date' => $date(9)]);
        $fleet = Pipeline::create($org, $u['priya'], ['name' => 'Fleet tracking dashboard', 'amount' => 120000, 'account_id' => $logistik->id,
            'contact_id' => $wong->id, 'stage_id' => $stages['Qualified']->id, 'expected_close_date' => $date(45)]);
        Pipeline::create($org, $u['priya'], ['name' => 'Pantas staff intranet', 'amount' => 24000, 'account_id' => $logistik->id,
            'stage_id' => $stages['Won']->id]);
        Pipeline::create($org, $u['hafiz'], ['name' => 'Kedai Maju POS integration', 'amount' => 9000, 'account_id' => $kedai->id,
            'stage_id' => $stages['Lost']->id, 'lost_reason' => 'They chose their POS vendor\'s own integration.']);

        $org->crmActivities()->createMany([
            ['opportunity_id' => $pos->id, 'account_id' => $kedai->id, 'type' => 'meeting', 'subject' => 'Requirements workshop',
                'body' => 'Rahim wants stock levels per outlet visible online. Budget approved up to RM 40k.', 'user_id' => $u['hafiz']->id],
            ['opportunity_id' => $pos->id, 'account_id' => $kedai->id, 'type' => 'task', 'subject' => 'Send revised proposal',
                'due_at' => now()->addDays(2), 'user_id' => $u['hafiz']->id],
            ['opportunity_id' => $fleet->id, 'account_id' => $logistik->id, 'type' => 'call', 'subject' => 'Intro call with Wong',
                'body' => 'Currently on spreadsheets; 140 lorries. Wants a pilot in Q1.', 'user_id' => $u['priya']->id],
            ['account_id' => $klinik->id, 'type' => 'note', 'subject' => 'Referral from Dr. Lim', 'user_id' => $u['priya']->id],
        ]);
    }
}
