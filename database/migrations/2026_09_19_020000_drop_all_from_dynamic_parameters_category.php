<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Remove the redundant 'all' category from dynamic_parameters.
     * 'global' already means "applies to every stock category",
     * so 'all' is unnecessary.
     */
    public function up(): void
    {
        Schema::table('dynamic_parameters', function (Blueprint $table) {
            $table->enum('category', ['iphone', 'android', 'global'])->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('dynamic_parameters', function (Blueprint $table) {
            $table->enum('category', ['iphone', 'android', 'global', 'all'])->change();
        });
    }
};