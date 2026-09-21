<?php

namespace Tests\Feature;

use App\Models\GeneralSetting;
use App\Services\AiEmbeddingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Batch embedding safety net.
 *
 * postBatch() keys every chunk's vectors from 0, so embedBatch() must offset
 * each >96-note chunk by its position or later chunks would silently overwrite
 * the earlier ones (the old `$out += ...` merge kept the first chunk's keys and
 * dropped everything past the first 96 notes).
 *
 * Free-tier Gemini quota (429 "retry in Ns") is transient: postBatch() latches
 * the breaker on any failure, so the retry loop in postBucket() must clear the
 * latch again before every attempt — otherwise each retry short-circuits to []
 * without ever re-contacting the API and a quiesced quota window fails forever.
 */
class AiEmbeddingBatchTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();

        // A migration already seeds one general_settings row; point AiEmbeddingService
        // at it (first()) by filling in the AI key rather than adding a second row.
        GeneralSetting::first()->update([
            'ai_api_key' => 'test-key',
        ]);
    }

    public function test_embed_batch_keeps_vectors_from_every_96_note_chunk(): void
    {
        Http::fake(function (\Illuminate\Http\Client\Request $request) {
            $payload = json_decode($request->body(), true);
            $count = count($payload['requests'] ?? []);

            return Http::response([
                'embeddings' => collect(range(0, $count - 1))->map(
                    fn ($i) => ['values' => array_fill(0, 3, $i + 1)]
                )->all(),
            ]);
        });

        $service = new AiEmbeddingService();

        // 200 texts = two full 96-note chunks + one 8-note trailing chunk.
        $vectors = $service->embedBatch(range(1, 200));

        $this->assertCount(200, $vectors);
        $this->assertSame(range(0, 199), array_keys($vectors), 'vectors must be keyed sequentially so note ids stay aligned');
        $this->assertSame(array_fill(0, 3, 1.0), $vectors[0]);
        $this->assertSame(array_fill(0, 3, 96.0), $vectors[95]);
        $this->assertSame(array_fill(0, 3, 1.0), $vectors[96], 'chunk 2 must not be overwritten by chunk 1');
        $this->assertSame(array_fill(0, 3, 8.0), $vectors[199], 'trailing chunk must survive');
    }

    public function test_embed_batch_with_exactly_one_chunk_still_maps_vectors(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'embeddings' => collect(range(0, 9))->map(
                    fn ($i) => ['values' => array_fill(0, 3, $i)]
                )->all(),
            ]),
        ]);

        $service = new AiEmbeddingService();

        $vectors = $service->embedBatch(range(1, 10));

        $this->assertCount(10, $vectors);
        $this->assertSame(array_fill(0, 3, 0.0), $vectors[0]);
        $this->assertSame(array_fill(0, 3, 9.0), $vectors[9]);
    }

    public function test_empty_input_returns_no_vectors_without_any_request(): void
    {
        Http::fake();

        $service = new AiEmbeddingService();

        $this->assertSame([], $service->embedBatch([]));
        $this->assertSame([], $service->embedBatch(['', "   \n  "]));
        Http::assertNothingSent();
    }

    public function test_total_failure_latches_breaker_for_chat_path(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response('', 429),
        ]);

        $service = new AiEmbeddingService();

        // Single-query embeds (the chat path) trip the breaker on failure…
        $this->assertNull($service->embedText('one'));
        $this->assertTrue(Cache::get('ai.embed.api_offline'), 'breaker must latch after a total upstream failure');

        // …and short-circuit while it is latched instead of hammering the API.
        $this->assertNull($service->embedText('two'));
        Http::assertSentCount(1);
    }

    public function test_quota_backoff_clears_latch_so_retry_genuinely_recontacts_api(): void
    {
        $dry = true;
        Http::fake(function (\Illuminate\Http\Client\Request $request) use (&$dry) {
            if ($dry) {
                $dry = false;

                return Http::response([
                    'error' => ['message' => 'Quota exceeded for metric: embed_content_free_tier_requests, limit: 100 ... Please retry in 1s.'],
                ], 429);
            }
            $payload = json_decode($request->body(), true);
            $count = count($payload['requests'] ?? []);

            return Http::response([
                'embeddings' => collect(range(0, $count - 1))->map(
                    fn ($i) => ['values' => array_fill(0, 3, $i + 1)]
                )->all(),
            ]);
        });

        $service = new NoSleepEmbeddingService();

        $vectors = $service->embedBatch(['one', 'two']);

        // Without the latch being cleared per attempt, the second call would
        // short-circuit to [] and the batch would "fail" despite the refill.
        $this->assertCount(2, $vectors);
        $this->assertSame(array_fill(0, 3, 1.0), $vectors[0]);
        $this->assertSame(array_fill(0, 3, 2.0), $vectors[1]);
        $this->assertNull(Cache::get('ai.embed.api_offline'), 'success must clear the breaker');
        Http::assertSentCount(2, 'the retry must actually re-contact the API, not short-circuit');
    }

    public function test_permanent_failure_splits_but_transient_429_is_not_split(): void
    {
        $requests = [];
        Http::fake(function (\Illuminate\Http\Client\Request $request) use (&$requests) {
            $payload = json_decode($request->body(), true);
            $requests[] = count($payload['requests'] ?? []);

            return Http::response(['error' => ['message' => 'Quota exceeded ... retry in 1s']], 429);
        });

        $service = new NoSleepEmbeddingService();

        $this->assertSame([], $service->embedBatch(['one', 'two']));

        // A transient 429 must NOT fan out into per-item calls while the window
        // is dry — the same two-item batch is retried through the whole backoff
        // budget (5 attempts), then left unembedded for the next run.
        $this->assertSame(array_fill(0, 5, 2), $requests);
    }
}

/** Service variant that skips the real backoff sleep so tests run instantly
 *  while still exercising the full retry/backoff control flow. */
class NoSleepEmbeddingService extends AiEmbeddingService
{
    protected function backoffWait(float $delay): void
    {
    }
}