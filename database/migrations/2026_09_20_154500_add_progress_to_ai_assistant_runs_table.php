<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Durable snapshot of the retrieval moment: which neurons pulsed per
     * stage (rule / semantic / contextual) and which ids were actually cited
     * back. Mirrors what the live web socket pushes, so a run can always be
     * replayed from the row alone.
     */
    public function up(): void
    {
        Schema::table('ai_assistant_runs', function (Blueprint $table) {
            $table->json('stages')->nullable()->after('neurons_retrieved');
            $table->json('used_ids')->nullable()->after('stages');
        });
    }

    public function down(): void
    {
        Schema::table('ai_assistant_runs', function (Blueprint $table) {
            $table->dropColumn(['stages', 'used_ids']);
        });
    }
};