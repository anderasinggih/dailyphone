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
        Schema::table('general_settings', function (Blueprint $table) {
            $table->boolean('ai_enabled')->default(true)->after('notification_emails');
            $table->string('ai_provider')->default('gemini')->after('ai_enabled');
            $table->text('ai_api_key')->nullable()->after('ai_provider');
            $table->string('ai_model')->default('gemini-3.6-flash')->after('ai_api_key');
            $table->text('ai_system_instruction')->nullable()->after('ai_model');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn([
                'ai_enabled',
                'ai_provider',
                'ai_api_key',
                'ai_model',
                'ai_system_instruction',
            ]);
        });
    }
};
