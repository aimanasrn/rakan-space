<?php

namespace App\Mail;

use App\Models\Invitation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Sent synchronously so the API can report whether delivery succeeded.
 */
class InvitationMail extends Mailable
{
    use Queueable;

    public function __construct(public Invitation $invitation, public string $token) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'You are invited to join '.$this->invitation->organization->name.' on RakanSpace');
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.invitation', with: [
            'organizationName' => $this->invitation->organization->name,
            'inviterName' => $this->invitation->inviter?->name ?? 'A teammate',
            'role' => $this->invitation->role->label(),
            'url' => config('rakanspace.frontend_url').'/invitations/'.$this->token,
            'expiresAt' => $this->invitation->expires_at->toDayDateTimeString().' UTC',
        ]);
    }
}
