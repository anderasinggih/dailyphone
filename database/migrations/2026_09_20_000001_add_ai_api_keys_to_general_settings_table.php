<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Adds an ordered JSON list of up to 10 Gemini API keys (slot 0 = primary,
     * slots 1..9 = failover keys) so the assistant can rotate to the next key
     * when the current one hits its usage/rate limit.
     */
    public function up(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->json('ai_api_keys')->nullable()->after('ai_api_key');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn('ai_api_keys');
        });
    }
};