<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. General settings table
        Schema::create('general_settings', function (Blueprint $table) {
            $table->id();
            $table->string('company_name')->default('Daily Phone');
            $table->time('work_start_time')->default('09:00:00');
            $table->time('work_end_time')->default('18:00:00');
            $table->integer('grace_period_minutes')->default(15);
            $table->boolean('geofence_lock_enabled')->default(true);
            $table->timestamps();
        });

        // Seed default general settings
        DB::table('general_settings')->insert([
            'company_name' => 'Daily Phone',
            'work_start_time' => '09:00:00',
            'work_end_time' => '18:00:00',
            'grace_period_minutes' => 15,
            'geofence_lock_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2. Employee schedules table
        Schema::create('employee_schedules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('store_id')->constrained('stores')->onDelete('cascade');
            $table->time('work_start_time')->nullable(); // overrides default settings
            $table->time('work_end_time')->nullable();   // overrides default settings
            $table->integer('grace_period_minutes')->nullable(); // overrides default settings
            $table->timestamps();
        });

        // 3. Add columns to attendances
        Schema::table('attendances', function (Blueprint $table) {
            $table->integer('late_minutes')->default(0)->after('status');
            $table->integer('work_minutes')->default(0)->after('late_minutes');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn(['late_minutes', 'work_minutes']);
        });
        Schema::dropIfExists('employee_schedules');
        Schema::dropIfExists('general_settings');
    }
};
