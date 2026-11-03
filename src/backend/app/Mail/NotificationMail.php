<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Email copy of an in-app notification. Queued; the in-app row is the source of truth.
 */
class NotificationMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(
        public string $organizationName,
        public string $title,
        public ?string $body,
        public ?string $url,
    ) {
        $this->onQueue('notifications');
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->title.' · '.$this->organizationName);
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.notification', with: [
            'organizationName' => $this->organizationName,
            'title' => $this->title,
            'body' => $this->body,
            'url' => $this->url,
        ]);
    }
}
