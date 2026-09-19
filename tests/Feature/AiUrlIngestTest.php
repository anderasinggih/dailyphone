<?php

namespace Tests\Feature;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Models\User;
use App\Services\AiFileIngestService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiUrlIngestTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create(['role' => 'superadmin']);
    }

    public function test_ingests_an_html_article_into_knowledge_nodes(): void
    {
        Http::fake([
            'https://example.com/mind-map' => Http::response(
                '<!doctype html><html><head><title>Mind Map - Visual Thinking</title></head>'
                .'<body><nav>Home About Contact</nav><article>'
                .str_repeat('<p>Mind maps are a visual way to organise thoughts and ideas around a central concept.</p>', 40)
                .'</article><script>alert("not visible")</script></body></html>',
                200,
                ['Content-Type' => 'text/html']
            ),
        ]);

        // A pre-existing memory gives the new article node something to plug into.
        AiTrainingNote::create([
            'user_id' => $this->user()->id,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => 'Visual learning tools help organise knowledge around central concepts.',
            'content_hash' => md5('Visual learning tools help organise knowledge around central concepts.'),
            'kind' => 'knowledge',
            'is_active' => true,
        ]);

        $result = app(AiFileIngestService::class)->ingestUrl('https://example.com/mind-map', $this->user());

        $this->assertTrue($result['success']);
        $this->assertGreaterThan(0, $result['notes_count']);
        $this->assertSame('Mind Map - Visual Thinking', $result['title']);
        $this->assertStringContainsString('example.com/mind-map', $result['url']);

        $this->assertDatabaseHas('ai_training_notes', [
            'source_url' => 'https://example.com/mind-map',
            'kind' => 'knowledge',
        ]);
        $this->assertSame(0, AiTrainingNote::where('content', 'like', '%alert("not visible")%')->count());

        $note = AiTrainingNote::where('source_url', 'https://example.com/mind-map')->first();
        $this->assertNotNull($note);
        $this->assertNotNull($note->title);
        $this->assertIsArray($note->related_keywords);

        // Nodes must be auto-linked into the neuron graph (mind map edges).
        $this->assertTrue(
            AiTrainingNoteLink::where('note_id', $note->id)
                ->orWhere('linked_note_id', $note->id)
                ->exists()
        );

        Http::assertSent(fn ($req) => str_contains($req->url(), 'example.com/mind-map'));
    }

    public function test_ingest_is_deduplicated_on_second_call(): void
    {
        Http::fake([
            'https://example.com/article' => Http::response(
                '<html><head><title>Repeat Topic</title></head><body>'
                .'<p>'.str_repeat('Same paragraphs on repeated ingestion stay identical.', 30).'</p>'
                .'</body></html>',
                200,
                ['Content-Type' => 'text/html']
            ),
        ]);

        $service = app(AiFileIngestService::class);
        $user = $this->user();

        $first = $service->ingestUrl('https://example.com/article', $user);
        $second = $service->ingestUrl('https://example.com/article', $user);

        $this->assertTrue($first['success']);
        $this->assertGreaterThan(0, $first['notes_count']);
        $this->assertFalse($second['success']);
        $this->assertSame(0, $second['notes_count']);
    }

    public function test_rejects_invalid_urls(): void
    {
        $result = app(AiFileIngestService::class)->ingestUrl('not-a-url', $this->user());

        $this->assertFalse($result['success']);
        $this->assertSame(0, $result['notes_count']);
        $this->assertStringContainsString('tidak valid', strtolower($result['message']));
    }

    public function test_reports_when_fetch_fails(): void
    {
        Http::fake([
            'https://example.com/gone' => Http::response('Not Found', 404),
        ]);

        $result = app(AiFileIngestService::class)->ingestUrl('https://example.com/gone', $this->user());

        $this->assertFalse($result['success']);
        $this->assertSame(0, $result['notes_count']);
        $this->assertStringContainsString('gagal', strtolower($result['message']));
    }
}
