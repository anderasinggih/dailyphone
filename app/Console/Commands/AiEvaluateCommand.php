<?php

namespace App\Console\Commands;

use App\Models\AiEvaluation;
use App\Services\GeminiAssistantService;
use Illuminate\Console\Command;

/**
 * Weekly golden-dataset evaluation (item 6).
 *
 * Scores the assistant against a set of known Q&A pairs and persists the
 * per-item pass/fail so accuracy can be tracked across model & retrieval
 * changes instead of being guessed at. Intentionally deterministic: answers are
 * judged by required fact fragments, not by whether the answer "sounds right".
 */
class AiEvaluateCommand extends Command
{
    protected $signature = 'ai:evaluate {--limit=0 : Only run the first N questions (0 = all)}';

    protected $description = 'Run the assistant against the golden Q&A dataset and store the score';

    public function handle(GeminiAssistantService $gemini): int
    {
        $model = $gemini->getModel();

        if (!$gemini->isConfigured()) {
            $this->error('Gemini is not configured — set an API key in Settings > General > AI first.');

            return self::FAILURE;
        }

        $dataset = $this->dataset();
        $limit = (int)$this->option('limit');
        if ($limit > 0) {
            $dataset = array_slice($dataset, 0, $limit);
        }

        $this->info("Evaluating {$model} against " . count($dataset) . ' golden Q&A items…');

        $items = [];
        $passed = 0;
        $start = microtime(true);
        $totalTokens = 0;

        foreach ($dataset as $index => $item) {
            $question = $item['q'];
            $must = $item['must'];

            $this->line('  [' . str_pad((string)($index + 1), 2, '0', STR_PAD_LEFT) . '] ' . mb_strimwidth($question, 0, 80, '…'));

            $itemStart = microtime(true);
            $answer = '';

            try {
                $result = $gemini->chat(
                    [['role' => 'user', 'content' => $question]],
                    null,
                    null,
                    $question,
                    null,
                    null,
                    '',
                    $model
                );
                $answer = trim((string)($result['reply'] ?? ''));
                $usage = $result['usage'] ?? [];
                $totalTokens += (int)($usage['total_tokens'] ?? 0);
            } catch (\Throwable $e) {
                $this->error('      threw: ' . $e->getMessage());
            }

            $answerLower = mb_strtolower($answer);
            $missing = array_values(array_filter($must, fn (string $frag) => !str_contains($answerLower, mb_strtolower($frag))));
            $ok = $missing === [] && $answer !== '';

            if ($ok) {
                $passed++;
                $this->info('      ✓ pass');
            } else {
                $this->warn('      ✗ fail — missing: ' . implode(', ', $missing) . ' | answer: ' . mb_strimwidth($answer, 0, 120, '…'));
            }

            $items[] = [
                'q' => $question,
                'must' => $must,
                'passed' => $ok,
                'missing' => $missing,
                'answer' => mb_substr($answer, 0, 800),
                'latency_ms' => (int)round((microtime(true) - $itemStart) * 1000),
            ];

            if (($index + 1) % 5 === 0) {
                $this->line('  — ' . $passed . ' / ' . ($index + 1) . ' so far');
            }
        }

        $score = $dataset === [] ? 0.0 : round(($passed / count($dataset)) * 100, 2);

        AiEvaluation::create([
            'run_key' => date('Y-W') . '_' . substr(md5($model . $passed), 0, 6),
            'model' => $model,
            'total_items' => count($dataset),
            'passed_items' => $passed,
            'score' => $score,
            'latency_ms' => (int)round((microtime(true) - $start) * 1000),
            'total_tokens' => $totalTokens,
            'items' => $items,
        ]);

        $this->newLine();
        $this->info("Done: {$passed}/" . count($dataset) . " passed ({$score}%). Model: {$model}");

        return self::SUCCESS;
    }

    /**
     * Golden Q&A pairs. `must` are lower-cased fact fragments the answer has to
     * contain for the item to count as passed. Kept deliberately independent of
     * volatile live numbers (prices / counts) so results stay comparable across
     * runs while still exercising the store-retail brain.
     *
     * @return array<int, array{q: string, must: string[]}>
     */
    protected function dataset(): array
    {
        return [
            ['q' => 'Apa itu aging stock?', 'must' => ['45', 'hari']],
            ['q' => 'Kenapa IMEI wajib dicek sebelum unit terjual?', 'must' => ['imei', '15']],
            ['q' => 'Sebutkan metode pembayaran yang tersedia di toko.', 'must' => ['cash', 'qris']],
            ['q' => 'Apa perbedaan kondisi unit New dan Second?', 'must' => ['new', 'second']],
            ['q' => 'Kalau unit sudah lebih dari 45 hari di stok, apa yang disarankan?', 'must' => ['promo']],
            ['q' => 'Siapa yang boleh mengeksekusi aksi perubahan data?', 'must' => ['superadmin']],
            ['q' => 'Sebutkan beberapa contoh kategori pengeluaran kas toko.', 'must' => ['operasional']],
            ['q' => 'Apa saja jenis lisensi unit yang dikenal?', 'must' => ['ibox', 'bea cukai']],
            ['q' => 'Data apa saja yang wajib ada saat mencatat penjualan unit?', 'must' => ['pembeli', 'metode']],
            ['q' => 'Apa fungsi pencatatan nomor seri dan IMEI pada unit?', 'must' => ['garansi']],
            ['q' => 'Kenapa tidak boleh mengarang nama pembeli saat mencatat penjualan?', 'must' => ['tidak']],
            ['q' => 'Bagaimana cara mengecek unit yang sudah lama tidak terjual?', 'must' => ['aging']],
            ['q' => 'Sebutkan status unit yang tersedia dalam sistem stok.', 'must' => ['available', 'sold']],
            ['q' => 'Apa yang dimaksud dengan validasi sebelum aksi (validation neuron)?', 'must' => ['verifikasi', 'aksi']],
            ['q' => 'Kapan harus menawarkan promo untuk unit yang lambat bergerak?', 'must' => ['45 hari']],
            ['q' => 'Metode pembayaran QRIS termasuk kategori apa?', 'must' => ['online', 'qris']],
            ['q' => 'Apa yang harus dilakukan jika AI tidak yakin soal harga atau stok?', 'must' => ['yakin', 'cek']],
            ['q' => 'Sebutkan salah satu contoh fakta yang layak diingat sebagai memori.', 'must' => ['pelanggan']],
            ['q' => 'Kenapa penting mencatat nomor HP pembeli?', 'must' => ['garansi', 'crm']],
            ['q' => 'Apa fungsi fitur tindakan aksi (action proposal) pada AI?', 'must' => ['konfirmasi']],
        ];
    }
}