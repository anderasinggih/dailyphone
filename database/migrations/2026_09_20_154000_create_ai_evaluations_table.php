<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Golden-dataset evaluation results (item 6). A weekly `ai:evaluate` run
     * scores the assistant against ~25 known Q&A pairs and stores the pass/fail
     * per item so accuracy trends (up/down across model & retrieval changes)
     * are visible instead of guessed at.
     */
    public function up(): void
    {
        Schema::create('ai_evaluations', function (Blueprint $table) {
            $table->id();
            $table->string('run_key', 64)->nullable()->index();
            $table->string('model', 100)->nullable();
            $table->unsignedInteger('total_items')->default(0);
            $table->unsignedInteger('passed_items')->default(0);
            $table->decimal('score', 5, 2)->default(0);
            $table->unsignedInteger('latency_ms')->default(0);
            $table->unsignedInteger('total_tokens')->default(0);
            $table->json('items')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_evaluations');
    }
};