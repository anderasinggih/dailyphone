<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Gemini 3 tool combination (Preview): lets the model use both Google
     * Search grounding (real-time web data) and function calling (live
     * store data) in a single request via includeServerSideToolInvocations.
     * Only applies to Gemini 3 non-image models; other models keep the
     * previous mutually-exclusive behaviour.
     */
    public function up(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->boolean('ai_tool_combo')->default(true)->after('ai_grounding_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn('ai_tool_combo');
        });
    }
};