<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_sessions', function (Blueprint $table) {
            $table->foreignId('project_id')->nullable()->after('user_id')
                ->constrained('ai_projects')->cascadeOnDelete();
            $table->index(['project_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::table('ai_sessions', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'updated_at']);
            $table->dropForeign(['project_id']);
            $table->dropColumn('project_id');
        });
    }
};