<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Files and folders shared inside a project. Folders are plain rows with
     * is_folder = true; nesting is expressed via a self-referencing parent_id,
     * which makes renames/relocations trivial and lets a folder delete cascade
     * to every descendant.
     */
    public function up(): void
    {
        Schema::create('ai_project_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained('ai_projects')->cascadeOnDelete();
            $table->unsignedBigInteger('parent_id')->nullable();
            $table->string('name', 255);
            $table->boolean('is_folder')->default(false);
            $table->string('mime_type', 150)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->string('kind', 32)->default('text');
            $table->string('storage_path', 500)->nullable();
            $table->longText('extracted_text')->nullable();
            $table->string('content_hash', 64)->nullable();
            $table->timestamps();

            $table->index(['project_id', 'parent_id', 'is_folder']);

            $table->foreign('parent_id')
                ->references('id')
                ->on('ai_project_files')
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_project_files');
    }
};