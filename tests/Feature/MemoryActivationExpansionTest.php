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
 * pulled along STRONG synapses (weight-ranked) and weak "glue" edges never
 * dump their content into the prompt, keeping the context tight.
 */
class MemoryActivationExpansionTest extends TestCase
{
    use RefreshDatabase;

    private function note(string $content): AiTrainingNote
    {
        return AiTrainingNote::create([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => $content,
            'content_hash' => md5($content),
            'kind' => 'note',
            'is_active' => true,
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

        AiTrainingNoteLink::create([
            'note_id' => $seed->id,
            'linked_note_id' => $strong->id,
            'relation' => 'closely_related',
            'weight' => 0.6,
        ]);
        AiTrainingNoteLink::create([
            'note_id' => $seed->id,
            'linked_note_id' => $medium->id,
            'relation' => 'related',
            'weight' => 0.3,
        ]);
        AiTrainingNoteLink::create([
            'note_id' => $seed->id,
            'linked_note_id' => $weak->id,
            'relation' => 'fresh_memory',
            'weight' => 0.05,
        ]);

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
}