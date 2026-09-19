<?php

namespace App\Console\Commands;

use App\Services\AiBrainMaintenanceService;
use Illuminate\Console\Command;

/**
 * Weekly memory-consolidation job (item 10). Dedupes overlapping neurons,
 * merges repeated validation patterns (proposal feedback) into one strong
 * node, and retires stale unused knowledge so the embedding index stays
 * clean instead of growing into redundant noise.
 */
class AiConsolidateMemoryCommand extends Command
{
    protected $signature = 'ai:consolidate-memory {--dedupe=0.92 : Cosine/Jaccard threshold for near-duplicate nodes} {--retire-after=120 : Days an unused knowledge node may survive}';

    protected $description = 'Dedupe similar neurons, promote repeated patterns, and retire stale memory';

    public function handle(AiBrainMaintenanceService $maintenance): int
    {
        $this->info('Consolidating the memory brain…');

        $threshold = min(1.0, max(0.5, (float)$this->option('dedupe')));
        $after = max(14, (int)$this->option('retire-after'));

        $result = $maintenance->consolidate($threshold, $after);

        $this->table(
            ['Metric', 'Count'],
            [
                ['Neurons scanned', $result['scanned']],
                ['Deduped (merged into survivor)', $result['deduped']],
                ['Repeated patterns promoted', $result['promoted']],
                ['Stale neurons retired', $result['retired']],
            ]
        );

        $this->info('Consolidation complete.');

        return self::SUCCESS;
    }
}