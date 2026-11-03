<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\URL;

/**
 * Sends a link to the frontend, which forwards the signed parameters to the API.
 */
class VerifyEmailNotification extends VerifyEmail
{
    protected function verificationUrl($notifiable): string
    {
        $signed = URL::temporarySignedRoute(
            'verification.verify',
            Carbon::now()->addMinutes(60),
            ['id' => $notifiable->getKey(), 'hash' => sha1($notifiable->getEmailForVerification())],
        );

        $query = parse_url($signed, PHP_URL_QUERY);

        return config('rakanspace.frontend_url').'/verify-email?'.http_build_query([
            'id' => $notifiable->getKey(),
            'hash' => sha1($notifiable->getEmailForVerification()),
        ]).'&'.$query;
    }

    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Verify your RakanSpace email address')
            ->greeting('Welcome to RakanSpace')
            ->line('Satu ruang. Satu pasukan. Please confirm your email address to continue.')
            ->action('Verify email address', $this->verificationUrl($notifiable))
            ->line('This link expires in 60 minutes. If you did not create an account, you can ignore this email.');
    }
}
