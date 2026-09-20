<?php

namespace Tests\Feature;

use App\Models\GeneralSetting;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AiLiveToolsGateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        GeneralSetting::create([
            'ai_model' => 'gemini-3.5-flash-lite',
        ]);
    }

    #[DataProvider('queriesProvider')]
    public function test_wants_live_tools_decides_per_query_intent(string $query, bool $expected): void
    {
        $service = app(GeminiAssistantService::class);
        $method = new \ReflectionMethod($service, 'wantsLiveTools');

        $this->assertSame($expected, $method->invoke($service, $query), $query);
    }

    public static function queriesProvider(): array
    {
        return [
            // Live store reads — tools must stay on (rows are fetched on demand).
            'stock in bahasa' => ['Apa stok iPhone 13 128GB yang ready hari ini?', true],
            'stock in english' => ['Is there any iPhone 13 128GB available right now?', true],
            'today sales' => ['Ringkasan penjualan toko hari ini?', true],
            'customer lookup' => ['Siapa pelanggan dengan nomor 08123456789?', true],
            'aging audit' => ['Tampilkan stok aging lebih dari 45 hari.', true],
            'warranty check' => ['iPhone kena air, masih garansi?', true],
            'unit search by imei' => ['Cek unit dengan IMEI 358729104829104', true],

            // Store mutations / recordings — action proposals must never be lost.
            'money note' => ['Catat pengeluaran buat listrik bulan ini.', true],
            'sell a unit' => ['Jadikan terjual iPhone 12 128GB itu, laku 6 juta cash.', true],
            'add stock' => ['Tambah 10 unit stok dummy sekaligus.', true],
            'adjust price' => ['Koreksi harga iPhone 13 jadi 7.599.000.', true],
            'proposal' => ['Buatkan proposal promo untuk iPhone 13.', true],
            'transfer' => ['Kirim 3 unit dari PERENG ke cabang Gatot.', true],

            // General chat / marketing / memory — single fast round-trip, no tools.
            'greeting' => ['Halo, selamat pagi Singgih!', false],
            'general knowledge' => ['Jelaskan cara kerja RAM pada smartphone.', false],
            'marketing copy' => ['Buatkan caption promosi buat postingan IG.', false],
            'reasoning' => ['Mana yang lebih worth antara beli baru atau second?', false],
            'personal memory' => ['Besok jemput kakak di stasiun pukul 8 pagi.', false],
            'world fact' => ['Apa ibu kota dari negara Portugal?', false],
        ];
    }
}
