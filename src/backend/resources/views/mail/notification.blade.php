<x-mail::message>
# {{ $title }}

@if ($body)
{{ $body }}
@endif

@if ($url)
<x-mail::button :url="$url">
Open in RakanSpace
</x-mail::button>
@endif

You received this because you are a member of **{{ $organizationName }}**.

Satu ruang. Satu pasukan.<br>
{{ config('app.name') }}
</x-mail::message>
