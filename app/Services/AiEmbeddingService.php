<?php

namespace App\Services;

use App\Jobs\BackfillMissingEmbeddingsJob;
use App\Models\AiTrainingNote;
use App\Models\GeneralSetting;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Semantic retrieval for the AI memory brain.
 *
 * Replaces the literal token-overlap scoring with a real embedding model
 * (default `text-embedding-004`). Every training note carries a stored vector
 * (ai_training_notes.embedding); a user query is embedded with the same model
 * and the nearest neighbours are ranked by cosine similarity — so "iphone kena
 * air garansi?" matches a node about "water damage" even though they share no
 * surface tokens.
 *
 * Every public entry point degrades gracefully: when the embedding API is
 * unreachable, unconfigured, or a note simply has no vector yet (not backfilled),
 * the caller can fall back to the tf-idf / keyword scoring already in the graph
 * service. Nothing here is fatal.
 */
class AiEmbeddingService
{
    /** Mapping from model name to the CLI-friendly sanitized key for the API URL. */
    protected string $model = 'gemini-embedding-001';

    /** Ordered Gemini API keys (failover over rate limits). */
    protected array $apiKeys = [];

    /**
     * Cache the last successful query embedding so a chat request that retrieves
     * neurons three times hits the embedding API at most once.
     */
    protected ?string $queryCacheKey = null;

    protected ?array $queryCacheVector = null;

    public function __construct()
    {
        $this->reloadSettings();
    }

    public function reloadSettings(): void
    {
        $settings = GeneralSetting::first();

        $this->apiKeys = $settings ? $settings->apiKeyList() : [];
        if (empty($this->apiKeys)) {
            $envKey = env('GEMINI_API_KEY');
            if (! empty($envKey)) {
                $this->apiKeys = [$envKey];
            }
        }

        $configured = trim((string) ($settings->ai_embedding_model ?? ''));
        $this->model = $configured !== '' ? $configured : 'gemini-embedding-001';
    }

    public function model(): string
    {
        return $this->model;
    }

    public function isConfigured(): bool
    {
        $this->reloadSettings();

        return ! empty($this->apiKeys);
    }

    /**
     * Sanitize a model name into a URL-safe segment (models may be written with
     * or without a "models/" prefix and :publishTokens suffix in settings).
     */
    protected function sanitizeModel(string $model): string
    {
        $model = trim($model);
        $model = preg_replace('/^models\//', '', $model);
        $model = preg_replace('/:\d+[a-z]+$/', '', $model);

        return $model !== '' ? $model : 'gemini-embedding-001';
    }

    /**
     * Embed a single piece of text into a numeric vector.
     *
     * @return float[]|null Vector, or null when the API is unavailable.
     */
    public function embedText(string $text): ?array
    {
        $text = trim((string) $text);
        if ($text === '') {
            return null;
        }

        // Circuit breaker: after a total failure (all keys) the endpoint is
        // treated as offline for a short window, so a dead/unreachable model
        // cannot stall every chat behind connect timeouts. Cleared by any
        // subsequent success.
        if (Cache::get('ai.embed.api_offline')) {
            return null;
        }

        $model = $this->sanitizeModel($this->model);
        $payload = [
            'model' => 'models/'.$model,
            'content' => ['parts' => [['text' => mb_substr($text, 0, 8000)]]],
        ];

        foreach (array_values($this->apiKeys) as $index => $key) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:embedContent?key={$key}";
                // Tight timeouts: the embedding is an auxiliary lever on the chat
                // request path, so a degraded embedding API must fail fast (and
                // fall back to the token pool) rather than freeze replies.
                $response = Http::timeout(8)->connectTimeout(3)->post($url, $payload);

                if ($response->successful()) {
                    $values = $response->json('embedding.values');

                    if (is_array($values)) {
                        Cache::forget('ai.embed.api_offline');

                        return array_map('floatval', $values);
                    }
                }

                Log::warning("Embedding request HTTP {$response->status()} (key #".($index + 1).'): '
                    .($response->json('error.message') ?? $response->body()));
            } catch (\Throwable $e) {
                Log::warning('Embedding request threw (key #'.($index + 1).'): '.$e->getMessage());
            }
        }

        Cache::put('ai.embed.api_offline', true, 60);

        return null;
    }

    /**
     * Embed several texts in one batch API call.
     *
     * @param  string[]  $texts  Indexed by original array keys.
     * @return array<string|int, float[]> Matches that succeeded, keyed by input key.
     */
    public function embedBatch(array $texts): array
    {
        $out = [];
        $indexed = [];
        foreach ($texts as $key => $text) {
            $text = trim((string) $text);
            if ($text !== '') {
                $indexed[$key] = $text;
            }
        }
        if ($indexed === []) {
            return $out;
        }

        $model = $this->sanitizeModel($this->model);
        $requests = [];
        $base = 0;
        foreach ($indexed as $key => $text) {
            $requests[] = [
                'model' => 'models/'.$model,
                'content' => ['parts' => [['text' => mb_substr((string) $text, 0, 8000)]]],
            ];
            // Cap batch size per call (some models limit it), chunk the rest.
            // postBatch() keys each chunk's vectors from 0, so offset every
            // chunk by its position to keep the returned map sequential and
            // avoid later chunks silently overwriting earlier ones.
            if (count($requests) >= 96) {
                foreach ($this->postBatch($requests) as $i => $vector) {
                    $out[$base + $i] = $vector;
                }
                $base += count($requests);
                $requests = [];
            }
        }
        if ($requests !== []) {
            foreach ($this->postBatch($requests) as $i => $vector) {
                $out[$base + $i] = $vector;
            }
        }

        return $out;
    }

    protected function postBatch(array $requests): array
    {
        $out = [];
        $model = $this->sanitizeModel($this->model);

        if (Cache::get('ai.embed.api_offline')) {
            return $out;
        }

        foreach (array_values($this->apiKeys) as $key) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:batchEmbedContents?key={$key}";
                $response = Http::timeout(12)->connectTimeout(3)->post($url, ['requests' => $requests]);

                if ($response->successful()) {
                    $embeddings = $response->json('embeddings', []);
                    foreach ($embeddings as $i => $emb) {
                        $values = $emb['values'] ?? null;
                        if (is_array($values)) {
                            $out[$i] = array_map('floatval', $values);
                        }
                    }

                    if ($out !== []) {
                        Cache::forget('ai.embed.api_offline');

                        return $out;
                    }
                }

                Log::warning('Batch embedding HTTP '.$response->status().': '
                    .($response->json('error.message') ?? $response->body()));
            } catch (\Throwable $e) {
                Log::warning('Batch embedding threw: '.$e->getMessage());
            }
        }

        Cache::put('ai.embed.api_offline', true, 60);

        return [];
    }

    /**
     * Persist the embedding vector on a note (best effort, never fatal).
     */
    public function embedNote(AiTrainingNote $note): bool
    {
        $vector = $this->embedText($this->noteText($note));
        if ($vector === null) {
            return false;
        }

        $note->forceFill([
            'embedding' => json_encode($vector),
            'embedding_model' => $this->model,
        ])->saveQuietly();

        return true;
    }

    /**
     * Embed notes that still miss a vector, in one batched round-trip.
     * Returns how many were newly embedded.
     *
     * @param  iterable<AiTrainingNote>  $notes
     */
    public function embedMissing(array|\Traversable $notes): int
    {
        $missing = [];
        foreach ($notes as $note) {
            // A vector is stale when it is absent OR was produced by a different
            // model (vectors from different models are not comparable, so they
            // must be regenerated rather than mixed into the index).
            if ($note->embedding === null || (string) $note->embedding_model !== $this->model) {
                $missing[$note->id] = $note;
            }
        }
        if ($missing === []) {
            return 0;
        }

        $texts = [];
        $keys = [];
        foreach ($missing as $id => $note) {
            $texts[] = $this->noteText($note);
            $keys[] = $id;
        }

        $vectors = $this->embedBatch($texts);
        $count = 0;
        foreach ($vectors as $i => $vector) {
            $id = $keys[$i] ?? null;
            if ($id === null) {
                continue;
            }
            try {
                $missing[$id]->forceFill([
                    'embedding' => json_encode($vector),
                    'embedding_model' => $this->model,
                ])->saveQuietly();
                $count++;
            } catch (\Throwable $e) {
                Log::warning('Failed persisting embedding for note #'.$id.': '.$e->getMessage());
            }
        }

        return $count;
    }

    /**
     * The text a note is embedded from: title + content + relation keywords.
     * Episode tags (when/where/who) are folded in so semantic retrieval can
     * match a memory by its situational frame, not only its wording.
     */
    public function noteText(AiTrainingNote $note): string
    {
        $title = trim((string) ($note->title ?? ''));
        $content = trim((string) $note->content);
        $related = is_array($note->related_keywords ?? null)
            ? trim(implode(' ', $note->related_keywords))
            : '';

        $episode = [];
        if (! empty($note->occurred_at)) {
            $episode[] = $note->occurred_at->format('Y-m-d');
        }
        if (trim((string) ($note->occurred_place ?? '')) !== '') {
            $episode[] = trim((string) $note->occurred_place);
        }
        if (trim((string) ($note->involved_with ?? '')) !== '') {
            $episode[] = trim((string) $note->involved_with);
        }

        return trim($title.' '.$related.' '.implode(' ', $episode).' '.$content);
    }

    /**
     * Embed once per distinct query text (memoized for the request lifetime,
     * then persisted app-wide so repeated questions never pay the embedding API
     * round-trip more than once per day — the vector depends only on the text
     * plus the current embedding model).
     *
     * @return float[]|null
     */
    public function embedQuery(string $query): ?array
    {
        $key = trim($query);
        if ($this->queryCacheKey === $key && $this->queryCacheVector !== null) {
            return $this->queryCacheVector;
        }

        $vector = Cache::remember(
            'ai.embed.'.md5($this->model.'|'.$key),
            60 * 60 * 24,
            fn () => $this->embedText($key)
        );

        $this->queryCacheKey = $key;
        $this->queryCacheVector = is_array($vector) ? $vector : null;

        return $this->queryCacheVector;
    }

    /**
     * Rank active non-rule notes against a query by cosine similarity over their
     * stored embeddings.
     *
     * @return array{notes: Collection, best_score: ?float, method: string}
     *                                                                      `notes` are AiTrainingNote models; `best_score` is the highest
     *                                                                      similarity found (null when no scored note); `method` tells the
     *                                                                      caller whether this really used embeddings or an empty result
     *                                                                      that a token fallback should fill.
     */
    public function search(?string $query, int $topK = 12, ?float $minScore = 0.30, array|string|null $kind = null): array
    {
        $this->reloadSettings();
        $query = trim((string) $query);

        if ($query === '' || ! $this->isConfigured()) {
            return ['notes' => collect(), 'best_score' => null, 'method' => 'embedding'];
        }

        // Candidate pool: the ACTIVE non-rule knowledge base itself (bounded).
        // Crucially this is NOT restricted to notes sharing a literal token with
        // the query — a node about "water damage" must still be scored against
        // the query "iphone kena air garansi" even though they share no words.
        // That is the entire point of semantic retrieval over token overlap.
        $queryBuilder = AiTrainingNote::where('is_active', true)
            ->where('is_stale', false)
            ->where('kind', '!=', 'rule');
        if ($kind) {
            if (is_array($kind)) {
                $queryBuilder->whereIn('kind', $kind);
            } else {
                $queryBuilder->where('kind', $this->normalizeKind((string) $kind));
            }
        }

        $pool = $queryBuilder
            ->orderBy('updated_at', 'desc')
            ->limit(400)
            ->get();

        // Cold paths never block a request. A note that still lacks a vector
        // (or was produced by an older embedding model) is skipped here so
        // scoring stays instant; it is re-embedded in the background by
        // EmbedTrainingNoteJob on creation and by a throttled backfill job when
        // the pool looks out of coverage. Callers fall back to token overlap
        // until the index catches up, so a slow embedding API can never freeze
        // a chat behind meaningless network calls. Scheduled BEFORE the query
        // embed so even a failing embedding API still triggers the self-heal.
        $this->scheduleSelfHeal($pool);

        // Cold index short-circuit: if no candidate carries a vector from the
        // current embedding model, the query embed can only produce a null and
        // fall back to the token pool — so skip the API round-trip entirely and
        // let the caller's token fallback fill the result (instant, no network).
        $hasModelVectors = $pool->contains(
            fn ($note) => $note->embedding !== null && (string) $note->embedding_model === $this->model
        );

        $qVector = $hasModelVectors ? $this->embedQuery($query) : null;
        if ($qVector === null) {
            return ['notes' => collect(), 'best_score' => null, 'method' => 'embedding'];
        }

        $scored = [];
        $best = null;
        foreach ($pool as $note) {
            // Only vectors produced by the current model may be compared. Mixing
            // vectors across models (or embedding dimensions) yields a cosine
            // that silently truncates to the shorter vector and ranks garbage,
            // so cross-model nodes are skipped until the warm-up re-embeds them.
            if ((string) $note->embedding_model !== $this->model) {
                continue;
            }

            $vector = $this->decodeVector((string) ($note->embedding ?? ''));
            if ($vector === null || count($vector) !== count($qVector)) {
                continue;
            }
            $score = $this->cosine($qVector, $vector);
            if ($score <= 0.0) {
                continue;
            }
            $scored[] = ['note' => $note, 'score' => $score];
            if ($best === null || $score > $best) {
                $best = $score;
            }
        }

        // Semantic matches pass the bar immediately; if we have any good hits do
        // not let scores below the threshold dilute the prompt.
        $filtered = array_values(array_filter($scored, fn ($s) => $minScore === null || $s['score'] >= $minScore));

        $source = $filtered !== [] ? $filtered : $scored;
        usort($source, fn ($a, $b) => $b['score'] <=> $a['score']);

        $notes = collect(array_slice($source, 0, $topK))->map(fn ($s) => $s['note'])->values();

        // Store the computed similarity on each note so downstream formatters can
        // surface it (confidence / observability) without re-scoring.
        $scoreById = [];
        foreach ($source as $s) {
            $scoreById[$s['note']->id] = $s['score'];
        }
        $notes->each(function ($n) use ($scoreById) {
            $n->setAttribute('retrieval_score', $scoreById[$n->id] ?? null);
        });

        return ['notes' => $notes, 'best_score' => $best, 'method' => 'embedding'];
    }

    public function normalizeKind(?string $kind): string
    {
        return app(AiMemoryGraphService::class)->normalizeKind($kind);
    }

    /**
     * Ask a background job to re-warm the index when a meaningful share of the
     * candidate pool is still unembedded. Runs on the `deferred` connection
     * (after the response) and is throttled through the cache so a broken
     * embedding API cannot re-trigger it on every search — an anti-retry guard
     * that keeps failing calls out of the request path entirely.
     */
    protected function scheduleSelfHeal(Collection $pool): void
    {
        $covered = 0;
        $missing = 0;
        foreach ($pool as $note) {
            if ($note->embedding !== null && (string) $note->embedding_model === $this->model) {
                $covered++;
            } else {
                $missing++;
            }
        }

        // A single cold note is already covered by its creation job
        // (EmbedTrainingNoteJob); only a meaningful gap warrants a batched pass.
        $total = $covered + $missing;
        if ($missing === 0 || $total === 0 || $missing / $total < 0.5) {
            return;
        }

        try {
            if (Cache::add(BackfillMissingEmbeddingsJob::throttleKey(), true, 900)) {
                BackfillMissingEmbeddingsJob::dispatch()->onConnection('deferred');
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to schedule embedding backfill: '.$e->getMessage());
        }
    }

    protected function decodeVector(string $raw): ?array
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded) || $decoded === []) {
            return null;
        }

        return array_map('floatval', $decoded);
    }

    public function cosine(array $a, array $b): float
    {
        // Vectors of different length describe different spaces; comparing them
        // (by silently truncating to the shorter one) is meaningless, so refuse.
        if (count($a) !== count($b) || $a === []) {
            return 0.0;
        }

        $dot = 0.0;
        $nA = 0.0;
        $nB = 0.0;
        $count = count($a);

        for ($i = 0; $i < $count; $i++) {
            $dot += $a[$i] * $b[$i];
            $nA += $a[$i] * $a[$i];
            $nB += $b[$i] * $b[$i];
        }

        if ($dot <= 0.0 || $nA <= 0.0 || $nB <= 0.0) {
            return 0.0;
        }

        return $dot / (sqrt($nA) * sqrt($nB));
    }
}
