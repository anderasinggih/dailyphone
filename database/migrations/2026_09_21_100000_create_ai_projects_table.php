<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Projects are the top-level organisational unit above chat sessions.
     * A project groups multiple sessions and owns a shared file/folder tree
     * whose files can be referenced (via @-mention) inside any of its sessions.
     */
    public function up(): void
    {
        Schema::create('ai_projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120)->default('New Project');
            $table->text('description')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_projects');
    }
};