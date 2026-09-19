<?php

namespace Tests\Feature;

use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiImageGenerationTest extends TestCase
{
    use RefreshDatabase;

    public function test_is_image_model_detects_nano_banana_models(): void
    {
        $svc = app(GeminiAssistantService::class);
        $method = new \ReflectionMethod($svc, 'isImageModel');

        $this->assertTrue($method->invoke($svc, 'gemini-2.5-flash-image'));
        $this->assertTrue($method->invoke($svc, 'gemini-3.1-flash-lite-image'));
        $this->assertTrue($method->invoke($svc, 'gemini-3.1-flash-image'));
        $this->assertFalse($method->invoke($svc, 'gemini-3.5-flash'));
    }

    public function test_persist_inline_image_saves_png_and_builds_download_url(): void
    {
        $svc = app(GeminiAssistantService::class);
        $method = new \ReflectionMethod($svc, 'persistInlineImage');

        $meta = $method->invoke($svc, [
            'data' => base64_encode($this->tinyPng()),
            'mimeType' => 'image/png',
        ], 'test_run', 0);

        $this->assertNotNull($meta);
        $this->assertEquals('generated-1.png', $meta['name']);
        $this->assertEquals('image/png', $meta['mime']);
        $this->assertFileExists(storage_path('app/ai_generated/' . $meta['path']));
        $this->assertStringContainsString('assistant/file/images/test_run/generated-1.png', $meta['url']);
    }

    private function tinyPng(): string
    {
        return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WkAAAAASUVORK5CYII=');
    }
}