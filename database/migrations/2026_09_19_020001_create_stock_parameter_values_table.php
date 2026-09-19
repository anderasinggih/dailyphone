<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * EAV table: arbitrary dynamic parameter values attached to a stock unit.
     * Enables truly dynamic spec fields (Color, Memory, License, Item Condition,
     * etc.) defined in Settings → Parameters without schema changes.
     */
    public function up(): void
    {
        Schema::create('stock_parameter_values', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_id')->constrained('stocks')->cascadeOnDelete();
            $table->foreignId('parameter_id')->constrained('dynamic_parameters')->cascadeOnDelete();
            $table->foreignId('value_id')->constrained('dynamic_parameter_values')->cascadeOnDelete();
            $table->unique(['stock_id', 'parameter_id']);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('stock_parameter_values');
    }
};