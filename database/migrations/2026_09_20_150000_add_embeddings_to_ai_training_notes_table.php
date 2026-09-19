<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Semantic search vectors for the AI memory brain. Each training note stores
     * its embedding (produced by text-embedding-004) here so retrieval can rank
     * neurons by real semantic similarity to the user's query instead of literal
     * keyword overlap. Stored as longText so both MySQL (JSON string) and SQLite
     * accommodate any embedding dimension.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->longText('embedding')->nullable()->after('content_hash');
            $table->string('embedding_model', 60)->nullable()->after('embedding');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropColumn(['embedding', 'embedding_model']);
        });
    }
};