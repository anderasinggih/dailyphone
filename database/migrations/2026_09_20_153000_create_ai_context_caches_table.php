<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tracks Gemini `cachedContents` resources so the Assistant can reuse a
     * static system-role preamble + tool declarations across turns instead of
     * re-billing their tokens on every request (context caching, item 11).
     * The `cache_key` is a hash of (model, system text, tools) so any config
     * change naturally invalidates the previous cache row.
     */
    public function up(): void
    {
        Schema::create('ai_context_caches', function (Blueprint $table) {
            $table->id();
            $table->string('cache_key', 96)->unique();
            $table->string('cache_name', 191);
            $table->string('model', 100)->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_context_caches');
    }
};