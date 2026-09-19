<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Rolling conversation summary for token-budget context trimming (item 7).
     * When a session's history exceeds the configured token budget, the oldest
     * messages are folded into this summary (regenerated as the chat grows)
     * and only the most recent messages are kept verbatim — so long chats never
     * silently exhaust the model's context window mid-conversation.
     */
    public function up(): void
    {
        Schema::table('ai_sessions', function (Blueprint $table) {
            $table->longText('ai_summary')->nullable()->after('custom_rules');
        });
    }

    public function down(): void
    {
        Schema::table('ai_sessions', function (Blueprint $table) {
            $table->dropColumn('ai_summary');
        });
    }
};