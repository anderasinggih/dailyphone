<?php

namespace App\Console\Commands;

use App\Models\AiTrainingNote;
use App\Services\AiEmbeddingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Backfill semantic embeddings for memory notes missing a vector (item 1).
 *
 * Every note created before the embedding column existed (or written while the
 * embedding API was unreachable) is embedded in one batched pass. Retrieval
 * degrades to token-overlap until this has run, so scheduling it weekly (and
 * right after consolidation) keeps the semantic index complete.
 *
 * Every batch prints its result straight to the console: writing to the Laravel
 * log alone proved undiagnosable on shared hosts where the CLI log stream is
 * lost, so a failed chunk must be visible in the terminal, not just swallowed.
 */
class AiEmbedBackfillCommand extends Command
{
    protected $signature = 'ai:embed-backfill {--force : Re-embed notes that already have a vector}';

    protected $description = 'Embed every training note that still lacks a vector';

    /** Chunks smaller than the service cap so a single request stays well
     *  inside the HTTP/API limits even with long note texts. */
    private const CHUNK_SIZE = 50;

    public function handle(AiEmbeddingService $embedder): int
    {
        if (!$embedder->isConfigured()) {
            $this->error('Gemini is not configured — set an API key in Settings > General > AI first.');

            return self::FAILURE;
        }

        $this->info('Embedding model: ' . $embedder->model());

        // Drop any circuit-breaker latch left by a previous failed attempt so
        // this run genuinely retries the API instead of short-circuiting to 0.
        Cache::forget('ai.embed.api_offline');

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

        $embedded = 0;
        $failed = 0;
        $batchNo = 0;

        foreach ($notes->chunk(self::CHUNK_SIZE) as $chunk) {
            $batchNo++;
            $keys = $chunk->map(fn ($n) => (int) $n->id)->values()->all();
            $texts = $chunk->map(fn ($n) => $embedder->noteText($n))->values()->all();

            $vectors = $embedder->embedBatch($texts);

            if ($vectors === []) {
                $offline = Cache::get('ai.embed.api_offline') ? 'offline latch set' : 'no vectors returned';
                $failed += count($keys);
                $reason = trim((string) $embedder->lastError);
                $transient = $embedder->isRetryableError();
                $this->warn('    batch '.$batchNo.': FAILED — 0/'.count($keys).' embedded ('.$offline.($reason !== '' ? ': '.$reason : '').'). '
                    .($transient
                        ? 'Free-tier quota is refilling — continuing; later batches retry after backoff.'
                        : 'Check the embedding API/network or your Gemini key/quota, then re-run.'));

                // Only a PERMANENT, latched failure (bad key/model/payload)
                // warrants aborting — every later retry would fail the same way.
                // A transient quota/429 refills, so keep going: each later batch
                // clears the latch and retries with backoff on its own.
                if (! $transient && $offline === 'offline latch set') {
                    $remaining = $total - (($batchNo - 1) * self::CHUNK_SIZE) - count($keys);
                    $this->warn("    aborting — {$remaining} note(s) left unembedded will retry on the next run.");

                    break;
                }
                continue;
            }

            $saved = 0;
            foreach ($vectors as $i => $vector) {
                $id = $keys[$i] ?? null;
                if ($id === null) {
                    continue;
                }
                try {
                    AiTrainingNote::where('id', $id)->update([
                        'embedding' => json_encode($vector),
                        'embedding_model' => $embedder->model(),
                    ]);
                    $saved++;
                } catch (\Throwable $e) {
                    Log::warning('Failed persisting embedding for note #'.$id.': '.$e->getMessage());
                    $this->warn("        note #{$id} failed to persist: ".$e->getMessage());
                }
            }

            $embedded += $saved;
            $awaiting = count($keys) - $saved;
            if ($awaiting > 0) {
                $failed += $awaiting;
            }
            $this->line("    batch {$batchNo}: embedded {$saved}/".count($keys).' note(s).');
        }

        if ($embedded > 0) {
            $this->info("Done: embedded {$embedded} note(s).");
        } else {
            $this->warn('Done: 0 notes embedded — nothing was stored. Check the batch lines above, the Gemini API key/quota in Settings, or the server\'s outbound network to generativelanguage.googleapis.com.');
        }

        if ($failed > 0) {
            $this->warn("{$failed} note(s) remain unembedded and will be retried on the next run.");

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}