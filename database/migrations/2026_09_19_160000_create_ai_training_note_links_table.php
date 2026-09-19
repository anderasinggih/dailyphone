<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_training_note_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('note_id')->constrained('ai_training_notes')->cascadeOnDelete();
            $table->foreignId('linked_note_id')->constrained('ai_training_notes')->cascadeOnDelete();
            $table->string('label')->nullable();
            $table->timestamps();

            $table->unique(['note_id', 'linked_note_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_training_note_links');
    }
};