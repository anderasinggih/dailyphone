<?php

namespace App\Jobs;

use App\Models\AiTrainingNote;
use App\Services\AiEmbeddingService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Self-heal the semantic index completely off the request path.
 *
 * `AiEmbeddingService::search()` deliberately never issues an embedding write, so
 * a chat stays fast no matter how cold or large the index is. When a search
 * finds a meaningful share of its candidate pool still unembedded, it asks this
 * job to re-warm the backlog in one batched pass. It runs on the `deferred`
 * connection (after the response) and is throttled by `AiEmbeddingService` via
 * the cache, so an unreachable embedding API is probed at most once per window
 * instead of on every query — the anti-retry guard for the hot path.
 */
class BackfillMissingEmbeddingsJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;
    public int $timeout = 300;

    /**
     * Throttle key shared with AiEmbeddingService::scheduleSelfHeal().
     * At most one background pass runs per 15-minute window.
     */
    public static function throttleKey(): string
    {
        return 'ai:embed:backfill:throttle';
    }

    public function handle(AiEmbeddingService $embedder): void
    {
        if (! $embedder->isConfigured()) {
            return;
        }

        $pool = AiTrainingNote::where('is_active', true)
            ->where('is_stale', false)
            ->where(fn ($q) => $q->whereNull('embedding')
                ->orWhere('embedding_model', '!=', $embedder->model()))
            ->orderBy('updated_at', 'desc')
            ->limit(400)
            ->get();

        if ($pool->isEmpty()) {
            return;
        }

        try {
            $embedded = $embedder->embedMissing($pool);
            Log::info('Background embedding backfill embedded '.$embedded.' note(s).');
        } catch (\Throwable $e) {
            Log::warning('Background embedding backfill failed: '.$e->getMessage());
        }
    }
}