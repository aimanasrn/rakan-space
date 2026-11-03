<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Broadcast after a message is committed. Only identifiers are carried (also
 * in the queued payload), so a stale subscription never receives message
 * content; clients fetch it via GET .../messages?after=..., which re-checks
 * permissions.
 */
class ConversationMessageChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable, InteractsWithSockets;

    public int $conversationId;

    public int $messageId;

    public string $clientId;

    public ?int $userId;

    public function __construct(Message $message, public string $action)
    {
        $this->conversationId = $message->conversation_id;
        $this->messageId = $message->id;
        $this->clientId = $message->client_id;
        $this->userId = $message->user_id;
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->conversationId)];
    }

    public function broadcastAs(): string
    {
        return 'message.'.$this->action; // message.created | message.updated | message.deleted
    }

    public function broadcastWith(): array
    {
        return [
            'conversation_id' => $this->conversationId,
            'message_id' => $this->messageId,
            'client_id' => $this->clientId,
            'user_id' => $this->userId,
        ];
    }
}
