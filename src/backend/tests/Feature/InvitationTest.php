<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Mail\InvitationMail;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class InvitationTest extends TestCase
{
    private function invite($org, string $email, string $role = 'staff'): string
    {
        $token = null;
        Mail::fake();
        $this->actingAs($this->owner($org))
            ->postJson($this->api($org, '/invitations'), ['email' => $email, 'role' => $role])
            ->assertCreated()->assertJsonPath('email_sent', true);
        Mail::assertSent(InvitationMail::class, function (InvitationMail $mail) use (&$token) {
            $token = $mail->token;

            return true;
        });

        return $token;
    }

    public function test_invited_user_with_matching_verified_email_can_accept_once(): void
    {
        $org = $this->createOrganization();
        $token = $this->invite($org, 'Siti@Example.com');
        $siti = User::factory()->create(['email' => 'siti@example.com']);

        $this->getJson('/api/invitations/'.$token)->assertOk()->assertJsonPath('data.status', 'pending');

        $this->actingAs($siti)->postJson('/api/invitations/'.$token.'/accept')->assertOk()
            ->assertJsonPath('organization.slug', $org->slug);
        $this->assertSame(Role::Staff, $this->membership($org, $siti)->role);

        // Single use: the same token cannot be accepted again, by anyone.
        $this->actingAs($siti)->postJson('/api/invitations/'.$token.'/accept')->assertStatus(410);
        $this->assertSame(1, $org->memberships()->where('user_id', $siti->id)->count());
    }

    public function test_email_must_match_and_be_verified(): void
    {
        $org = $this->createOrganization();
        $token = $this->invite($org, 'aminah@example.com');

        $intruder = User::factory()->create(['email' => 'someone@example.com']);
        $this->actingAs($intruder)->postJson('/api/invitations/'.$token.'/accept')->assertForbidden();

        $unverified = User::factory()->unverified()->create(['email' => 'aminah@example.com']);
        $this->actingAs($unverified)->postJson('/api/invitations/'.$token.'/accept')->assertForbidden();

        $this->assertFalse($org->hasActiveMember($intruder->id));
        $this->assertFalse($org->hasActiveMember($unverified->id));
    }

    public function test_expired_and_revoked_invitations_cannot_be_used(): void
    {
        $org = $this->createOrganization();
        $user = User::factory()->create(['email' => 'late@example.com']);

        $token = $this->invite($org, 'late@example.com');
        Invitation::query()->update(['expires_at' => now()->subMinute()]);
        $this->actingAs($user)->postJson('/api/invitations/'.$token.'/accept')->assertStatus(410)
            ->assertJsonPath('message', 'This invitation has expired. Ask for a new one.');

        $token2 = $this->invite($org, 'late@example.com');
        $invitation = Invitation::whereNull('revoked_at')->latest('id')->first();
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/invitations/'.$invitation->id))->assertOk();
        $this->actingAs($user)->postJson('/api/invitations/'.$token2.'/accept')->assertStatus(410);
        $this->assertFalse($org->hasActiveMember($user->id));
    }

    public function test_resending_rotates_the_token(): void
    {
        $org = $this->createOrganization();
        $oldToken = $this->invite($org, 'resend@example.com');
        $invitation = Invitation::latest('id')->first();

        Mail::fake();
        $this->actingAs($this->owner($org))->postJson($this->api($org, '/invitations/'.$invitation->id.'/resend'))->assertOk();
        $newToken = null;
        Mail::assertSent(InvitationMail::class, function ($m) use (&$newToken) {
            $newToken = $m->token;

            return true;
        });

        $user = User::factory()->create(['email' => 'resend@example.com']);
        $this->actingAs($user)->postJson('/api/invitations/'.$oldToken.'/accept')->assertNotFound();
        $this->actingAs($user)->postJson('/api/invitations/'.$newToken.'/accept')->assertOk();
    }

    public function test_duplicate_memberships_and_privilege_escalation_are_prevented(): void
    {
        $org = $this->createOrganization();
        $member = $this->addMember($org);
        $admin = $this->addMember($org, Role::Admin);

        // Already a member.
        $this->actingAs($this->owner($org))->postJson($this->api($org, '/invitations'), ['email' => $member->email, 'role' => 'staff'])
            ->assertStatus(422);
        // Admins can only invite manager/staff; nobody can invite an owner.
        $this->actingAs($admin)->postJson($this->api($org, '/invitations'), ['email' => 'x@example.com', 'role' => 'admin'])
            ->assertStatus(422)->assertJsonValidationErrors('role');
        $this->actingAs($this->owner($org))->postJson($this->api($org, '/invitations'), ['email' => 'y@example.com', 'role' => 'owner'])
            ->assertStatus(422);
        // An invitation cannot be used by someone already in the organisation.
        $token = $this->invite($org, 'z@example.com');
        $z = User::factory()->create(['email' => 'z@example.com']);
        $this->addMember($org, Role::Staff, $z);
        $this->actingAs($z)->postJson('/api/invitations/'.$token.'/accept')->assertStatus(409);
    }

    public function test_failed_email_delivery_is_reported(): void
    {
        $org = $this->createOrganization();
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP down'));

        $this->actingAs($this->owner($org))->postJson($this->api($org, '/invitations'), ['email' => 'down@example.com', 'role' => 'staff'])
            ->assertCreated()->assertJsonPath('email_sent', false);
    }
}
