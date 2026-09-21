<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Track AI-driven changes on project files so the workspace can render an
     * opencode-style "Changed Files" panel: every file the AI creates or edits
     * is flagged, and files whose content replaced an existing sibling keep the
     * previous content so the client can render an old→new diff.
     */
    public function up(): void
    {
        Schema::table('ai_project_files', function (Blueprint $table) {
            $table->string('change_type', 16)->nullable()->after('content_hash');
            $table->longText('previous_content')->nullable()->after('change_type');
            $table->string('previous_content_hash', 64)->nullable()->after('previous_content');
            $table->timestamp('changed_at')->nullable()->after('previous_content_hash');

            $table->index('change_type');
        });
    }

    public function down(): void
    {
        Schema::table('ai_project_files', function (Blueprint $table) {
            $table->dropColumn(['change_type', 'previous_content', 'previous_content_hash', 'changed_at']);
        });
    }
};