<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Services\AiEmbeddingService;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Situational + continuous recall (inter-turn spreading activation).
 *
 * A memory is not only found by embedding similarity: a query that names a
 * time ("lusa"), a place ("di Juanda") or a person pulls the episode-tagged
 * node even when the content shares zero literal words — and the recent
 * conversation primes the neurons a human would still be holding onto.
 *
 * Every test keeps the target node OLD (stale updated_at) and the pool full
 * of recent fillers, so the cold-index token fallback ("6 most recent") can
 * never surface it — only the situational/momentum seed can.
 */
class EpisodicRecallTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content, string $kind = 'note', array $extra = []): AiTrainingNote
    {
        return AiTrainingNote::create(array_merge([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $content,
            'content_hash' => md5($content),
            'kind' => $kind,
            'is_active' => true,
        ], $extra));
    }

    private function contextFor(string $query, array $conversation = [], array $targets = [], int $pool = 8): string
    {
        // Realistic pool: recent filler notes so the cold-index token fallback
        // returns them, never an old episode node. Each filler gets a distinct
        // (but still recent) updated_at; with identical timestamps SQLite falls
        // back to id order and the oldest target could sneak into "6 most
        // recent". updated_at is not mass-assignable, so it is written raw.
        for ($i = 0; $i < $pool; $i++) {
            $filler = $this->note("Arsip ke-$i: stok gudang mingguan dan nota pembelian rutin.");
            DB::table('ai_training_notes')->where('id', $filler->id)->update(['updated_at' => now()->subSeconds($pool - $i)]);
        }

        // Target nodes predate every filler by a month, so the "6 most recent"
        // warm-up can never reach them.
        foreach (array_filter($targets) as $t) {
            DB::table('ai_training_notes')->where('id', $t->id)->update(['updated_at' => now()->subDays(30)]);
        }

        // Cold embedding index -> the deterministic token pool runs instead,
        // so the test never hits the network and stays stable.
        $embedder = \Mockery::mock(AiEmbeddingService::class);
        $embedder->shouldReceive('search')->andReturn(['notes' => collect(), 'best_score' => null, 'method' => 'embedding']);
        $this->app->instance(AiEmbeddingService::class, $embedder);

        $service = app(GeminiAssistantService::class);
        $service->setConversationContext($conversation);

        return $service->generateTrainingNotesContext($query);
    }

    public function test_relative_time_recall_brings_the_day_of_that_episode(): void
    {
        // No word of the query's token set appears in this content — retrieval
        // must fire on the WHEN, not on text ("lusa" -> that calendar day).
        $note = $this->note('Penjemputan barang pesanan di bandara Juanda.', 'memory', [
            'occurred_at' => now()->addDays(2)->startOfDay(),
            'occurred_place' => 'Juanda',
            'involved_with' => 'Kakak',
        ]);

        $ctx = $this->contextFor('lusa diantar pakai mobil rencana terakhir ya?', [], [$note]);

        $this->assertStringContainsString('Penjemputan barang pesanan di bandara Juanda.', $ctx);
        $this->assertStringContainsString('[episode: ' . now()->addDays(2)->format('d M Y'), $ctx);
        $this->assertStringContainsString('(muncul: waktu ' . now()->addDays(2)->format('Y-m-d'), $ctx);
    }

    public function test_place_recall_resurfaces_episode_by_location_word(): void
    {
        $note = $this->note('Nego harga kendaraan dinas cabang utama kemarin.', 'memory', [
            'occurred_place' => 'Cabang Gatot',
        ]);

        $ctx = $this->contextFor('tadi di gatot nilai kebutuhan bulan depan', [], [$note]);

        $this->assertStringContainsString('Nego harga kendaraan dinas cabang utama kemarin.', $ctx);
        $this->assertStringContainsString('[episode: Cabang Gatot', $ctx);
        $this->assertStringContainsString('(muncul: di Cabang Gatot', $ctx);
    }

    public function test_person_recall_triggers_from_conversation_not_just_query(): void
    {
        $note = $this->note('Inspeksi mendadak jadwal bergeser saat tutup.', 'memory', [
            'involved_with' => 'Budi',
        ]);

        // "Budi" lives in the PRIOR turn, not in today's query.
        $ctx = $this->contextFor('besok gimana jadwalnya?', [
            ['role' => 'user', 'content' => 'kemarin Budi ke toko pas tutup'],
        ], [$note]);

        $this->assertStringContainsString('Inspeksi mendadak jadwal bergeser saat tutup.', $ctx);
        $this->assertStringContainsString('[episode: bersama Budi', $ctx);
        $this->assertStringContainsString('(muncul: bersama Budi', $ctx);
    }

    public function test_recently_used_memory_resurfaces_across_unrelated_queries(): void
    {
        // Consulted minutes ago — momentum should keep it alive with zero
        // word overlap to the new (unrelated) query.
        $note = $this->note('Kebijakan retur barang wajib kartu pembelian.', 'note');
        $note->update([
            'last_used_at' => now()->subMinutes(2),
            'used_count' => 1,
        ]);

        $ctx = $this->contextFor('berapa harga terbaru di pasar oke?', [], [$note]);

        $this->assertStringContainsString('Kebijakan retur barang wajib kartu pembelian.', $ctx);
        $this->assertStringContainsString('(muncul: momentum percakapan', $ctx);
    }

    public function test_recent_conversation_topic_primes_related_neurons(): void
    {
        // Content matches a token in the conversation ("telur"), not the query.
        $note = $this->note('Pemasok telur ditarik; cari pengganti baru pekan ini.');
        $note->update(['last_used_at' => now()->subDays(10)]);

        $ctx = $this->contextFor('besok ada apa?', [
            ['role' => 'user', 'content' => 'tadi aku tanya soal telur, gimana kelanjutannya'],
        ], [$note]);

        $this->assertStringContainsString('Pemasok telur ditarik; cari pengganti baru pekan ini.', $ctx);
        $this->assertStringContainsString('(muncul: topik yang sedang dibahas', $ctx);
    }

    public function test_episode_date_helpers_bounds_sloppy_tags(): void
    {
        $controller = app(\App\Http\Controllers\AiAssistantController::class);

        $ref = new \ReflectionMethod($controller, 'episodeDate');
        $method = $ref->getClosure($controller);

        $this->assertNotNull($method(['occurred_at' => '2026-09-18']));
        $this->assertNotNull($method(['when' => 'sekarang']));
        $this->assertNull($method(['occurred_at' => 'not a date at all']));
        $this->assertNull($method([]));
    }

    public function test_episode_label_trims_and_bounds(): void
    {
        $controller = app(\App\Http\Controllers\AiAssistantController::class);

        $ref = new \ReflectionMethod($controller, 'episodeLabel');
        $method = $ref->getClosure($controller);

        $this->assertSame('Cabang Gatot', $method('  Cabang Gatot, '));
        $this->assertSame('Budi', $method('Budi'));
        $this->assertNull($method('  ..'));
        $this->assertNull($method('a'));
        $this->assertNull($method(str_repeat('x', 200)));
    }
}