<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class AssistantChatOnlyTest extends TestCase
{
    use RefreshDatabase;

    public function test_chat_only_page_redirects_guests_to_login(): void
    {
        $this->get(route('assistant.chat-only'))
            ->assertRedirect(route('login'));
    }

    public function test_chat_only_page_follows_app_auth_rules_so_unverified_users_are_allowed(): void
    {
        // The rest of the app does not enforce MustVerifyEmail either, so the
        // chat-only page behaves identically: authentication is the gate.
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get(route('assistant.chat-only'))
            ->assertOk();
    }

    public function test_any_authenticated_verified_user_can_open_chat_only_page(): void
    {
        $user = User::factory()->create(['role' => 'karyawan']);

        $this->actingAs($user)
            ->get(route('assistant.chat-only'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Assistant/Index')
                ->where('chatOnly', true)
                ->has('sessions')
                ->has('activeSessionId')
                ->has('initialMessages')
            );
    }

    public function test_full_assistant_page_is_not_in_chat_only_mode(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get(route('assistant.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Assistant/Index')
                ->where('chatOnly', false)
            );
    }
}