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
        $stocksColumns = [
            'grade',
            'imei_2',
            'ktp_number',
            'ktp_name',
            'ktp_photo_path',
            'brand_rebate_status',
        ];

        Schema::table('stocks', function (Blueprint $table) use ($stocksColumns) {
            // Drop unique constraint on imei_2 if it exists before dropping column (fixes SQLite index collision)
            try {
                $table->dropUnique(['imei_2']);
            } catch (\Throwable $e) {
                // Ignore if index doesn't exist
            }

            foreach ($stocksColumns as $column) {
                if (Schema::hasColumn('stocks', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        if (Schema::hasColumn('sales', 'void_requested')) {
            Schema::table('sales', function (Blueprint $table) {
                $table->dropColumn('void_requested');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('stocks', function (Blueprint $table) {
            $table->string('grade')->nullable()->after('license_id');
            $table->string('imei_2')->nullable()->unique()->after('imei_1');
            $table->string('ktp_number')->nullable()->after('status');
            $table->string('ktp_name')->nullable()->after('ktp_number');
            $table->string('ktp_photo_path')->nullable()->after('ktp_name');
            $table->enum('brand_rebate_status', ['none', 'pending', 'claimed', 'received'])->default('none')->after('ktp_photo_path');
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->boolean('void_requested')->default(false)->after('affiliate_fee');
        });
    }
};
