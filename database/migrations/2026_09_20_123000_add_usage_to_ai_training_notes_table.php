<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Track how often each memory node is actually consulted in chat replies
     * (the AI cites the node ids it used). This turns the "learning" loop into
     * something measurable: over time the superadmin sees which neurons are
     * load-bearing vs dead weight.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->unsignedInteger('used_count')->default(0)->after('is_active');
            $table->timestamp('last_used_at')->nullable()->after('used_count');
        });
    }

    public function down(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->dropColumn(['used_count', 'last_used_at']);
        });
    }
};