<?php

namespace App\Console\Commands;

use App\Models\AiTrainingNote;
use App\Services\AiEmbeddingService;
use Illuminate\Console\Command;

/**
 * Backfill semantic embeddings for memory notes missing a vector (item 1).
 *
 * Every note created before the embedding column existed (or written while the
 * embedding API was unreachable) is embedded in one batched pass. Retrieval
 * degrades to token-overlap until this has run, so scheduling it weekly (and
 * right after consolidation) keeps the semantic index complete.
 */
class AiEmbedBackfillCommand extends Command
{
    protected $signature = 'ai:embed-backfill {--force : Re-embed notes that already have a vector}';

    protected $description = 'Embed every training note that still lacks a vector';

    public function handle(AiEmbeddingService $embedder): int
    {
        if (!$embedder->isConfigured()) {
            $this->error('Gemini is not configured — set an API key in Settings > General > AI first.');

            return self::FAILURE;
        }

        $this->info('Embedding model: ' . $embedder->model());

        if ($this->option('force')) {
            $notes = AiTrainingNote::orderBy('id', 'asc')->get();
        } else {
            $notes = AiTrainingNote::whereNull('embedding')->orderBy('id', 'asc')->get();
        }

        $total = $notes->count();
        if ($total === 0) {
            $this->info('No notes need embedding — the index is complete.');

            return self::SUCCESS;
        }

        $this->info("Embedding {$total} notes in batched rounds…");

        // embedMissing works on *missing* only; force re-embedding happens per batch.
        if (!$this->option('force')) {
            $embedded = $embedder->embedMissing($notes);
            $this->info("Done: embedded {$embedded} note(s).");
        } else {
            $embedded = 0;
            foreach ($notes->chunk(96) as $chunk) {
                $texts = [];
                $keys = [];
                foreach ($chunk as $note) {
                    $texts[] = $embedder->noteText($note);
                    $keys[] = $note->id;
                }

                $vectors = $embedder->embedBatch($texts);
                foreach ($vectors as $i => $vector) {
                    $id = $keys[$i] ?? null;
                    if ($id === null) {
                        continue;
                    }
                    AiTrainingNote::where('id', $id)->update([
                        'embedding' => json_encode($vector),
                        'embedding_model' => $embedder->model(),
                    ]);
                    $embedded++;
                }
                $this->line('    batch done — running total: ' . $embedded);
            }
            $this->info("Done: re-embedded {$embedded} note(s).");
        }

        return self::SUCCESS;
    }
}