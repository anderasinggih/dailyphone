<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Global AI training memory: a persistent "notebook" the AI writes to
     * by itself during chats, and reads back in every session to "learn".
     * - kind = 'rule'      -> behavioral directive (superadmin only)
     * - kind = 'knowledge' -> factual/learned note (any role)
     */
    public function up(): void
    {
        Schema::create('ai_training_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('author_name')->nullable();
            $table->string('author_role')->nullable();
            $table->text('content');
            $table->string('content_hash', 32)->unique();
            $table->string('kind', 16)->default('knowledge');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_training_notes');
    }
};