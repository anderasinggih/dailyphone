<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Advanced AI intelligence flags. These switch on the semantic-retrieval
     * pipeline, Gemini function calling (live stock/sales/customer tools),
     * Google Search grounding, context caching and token-budget trimming —
     * each shipped with a graceful fallback to the previous behaviour.
     */
    public function up(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->string('ai_embedding_model', 60)->default('gemini-embedding-001')->after('ai_model');
            $table->boolean('ai_tools_enabled')->default(true)->after('ai_embedding_model');
            $table->boolean('ai_grounding_enabled')->default(true)->after('ai_tools_enabled');
            $table->boolean('ai_context_caching_enabled')->default(true)->after('ai_grounding_enabled');
            $table->unsignedInteger('ai_retrieval_top_k')->default(12)->after('ai_context_caching_enabled');
            $table->decimal('ai_retrieval_min_score', 5, 3)->default(0.30)->after('ai_retrieval_top_k');
            $table->unsignedInteger('ai_context_token_budget')->default(10000)->after('ai_retrieval_min_score');
        });
    }

    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn([
                'ai_embedding_model',
                'ai_tools_enabled',
                'ai_grounding_enabled',
                'ai_context_caching_enabled',
                'ai_retrieval_top_k',
                'ai_retrieval_min_score',
                'ai_context_token_budget',
            ]);
        });
    }
};