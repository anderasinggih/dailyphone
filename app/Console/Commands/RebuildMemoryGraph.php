<?php

namespace App\Console\Commands;

use App\Services\AiMemoryGraphService;
use Illuminate\Console\Command;

class RebuildMemoryGraph extends Command
{
    protected $signature = 'ai:rebuild-memory {--force : Rebuild even when no training notes exist}';

    protected $description = 'Rebuild all AI memory graph synapses with typed relations and weights';

    public function handle(AiMemoryGraphService $graph): int
    {
        if (\App\Models\AiTrainingNote::count() === 0 && !$this->option('force')) {
            $this->warn('No AI training notes yet — nothing to rebuild.');

            return self::SUCCESS;
        }

        $created = $graph->rebuildAllLinks();

        $this->info("Neuron map rebuilt: {$created} synapses created.");

        return self::SUCCESS;
    }
}