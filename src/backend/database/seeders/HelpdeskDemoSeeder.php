<?php

namespace Database\Seeders;

use App\Models\Helpdesk\Ticket;
use App\Models\Organization;
use App\Models\User;
use App\Support\Helpdesk\Helpdesk;
use Illuminate\Support\Facades\DB;

/**
 * Fictional Helpdesk data for Rakan Teknologi: Daniel (Operations) is the
 * listed agent. Goes through the real service, so SLA times and history are real.
 */
class HelpdeskDemoSeeder
{
    /** @param array<string, User> $u */
    public function rakanTech(Organization $org, array $u): void
    {
        DB::table('helpdesk_agents')->insert(['organization_id' => $org->id, 'user_id' => $u['daniel']->id, 'created_at' => now(), 'updated_at' => now()]);
        $org->cannedResponses()->createMany([
            ['title' => 'Restart first', 'body' => "Thanks for reporting this. Could you restart the device and tell us if it still happens?\n\n– Operations", 'created_by' => $u['daniel']->id],
            ['title' => 'Purchase needs approval', 'body' => 'New equipment goes through a Purchase Request in the Form app. Fill it in and we will order it once it is approved.', 'created_by' => $u['daniel']->id],
        ]);

        // In progress, with an internal note.
        $vpn = Helpdesk::create($org, $u['meiling'], [
            'subject' => 'VPN disconnects every few minutes', 'priority' => 'high', 'category' => 'IT',
            'description' => "Since yesterday the VPN drops every 5–10 minutes when I work from home. I'm on the latest client.",
        ]);
        Helpdesk::update($vpn, $u['daniel'], ['assignee_id' => $u['daniel']->id]);
        Helpdesk::reply($vpn, $u['daniel'], 'Thanks Mei Ling. Are you on Wi-Fi or a cable at home? And does it happen on the office network too?');
        Helpdesk::reply($vpn, $u['meiling'], 'Wi-Fi at home. In the office it is fine.');
        Helpdesk::reply($vpn, $u['daniel'], 'Two other remote staff reported the same after the router firmware update. Checking with the ISP.', internal: true);

        // New and unassigned.
        Helpdesk::create($org, $u['hafiz'], [
            'subject' => 'Second monitor for the design reviews', 'priority' => 'low', 'category' => 'IT',
            'description' => 'Could I get a second 27" monitor? It would make reviewing the landing page designs much easier.',
        ]);

        // Resolved.
        $aircond = Helpdesk::create($org, $u['priya'], [
            'subject' => 'Meeting room air-conditioning is leaking', 'priority' => 'medium', 'category' => 'Facilities',
            'description' => 'Water is dripping from the aircond in the main meeting room onto the carpet.',
        ]);
        Helpdesk::reply($aircond, $u['daniel'], 'Technician is coming at 2pm today. Please keep the room closed until then.', status: Ticket::STATUS_IN_PROGRESS);
        Helpdesk::update($aircond, $u['daniel'], ['assignee_id' => $u['daniel']->id, 'status' => Ticket::STATUS_RESOLVED]);
    }
}
