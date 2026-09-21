<?php

namespace Tests\Feature;

use App\Http\Controllers\AiAssistantController;
use App\Models\AiTrainingNote;
use App\Models\User;
use App\Services\AiActionService;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A save request ("catat ya", "simpen ke node", "pahami ini") must never end
 * up as the node's content verbatim. stripSaveCommand(), stripCommandFrame()
 * and declarativeFallback() peel the framing so the FACT underneath is what is
 * persisted — and a bare command persists nothing at all.
 */
class AiMemorySaveCommandFrameTest extends TestCase
{
    use RefreshDatabase;

    private function controller(): AiAssistantController
    {
        return app(AiAssistantController::class, [
            'geminiService' => app(GeminiAssistantService::class),
            'aiActionService' => app(AiActionService::class),
        ]);
    }

    private function stripSaveCommand(AiAssistantController $controller, string $text): string
    {
        $method = new \ReflectionMethod(AiAssistantController::class, 'stripSaveCommand');
        $method->setAccessible(true);

        return (string) $method->invoke($controller, $text);
    }

    private function declarativeFallback(AiAssistantController $controller, string $text): ?string
    {
        $method = new \ReflectionMethod(AiAssistantController::class, 'declarativeFallback');
        $method->setAccessible(true);

        return $method->invoke($controller, $text);
    }

    private function persist(string $userText, string $priorUserText = ''): void
    {
        $controller = $this->controller();
        $method = new \ReflectionMethod(AiAssistantController::class, 'silentlyPersistUserFact');
        $method->setAccessible(true);

        $result = ['success' => true, 'reply' => 'oke', 'raw_reply' => 'oke'];
        $method->invokeArgs($controller, [&$result, User::factory()->create(), $userText, $priorUserText]);
    }

    public function test_strip_save_command_peels_mid_sentence_save_frame(): void
    {
        // The imperative sits after a junk / dictation prefix, not at token #0 —
        // historically nothing was peeled and the raw command was stored.
        $controller = $this->controller();

        $this->assertSame(
            'laptopku 256gb',
            $this->stripSaveCommand($controller, 'cpba simpen ke node, laptopku 256gb')
        );
    }

    public function test_declarative_fallback_keeps_the_fact_below_a_save_command(): void
    {
        $controller = $this->controller();

        $this->assertSame(
            'laptopku 256gb',
            $this->declarativeFallback($controller, 'cpba simpen ke node, laptopku 256gb')
        );
    }

    public function test_declarative_fallback_rejects_bare_commands_with_no_fact(): void
    {
        $controller = $this->controller();

        $this->assertNull($this->declarativeFallback($controller, 'pelajari yaaa'));
        $this->assertNull($this->declarativeFallback($controller, 'tlong pahami ini yaaa'));
        $this->assertNull($this->declarativeFallback($controller, 'simpen ke node'));
    }

    public function test_persists_the_fact_not_the_verbatim_command(): void
    {
        $this->persist('cpba simpen ke node, laptopku 256gb');

        $this->assertSame(1, AiTrainingNote::count());
        $this->assertSame('laptopku 256gb', AiTrainingNote::first()->content);
    }

    public function test_bare_save_commands_persist_nothing(): void
    {
        $this->persist('tlong pahami ini yaaa');
        $this->persist('pelajari yaaa');

        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_plain_facts_survive_unchanged(): void
    {
        $this->persist('catat ya eka rahayu adalah ibu saya');

        $this->assertSame(1, AiTrainingNote::count());
        $this->assertSame('eka rahayu adalah ibu saya', AiTrainingNote::first()->content);
        $this->assertSame('identity', AiTrainingNote::first()->kind);
    }

    public function test_question_never_becomes_a_node(): void
    {
        // "nama nodenya apa" / "berapa total node" are chat questions, not
        // memories — no path may persist them.
        $this->persist('nama nodenya apa');
        $this->persist('berapa total node kah');

        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_model_memo_with_question_content_is_rejected(): void
    {
        // Choke point guard: even a model-authored ```ai_memo block carrying a
        // question ("apakah sudah tersimpan?") must not create a node.
        $method = new \ReflectionMethod(AiAssistantController::class, 'persistMemo');
        $method->setAccessible(true);

        $saved = $method->invoke($this->controller(), [
            'kind' => 'note',
            'title' => 'Pertanyaan user',
            'content' => 'apakah preferensi warna iphone sudah tersimpan?',
        ], User::factory()->create());

        $this->assertFalse($saved);
        $this->assertSame(0, AiTrainingNote::count());
    }
}