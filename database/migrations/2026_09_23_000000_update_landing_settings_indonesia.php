<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Normalize landing page copy to Indonesian and fix the store address spelling.
     */
    public function up(): void
    {
        DB::table('general_settings')->update([
            'company_name' => 'Daily Phone',
            'landing_tagline' => 'iPhone Berkualitas. Harga Bersahabat.',
            'landing_description' => 'iPhone baru & terawat, bergaransi resmi, bisa tukar tambah.',
            'store_address' => 'Pekojan, Jakarta Barat',
        ]);
    }

    public function down(): void
    {
        // No automated revert needed; values are managed from Settings → Company & Identity.
    }
};