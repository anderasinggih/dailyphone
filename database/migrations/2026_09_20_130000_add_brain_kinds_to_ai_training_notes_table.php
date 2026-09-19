<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Expand the AI memory taxonomy from 2 rough buckets (rule / knowledge) into
     * a full "brain" of typed neurons: rule, validation, condition, emotions,
     * note, memory, preference, identity, goal, warning. Each kind is rendered
     * with its own color in the mind map so every neuron's role is readable at
     * a glance. The legacy 'knowledge' bucket becomes the generic 'note' kind.
     */
    public function up(): void
    {
        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->string('kind', 24)->default('note')->change();
        });

        DB::table('ai_training_notes')
            ->where('kind', 'knowledge')
            ->update(['kind' => 'note']);
    }

    public function down(): void
    {
        DB::table('ai_training_notes')
            ->where('kind', 'note')
            ->update(['kind' => 'knowledge']);

        Schema::table('ai_training_notes', function (Blueprint $table) {
            $table->string('kind', 16)->default('knowledge')->change();
        });
    }
};