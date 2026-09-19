<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('stocks', function (Blueprint $table) {
            if (!Schema::hasColumn('stocks', 'created_by')) {
                $table->string('created_by')->nullable()->after('status');
            }
        });

        Schema::table('ai_chats', function (Blueprint $table) {
            if (!Schema::hasColumn('ai_chats', 'execution_data')) {
                $table->json('execution_data')->nullable()->after('action_status');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('stocks', function (Blueprint $table) {
            if (Schema::hasColumn('stocks', 'created_by')) {
                $table->dropColumn('created_by');
            }
        });

        Schema::table('ai_chats', function (Blueprint $table) {
            if (Schema::hasColumn('ai_chats', 'execution_data')) {
                $table->dropColumn('execution_data');
            }
        });
    }
};
