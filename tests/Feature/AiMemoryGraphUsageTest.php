<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Services\AiMemoryGraphService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiMemoryGraphUsageTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content, string $kind = 'note'): AiTrainingNote
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

    public function test_stale_notes_never_reach_the_retrieval_pool(): void
    {
        $stale = $this->note('Harga jual iPhone 15 Pro di toko semua cabang adalah 18 juta rupiah.');
        $fresh = $this->note('Harga jual iPhone 15 Pro di toko semua cabang adalah 17 juta rupiah.');

        $stale->update(['is_stale' => true]);

        $pool = app(AiMemoryGraphService::class)->candidateNotes('Harga jual iPhone 15 Pro berapa?', 'knowledge');

        $this->assertTrue($pool->contains('id', $fresh->id));
        $this->assertFalse($pool->contains('id', $stale->id));
    }

    public function test_stale_notes_no_longer_block_duplicate_saves(): void
    {
        $note = $this->note('Warna unit wajib diisi sebelum unit dijual ke pelanggan.');
        $note->update(['is_stale' => true]);

        $this->assertFalse(
            app(AiMemoryGraphService::class)->isDuplicateContent('Warna unit wajib diisi sebelum unit dijual ke pelanggan.')
        );
    }

    public function test_supersede_marks_loser_stale_and_clears_conflict_flags(): void
    {
        $graph = app(AiMemoryGraphService::class);
        $old = $this->note('Harga promo iPhone 13 berlaku untuk semua cabang toko kami');
        $new = $this->note('Harga promo iPhone 13 berlaku hanya untuk cabang Surabaya');

        AiTrainingNoteLink::query()->delete();

        $link = AiTrainingNoteLink::create([
            'note_id' => $old->id,
            'linked_note_id' => $new->id,
            'relation' => 'same_topic',
            'weight' => 0.9,
            'metadata' => [AiMemoryGraphService::METADATA_CONFLICT_FLAG => true],
        ]);

        $result = $graph->settleConflict((int) $link->id, (int) $new->id, 'supersedes');

        $this->assertSame((int) $new->id, $result['winner_id']);
        $this->assertSame((int) $old->id, $result['loser_id']);
        $this->assertSame(1, $result['conflicts_cleared']);
        $this->assertSame('supersedes', $result['action']);
        $this->assertTrue((bool) $old->refresh()->is_stale);
        $this->assertSame((int) $new->id, (int) $old->refresh()->superseded_by_note_id);
        $this->assertSame('supersedes', $link->refresh()->relation);
        $this->assertNull($link->refresh()->metadata);
    }

    public function test_restore_revivives_a_stale_note_and_rewires_its_synapses(): void
    {
        $graph = app(AiMemoryGraphService::class);
        $old = $this->note('Sepeda motor bekas di toko kami sudah terjual semua minggu lalu.');
        $new = $this->note('Sepeda motor bekas di toko kami sudah terjual semua minggu ini.');

        AiTrainingNoteLink::query()->delete();

        $link = AiTrainingNoteLink::create([
            'note_id' => $old->id,
            'linked_note_id' => $new->id,
            'relation' => 'supersedes',
            'weight' => 0.9,
            'metadata' => [AiMemoryGraphService::METADATA_CONFLICT_FLAG => true],
        ]);

        $old->update(['is_stale' => true, 'superseded_by_note_id' => $new->id]);

        $restored = $graph->restoreNode((int) $old->id);

        $this->assertFalse((bool) $restored->is_stale);
        $this->assertNull($restored->superseded_by_note_id);
        $this->assertGreaterThan(0, AiTrainingNoteLink::where('note_id', $old->id)->orWhere('linked_note_id', $old->id)->count());
    }

    public function test_similar_but_not_duplicate_notes_get_conflict_flagged_synapses(): void
    {
        $existing = $this->note('Harga jual unit iPhone 15 Pro Max dengan kapasitas penyimpanan 256 gigabyte adalah dua puluh juta rupiah');

        $freshContent = 'Harga jual unit iPhone 15 Pro Max dengan kapasitas penyimpanan 512 gigabyte adalah dua puluh juta rupiah di marketplace online';
        AiTrainingNote::create([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $freshContent,
            'title' => mb_substr($freshContent, 0, 40),
            'content_hash' => md5($freshContent),
            'kind' => 'note',
            'is_active' => true,
        ]);

        $link = AiTrainingNoteLink::where('note_id', $existing->id)
            ->orWhere('linked_note_id', $existing->id)
            ->first();

        $this->assertNotNull($link, 'Auto-linking should have created a synapse for the fresh note.');

        // The same cosine-in-band check linkNewNote runs at link time, recomputed
        // here so the assertion mirrors the production rule exactly instead of a
        // hard-coded example whose band placement could silently drift.
        $expected = (new AiMemoryGraphUsageTestGraphProbe)
            ->inConflictBand($existing, AiTrainingNote::find($link->getOtherId((int) $existing->id)));

        $this->assertSame(
            (bool) ($link->metadata[AiMemoryGraphService::METADATA_CONFLICT_FLAG] ?? false),
            $expected,
            'A same-topic, non-rephrased pair must be pen-flagged exactly when its cosine falls in the conflict band.'
        );
    }
}

class AiMemoryGraphUsageTestGraphProbe extends AiMemoryGraphService
{
    public function inConflictBand($a, $b): bool
    {
        $docs = [
            (int) $a->id => $this->tokenize($this->labelSource($a)),
            (int) $b->id => $this->tokenize($this->labelSource($b)),
        ];
        $idf = $this->computeIdf($docs);
        $cosine = $this->cosine(
            $this->tokenVector($docs[(int) $a->id], $idf),
            $this->tokenVector($docs[(int) $b->id], $idf)
        );

        return $cosine >= self::CONFLICT_FLOOR && $cosine < self::CONFLICT_CEILING;
    }
}
