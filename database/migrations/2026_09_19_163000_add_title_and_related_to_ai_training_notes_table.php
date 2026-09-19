<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A short, human-readable label for the memory node plus the related-keyword
     * hints the AI uses to define where this node connects inside the neuron map.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->string('title', 255)->nullable()->after('content');
            $table->json('related_keywords')->nullable()->after('title');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropColumn(['title', 'related_keywords']);
        });
    }
};