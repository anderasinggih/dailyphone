<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Services\AiBrainMaintenanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Weekly consolidation must REMODEL the synapse network, not just clean the
 * node table: frequently co-activated neurons get stronger bonds (Hebbian
 * plasticity) while pairs that never fire together decay toward silence.
 */
class SynapseConsolidationTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content, array $extra = []): AiTrainingNote
    {
        $stamps = [];
        foreach (['created_at', 'updated_at'] as $col) {
            if (isset($extra[$col])) {
                $stamps[$col] = $extra[$col];
                unset($extra[$col]);
            }
        }

        $note = AiTrainingNote::create(array_merge([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $content,
            'content_hash' => md5($content),
            'kind' => 'note',
            'is_active' => true,
            'used_count' => 0,
        ], $extra));

        if ($stamps !== []) {
            $note->forceFill($stamps);
            $note->saveQuietly();
        }

        return $note->refresh();
    }

    private function link(int $from, int $to, float $weight): AiTrainingNoteLink
    {
        return AiTrainingNoteLink::create([
            'note_id' => $from,
            'linked_note_id' => $to,
            'relation' => 'related',
            'weight' => $weight,
        ]);
    }

    public function test_consolidation_strengthens_coactivated_synapses_and_decays_dead_pairs(): void
    {
        $vitalA = $this->note('Penjualan perangkat lama dicatat setiap sore di buku kas.', [
            'used_count' => 20,
            'updated_at' => now(),
        ]);
        $vitalB = $this->note('Kasir pagi bertanggung jawab atas setoran pertama hari ini.', [
            'used_count' => 25,
            'updated_at' => now(),
        ]);

        $deadC = $this->note('Katalog warna unit lama diarsipkan di gudang belakang.', [
            'created_at' => now()->subDays(300),
            'updated_at' => now()->subDays(300),
        ]);
        $deadD = $this->note('Inventaris rak kosong diisi ulang oleh tim gudang pagi.', [
            'created_at' => now()->subDays(300),
            'updated_at' => now()->subDays(300),
        ]);

        $vitalLink = $this->link($vitalA->id, $vitalB->id, 0.4);
        $deadLink = $this->link($deadC->id, $deadD->id, 0.4);

        $result = app(AiBrainMaintenanceService::class)->consolidate(0.99, 120);

        // Co-activated pair strengthened (0.4 → 0.44)…
        $this->assertEqualsWithDelta(0.44, $vitalLink->refresh()->weight, 0.0001);

        // …dead pair decayed toward the floor (0.4 → 0.32).
        $this->assertEqualsWithDelta(0.32, $deadLink->refresh()->weight, 0.0001);

        // The consolidation actually remodeled synapses.
        $this->assertGreaterThanOrEqual(2, $result['remodeled_synapses']);
    }

    public function test_pure_synapse_strength_still_bounded_to_max(): void
    {
        $a = $this->note('Rejeki nomplok bulanan dibagi rata ke semua karyawan piket.', [
            'used_count' => 10,
            'updated_at' => now(),
        ]);
        $b = $this->note('Barang hilang dalam pemeriksaan stok harus diganti penjaga malam.', [
            'used_count' => 12,
            'updated_at' => now(),
        ]);

        $link = $this->link($a->id, $b->id, 0.95);

        app(AiBrainMaintenanceService::class)->consolidate(0.99, 120);

        // 0.95 × 1.10 → 1.045, clamped back to 1.0 so synapses never saturate.
        $this->assertEqualsWithDelta(1.0, $link->refresh()->weight, 0.0001);
    }
}