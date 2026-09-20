<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Services\AiEmbeddingService;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Path expansion must behave like human associative memory: neighbours are
 * pulled along STRONG synapses (weight-ranked, modulated by how "alive" each
 * memory is — recency × emotion × usage), a tight capped second hop lets
 * recall wander two jumps like a real memory chain, and weak "glue" edges
 * never dump their content into the prompt.
 */
class MemoryActivationExpansionTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content, string $kind = 'note', int $usedCount = 0, ?int $updatedDaysAgo = null): AiTrainingNote
    {
        $note = AiTrainingNote::create([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $content,
            'content_hash' => md5($content),
            'kind' => $kind,
            'is_active' => true,
            'used_count' => $usedCount,
        ]);

        if ($updatedDaysAgo !== null) {
            $note->update(['updated_at' => now()->subDays($updatedDaysAgo)]);
            $note = $note->refresh();
        }

        return $note;
    }

    private function link(int $from, int $to, float $weight, string $relation = 'related'): void
    {
        AiTrainingNoteLink::create([
            'note_id' => $from,
            'linked_note_id' => $to,
            'relation' => $relation,
            'weight' => $weight,
        ]);
    }

    private function contextFor(string $query): string
    {
        // Cold embedding index -> the deterministic token pool runs instead,
        // so the test never hits the network and stays stable.
        $embedder = \Mockery::mock(AiEmbeddingService::class);
        $embedder->shouldReceive('search')->andReturn(['notes' => collect(), 'best_score' => null, 'method' => 'embedding']);
        $this->app->instance(AiEmbeddingService::class, $embedder);

        $service = app(GeminiAssistantService::class);

        return $service->generateTrainingNotesContext($query);
    }

    public function test_expansion_ranks_neighbours_by_synapse_weight_and_drops_weak_edges(): void
    {
        $seed = $this->note('Sambal pecel Mbok Ginem resep turun temurun otentik.');

        $strong = $this->note('Dewi adalah istri dari Singgih.');
        $medium = $this->note('Pelanggan setia bernama Dewi Puspita Sari.');
        $weak = $this->note('Catatan lama produksi sama sekali tidak relevan.');

        $this->link($seed->id, $strong->id, 0.6, 'closely_related');
        $this->link($seed->id, $medium->id, 0.3, 'related');
        $this->link($seed->id, $weak->id, 0.05, 'fresh_memory');

        $ctx = $this->contextFor('sambal pecel');

        // Both strong neighbours travel with the seed…
        $this->assertStringContainsString('Dewi adalah istri dari Singgih.', $ctx);
        $this->assertStringContainsString('Pelanggan setia bernama Dewi Puspita Sari.', $ctx);

        // …ranked strongest-first along the synapse weights…
        $this->assertLessThan(
            strpos($ctx, 'Pelanggan setia bernama Dewi Puspita Sari.'),
            strpos($ctx, 'Dewi adalah istri dari Singgih.')
        );

        // …while the weak "glue" edge never reaches the model context.
        $this->assertStringNotContainsString('Catatan lama produksi sama sekali tidak relevan.', $ctx);
    }

    public function test_second_hop_travels_through_strong_first_hop_only_and_stays_tight(): void
    {
        $seed = $this->note('Sambal pecel Mbok Ginem resep turun temurun otentik.');
        $hopOne = $this->note('Dewi membeli satu kilogram cabai rawit di pasar pagi.');
        $hopTwo = $this->note('Komunitas menari Singgih berlatih setiap kamis malam.');
        $weakGlue = $this->note('Arsip nota pembelian lama tersimpan rapi di laci meja.');

        $this->link($seed->id, $hopOne->id, 0.55, 'closely_related');
        $this->link($hopOne->id, $hopTwo->id, 0.5, 'related');
        $this->link($hopOne->id, $weakGlue->id, 0.08, 'fresh_memory');

        $ctx = $this->contextFor('sambal pecel');

        // Hop 1 brings the direct neighbour…
        $this->assertStringContainsString('Dewi membeli satu kilogram cabai rawit di pasar pagi.', $ctx);

        // …and the strong first-hop node pulls its own best neighbour one
        // more jump, exposing the full traversal chain to the model.
        $this->assertStringContainsString("jalur: #{$seed->id} → #{$hopOne->id} → #{$hopTwo->id}", $ctx);
        $this->assertStringContainsString(', hop 2', $ctx);

        // Weak edges are never allowed to keep hopping.
        $this->assertStringNotContainsString('Arsip nota pembelian lama tersimpan rapi di laci meja.', $ctx);
    }

    public function test_activation_weights_recent_emotional_well_used_memories_higher(): void
    {
        $seed = $this->note('Sambal pecel Mbok Ginem resep turun temurun otentik.');

        // Same synapse strength on both sides…
        $loved = $this->note('Pelanggan kesal selalu diminta tenang dan diberi minuman dingin.', 'emotions', 30, 2);
        $forgotten = $this->note('Dewi mencatat pemasukan dan pengeluaran toko setiap sore.', 'note', 0, 200);

        $this->link($seed->id, $loved->id, 0.5, 'closely_related');
        $this->link($seed->id, $forgotten->id, 0.5, 'closely_related');

        $ctx = $this->contextFor('sambal pecel');

        // …yet the recent, emotionally charged, much-used memory fires first —
        // an old untouched node decays to near-silence.
        $this->assertStringContainsString('Pelanggan kesal selalu diminta tenang dan diberi minuman dingin.', $ctx);
        $this->assertStringContainsString('Dewi mencatat pemasukan dan pengeluaran toko setiap sore.', $ctx);
        $this->assertLessThan(
            strpos($ctx, 'Dewi mencatat pemasukan dan pengeluaran toko setiap sore.'),
            strpos($ctx, 'Pelanggan kesal selalu diminta tenang dan diberi minuman dingin.')
        );
    }
}
