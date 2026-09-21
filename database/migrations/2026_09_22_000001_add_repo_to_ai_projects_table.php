<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Let a project optionally back itself with a remote git repository. When
     * repo_url is set, the file tree is wired to a working clone on disk and the
     * workspace can commit & push edits back upstream.
     */
    public function up(): void
    {
        Schema::table('ai_projects', function (Blueprint $table) {
            $table->string('repo_url')->nullable()->after('description');
            $table->string('repo_branch')->nullable()->default('main')->after('repo_url');
            $table->boolean('repo_imported')->default(false)->after('repo_branch');
            $table->string('repo_error')->nullable()->after('repo_imported');
        });
    }

    public function down(): void
    {
        Schema::table('ai_projects', function (Blueprint $table) {
            $table->dropColumn(['repo_url', 'repo_branch', 'repo_imported', 'repo_error']);
        });
    }
};