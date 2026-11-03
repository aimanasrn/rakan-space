<x-mail::message>
# Join {{ $organizationName }} on RakanSpace

{{ $inviterName }} has invited you to join **{{ $organizationName }}** as **{{ $role }}**.

<x-mail::button :url="$url">
Accept invitation
</x-mail::button>

This invitation can be used once and expires on {{ $expiresAt }}.
You must sign in with this email address to accept it.

If you were not expecting this invitation, you can ignore this email.

Satu ruang. Satu pasukan.<br>
{{ config('app.name') }}
</x-mail::message>
