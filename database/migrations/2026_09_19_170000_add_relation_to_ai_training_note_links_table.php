<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_training_note_links', function (Blueprint $table) {
            // Typed, meaningful relations between memory nodes so the AI can
            // navigate the neuron map along specific paths ("same_topic",
            // "rule_applies", "persistent_hint", "closely_related", "related").
            $table->string('relation', 32)->nullable()->after('label');
            // Connection strength 0..1 shared by the memory engine.
            $table->decimal('weight', 5, 3)->nullable()->after('relation');
            // Short human explanation of why these two memories are linked.
            $table->string('reason')->nullable()->after('weight');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_note_links', function (Blueprint $table) {
            $table->dropColumn(['relation', 'weight', 'reason']);
        });
    }
};