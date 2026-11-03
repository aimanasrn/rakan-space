<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Resources\InvitationResource;
use App\Mail\InvitationMail;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Support\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;

class InvitationController extends Controller
{
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->requireInviter($request);

        $status = $request->input('status', 'pending');
        $query = $organization->invitations()->with(['inviter', 'department'])->latest('id');
        if ($status === 'pending') {
            $query->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now());
        }

        return InvitationResource::collection($query->paginate(25));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $actor = $this->requireInviter($request);

        $data = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            // Owner is granted only by promotion or transfer, never by invitation.
            'role' => ['required', Rule::in(array_values(array_diff(array_map(fn (Role $r) => $r->value, $actor->role->assignableRoles()), [Role::Owner->value])))],
            'department_id' => ['nullable', 'integer', Rule::exists('departments', 'id')->where('organization_id', $organization->id)],
        ], ['role.in' => 'You cannot invite someone with this role.']);

        $email = Str::lower($data['email']);

        $alreadyMember = $organization->memberships()
            ->whereIn('status', [OrganizationMembership::STATUS_ACTIVE, OrganizationMembership::STATUS_DEACTIVATED])
            ->whereHas('user', fn ($q) => $q->where('email', $email))->exists();
        abort_if($alreadyMember, 422, 'This person is already a member of the workspace.');

        $token = Str::random(64);

        $invitation = DB::transaction(function () use ($organization, $email, $data, $token, $request) {
            // Replace any open invitation for the same address.
            $organization->invitations()->whereRaw('lower(email) = ?', [$email])
                ->whereNull('accepted_at')->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            $invitation = $organization->invitations()->create([
                'email' => $email,
                'role' => $data['role'],
                'department_id' => $data['department_id'] ?? null,
                'token_hash' => Invitation::hashToken($token),
                'invited_by' => $request->user()->id,
                'expires_at' => now()->addDays(config('rakanspace.invitations.expires_in_days')),
            ]);

            ActivityLog::audit($organization->id, $request->user(), 'invitation.created', $invitation, ['email' => $email, 'role' => $data['role']]);

            return $invitation;
        });

        $sent = $this->deliver($invitation, $token);

        return response()->json([
            'data' => new InvitationResource($invitation->load(['inviter', 'department'])),
            'email_sent' => $sent,
            'message' => $sent ? 'Invitation sent.' : 'The invitation was created but the email could not be sent. Try resending it.',
        ], 201);
    }

    /** Issues a fresh token (old links stop working) and a new expiry. */
    public function resend(Request $request, Organization $organization, Invitation $invitation): JsonResponse
    {
        $this->requireInviter($request);
        abort_if($invitation->accepted_at || $invitation->revoked_at, 422, 'Only open invitations can be resent.');

        $token = Str::random(64);
        $invitation->update([
            'token_hash' => Invitation::hashToken($token),
            'expires_at' => now()->addDays(config('rakanspace.invitations.expires_in_days')),
        ]);

        $sent = $this->deliver($invitation, $token);

        return response()->json([
            'data' => new InvitationResource($invitation->load(['inviter', 'department'])),
            'email_sent' => $sent,
            'message' => $sent ? 'Invitation resent.' : 'The email could not be sent. Please try again later.',
        ], $sent ? 200 : 503);
    }

    public function revoke(Request $request, Organization $organization, Invitation $invitation): JsonResponse
    {
        $this->requireInviter($request);
        abort_if($invitation->accepted_at, 422, 'This invitation was already accepted.');

        $invitation->update(['revoked_at' => $invitation->revoked_at ?? now()]);
        ActivityLog::audit($organization->id, $request->user(), 'invitation.revoked', $invitation, ['email' => $invitation->email]);

        return response()->json(['message' => 'Invitation revoked.']);
    }

    /** Public preview for the invitation landing page (token holders only). */
    public function preview(string $token): JsonResponse
    {
        $invitation = Invitation::findByToken($token);
        abort_unless($invitation, 404, 'This invitation link is invalid.');

        return response()->json(['data' => [
            'organization' => ['name' => $invitation->organization->name, 'logo_url' => null],
            'email' => $invitation->email,
            'role' => $invitation->role->value,
            'status' => $invitation->status(),
            'invited_by' => $invitation->inviter?->name,
            'expires_at' => $invitation->expires_at->toIso8601String(),
        ]]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->hasVerifiedEmail(), 403, 'Verify your email address before accepting invitations.');

        $organization = DB::transaction(function () use ($token, $user) {
            $invitation = Invitation::where('token_hash', Invitation::hashToken($token))->lockForUpdate()->first();
            abort_unless($invitation, 404, 'This invitation link is invalid.');

            match ($invitation->status()) {
                'accepted' => abort(410, 'This invitation has already been used.'),
                'revoked' => abort(410, 'This invitation has been revoked.'),
                'expired' => abort(410, 'This invitation has expired. Ask for a new one.'),
                default => null,
            };

            abort_unless(Str::lower($user->email) === Str::lower($invitation->email), 403,
                'This invitation was sent to a different email address.');
            // Owner can only be granted through promotion or transfer, never by invitation.
            abort_if($invitation->role === Role::Owner, 422, 'This invitation is not valid.');

            $membership = OrganizationMembership::where('organization_id', $invitation->organization_id)
                ->where('user_id', $user->id)->lockForUpdate()->first();

            if ($membership && $membership->status !== OrganizationMembership::STATUS_REMOVED) {
                abort(409, $membership->isActive()
                    ? 'You are already a member of this workspace.'
                    : 'Your membership in this workspace is deactivated. Contact an administrator.');
            }

            if ($membership) {
                // Rejoining after removal: start again with the invited role.
                $membership->update([
                    'role' => $invitation->role,
                    'status' => OrganizationMembership::STATUS_ACTIVE,
                    'joined_at' => now(),
                    'status_changed_at' => now(),
                ]);
            } else {
                $membership = OrganizationMembership::create([
                    'organization_id' => $invitation->organization_id,
                    'user_id' => $user->id,
                    'role' => $invitation->role,
                    'status' => OrganizationMembership::STATUS_ACTIVE,
                    'joined_at' => now(),
                ]);
            }

            if ($invitation->department_id) {
                DB::table('department_user')->insertOrIgnore([
                    'organization_id' => $invitation->organization_id,
                    'department_id' => $invitation->department_id,
                    'user_id' => $user->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            // Join the default public #general channel.
            $general = $invitation->organization->conversations()
                ->where('type', 'channel')->where('visibility', 'public')->where('name', 'general')->first();
            $general?->memberships()->firstOrCreate(['user_id' => $user->id], ['role' => 'member', 'joined_at' => now()]);

            $invitation->update(['accepted_at' => now(), 'accepted_by' => $user->id]);

            ActivityLog::audit($invitation->organization_id, $user, 'invitation.accepted', $membership, ['role' => $invitation->role->value]);

            return $invitation->organization;
        });

        $user->forgetMembershipCache();

        return response()->json([
            'data' => AuthController::userPayload($user),
            'organization' => ['slug' => $organization->slug, 'name' => $organization->name],
        ]);
    }

    private function requireInviter(Request $request): OrganizationMembership
    {
        $actor = $request->attributes->get('membership');
        abort_unless($actor->isAdministrator(), 403, 'Only owners and admins can manage invitations.');

        return $actor;
    }

    private function deliver(Invitation $invitation, string $token): bool
    {
        try {
            Mail::to($invitation->email)->send(new InvitationMail($invitation->loadMissing('organization', 'inviter'), $token));
            $invitation->forceFill(['last_sent_at' => now(), 'send_count' => $invitation->send_count + 1])->save();

            return true;
        } catch (Throwable $e) {
            Log::error('Invitation email failed', ['invitation_id' => $invitation->id, 'error' => $e->getMessage()]);

            return false;
        }
    }
}
