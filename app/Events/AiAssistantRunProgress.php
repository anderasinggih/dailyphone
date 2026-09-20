<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Real-time mirror of an assistant run (superadmin only): every retrieval
 * stage, the final neuron set, the cited ids and the outcome. Mirrors the
 * NDJSON stream so any open tab (assistant page, memory map) can pulse its
 * brain map live without being the tab that started the chat.
 */
class AiAssistantRunProgress implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  array{
     *     kind: 'stage'|'neurons'|'trace'|'done'|'error',
     *     query?: string,
     *     stage?: string,
     *     nodes?: array,
     *     edges?: array,
     *     used?: array<int, int>,
     *     status?: string,
     *     latency_ms?: int,
     *     message?: string,
     * }  $payload
     */
    public function __construct(public array $payload)
    {
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [new PrivateChannel('superadmin.live')];
    }

    public function broadcastAs(): string
    {
        return 'ai.progress';
    }
}