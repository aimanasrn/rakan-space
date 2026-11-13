<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Crm\Opportunity;
use App\Models\Organization;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\AppCatalog;
use Tests\TestCase;

class OpportunityTest extends TestCase
{
    /** @return array{0: Organization, 1: User, 2: User, 3: User} [org, sales rep (staff), their manager, sales manager (manager role)] */
    private function team(): array
    {
        $org = $this->createOrganization(null, 'Acme');
        AppCatalog::installDefaults($org, $this->owner($org));
        $rep = $this->addMember($org, Role::Staff);
        $lead = $this->addMember($org, Role::Staff);
        $this->membership($org, $rep)->update(['manager_id' => $lead->id]);
        $salesManager = $this->addMember($org, Role::Manager);

        return [$org, $rep, $lead, $salesManager];
    }

    private function stages(Organization $org, User $user): array
    {
        return collect($this->actingAs($user)->getJson($this->api($org, '/crm/summary'))->assertOk()->json('data.stages'))
            ->keyBy('name')->map(fn ($s) => $s['id'])->all();
    }

    private function deal(Organization $org, User $user, array $extra = []): int
    {
        return $this->actingAs($user)->postJson($this->api($org, '/crm/opportunities'), ['name' => 'Website for Kedai Maju', 'amount' => 12000, ...$extra])
            ->assertCreated()->json('data.id');
    }

    public function test_rep_works_a_deal_through_the_pipeline(): void
    {
        [$org, $rep] = $this->team();
        $stages = $this->stages($org, $rep);
        $this->assertSame(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'], array_keys($stages));

        $account = $this->actingAs($rep)->postJson($this->api($org, '/crm/accounts'), ['name' => 'Kedai Maju Sdn Bhd', 'industry' => 'Retail'])
            ->assertCreated()->assertJsonPath('data.owner.id', $rep->id)->json('data.id');
        $contact = $this->actingAs($rep)->postJson($this->api($org, '/crm/contacts'), ['name' => 'Encik Rahim', 'email' => 'rahim@example.test', 'account_id' => $account])
            ->assertCreated()->json('data.id');

        $res = $this->actingAs($rep)->postJson($this->api($org, '/crm/opportunities'), [
            'name' => 'Website revamp', 'amount' => '25000.50', 'account_id' => $account, 'contact_id' => $contact, 'expected_close_date' => now()->addDays(20)->toDateString(),
        ])->assertCreated()
            ->assertJsonPath('data.stage_id', $stages['Lead'])
            ->assertJsonPath('data.owner.id', $rep->id)
            ->assertJsonPath('data.account.name', 'Kedai Maju Sdn Bhd')
            ->assertJsonPath('data.amount', 25000.5);
        $id = $res->json('data.id');

        $this->actingAs($rep)->postJson($this->api($org, "/crm/opportunities/{$id}/move"), ['stage_id' => $stages['Proposal']])->assertOk()
            ->assertJsonPath('data.stage_id', $stages['Proposal']);
        // Lost needs a reason.
        $this->actingAs($rep)->postJson($this->api($org, "/crm/opportunities/{$id}/move"), ['stage_id' => $stages['Lost']])
            ->assertJsonValidationErrors('lost_reason');
        $this->actingAs($rep)->postJson($this->api($org, "/crm/opportunities/{$id}/move"), ['stage_id' => $stages['Lost'], 'lost_reason' => 'Went with a cheaper vendor'])
            ->assertOk()->assertJsonPath('data.lost_reason', 'Went with a cheaper vendor');
        $this->assertNotNull(Opportunity::find($id)->closed_at);
        // Reopened, then won: the reason is cleared.
        $this->actingAs($rep)->patchJson($this->api($org, "/crm/opportunities/{$id}"), ['stage_id' => $stages['Negotiation']])->assertOk()
            ->assertJsonPath('data.lost_reason', null)->assertJsonPath('data.closed_at', null);
        $this->actingAs($rep)->patchJson($this->api($org, "/crm/opportunities/{$id}"), ['stage_id' => $stages['Won']])->assertOk();

        // Activities and follow-up tasks.
        $task = $this->actingAs($rep)->postJson($this->api($org, '/crm/activities'), [
            'type' => 'task', 'subject' => 'Send invoice', 'opportunity_id' => $id, 'due_at' => now()->addDay()->toIso8601String(),
        ])->assertCreated()->assertJsonPath('data.account.id', $account)->json('data.id');
        $this->actingAs($rep)->postJson($this->api($org, '/crm/activities'), ['type' => 'call', 'subject' => 'Kick-off call', 'opportunity_id' => $id])->assertCreated();
        $this->actingAs($rep)->getJson($this->api($org, '/crm/activities/my-tasks'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($rep)->patchJson($this->api($org, "/crm/activities/{$task}"), ['done' => true])->assertOk();
        $this->actingAs($rep)->getJson($this->api($org, '/crm/activities/my-tasks'))->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($rep)->getJson($this->api($org, "/crm/opportunities/{$id}"))->assertOk()
            ->assertJsonCount(2, 'data.activities')
            ->assertJsonPath('data.history.1.event', 'crm.stage_changed');

        // The account page shows its contacts, deals and activities.
        $this->actingAs($rep)->getJson($this->api($org, "/crm/accounts/{$account}"))->assertOk()
            ->assertJsonCount(1, 'data.contacts')->assertJsonCount(1, 'data.opportunities')->assertJsonCount(2, 'data.activities');
    }

    public function test_who_sees_and_changes_an_opportunity(): void
    {
        [$org, $rep, $lead, $salesManager] = $this->team();
        $colleague = $this->addMember($org, Role::Staff);
        $id = $this->deal($org, $rep);
        $url = $this->api($org, "/crm/opportunities/{$id}");

        $this->actingAs($rep)->getJson($url)->assertOk()->assertJsonPath('data.permissions.edit', true);
        // Reporting manager: sees, cannot change.
        $this->actingAs($lead)->getJson($url)->assertOk()->assertJsonPath('data.permissions.edit', false);
        $this->actingAs($lead)->patchJson($url, ['amount' => 1])->assertForbidden();
        // Sales manager ("edit") and Owner see and change everything.
        $this->actingAs($salesManager)->patchJson($url, ['amount' => 15000])->assertOk();
        $this->actingAs($this->owner($org))->getJson($url)->assertOk();
        // A colleague: not found, not listed, cannot attach activities by guessing.
        $this->actingAs($colleague)->getJson($url)->assertNotFound();
        $this->actingAs($colleague)->patchJson($url, ['amount' => 1])->assertNotFound();
        $this->actingAs($colleague)->postJson("{$url}/move", ['stage_id' => 1])->assertNotFound();
        $this->actingAs($colleague)->getJson($this->api($org, '/crm/opportunities'))->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($colleague)->postJson($this->api($org, '/crm/activities'), ['type' => 'note', 'subject' => 'x', 'opportunity_id' => $id])
            ->assertJsonValidationErrors('opportunity_id');
        $this->actingAs($lead)->getJson($this->api($org, '/crm/opportunities'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($salesManager)->getJson($this->api($org, '/crm/opportunities?owner=me'))->assertOk()->assertJsonCount(0, 'data');

        // Deleting needs the "delete" ability (Owners/Admins by default).
        $this->actingAs($rep)->deleteJson($url)->assertForbidden();
        $this->actingAs($this->owner($org))->deleteJson($url)->assertNoContent();

        // Other organisation: guessed IDs are 404 everywhere.
        $other = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($other, $this->owner($other));
        $theirs = $this->deal($other, $this->owner($other));
        $this->actingAs($this->owner($org))->getJson($this->api($org, "/crm/opportunities/{$theirs}"))->assertNotFound();
        $this->actingAs($this->owner($org))->getJson($this->api($other, "/crm/opportunities/{$theirs}"))->assertNotFound();
    }

    public function test_references_are_checked_inside_the_organisation(): void
    {
        [$org, $rep, $lead, $salesManager] = $this->team();
        $other = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($other, $this->owner($other));
        $foreignUser = $this->addMember($other, Role::Staff);
        $this->actingAs($this->owner($other));
        $foreignAccount = $this->postJson($this->api($other, '/crm/accounts'), ['name' => 'Theirs'])->json('data.id');
        $foreignContact = $this->postJson($this->api($other, '/crm/contacts'), ['name' => 'Them'])->json('data.id');
        $foreignStage = $this->stages($other, $this->owner($other))['Lead'];

        $base = $this->api($org, '/crm/opportunities');
        $this->actingAs($rep)->postJson($base, ['name' => 'x', 'account_id' => $foreignAccount])->assertJsonValidationErrors('account_id');
        $this->actingAs($rep)->postJson($base, ['name' => 'x', 'contact_id' => $foreignContact])->assertJsonValidationErrors('contact_id');
        $this->actingAs($rep)->postJson($base, ['name' => 'x', 'stage_id' => $foreignStage])->assertJsonValidationErrors('stage_id');
        $this->actingAs($salesManager)->postJson($base, ['name' => 'x', 'owner_id' => $foreignUser->id])->assertJsonValidationErrors('owner_id');
        // A rep cannot hand deals to someone else; a sales manager can, and the new owner is told.
        $this->actingAs($rep)->postJson($base, ['name' => 'x', 'owner_id' => $lead->id])->assertJsonValidationErrors('owner_id');
        $this->actingAs($salesManager)->postJson($base, ['name' => 'Handed over', 'owner_id' => $rep->id])->assertCreated()->assertJsonPath('data.owner.id', $rep->id);
        $this->assertSame(1, UserNotification::where('user_id', $rep->id)->where('type', 'crm.assigned')->count());

        // A contact from another account.
        $a1 = $this->actingAs($rep)->postJson($this->api($org, '/crm/accounts'), ['name' => 'A1'])->json('data.id');
        $a2 = $this->actingAs($rep)->postJson($this->api($org, '/crm/accounts'), ['name' => 'A2'])->json('data.id');
        $c2 = $this->actingAs($rep)->postJson($this->api($org, '/crm/contacts'), ['name' => 'C2', 'account_id' => $a2])->json('data.id');
        $this->actingAs($rep)->postJson($base, ['name' => 'x', 'account_id' => $a1, 'contact_id' => $c2])->assertJsonValidationErrors('contact_id');
        $this->actingAs($rep)->postJson($this->api($org, '/crm/contacts'), ['name' => 'C3', 'account_id' => $foreignAccount])->assertJsonValidationErrors('account_id');

        // Directory routes with another organisation's IDs.
        $this->actingAs($this->owner($org))->getJson($this->api($org, "/crm/accounts/{$foreignAccount}"))->assertNotFound();
        $this->actingAs($this->owner($org))->patchJson($this->api($org, "/crm/contacts/{$foreignContact}"), ['name' => 'x'])->assertNotFound();
    }

    public function test_directory_is_shared_but_edits_are_limited(): void
    {
        [$org, $rep, $lead] = $this->team();
        $colleague = $this->addMember($org, Role::Staff);
        $account = $this->actingAs($rep)->postJson($this->api($org, '/crm/accounts'), ['name' => 'Shared Co'])->json('data.id');
        $contact = $this->actingAs($rep)->postJson($this->api($org, '/crm/contacts'), ['name' => 'Puan Aminah', 'account_id' => $account])->json('data.id');
        $this->deal($org, $rep, ['account_id' => $account]);

        // Everyone with the app sees the account and its contacts, but only the deals they may see.
        $this->actingAs($colleague)->getJson($this->api($org, "/crm/accounts/{$account}"))->assertOk()
            ->assertJsonCount(1, 'data.contacts')->assertJsonCount(0, 'data.opportunities')
            ->assertJsonPath('data.permissions.edit', false);
        $this->actingAs($colleague)->getJson($this->api($org, '/crm/accounts?q=shared'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($colleague)->patchJson($this->api($org, "/crm/accounts/{$account}"), ['name' => 'Hijacked'])->assertForbidden();
        $this->actingAs($colleague)->patchJson($this->api($org, "/crm/contacts/{$contact}"), ['name' => 'x'])->assertForbidden();
        $this->actingAs($rep)->patchJson($this->api($org, "/crm/accounts/{$account}"), ['website' => 'https://shared.example'])->assertOk();
        $this->actingAs($rep)->deleteJson($this->api($org, "/crm/accounts/{$account}"))->assertForbidden();

        // Deleting an account keeps its opportunities and contacts.
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, "/crm/accounts/{$account}"))->assertNoContent();
        $this->assertSame(1, Opportunity::where('organization_id', $org->id)->count());
        $this->assertNull(Opportunity::where('organization_id', $org->id)->first()->account_id);

        // App removed for Staff: everything is 404.
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/admin/apps/opportunity'))->assertSuccessful();
        $this->actingAs($rep)->getJson($this->api($org, '/crm/opportunities'))->assertNotFound();
    }

    public function test_forecast_weights_open_deals_and_counts_won_revenue(): void
    {
        $this->travelTo(now()->setTimezone('Asia/Kuala_Lumpur')->setDate(2026, 11, 6)->setTime(10, 0));
        [$org, $rep, $lead, $salesManager] = $this->team();
        $s = $this->stages($org, $rep);
        $this->deal($org, $rep, ['amount' => 10000, 'stage_id' => $s['Proposal'], 'expected_close_date' => '2026-11-20']); // 50% → 5,000
        $this->deal($org, $rep, ['amount' => 8000, 'stage_id' => $s['Negotiation'], 'expected_close_date' => '2026-12-05']); // 75% → 6,000
        $this->deal($org, $rep, ['amount' => 4000, 'stage_id' => $s['Lead'], 'expected_close_date' => '2026-10-01']); // overdue
        $this->deal($org, $rep, ['amount' => 3000, 'stage_id' => $s['Won']]);
        $this->deal($org, $salesManager, ['amount' => 99999, 'stage_id' => $s['Proposal'], 'expected_close_date' => '2026-11-15']);

        $res = $this->actingAs($rep)->getJson($this->api($org, '/crm/forecast?months=3'))->assertOk();
        $months = collect($res->json('data.months'))->keyBy('month');
        $this->assertSame('2026-11', $res->json('data.current_month'));
        $this->assertEquals(10000, $months['2026-11']['open_amount']);
        $this->assertEquals(5000, $months['2026-11']['weighted_amount']);
        $this->assertEquals(3000, $months['2026-11']['won_amount']);
        $this->assertEquals(6000, $months['2026-12']['weighted_amount']);
        $this->assertEquals(4000, $res->json('data.overdue.open_amount'));

        // The sales manager sees the whole team; "me" narrows it.
        $all = collect($this->actingAs($salesManager)->getJson($this->api($org, '/crm/forecast?months=3'))->json('data.months'))->keyBy('month');
        $this->assertEquals(109999, $all['2026-11']['open_amount']);
        $mine = collect($this->actingAs($salesManager)->getJson($this->api($org, '/crm/forecast?months=3&owner=me'))->json('data.months'))->keyBy('month');
        $this->assertEquals(99999, $mine['2026-11']['open_amount']);
    }

    public function test_pipeline_stages_can_be_edited_by_admins_only(): void
    {
        [$org, $rep, $lead, $salesManager] = $this->team();
        $owner = $this->owner($org);
        $s = $this->stages($org, $owner);
        $this->deal($org, $rep, ['stage_id' => $s['Qualified']]);
        $current = collect($this->actingAs($owner)->getJson($this->api($org, '/crm/summary'))->json('data.stages'))
            ->map(fn ($x) => ['id' => $x['id'], 'name' => $x['name'], 'probability' => $x['probability'], 'kind' => $x['kind']])->all();

        $this->actingAs($salesManager)->putJson($this->api($org, '/crm/stages'), ['stages' => $current])->assertForbidden();

        // Must keep one Won and one Lost.
        $noWon = array_values(array_filter($current, fn ($x) => $x['kind'] !== 'won'));
        $this->actingAs($owner)->putJson($this->api($org, '/crm/stages'), ['stages' => $noWon])->assertJsonValidationErrors('stages');
        // Cannot drop a stage that still has deals.
        $withoutQualified = array_values(array_filter($current, fn ($x) => $x['name'] !== 'Qualified'));
        $this->actingAs($owner)->putJson($this->api($org, '/crm/stages'), ['stages' => $withoutQualified])->assertJsonValidationErrors('stages');
        // Another organisation's stage ID is rejected.
        $other = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($other, $this->owner($other));
        $foreign = $this->stages($other, $this->owner($other))['Lead'];
        $this->actingAs($owner)->putJson($this->api($org, '/crm/stages'), ['stages' => [['id' => $foreign, 'name' => 'Mine now', 'probability' => 5, 'kind' => 'open'], ...array_slice($current, 1)]])
            ->assertJsonValidationErrors('stages.0.id');

        // Rename, add a stage and drop an empty one.
        $next = $current;
        $next[0]['name'] = 'New lead';
        array_splice($next, 3, 1); // Negotiation (empty)
        array_splice($next, 2, 0, [['name' => 'Demo booked', 'probability' => 40, 'kind' => 'open']]);
        $names = collect($this->actingAs($owner)->putJson($this->api($org, '/crm/stages'), ['stages' => $next])->assertOk()->json('data'))->pluck('name')->all();
        $this->assertSame(['New lead', 'Qualified', 'Demo booked', 'Proposal', 'Won', 'Lost'], $names);
    }

    public function test_activities_follow_their_opportunity_and_author(): void
    {
        [$org, $rep, $lead, $salesManager] = $this->team();
        $colleague = $this->addMember($org, Role::Staff);
        $id = $this->deal($org, $rep);
        $note = $this->actingAs($rep)->postJson($this->api($org, '/crm/activities'), ['type' => 'note', 'subject' => 'Budget confirmed', 'opportunity_id' => $id])
            ->assertCreated()->json('data.id');
        $url = $this->api($org, "/crm/activities/{$note}");

        // Someone who cannot see the deal gets 404, not 403.
        $this->actingAs($colleague)->patchJson($url, ['subject' => 'x'])->assertNotFound();
        $this->actingAs($colleague)->deleteJson($url)->assertNotFound();
        // The rep's manager sees the deal but cannot change the rep's notes.
        $this->actingAs($lead)->patchJson($url, ['subject' => 'x'])->assertForbidden();
        $this->actingAs($lead)->deleteJson($url)->assertForbidden();
        // A sales manager can.
        $this->actingAs($salesManager)->patchJson($url, ['subject' => 'Budget confirmed (RM 12k)'])->assertOk();

        // Account-level notes: everyone with the app sees them, only the author or a sales manager edits.
        $account = $this->actingAs($rep)->postJson($this->api($org, '/crm/accounts'), ['name' => 'Kedai Maju'])->json('data.id');
        $accountNote = $this->actingAs($rep)->postJson($this->api($org, '/crm/activities'), ['type' => 'note', 'subject' => 'Prefers email', 'account_id' => $account])
            ->assertCreated()->json('data.id');
        $this->actingAs($colleague)->patchJson($this->api($org, "/crm/activities/{$accountNote}"), ['subject' => 'x'])->assertForbidden();
        $this->actingAs($rep)->deleteJson($this->api($org, "/crm/activities/{$accountNote}"))->assertNoContent();

        // Other organisation: its accounts are rejected and its activity IDs are 404.
        $other = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($other, $this->owner($other));
        $this->actingAs($this->owner($other));
        $foreignAccount = $this->postJson($this->api($other, '/crm/accounts'), ['name' => 'Theirs'])->json('data.id');
        $foreignNote = $this->postJson($this->api($other, '/crm/activities'), ['type' => 'note', 'subject' => 'Theirs', 'account_id' => $foreignAccount])->json('data.id');
        $this->actingAs($rep)->postJson($this->api($org, '/crm/activities'), ['type' => 'note', 'subject' => 'x', 'account_id' => $foreignAccount])
            ->assertJsonValidationErrors('account_id');
        $this->actingAs($this->owner($org))->patchJson($this->api($org, "/crm/activities/{$foreignNote}"), ['subject' => 'x'])->assertNotFound();
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, "/crm/activities/{$foreignNote}"))->assertNotFound();
    }

    public function test_removing_a_member_keeps_their_deals(): void
    {
        [$org, $rep, $lead, $salesManager] = $this->team();
        $id = $this->deal($org, $rep);
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/members/'.$this->membership($org, $rep)->id))->assertSuccessful();

        $this->assertSame($rep->id, Opportunity::findOrFail($id)->owner_id);
        $this->actingAs($salesManager)->getJson($this->api($org, "/crm/opportunities/{$id}"))->assertOk();
        // Handing it to someone else works; the former member cannot be chosen.
        $this->actingAs($salesManager)->patchJson($this->api($org, "/crm/opportunities/{$id}"), ['owner_id' => $rep->id])->assertOk();
        $this->actingAs($salesManager)->patchJson($this->api($org, "/crm/opportunities/{$id}"), ['owner_id' => $salesManager->id])->assertOk()
            ->assertJsonPath('data.owner.id', $salesManager->id);
    }
}
