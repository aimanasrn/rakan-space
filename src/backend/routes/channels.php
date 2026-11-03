<?php

use App\Models\Conversation;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Support\Facades\Broadcast;

/*
| Real-time channel authorisation. Checked on every subscription against the
| user's current permissions. Event payloads only carry identifiers, so access
| revoked after subscribing never exposes new content.
*/

Broadcast::channel('user.{id}', function (User $user, int $id) {
    return $user->id === $id;
});

Broadcast::channel('conversation.{conversationId}', function (User $user, int $conversationId) {
    $conversation = Conversation::find($conversationId);

    return $conversation !== null && Permissions::canViewConversation($user, $conversation);
});
