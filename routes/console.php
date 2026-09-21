<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();

// Weekly AI brain maintenance:
//  - evaluate the golden dataset so accuracy trends are visible (item 6);
//  - consolidate memory (dedupe / promote / retire, item 10), then re-embed so
//    the semantic index reflects the freshly merged & promoted nodes (item 1).
Schedule::command('ai:evaluate')->weeklyOn(1, '03:00')->withoutOverlapping();

Schedule::command('ai:consolidate-memory')
    ->weeklyOn(1, '03:30')
    ->withoutOverlapping()
    ->then(fn () => Artisan::call('ai:embed-backfill'));

// Daily storage hygiene: sweep orphaned chat-attachment rows + blobs, stray
// ai-uploads/ai-projects blobs and stale ai-repos temp trees left behind by
// DB-level cascades or interrupted requests.
Schedule::command('ai:cleanup-storage --delete')
    ->dailyAt('04:00')
    ->withoutOverlapping();
