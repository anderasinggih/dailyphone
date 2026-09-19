<?php

namespace App\Jobs;

use App\Models\AiChat;
use App\Models\AiSession;
use App\Models\GeneralSetting;
use App\Services\GeminiAssistantService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Token-budget context trimming, off the request path (item 7).
 *
 * When a chat session grows past the configured budget, the older turns are
 * compressed into the rolling `ai_summary` so the next request keeps only the
 * recent messages verbatim. Summarization costs a Gemini round-trip, so it is
 * queued on the `deferred` connection — it runs AFTER the chat reply has been
 * streamed to the user, never delaying it.
 */
class SummarizeAiSessionJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;
    public int $timeout = 120;

    public function __construct(
        public int $sessionId,
        public ?string $priorSummary = null,
    ) {
    }

    public function handle(GeminiAssistantService $gemini): void
    {
        $session = AiSession::find($this->sessionId);
        if (!$session) {
            return;
        }

        $settings = GeneralSetting::first();
        $budget = (int)($settings?->ai_context_token_budget ?? 10000);
        if ($budget < 1000) {
            $budget = 10000;
        }

        $history = AiChat::where('session_id', $this->sessionId)
            ->where('role', '!=', 'system')
            ->orderBy('id', 'asc')
            ->get(['id', 'role', 'content']);

        // The last 10 messages travel verbatim; everything older is what a
        // summary would replace. Only fold once there is a meaningful surplus,
        // so short chats never pay for a summarization round-trip.
        $all = $history->values();
        $verbatim = $all->slice(-10);
        $summarizable = $all->slice(0, max(0, $all->count() - $verbatim->count()));

        if ($summarizable->isEmpty()) {
            return;
        }

        if (mb_strlen($summarizable->implode('content', '')) < $budget * 3) {
            return;
        }

        $messages = $summarizable->map(fn ($c) => [
            'role' => ($c->role === 'user') ? 'user' : 'model',
            'content' => (string)$c->content,
        ])->values()->all();

        try {
            $summary = $gemini->summarizeConversation($messages, $this->priorSummary);
        } catch (\Throwable $e) {
            Log::warning('AI context summarization failed: ' . $e->getMessage());

            return;
        }

        if ($summary !== null && trim($summary) !== '') {
            $session->update(['ai_summary' => $summary]);
        }
    }
}
