<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Conflict / supersede bookkeeping for the memory brain.
     *
     * 1. ai_training_notes.is_stale — a node whose fact has been replaced by a
     *    newer one. Retrieval must never surface it again (and it must not leak
     *    back through 2-hop synapse expansion either), but it stays on disk so
     *    the superadmin can see the history and undo the decision.
     * 2. ai_training_notes.superseded_by_note_id — the newer node that took
     *    this stale node's place, when the replacement was resolved by review.
     * 3. ai_training_note_links.metadata — free-form JSON per synapse. Today it
     *    flags `possible_conflict = true` when a fresh node lands in the
     *    "same topic, maybe different facts" similarity band (0.72-0.92) — a
     *    pen marker for the superadmin's conflict review UI, never an
     *    auto-supersede.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->boolean('is_stale')->default(false)->index()->after('is_active');
            $table->foreignId('superseded_by_note_id')
                ->nullable()
                ->after('is_stale')
                ->constrained('ai_training_notes')
                ->nullOnDelete();
        });

        Schema::table('ai_training_note_links', function (Blueprint $table) {
            $table->json('metadata')->nullable()->after('reason');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('superseded_by_note_id');
            $table->dropColumn('is_stale');
        });

        Schema::table('ai_training_note_links', function (Blueprint $table) {
            $table->dropColumn('metadata');
        });
    }
};
