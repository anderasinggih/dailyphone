<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Master switch for the semantic-retrieval pipeline (embedding search +
     * situational memory seeds + pinned training-notes context). Turning it off
     * removes every memory cards/retrieval call from the chat request path, so
     * replies stream straight from the model with no retrieval overhead — the
     * pre-retrieval behaviour. Live store tools and grounding stay independent.
     */
    public function up(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->boolean('ai_retrieval_enabled')->default(true)->after('ai_tool_combo');
        });
    }

    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn('ai_retrieval_enabled');
        });
    }
};