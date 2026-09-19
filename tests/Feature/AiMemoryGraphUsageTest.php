<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Services\AiMemoryGraphService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiMemoryGraphUsageTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content, string $kind = 'knowledge'): AiTrainingNote
    {
        return AiTrainingNote::create([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $content,
            'title' => mb_substr($content, 0, 40),
            'content_hash' => md5($content),
            'kind' => $kind,
            'is_active' => true,
        ]);
    }

    public function test_register_usage_increments_count_and_touches_timestamp(): void
    {
        $a = $this->note('Aturan diskon karyawan berlaku untuk semua cabang');
        $b = $this->note('iPhone 15 Pro masuk minggu ini dengan harga promo');

        $this->assertSame(0, $a->refresh()->used_count);
        $this->assertNull($a->refresh()->last_used_at);

        app(AiMemoryGraphService::class)->registerUsage([$a->id, $b->id, $a->id]);

        $this->assertSame(1, $a->refresh()->used_count);
        $this->assertSame(1, $b->refresh()->used_count);
        $this->assertNotNull($a->refresh()->last_used_at);
    }

    public function test_duplicate_detection_catches_rephrased_via_shared_tokens(): void
    {
        $this->note('Harga promo berlaku untuk unit iPhone 13 di semua cabang toko kami');

        $graph = app(AiMemoryGraphService::class);

        // Same idea, different word order → shares key tokens (promo, harga, iphone, ...) → duplicate.
        $this->assertTrue($graph->isDuplicateContent('Untuk semua cabang toko, harga promo iPhone 13 berlaku'));

        // Genuinely different topic → NOT a duplicate.
        $this->assertFalse($graph->isDuplicateContent('Apple merilis iPhone generasi terbaru dengan kamera yang lebih baik.'));
    }

    public function test_paused_notes_still_count_as_duplicates(): void
    {
        $note = $this->note('Warna unit wajib diisi sebelum unit dijual ke pelanggan.');
        $note->update(['is_active' => false]);

        $this->assertTrue(
            app(AiMemoryGraphService::class)->isDuplicateContent('Warna unit wajib diisi sebelum unit dijual ke pelanggan.')
        );
    }

    public function test_candidate_pool_never_materializes_the_whole_table(): void
    {
        $this->note('Sepeda motor bekas di toko kami sudah terjual semua minggu lalu.');
        $target = $this->note('Xiaomi Redmi Note 13 ramai peminat di segment harga menengah.');

        $pool = app(AiMemoryGraphService::class)->candidateNotes('Berapa harga Xiaomi Redmi Note 13?', 'knowledge');

        $this->assertTrue($pool->contains('id', $target->id));
        $this->assertCount(1, $pool);
    }
}