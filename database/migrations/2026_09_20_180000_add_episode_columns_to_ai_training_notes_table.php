<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Episode tagging for episodic memory. A memory node can now carry the
     * situational frame a human remembers it by — WHEN it happened
     * (occurred_at), WHERE (occurred_place), and with WHOM (involved_with).
     * Retrieval uses these as seed signals, not just text: "lusa" or "Juanda"
     * or a person's name can resurface the tagged episode even when the
     * content shares no literal words with the query.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dateTime('occurred_at')->nullable()->after('last_used_at');
            $table->string('occurred_place', 120)->nullable()->after('occurred_at');
            $table->string('involved_with', 120)->nullable()->after('occurred_place');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropColumn(['occurred_at', 'occurred_place', 'involved_with']);
        });
    }
};