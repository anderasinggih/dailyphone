<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add provenance columns to the training memory nodes and create a table
     * for chat attachments (files the user uploads so the AI can read them).
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->string('source_url', 500)->nullable()->after('related_keywords');
            $table->string('source_label', 255)->nullable()->after('source_url');
        });

        Schema::create('ai_chat_attachments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->unsignedBigInteger('session_id')->nullable();
            $table->unsignedBigInteger('ai_chat_id')->nullable();
            $table->string('original_name', 255);
            $table->string('mime_type', 150)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->string('kind', 32)->default('text');
            $table->string('storage_path', 500);
            $table->longText('extracted_text')->nullable();
            $table->string('content_hash', 64)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_chat_attachments');

        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropColumn(['source_url', 'source_label']);
        });
    }
};