<?php

namespace App\Services;

use App\Models\AiProject;
use App\Models\AiProjectFile;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Bridges a project's file tree with a remote git repository.
 *
 * Responsibilities:
 *  - Clone / fetch a remote repo into a working directory on disk so the
 *    Explorer + editor views read real repository content.
 *  - Import the working clone into ai_project_files rows (idempotently) so the
 *    workspace shows the repo as a browsable, editable file tree.
 *  - Write back user/AI edits (blobs under ai-projects/) into the working
 *    clone and run `git add` / `git commit` / `git push` so Accepted changes
 *    land on GitHub.
 *
 * Git operations run through the ambient git environment on the server, so
 * push auth is whatever git is configured with (SSH key, credential helper,
 * or a personal access token stored in the git credential store).
 */
class GitRepoService
{
    public const REPO_ROOT = 'ai-repos';

    /** Directories that are never imported into the file tree. */
    public const SKIP_DIRS = [
        '.git',
        'node_modules',
        'vendor',
        '.venv',
        'venv',
        '__pycache__',
        '.cache',
        '.next',
        '.turbo',
        'dist',
        'build',
        '.DS_Store',
        'storage/logs',
    ];

    /** File patterns never imported (tracked as dotfiles can still show fine). */
    public const SKIP_FILES = [
        '.DS_Store',
        'Thumbs.db',
    ];

    protected function repoDir(AiProject $project): string
    {
        return self::REPO_ROOT . '/project-' . $project->id;
    }

    protected function repoFullPath(AiProject $project): string
    {
        return storage_path('app/private/' . $this->repoDir($project));
    }

    protected function checkoutUrl(AiProject $project): string
    {
        if (! $project->repo_url) {
            throw new \RuntimeException('Project is not connected to a repository.');
        }

        return trim($project->repo_url);
    }

    /**
     * Ensure a working clone exists for the project. Clones the first time and
     * fetches + checks out the target branch afterwards.
     *
     * If the requested branch does not exist on the remote (a repo that uses
     * "master" instead of "main", for example), the clone falls back to the
     * remote's default branch and the project's repo_branch is corrected so
     * the UI shows the real branch.
     *
     * @return string absolute path to the working clone
     */
    public function ensureClone(AiProject $project): string
    {
        $dir = $this->repoFullPath($project);
        $url = $this->checkoutUrl($project);
        $requested = $project->repo_branch ?: null;

        if (! is_dir($dir . '/.git')) {
            if (is_dir($dir)) {
                @exec('rm -rf ' . escapeshellarg($dir));
            }
            if (! @mkdir($dir, 0755, true) && ! is_dir($dir)) {
                throw new \RuntimeException('Could not create the repository directory.');
            }

            // 1) Try the requested branch explicitly.
            if ($requested !== null && $requested !== '') {
                $output = [];
                $code = 0;
                exec(sprintf(
                    'git clone --branch %s --single-branch %s %s 2>&1',
                    escapeshellarg($requested),
                    escapeshellarg($url),
                    escapeshellarg($dir)
                ), $output, $code);

                if ($code === 0 && is_dir($dir . '/.git')) {
                    return $this->reindexBranch($project, $dir);
                }

                // Branch did not exist (or another clone error): retry on the
                // remote default branch below.
                @exec('rm -rf ' . escapeshellarg($dir));
                if (is_dir($dir)) {
                    @rmdir($dir);
                }
            }

            // 2) Fallback: clone with the remote's default branch.
            $output = [];
            $code = 0;
            exec(sprintf('git clone %s %s 2>&1', escapeshellarg($url), escapeshellarg($dir)), $output, $code);

            if ($code !== 0 || ! is_dir($dir . '/.git')) {
                $message = trim(implode("\n", array_slice($output, -4)));
                if ($message === '') {
                    $first = trim(implode("\n", array_slice($output, 0, 3)));
                    $message = $first !== '' ? $first : "Could not clone repository from {$url}.";
                }
                @exec('rm -rf ' . escapeshellarg($dir));
                throw new \RuntimeException($message);
            }

            return $this->reindexBranch($project, $dir);
        }

        // Existing clone: fetch and move onto the requested branch without
        // clobbering local uncommitted workspace changes.
        $this->run($project, ['git', 'fetch', 'origin'], $dir, true);

        $branch = $requested ?: 'main';
        if (! $this->branchExists($dir, $branch)) {
            $default = $this->defaultRemoteBranch($dir);
            if ($default !== null && $default !== '') {
                $branch = $default;
                $project->update(['repo_branch' => $branch]);
            }
        }
        if ($this->branchExists($dir, $branch)) {
            $this->run($project, ['git', 'checkout', $branch], $dir, true);
        }

        return $dir;
    }

    protected function reindexBranch(AiProject $project, string $dir): string
    {
        $actual = $this->currentBranch($dir);
        if ($actual !== null && $actual !== $project->repo_branch) {
            $project->update(['repo_branch' => $actual]);
        }

        return $dir;
    }

    protected function currentBranch(string $cwd): ?string
    {
        $output = [];
        $code = 0;
        exec('git -C ' . escapeshellarg($cwd) . ' rev-parse --abbrev-ref HEAD 2>/dev/null', $output, $code);

        return ($code === 0 && isset($output[0]) && $output[0] !== 'HEAD') ? trim($output[0]) : null;
    }

    protected function branchExists(string $cwd, string $branch): bool
    {
        $output = [];
        $code = 0;
        exec(
            'git -C ' . escapeshellarg($cwd) . ' rev-parse --verify ' . escapeshellarg('origin/' . $branch) . ' 2>/dev/null',
            $output,
            $code
        );

        return $code === 0;
    }

    protected function defaultRemoteBranch(string $cwd): ?string
    {
        $output = [];
        $code = 0;
        exec(
            'git -C ' . escapeshellarg($cwd) . ' symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null',
            $output,
            $code
        );

        if ($code === 0 && isset($output[0])) {
            return str_replace('origin/', '', trim($output[0]));
        }

        return null;
    }

    public function pull(AiProject $project): string
    {
        $dir = $this->ensureClone($project);
        $this->run($project, ['git', 'pull', '--ff-only'], $dir);

        return $dir;
    }

    /**
     * Import the working clone into ai_project_files (idempotent). Rows are
     * matched by their storage_path under the repo dir, so re-importing after
     * a pull only adds rows for brand-new files.
     */
    public function importIntoTree(AiProject $project, User $user): void
    {
        $dir = $this->ensureClone($project);
        $prefix = $this->repoDir($project);

        $existing = AiProjectFile::where('project_id', $project->id)->get()->keyBy('storage_path');

        $this->importDirectory($project, $user, $dir, null, '', $existing);

        $project->update([
            'repo_imported' => true,
            'repo_error' => null,
        ]);
    }

    protected function importDirectory(
        AiProject $project,
        User $user,
        string $fullDir,
        ?int $parentId,
        string $relPrefix,
        \Illuminate\Support\Collection $existing
    ): void {
        $entries = scandir($fullDir);
        if ($entries === false) {
            return;
        }

        // Folders first, alphabetically — mirrors the native tree ordering.
        $folders = [];
        $files = [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $full = $fullDir . '/' . $entry;
            $rel = ($relPrefix !== '' ? $relPrefix . '/' : '') . $entry;
            $storage = $this->storagePathFor($project, $rel);

            if (is_dir($full)) {
                if (in_array($entry, self::SKIP_DIRS, true)) {
                    continue;
                }
                $folders[] = ['entry' => $entry, 'full' => $full, 'rel' => $rel, 'storage' => $storage];
            } else {
                if (in_array($entry, self::SKIP_FILES, true)) {
                    continue;
                }
                $files[] = ['entry' => $entry, 'full' => $full, 'rel' => $rel, 'storage' => $storage];
            }
        }

        foreach ($folders as $f) {
            $folder = $this->upsertRow($project, $user, $parentId, $existing, $f['entry'], $f['storage'], true);
            if ($folder !== null) {
                $this->importDirectory($project, $user, $f['full'], (int) $folder->id, $f['rel'], $existing);
            }
        }

        foreach ($files as $f) {
            $bytes = @filesize($f['full']) ?: 0;
            $ext = strtolower(pathinfo($f['entry'], PATHINFO_EXTENSION));
            $ingest = app(AiFileIngestService::class);
            $kind = $ingest->classify($f['entry'], mime_content_type($f['full']) ?: 'application/octet-stream');

            $record = $this->upsertRow($project, $user, $parentId, $existing, $f['entry'], $f['storage'], false);
            if ($record === null) {
                continue;
            }

            $record->update([
                'mime_type' => mime_content_type($f['full']) ?: 'application/octet-stream',
                'size_bytes' => $bytes,
                'kind' => $kind,
                'extracted_text' => null,
                'content_hash' => md5_file($f['full']) ?: null,
                'change_type' => null,
                'changed_at' => null,
            ]);
        }

        $project->touch();
    }

    protected function upsertRow(
        AiProject $project,
        User $user,
        ?int $parentId,
        \Illuminate\Support\Collection $existing,
        string $name,
        string $storage,
        bool $isFolder
    ): ?AiProjectFile {
        $row = $existing->get($storage);
        if ($row) {
            return $row;
        }

        return AiProjectFile::create([
            'user_id' => $user->id,
            'project_id' => $project->id,
            'parent_id' => $parentId,
            'name' => $name,
            'is_folder' => $isFolder,
            'storage_path' => $storage,
        ]);
    }

    protected function storagePathFor(AiProject $project, string $relative): string
    {
        return $this->repoDir($project) . '/' . $relative;
    }

    /**
     * Write the project's mutable rows (blobs under ai-projects/) back into the
     * working clone, then stage, commit and push. Returns the git command
     * output so the UI can mirror what happened.
     *
     * @return array{output: string, committed: int} number of committed files
     */
    public function commitAndPush(AiProject $project): array
    {
        $dir = $this->ensureClone($project);
        $this->writeBackToClone($project, $dir);

        $this->run($project, ['git', 'add', '-A'], $dir);

        $staged = $this->run($project, ['git', 'diff', '--cached', '--name-only'], $dir);
        $stagedFiles = array_values(array_filter(array_map('trim', explode("\n", $staged))));

        if ($stagedFiles === []) {
            return ['output' => 'Nothing to commit — working tree already clean.', 'committed' => 0];
        }

        $message = 'Project workspace sync — ' . now()->format('Y-m-d H:i');
        $this->run($project, ['git', 'commit', '-m', $message], $dir);
        $this->run($project, ['git', 'push', 'origin', 'HEAD'], $dir);

        // Sync succeeded: reset change flags so the workspace shows a clean tree.
        AiProjectFile::where('project_id', $project->id)
            ->where(function ($q) {
                $q->where('change_type', 'created')->orWhere('change_type', 'modified');
            })
            ->update(['change_type' => null, 'previous_content' => null, 'previous_content_hash' => null, 'changed_at' => null]);

        return [
            'output' => 'Committed and pushed ' . count($stagedFiles) . ' file(s).',
            'committed' => count($stagedFiles),
        ];
    }

    /**
     * Reconcile the working clone with the project's rows. Files whose current
     * content lives in a blob (ai-projects/) are copied into the clone at the
     * row's relative path; tracked files that no longer have a row (deleted in
     * the workspace) are removed from the clone so `git add -A` picks the
     * deletion up.
     */
    protected function writeBackToClone(AiProject $project, string $dir): void
    {
        $prefix = $this->repoDir($project);
        $rows = AiProjectFile::where('project_id', $project->id)->where('is_folder', false)->get();

        $repoPaths = [];
        foreach ($rows as $row) {
            $storage = $row->storage_path;
            if (! $storage) {
                continue;
            }
            $relative = $this->repoRelativeOf($project, $row);
            if ($relative === null) {
                continue;
            }
            $repoPaths[$relative] = (int) $row->id;

            $dest = $dir . '/' . $relative;
            if (! is_dir(dirname($dest))) {
                @mkdir(dirname($dest), 0755, true);
            }

            if (str_starts_with($storage, 'ai-projects/')) {
                $blob = storage_path('app/private/' . $storage);
                if (is_file($blob)) {
                    @copy($blob, $dest);
                }
            }
        }

        // Remove tracked files whose row was deleted in the workspace.
        $tracked = $this->run($project, ['git', 'ls-files'], $dir);
        foreach (array_filter(explode("\n", $tracked)) as $file) {
            $file = trim($file);
            if ($file === '' || $file[0] === '"') {
                continue;
            }
            if (in_array($this->firstSegment($file), self::SKIP_DIRS, true)) {
                continue;
            }
            if (! isset($repoPaths[$file]) && is_file($dir . '/' . $file)) {
                @unlink($dir . '/' . $file);
            }
        }
    }

    protected function repoRelativeOf(AiProject $project, AiProjectFile $row): ?string
    {
        $prefix = $this->repoDir($project);
        $storage = $row->storage_path;
        if (! $storage) {
            return null;
        }

        if (str_starts_with($storage, $prefix . '/')) {
            return substr($storage, strlen($prefix) + 1);
        }

        // Blob-backed row: place at its folder-chain position inside the clone.
        // Folder rows imported from the repo carry the directory path in their
        // storage_path, so walk up and prepend that once we reach one; UI-created
        // folders contribute their own name on the way up.
        $parts = [$row->name];
        $cursor = $row->parent_id ? (int) $row->parent_id : null;
        while ($cursor !== null) {
            $parent = AiProjectFile::find($cursor);
            if (! $parent) {
                break;
            }
            $ps = $parent->storage_path;
            if ($ps && str_starts_with($ps, $prefix . '/')) {
                $relBase = rtrim(substr($ps, strlen($prefix) + 1), '/');
                if ($relBase !== '') {
                    $parts = [...explode('/', $relBase), ...$parts];
                }
                break;
            }
            array_unshift($parts, $parent->name);
            $cursor = $parent->parent_id ? (int) $parent->parent_id : null;
        }

        return implode('/', $parts);
    }

    protected function firstSegment(string $path): string
    {
        $sep = strpos($path, '/');
        return $sep === false ? $path : substr($path, 0, $sep);
    }

    /**
     * Rename and/or move a file/folder inside a project tree.
     *
     * For plain projects this is a simple DB update. For repo-backed projects
     * the working clone is reconciled too: the physical files/directories are
     * moved and every repo-backed row's storage_path is rewritten so the next
     * commit (writeBackToClone + git add -A) still finds the files at their new
     * relative locations. Blob rows (ai-projects/) and UI-created folders keep
     * their own storage and re-derive their clone path from the new hierarchy.
     */
    public function moveEntry(AiProject $project, AiProjectFile $entry, ?string $newName, ?int $newParentId): void
    {
        $isRepo = $project->repo_url !== null;

        if (! $isRepo) {
            if ($newName !== null) {
                $entry->name = $newName;
            }
            if ($newParentId !== null) {
                $entry->parent_id = $newParentId;
            }
            $entry->save();
            $project->touch();

            return;
        }

        $prefix = $this->repoDir($project);

        // Affected rows: the entry plus every descendant when it is a folder.
        $entryId = (int) $entry->id;
        $affected = \App\Models\AiProjectFile::where('project_id', $project->id)
            ->get()
            ->filter(function ($f) use ($entryId) {
                if ((int) $f->id === $entryId) {
                    return true;
                }
                $node = $f;
                $depth = 0;
                while ($node && $node->parent_id && $depth < 1000) {
                    if ((int) $node->parent_id === $entryId) {
                        return true;
                    }
                    $node = $node->parent()->first();
                    $depth++;
                }
                return false;
            })
            ->values();

        // Old repo-relative paths (from storage_path) captured before any change.
        $oldRelPath = [];
        foreach ($affected as $f) {
            if ($f->storage_path && str_starts_with($f->storage_path, $prefix . '/')) {
                $oldRelPath[(int) $f->id] = substr($f->storage_path, strlen($prefix) + 1);
            }
        }

        if ($newName !== null) {
            $entry->name = $newName;
        }
        if ($newParentId !== null) {
            $entry->parent_id = $newParentId;
        }
        $entry->save();

        $dir = $this->ensureClone($project);

        $hasStorage = (bool) $entry->storage_path;
        if ($entry->is_folder && $hasStorage) {
            // Repo-backed folder: rename/move the directory in the clone once —
            // everything inside travels with it. Descendants only get their
            // storage_path rewritten.
            $this->movePhysicalRow($dir, $prefix, $entry, $oldRelPath[(int) $entry->id] ?? null);
            foreach ($affected as $f) {
                if ((int) $f->id === $entryId) {
                    continue;
                }
                if ($f->storage_path && str_starts_with($f->storage_path, $prefix . '/')) {
                    $newRel = $this->repoRelativeOf($f);
                    $f->update(['storage_path' => $prefix . '/' . $newRel]);
                }
            }
        } elseif (! $entry->is_folder && $hasStorage) {
            // Repo-backed file: move just the file.
            $this->movePhysicalRow($dir, $prefix, $entry, $oldRelPath[(int) $entry->id] ?? null);
        } elseif ($entry->is_folder) {
            // UI-created folder (no own storage): move each repo-backed
            // descendant individually.
            foreach ($affected as $f) {
                if ($f->storage_path && str_starts_with($f->storage_path, $prefix . '/')) {
                    $this->movePhysicalRow($dir, $prefix, $f, $oldRelPath[(int) $f->id] ?? null);
                }
            }
        }

        $project->touch();
    }

    /**
     * Move a single repo-backed row inside the clone and rewrite its
     * storage_path to the new relative location.
     */
    protected function movePhysicalRow(string $dir, string $prefix, AiProjectFile $row, ?string $oldRel): void
    {
        $newRel = $this->repoRelativeOf($row);
        $row->update(['storage_path' => $prefix . '/' . $newRel]);

        if ($oldRel === null || $oldRel === $newRel) {
            return;
        }

        $oldFull = $dir . '/' . $oldRel;
        $newFull = $dir . '/' . $newRel;
        if (! file_exists($oldFull) || $oldFull === $newFull) {
            return;
        }

        if (! is_dir(dirname($newFull))) {
            @mkdir(dirname($newFull), 0755, true);
        }
        @rename($oldFull, $newFull);
    }

    /**
     * VS Code-style commit history for a repo-backed project.
     *
     * @return array<int, array{
     *     hash: string, short: string, author: string, email: string,
     *     date: string, subject: string
     * }>
     */
    public function commitLog(AiProject $project, int $limit = 60): array
    {
        $dir = $this->ensureClone($project);
        $raw = $this->run(
            $project,
            ['git', 'log', '--max-count=' . max(1, min(500, $limit)), '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s'],
            $dir,
            true
        );

        $out = [];
        foreach (explode("\n", trim($raw)) as $line) {
            if ($line === '') {
                continue;
            }
            $parts = explode("\x1f", $line);
            if (count($parts) < 6) {
                continue;
            }
            [$hash, $short, $author, $email, $date, $subject] = $parts;
            $out[] = [
                'hash' => $hash,
                'short' => $short,
                'author' => $author,
                'email' => $email,
                'date' => $date,
                'subject' => $subject,
            ];
        }

        return $out;
    }

    /**
     * Detail for a single commit: metadata, changed files (A/M/D status) and a
     * unified diff body for the workspace to render.
     */
    public function commitDetail(AiProject $project, string $hash): array
    {
        $hash = trim($hash);
        if (! preg_match('/^[0-9a-f]{7,64}$/i', $hash)) {
            throw new \RuntimeException('Invalid commit reference.');
        }

        $dir = $this->ensureClone($project);

        $metaRaw = $this->run(
            $project,
            ['git', 'show', '--no-color', '--no-patch', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s', $hash],
            $dir,
            true
        );
        $metaParts = explode("\x1f", trim($metaRaw));
        $meta = [
            'hash' => $metaParts[0] ?? $hash,
            'short' => $metaParts[1] ?? $hash,
            'author' => $metaParts[2] ?? '',
            'email' => $metaParts[3] ?? '',
            'date' => $metaParts[4] ?? '',
            'subject' => $metaParts[5] ?? '',
        ];

        // Changed files with add/modify/delete status.
        $namesRaw = $this->run($project, ['git', 'diff-tree', '--no-commit-id', '--name-status', '-r', $hash], $dir, true);
        $files = [];
        foreach (array_filter(explode("\n", trim($namesRaw))) as $line) {
            if (preg_match('/^([AMDRC]|A\s|M\s|D\s|R\d+)\s+(.*)$/', $line, $m)) {
                $status = trim((string) $m[1]);
                $path = trim((string) $m[2]);
                if ($status === 'A') {
                    $status = 'added';
                } elseif ($status === 'M') {
                    $status = 'modified';
                } elseif ($status === 'D') {
                    $status = 'deleted';
                } elseif ($status === 'R100' || str_starts_with($status, 'R')) {
                    $status = 'renamed';
                } else {
                    $status = 'modified';
                }
                $files[] = ['status' => $status, 'path' => $path];
            }
        }

        // Unified diff body. Root commits have no parent to diff against, so
        // `git show` degrades to the full file content — acceptable.
        $diff = $this->run($project, ['git', 'show', '--no-color', '--format=', '--no-renames', '--unified=1', $hash], $dir, true);
        if (strlen($diff) > 400000) {
            $diff = mb_substr($diff, 0, 400000);
        }

        return $meta + ['files' => $files, 'diff' => $diff];
    }

    /**
     * Run a git command inside the clone and return stdout. Throws when the
     * command fails so the caller can surface a readable error.
     */
    protected function run(AiProject $project, array $args, string $cwd, bool $allowFailure = false): string
    {
        if (($args[0] ?? null) === 'git') {
            array_shift($args);
        }

        $cmd = 'git -C ' . escapeshellarg($cwd) . ' ' . implode(' ', array_map('escapeshellarg', $args));
        $output = [];
        $code = 0;
        // Ensure git always refs user identity even when the server has none.
        $envPrefix = 'GIT_AUTHOR_NAME=' . escapeshellarg('Daily Phone Workspace') . ' GIT_AUTHOR_EMAIL=' . escapeshellarg('workspace@dailyphone.local') .
            ' GIT_COMMITTER_NAME=' . escapeshellarg('Daily Phone Workspace') . ' GIT_COMMITTER_EMAIL=' . escapeshellarg('workspace@dailyphone.local') .
            ' GIT_TERMINAL_PROMPT=0';

        exec($envPrefix . ' ' . $cmd . ' 2>&1', $output, $code);
        $raw = implode("\n", $output);

        if ($code !== 0 && ! $allowFailure) {
            $message = trim(implode("\n", array_slice($output, -6)));
            $project->update(['repo_error' => $message]);
            throw new \RuntimeException($message ?: 'Git command failed.');
        }

        return $raw;
    }

    /**
     * Remove the on-disk working clone for a project (used on disconnect and
     * project deletion).
     */
    public function removeClone(AiProject $project): void
    {
        $dir = $this->repoFullPath($project);
        if (is_dir($dir) && ! is_dir($dir . '/.git')) {
            return;
        }
        @exec('rm -rf ' . escapeshellarg($dir));
    }

    /**
     * Derive a repo display URL for the UI (strip credentials).
     */
    public function displayUrl(string $url): string
    {
        return (string) preg_replace('#^https?://[^@/]*@#', 'https://', $url);
    }

    /**
     * Normalize a user-supplied repo reference to a cloneable https URL.
     */
    public function normalizeUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }

        // "user/repo" shorthand
        if (! preg_match('#^(https?://|git@|ssh://|git://)#', $url) && substr_count($url, '/') === 1) {
            $url = 'https://github.com/' . $url . '.git';
        }

        return $url;
    }

    public function isCloned(AiProject $project): bool
    {
        return $project->repo_url !== null && is_dir($this->repoFullPath($project) . '/.git');
    }
}