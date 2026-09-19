<?php

namespace App\Jobs;

use App\Models\AiTrainingNote;
use App\Services\AiEmbeddingService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Keep the semantic index warm as the memory brain grows (item 1).
 *
 * A freshly created neuron would otherwise stay unsearchable until the next
 * chat query happened to warm it (or the weekly backfill ran). Embedding is a
 * network call, so it is queued on the `deferred` connection and runs after the
 * response that created the note, never blocking the writer.
 */
class EmbedTrainingNoteJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;
    public int $timeout = 60;

    public function __construct(public int $noteId)
    {
    }

    public function handle(AiEmbeddingService $embedder): void
    {
        $note = AiTrainingNote::find($this->noteId);
        if (!$note) {
            return;
        }

        // Skip when the note is already embedded with the CURRENT model; a model
        // change must re-embed, so that counts as stale and is refreshed.
        if ($note->embedding !== null && $note->embedding_model === $embedder->model()) {
            return;
        }

        try {
            $embedder->embedNote($note);
        } catch (\Throwable $e) {
            Log::warning('Embedding note #' . $this->noteId . ' failed: ' . $e->getMessage());
        }
    }
}
