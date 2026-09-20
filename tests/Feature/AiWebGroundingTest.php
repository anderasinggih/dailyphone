<?php

namespace Tests\Feature;

use App\Models\GeneralSetting;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AiWebGroundingTest extends TestCase
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
    public function test_wants_web_grounding_decides_per_query_intent(string $query, bool $expected): void
    {
        $service = app(GeminiAssistantService::class);
        $method = new \ReflectionMethod($service, 'wantsWebGrounding');
        $method->setAccessible(true);

        $this->assertSame($expected, $method->invoke($service, $query), $query);
    }

    public static function queriesProvider(): array
    {
        return [
            // Store/ops questions — must stay fast, no web search.
            'stock in bahasa' => ['Apa stok iPhone 13 128GB yang ready hari ini?', false],
            'stock in english' => ['Is there any iPhone 13 128GB available right now?', false],
            'today sales' => ['Ringkasan penjualan toko hari ini?', false],
            'customer lookup' => ['Siapa pelanggan dengan nomor 08123456789?', false],
            'money note' => ['Catat pengeluaran buat listrik bulan ini.', false],
            'warranty' => ['iPhone kena air, masih garansi?', false],
            'shift' => ['Jam berapa aku masuk shift pagi ini?', false],
            'inventory aging' => ['Tampilkan stok aging lebih dari 45 hari.', false],

            // Web/current/world info — grounding should stay on.
            'explicit web search' => ['Cari di google harga iphone 16 sekarang', true],
            'news in bahasa' => ['Baca berita terbaru teknologi smartphone', true],
            'market price' => ['Berapa harga pasaran iPhone 12 saat ini?', true],
            'kurs' => ['Berapa kurs dollar hari ini?', true],
            'trend topic' => ['Apa saja yang lagi viral di tiktok?', true],
            'weather' => ['Bagaimana cuaca di Purwokerto?', true],
            'news in english' => ['Tell me the latest breaking news', true],
        ];
    }
}
