<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Widen the chat content column so long messages/replies survive MySQL.
     *
     * The original `content` was `text`, which on MySQL is capped at 64KB — a
     * long assistant answer (or a long user prompt) overflowed it and made the
     * pre-stream AiChat::create() throw, surfacing as a generic 500 "Server
     * Error" instead of a usable reply. SQLite is unaffected but the migration
     * is a safe no-op there.
     */
    public function up(): void
    {
        Schema::table('ai_chats', function (Blueprint $table) {
            $table->longText('content')->change();
        });
    }

    public function down(): void
    {
        Schema::table('ai_chats', function (Blueprint $table) {
            $table->text('content')->change();
        });
    }
};