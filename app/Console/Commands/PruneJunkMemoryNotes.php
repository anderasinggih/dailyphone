<?php

namespace App\Console\Commands;

use App\Models\AiTrainingNote;
use App\Services\AiMemoryGraphService;
use Illuminate\Console\Command;

class PruneJunkMemoryNotes extends Command
{
    protected $signature = 'ai:prune-junk-memory {--delete : Actually delete the junk nodes (default is a dry run)}';

    protected $description = 'Remove AI memory nodes that were polluted with the assistant\'s own chat acknowledgments instead of real facts';

    public function handle(AiMemoryGraphService $graph): int
    {
        $notes = AiTrainingNote::orderBy('id')->get(['id', 'title', 'content', 'kind']);

        $junk = $notes->filter(fn ($n) => $this->isJunkContent((string) $n->content));

        if ($junk->isEmpty()) {
            $this->info('No junk memory nodes found. Your memory is clean.');

            return self::SUCCESS;
        }

        $this->warn(sprintf(
            '%d candidate junk node(s) found%s:',
            $junk->count(),
            $this->option('delete') ? '' : ' (dry run — add --delete to remove)'
        ));

        foreach ($junk as $note) {
            $short = mb_strimwidth(preg_replace('/\s+/', ' ', (string) $note->content), 0, 110, '…');
            $this->line(sprintf('  #%d [%s] %s', $note->id, $note->kind, $short));

            if ($this->option('delete')) {
                $graph->pruneLinksFor($note->id);
                $note->delete();
            }
        }

        if ($this->option('delete')) {
            $this->info("Deleted {$junk->count()} junk node(s).");
        }

        return self::SUCCESS;
    }

    /**
     * Fingerprint of the old reconcileMemoClaims() bug: a node whose content is
     * the model's own storage confirmation ("berhasil dicatat", "tersimpan",
     * "node baru ...", "saya perbarui ...") rather than a real fact. Two or more
     * distinct acknowledgment signals are required so legitimate memories that
     * merely mention "dicatat" are never touched.
     */
    protected function isJunkContent(string $content): bool
    {
        $text = mb_strtolower(trim($content));

        $signals = [
            '/\b(?:kucatat|kusimpan|kuingat|kurekam)\b/',
            '/\b(?:berhasil|sudah|telah)\s+(?:di|ter|ku|saya\s+)?(?:catat|simp[ae]n|ingat|rekam)\b/',
            '/\b(?:tersimp[ae]n|tercatat)\b/',
            '/\bnode\s+baru\b/',
            '/\b(?:saya|aku|kamu)\s+(?:beri\s+nama|langsung\s+catat|perbarui)\b/',
            '/\s📝/',
            '/\bmohon\s+maaf[^.]*tersimp[ae]n/',
        ];

        $hits = 0;
        foreach ($signals as $pattern) {
            if (preg_match($pattern, $text)) {
                $hits++;
            }
        }

        // Two or more signals, or one strong signal on a very short text (a
        // bare acknowledgment like "NIM Dewi berhasil dicatat." holds no fact).
        return $hits >= 2 || ($hits >= 1 && mb_strlen($content) <= 60);
    }
}