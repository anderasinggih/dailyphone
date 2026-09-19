<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-chat observability. Every assistant run records which memory neurons
     * were retrieved, which tools were called, token usage and latency, so a
     * bad answer can be replayed and diagnosed instead of guessed at.
     */
    public function up(): void
    {
        Schema::create('ai_assistant_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('session_id')->nullable()->constrained('ai_sessions')->nullOnDelete();
            $table->unsignedBigInteger('ai_chat_id')->nullable();
            $table->text('query')->nullable();
            $table->string('model', 100)->nullable();
            $table->string('status', 16)->default('success');
            $table->unsignedInteger('latency_ms')->default(0);
            $table->unsignedInteger('prompt_tokens')->default(0);
            $table->unsignedInteger('completion_tokens')->default(0);
            $table->unsignedInteger('total_tokens')->default(0);
            $table->json('neurons_retrieved')->nullable();
            $table->json('tools_called')->nullable();
            $table->json('citations')->nullable();
            $table->decimal('retrieval_confidence', 5, 3)->nullable();
            $table->text('error')->nullable();
            $table->timestamps();

            $table->index(['session_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_assistant_runs');
    }
};