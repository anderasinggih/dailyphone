<?php

namespace Tests\Feature;

use App\Models\GeneralSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AssistantChatLimitTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create(['role' => 'superadmin']);
    }

    public function test_long_message_streams_and_persists_without_server_error(): void
    {
        GeneralSetting::create([
            'ai_enabled' => true,
            'ai_api_key' => 'fake-key',
            'ai_model' => 'gemini-3.5-flash-lite',
        ]);

        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response(
                '[{"candidates":[{"content":{"parts":[{"text":"oke"}],"role":"model"}}]}]',
                200,
                ['Content-Type' => 'application/json']
            ),
        ]);

        // ~170KB message — over the legacy MySQL `text` (64KB) limit but under
        // the new 200k validation cap.
        $longText = str_repeat('Lorem ipsum dolor sit amet consectetur adipiscing elit. ', 3000);

        $response = $this->actingAs($this->user())
            ->post(route('assistant.chat'), [
                'message' => $longText,
            ], ['Accept' => 'application/json']);

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        $streamed = $response->streamedContent();
        $this->assertStringContainsString('"type":"done"', $streamed);
        $this->assertStringNotContainsString('Server Error', $streamed);
    }

    public function test_oversized_message_gets_friendly_422_instead_of_server_error(): void
    {
        GeneralSetting::create([
            'ai_enabled' => true,
            'ai_api_key' => 'fake-key',
        ]);

        $this->actingAs($this->user())
            ->post(route('assistant.chat'), [
                'message' => str_repeat('averylongsegmentoftheprompt. ', 14000),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The message field must not be greater than 200000 characters.');
    }
}