<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->boolean('landing_enabled')->default(true)->after('notification_emails');
            $table->string('landing_tagline')->nullable()->after('landing_enabled');
            $table->text('landing_description')->nullable()->after('landing_tagline');
            $table->string('instagram_handle')->nullable()->after('landing_description');
            $table->string('instagram_url')->nullable()->after('instagram_handle');
            $table->string('whatsapp_number')->nullable()->after('instagram_url');
            $table->string('store_address')->nullable()->after('whatsapp_number');
            $table->json('instagram_embeds')->nullable()->after('store_address');
        });

        // Backfill sensible defaults for rows that existed before this migration,
        // since ALTER TABLE only applies them to newly created records.
        DB::table('general_settings')->update([
            'landing_enabled' => true,
            'landing_tagline' => 'iPhone Berkualitas. Harga Bersahabat.',
            'landing_description' => 'iPhone baru & terawat, bergaransi resmi, bisa tukar tambah.',
            'instagram_handle' => 'dailyphone.store',
            'instagram_url' => 'https://www.instagram.com/dailyphone.store/',
            'whatsapp_number' => '0881010229772',
            'store_address' => 'Pekojan, Jakarta Barat',
            'instagram_embeds' => json_encode([]),
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('general_settings', function (Blueprint $table) {
            $table->dropColumn([
                'landing_enabled',
                'landing_tagline',
                'landing_description',
                'instagram_handle',
                'instagram_url',
                'whatsapp_number',
                'store_address',
                'instagram_embeds',
            ]);
        });
    }
};