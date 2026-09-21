<?php

namespace App\Console\Commands;

use App\Models\AiChatAttachment;
use App\Models\AiProjectFile;
use Illuminate\Console\Command;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

class CleanupAiStorageCommand extends Command
{
    protected $signature = 'ai:cleanup-storage
        {--delete : Actually delete files/rows; default is a dry run}
        {--prune-generated : Also prune old artifacts under storage/app/ai_generated}
        {--generated-days=30 : Keep generated artifacts newer than this many days when pruning}';

    protected $description = 'Remove orphaned AI storage: chat attachments, stray uploads, stale temp repos and old generated artifacts';

    public function handle(): int
    {
        $commit = (bool) $this->option('delete');
        $mode = $commit ? 'DELETE' : 'DRY RUN';
        $disk = Storage::disk('local');

        $this->info("AI storage cleanup ({$mode}, disk root: {$disk->path('')})");
        $this->newLine();

        $this->orphanAttachments($commit);
        $this->draftAttachments($commit);
        $this->strayBlobs($commit, $disk, 'ai-uploads', AiChatAttachment::class);
        $this->strayBlobs($commit, $disk, 'ai-projects', AiProjectFile::class);
        $this->staleRepos($commit, $disk);

        if ($this->option('prune-generated')) {
            $this->generatedArtifacts($commit, (int) $this->option('generated-days'));
        } else {
            $this->line('Generated artifacts skipped — pass --prune-generated to include them.');
        }

        $this->newLine();
        $this->info('Done.');

        return self::SUCCESS;
    }

    /**
     * Attachment rows pointing at sessions/chats that no longer exist. These
     * appear when a deletion happened at the DB level (e.g. removing a user),
     * where Eloquent observers never ran and the FK-less ai_chat_attachments
     * rows were left behind alongside their blobs.
     */
    protected function orphanAttachments(bool $commit): void
    {
        $orphans = AiChatAttachment::query()
            ->where(function ($q) {
                $q->whereNotNull('session_id')->whereDoesntHave('session')
                    ->orWhereNotNull('ai_chat_id')->whereDoesntHave('chat');
            })
            ->get();

        $this->warn(sprintf('Orphan attachments (dead session/chat refs): %d %s', $orphans->count(), $this->suffix()));

        if ($commit && $orphans->isNotEmpty()) {
            AiChatAttachment::deleteBatchWithBlobs($orphans);
        }
    }

    /**
     * Attachments uploaded but never attached to a sent message. They sit
     * unlinked (no session/chat) until the user sends the message, so only
     * touch the ones older than 24h.
     */
    protected function draftAttachments(bool $commit): void
    {
        $drafts = AiChatAttachment::query()
            ->whereNull('session_id')
            ->whereNull('ai_chat_id')
            ->where('created_at', '<', now()->subHours(24))
            ->get();

        $this->warn(sprintf('Unattached draft attachments (>24h): %d %s', $drafts->count(), $this->suffix()));

        if ($commit && $drafts->isNotEmpty()) {
            AiChatAttachment::deleteBatchWithBlobs($drafts);
        }
    }

    /**
     * Blobs under a disk folder that no DB row references any more (uploaded,
     * then the row was removed by a cascade or an interrupted request).
     */
    protected function strayBlobs(bool $commit, Filesystem $disk, string $folder, string $model): void
    {
        $known = $model::query()->whereNotNull('storage_path')->pluck('storage_path')->flip();

        $stray = [];
        foreach ($disk->allFiles($folder) as $path) {
            if (! isset($known[$path])) {
                $stray[] = $path;
            }
        }

        $this->warn(sprintf('Stray blobs in %s/: %d %s', $folder, count($stray), $this->suffix()));

        foreach ($stray as $i => $path) {
            if ($i >= 30) {
                $this->line(sprintf('    … and %d more', count($stray) - 30));
                break;
            }
            $this->line(sprintf('    • %s (%s)', $path, $disk->size($path)));
        }

        if ($commit) {
            foreach ($stray as $path) {
                $disk->delete($path);
            }
        }
    }

    /**
     * Temp repo trees (zipped + extracted source) left behind if the PHP
     * process died mid-ingest. Normal runs already clean themselves in a
     * finally block, so only very old leftovers are considered truly stale.
     */
    protected function staleRepos(bool $commit, Filesystem $disk): void
    {
        $cutoff = now()->subHours(24)->getTimestamp();

        $stale = collect($disk->directories('ai-repos'))
            ->filter(fn ($dir) => $disk->lastModified($dir) < $cutoff)
            ->values();

        $this->warn(sprintf('Stale ai-repos temp dirs (>24h): %d %s', $stale->count(), $this->suffix()));

        foreach ($stale as $dir) {
            $this->line(sprintf('    • %s', $dir));
            if ($commit) {
                $disk->deleteDirectory($dir);
            }
        }
    }

    /**
     * Old Python output dirs + inline images, and empty leftover dirs in the
     * script area. Opt-in stage (default keeps everything, since some outputs
     * are still previewable from old runs).
     */
    protected function generatedArtifacts(bool $commit, int $generatedDays): void
    {
        $cutoff = now()->subDays($generatedDays)->getTimestamp();

        $old = collect(File::allFiles(storage_path('app/ai_generated')))
            ->filter(fn ($file) => File::lastModified($file->getRealPath()) < $cutoff)
            ->values();

        $this->warn(sprintf('Old generated artifacts (>%dd): %d %s', $generatedDays, $old->count(), $this->suffix()));

        foreach ($old as $i => $file) {
            $this->line(sprintf('    • %s', $file->getRelativePathname()));
            if ($commit) {
                File::delete($file->getRealPath());
            }
            if ($i >= 30) {
                $this->line('    … and more');
                break;
            }
        }

        foreach ([storage_path('app/ai_generated'), storage_path('app/ai_scripts')] as $dir) {
            foreach (File::directories($dir) as $sub) {
                if (File::isEmptyDirectory($sub)) {
                    $this->line(sprintf('    • (empty dir) %s', $sub));
                    if ($commit) {
                        File::deleteDirectory($sub);
                    }
                } else {
                    $this->pruneRotatedEmptyDirs($sub, $commit);
                }
            }
        }
    }

    /**
     * Nested output dirs (e.g. ai_generated/images/{runId}) whose only leftover
     * runs are already deleted can keep the tree tidy without touching anything
     * still in use.
     */
    protected function pruneRotatedEmptyDirs(string $dir, bool $commit): void
    {
        foreach (File::directories($dir) as $sub) {
            if (File::isEmptyDirectory($sub)) {
                $this->line(sprintf('    • (empty dir) %s', $sub));
                if ($commit) {
                    File::deleteDirectory($sub);
                }
            } else {
                $this->pruneRotatedEmptyDirs($sub, $commit);
            }
        }
    }

    protected function suffix(): string
    {
        return $this->option('delete') ? '→ will delete' : '(dry run)';
    }
}
