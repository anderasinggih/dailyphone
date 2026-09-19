<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Explicit Gemini cachedContents were removed: modern models (2.5+) cache
     * prompts implicitly for free, and sending `cachedContent` together with
     * `system_instruction`/`tools` returns HTTP 400 INVALID_ARGUMENT. Drop the
     * now-unused table and settings flag.
     */
    public function up(): void
    {
        Schema::dropIfExists('ai_context_caches');

        if (Schema::hasColumn('general_settings', 'ai_context_caching_enabled')) {
            Schema::table('general_settings', function (Blueprint $table) {
                $table->dropColumn('ai_context_caching_enabled');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('ai_context_caches')) {
            Schema::create('ai_context_caches', function (Blueprint $table) {
                $table->id();
                $table->string('cache_key', 96)->unique();
                $table->string('cache_name', 191);
                $table->string('model', 100)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasColumn('general_settings', 'ai_context_caching_enabled')) {
            Schema::table('general_settings', function (Blueprint $table) {
                $table->boolean('ai_context_caching_enabled')->default(true)->after('ai_grounding_enabled');
            });
        }
    }
};