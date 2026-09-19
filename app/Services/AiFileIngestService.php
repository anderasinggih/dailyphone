<?php

namespace App\Services;

use App\Models\AiTrainingNote;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use SimpleXMLElement;
use ZipArchive;

/**
 * Parses uploaded files (text, CSV, spreadsheets, documents, archives,
 * images) into readable text and ingests GitHub repositories as new
 * training-memory nodes connected into the AI neuron network.
 */
class AiFileIngestService
{
    /** Max characters kept when extracting text from an uploaded attachment. */
    public const ATTACHMENT_TEXT_MAX = 50000;

    /** Max characters kept per file when decoding a repository. */
    public const REPO_FILE_TEXT_MAX = 20000;

    /** Max characters stored per AiTrainingNote.content (MySQL TEXT is 64KB). */
    public const NOTE_CONTENT_MAX = 12000;

    /** Upper bound on how many repo files become nodes in one ingestion. */
    public const MAX_REPO_NOTES = 120;

    /** Skip these directories when walking a repository. */
    protected const IGNORED_DIRS = [
        '.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target',
        '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'coverage',
        'storage', '.cache', 'bower_components', '.next', '.nuxt',
    ];

    /** File extensions that are safe to read as plain text. */
    protected const TEXT_EXTENSIONS = [
        'txt', 'text', 'md', 'markdown', 'rst', 'json', 'csv', 'tsv', 'log',
        'js', 'jsx', 'ts', 'tsx', 'php', 'py', 'rb', 'go', 'java', 'kt', 'c', 'h',
        'cpp', 'cc', 'hpp', 'cs', 'sql', 'html', 'htm', 'css', 'scss', 'sass',
        'less', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh',
        'bash', 'zsh', 'bat', 'ps1', 'vue', 'svelte', 'properties', 'gitignore',
        'gitattributes', 'dockerfile', 'lock', 'lua', 'swift', 'r', 'pl', 'tcl',
        'dart', 'scala', 'ex', 'exs', 'hbs', 'ejs', 'twig', 'jinja', 'ipynb',
        'sqlite', 'graphql', 'proto', 'npmrc',
    ];

    /** File extensions that are image/media/binary and cannot be read as text. */
    protected const BINARY_EXTENSIONS = [
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp',
        'ico', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'mp3', 'mp4', 'wav', 'webm',
        'mov', 'avi', 'mkv', 'mpg', 'mpeg', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
        'xlsm', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'bz2',
        'exe', 'dll', 'so', 'dylib', 'bin', 'db', 'sqlite3', 'class', 'jar', 'a',
    ];

    /**
     * Classify an uploaded file into a coarse kind used by the UI and the
     * Gemini inline-data pipeline (image / pdf / archive / spreadsheet /
     * document / text).
     */
    public function classify(string $fileName, ?string $mime = null): string
    {
        $mime = strtolower((string)$mime);
        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));

        if (str_starts_with($mime, 'image/') || in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'], true)) {
            return 'image';
        }
        if ($mime === 'application/pdf' || $ext === 'pdf') {
            return 'pdf';
        }
        if (in_array($ext, ['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'bz2'], true)) {
            return 'archive';
        }
        if (in_array($ext, ['xlsx', 'xls', 'csv', 'tsv'], true) || in_array($mime, ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], true)) {
            return 'spreadsheet';
        }
        if (in_array($ext, ['doc', 'docx', 'rtf', 'odt', 'pdf'], true)) {
            return 'document';
        }

        return 'text';
    }

    /**
     * Extract readable plain text from a file on the local filesystem.
     * Binary-safe and capped at $max chars. Images/PDFs return '' here —
     * they are handled as inline data instead.
     */
    public function extractText(string $path, ?string $mime = null, ?string $fileName = null, int $max = self::ATTACHMENT_TEXT_MAX): string
    {
        if (!is_file($path)) {
            return '';
        }

        $fileName = $fileName ?: basename($path);
        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
        $mime = strtolower((string)$mime);

        if (str_starts_with($mime, 'image/') || $this->isImageExt($ext)) {
            return '';
        }

        try {
            switch (true) {
                case $mime === 'application/pdf' || $ext === 'pdf':
                    return '';

                case $ext === 'xlsx' || $ext === 'xlsm':
                    return $this->truncate($this->extractXlsx($path), $max);

                case $ext === 'docx':
                    return $this->truncate($this->extractDocx($path), $max);

                case $ext === 'zip':
                    return $this->truncate($this->extractZip($path), $max);

                case $ext === 'csv' || $ext === 'tsv' || $mime === 'text/csv':
                    return $this->truncate($this->extractCsv($path, $ext === 'tsv' ? "\t" : ','), $max);

                case in_array($ext, self::BINARY_EXTENSIONS, true):
                    return '';

                case $this->isReadableExt($ext) || str_starts_with($mime, 'text/') || in_array($mime, ['application/json', 'application/xml', 'application/javascript', 'application/x-sh', 'application/x-yaml'], true):
                    $raw = @file_get_contents($path);
                    if ($raw === false) {
                        return '';
                    }
                    return $this->truncate($this->cleanText($raw), $max);

                default:
                    // Unknown extension: sniff the first bytes; if it looks like
                    // plain text, read it, otherwise treat as binary.
                    $info = @finfo_open(FILEINFO_MIME_TYPE);
                    $sniffed = $info ? @finfo_file($info, $path) : '';
                    @finfo_close($info);
                    if ($sniffed !== false && str_starts_with((string)$sniffed, 'text/')) {
                        $raw = @file_get_contents($path);
                        return $raw === false ? '' : $this->truncate($this->cleanText($raw), $max);
                    }
                    return '';
            }
        } catch (\Throwable $e) {
            Log::warning('File text extraction failed: ' . $e->getMessage(), [
                'file' => $fileName,
            ]);
            return '';
        }
    }

    /**
     * Download a GitHub repository, split its text files into readable chunks
     * and persist each as a knowledge node wired into the AI neuron network.
     *
     * @return array{success: bool, message: string, repo: string, notes_count: int}
     */
    public function ingestRepository(string $repoUrl, User $user): array
    {
        $repoUrl = trim($repoUrl);
        if ($repoUrl === '') {
            return $this->fail('Repo URL tidak boleh kosong.');
        }

        if (!preg_match('#github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)#', $repoUrl, $m) && !preg_match('#^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$#', $repoUrl, $m)) {
            return $this->fail('URL bukan repository GitHub. Contoh: https://github.com/owner/repo atau owner/repo.');
        }

        $owner = $m[1];
        $repo = $m[2];

        $zipPath = null;
        $extractDir = null;
        $token = Str::uuid()->toString();

        try {
            $baseDir = 'ai-repos/' . $token;
            Storage::disk('local')->makeDirectory($baseDir);
            $zipPath = Storage::disk('local')->path($baseDir . '/repo.zip');
            $extractDir = Storage::disk('local')->path($baseDir . '/src');

            if (!$this->downloadArchive($owner, $repo, $zipPath)) {
                return $this->fail("Gagal mengunduh arsip repository {$owner}/{$repo} dari GitHub. Pastikan repo bersifat publik.");
            }

            $zip = new ZipArchive();
            if ($zip->open($zipPath) !== true) {
                return $this->fail('Arsip repository tidak valid.');
            }
            @mkdir($extractDir, 0755, true);
            $zip->extractTo($extractDir);
            $zip->close();

            [$saved, $total] = $this->walkRepository($extractDir, "{$owner}/{$repo}", $user);

            return [
                'success' => $saved > 0,
                'message' => $saved > 0
                    ? "🧠 Berhasil mempelajari {$saved} file dari repo {$owner}/{$repo} dan menyimpannya sebagai node neuron memory."
                    : "Repo {$owner}/{$repo} dibaca tapi tidak ada file teks baru yang layak disimpan (mungkin sudah pernah dipelajari sebelumnya).",
                'repo' => "https://github.com/{$owner}/{$repo}",
                'notes_count' => $saved,
                'files_scanned' => $total,
            ];
        } catch (\Throwable $e) {
            Log::error('Repo ingestion failed: ' . $e->getMessage(), [
                'repo' => $repoUrl,
                'user_id' => $user->id,
            ]);
            return $this->fail('Terjadi kesalahan saat mempelajari repo: ' . $e->getMessage());
        } finally {
            if ($token !== '') {
                try {
                    Storage::disk('local')->deleteDirectory('ai-repos/' . $token);
                } catch (\Throwable $e) {
                    // best-effort cleanup
                }
            }
        }
    }

    protected function downloadArchive(string $owner, string $repo, string $zipPath): bool
    {
        $branch = null;
        try {
            $meta = Http::timeout(15)
                ->withHeaders(['User-Agent' => 'dailyphone-ai', 'Accept' => 'application/vnd.github+json'])
                ->get("https://api.github.com/repos/{$owner}/{$repo}");
            if ($meta->successful()) {
                $branch = $meta->json('default_branch') ?: null;
            }
        } catch (\Throwable $e) {
            // fall back to trying common branches directly
        }

        $candidates = $branch ? ["/zip/refs/heads/{$branch}"] : ['/zip/refs/heads/main', '/zip/refs/heads/master', '/zipball'];
        foreach ($candidates as $suffix) {
            try {
                $url = "https://codeload.github.com/{$owner}/{$repo}{$suffix}";
                $response = Http::timeout(90)
                    ->connectTimeout(20)
                    ->withHeaders(['User-Agent' => 'dailyphone-ai'])
                    ->withOptions(['sink' => $zipPath])
                    ->get($url);

                if ($response->successful() && is_file($zipPath) && filesize($zipPath) > 0) {
                    return true;
                }
            } catch (\Throwable $e) {
                continue;
            }
        }

        return false;
    }

    /**
     * Walk every text file of an extracted repository and persist a knowledge
     * node for each meaningful one (deduplicated by content hash).
     *
     * @return array{0: int, 1: int} [saved, scanned]
     */
    protected function walkRepository(string $extractDir, string $repoLabel, User $user): array
    {
        $root = $extractDir;
        $saved = 0;
        $scanned = 0;

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::LEAVES_ONLY
        );

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) {
                continue;
            }

            $relPath = trim(str_replace('\\', '/', substr($fileInfo->getPathname(), strlen($root))), '/');

            // codeload archives wrap everything in a root folder — drop it so
            // paths are relative to the repository itself.
            $pathSegs = explode('/', $relPath);
            if (count($pathSegs) > 1) {
                array_shift($pathSegs);
            }
            $relPath = implode('/', $pathSegs);
            if ($relPath === '') {
                continue;
            }

            $segments = explode('/', $relPath);
            $isIgnored = false;
            foreach ($segments as $seg) {
                if (in_array(strtolower($seg), array_map('strtolower', self::IGNORED_DIRS), true)) {
                    $isIgnored = true;
                    break;
                }
            }
            if ($isIgnored) {
                continue;
            }

            $ext = strtolower($fileInfo->getExtension());
            if ($fileInfo->getSize() > 300 * 1024) {
                continue;
            }
            if (!$this->isRepoReadableFile($relPath, $ext, $fileInfo->getPathname())) {
                continue;
            }

            $scanned++;
            if ($saved >= self::MAX_REPO_NOTES) {
                break;
            }

            $text = $this->extractText($fileInfo->getPathname(), null, $relPath, self::REPO_FILE_TEXT_MAX);
            $text = trim($text);
            if (mb_strlen($text) < 20) {
                continue;
            }

            $this->persistRepoNode($relPath, $text, $repoLabel, $user);
            $saved++;
        }

        return [$saved, $scanned];
    }

    /**
     * Decide whether a repository file is worth reading: plain text by extension,
     * well-known extension-less names (README/LICENSE/...), or a text sniff.
     */
    protected function isRepoReadableFile(string $relPath, string $ext, string $fullPath): bool
    {
        if ($ext === '') {
            $name = strtolower(basename($relPath));
            if (preg_match('/^(readme|license|licence|copying|authors?|contributing|changelog|code_of_conduct|security|support|notice|makefile|makefile\.|install|setup|gitignore|gitattributes|dockerfile)/i', $name)) {
                return true;
            }

            $info = @finfo_open(FILEINFO_MIME_TYPE);
            $sniffed = $info ? @finfo_file($info, $fullPath) : '';
            @finfo_close($info);
            return $sniffed !== false && str_starts_with((string)$sniffed, 'text/');
        }

        if (in_array($ext, self::BINARY_EXTENSIONS, true)) {
            return false;
        }

        return in_array($ext, self::TEXT_EXTENSIONS, true);
    }

    protected function persistRepoNode(string $relPath, string $text, string $repoLabel, User $user): void
    {
        $title = Str::limit($relPath, 200);
        $slug = preg_replace('/[^A-Za-z0-9]+/', ' ', strtolower(pathinfo($relPath, PATHINFO_FILENAME)));
        $ext = strtolower(pathinfo($relPath, PATHINFO_EXTENSION));

        $related = array_values(array_unique(array_filter([
            str_replace(['/', '\\'], ' ', strtolower($repoLabel)),
            'repo',
            $ext && $ext !== '' ? $ext : null,
            $slug ? Str::limit($slug, 24) : null,
        ], fn ($v) => $v !== null && trim((string)$v) !== '')));
        $related = array_slice($related, 0, 8);

        $content = mb_substr($text, 0, self::NOTE_CONTENT_MAX);
        $hash = md5($content);

        if (\App\Models\AiTrainingNote::where('content_hash', $hash)->exists()
            || app(AiMemoryGraphService::class)->isDuplicateContent($content)) {
            return;
        }

        try {
            AiTrainingNote::create([
                'user_id' => $user->id,
                'author_name' => 'Repo Learn (GitHub)',
                'author_role' => 'system',
                'content' => $content,
                'title' => $title,
                'related_keywords' => $related,
                'content_hash' => $hash,
                'kind' => 'knowledge',
                'is_active' => true,
                'source_url' => "https://github.com/{$repoLabel}",
                'source_label' => $repoLabel,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to persist repo training node: ' . $e->getMessage(), [
                'repo' => $repoLabel,
                'file' => $relPath,
            ]);
        }
    }

    protected function extractXlsx(string $path): string
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            return '';
        }

        $shared = [];
        $sharedXml = $zip->getFromName('xl/sharedStrings.xml');
        if ($sharedXml !== false) {
            $doc = @simplexml_load_string($sharedXml, SimpleXMLElement::class, LIBXML_NOCDATA | LIBXML_NOERROR);
            if ($doc !== false && isset($doc->si)) {
                foreach ($doc->si as $si) {
                    $text = '';
                    foreach ($si->t as $t) {
                        $text .= (string)$t;
                    }
                    $shared[] = trim($text);
                }
            }
        }

        $output = [];
        for ($i = 1; $i <= 30; $i++) {
            $sheetXml = $zip->getFromName("xl/worksheets/sheet{$i}.xml");
            if ($sheetXml === false) {
                break;
            }

            $sheet = @simplexml_load_string($sheetXml, SimpleXMLElement::class, LIBXML_NOCDATA | LIBXML_NOERROR);
            if ($sheet === false || !isset($sheet->sheetData)) {
                continue;
            }

            $lines = [];
            foreach ($sheet->sheetData->row as $row) {
                $cells = [];
                foreach ($row->c as $c) {
                    $type = (string)$c['t'];
                    $value = trim((string)$c->v);
                    if ($type === 's') {
                        $value = $shared[(int)$value] ?? '';
                    } elseif ($type === 'inlineStr' && isset($c->is->t)) {
                        $value = trim((string)$c->is->t);
                    }
                    $cells[] = $value;
                }
                if (count(array_filter($cells, fn ($x) => $x !== '')) > 0) {
                    $lines[] = implode(' | ', $cells);
                }
            }

            if ($lines !== []) {
                $output[] = '--- Sheet ' . $i . ' ---';
                array_push($output, ...$lines);
            }
        }

        $zip->close();
        return implode("\n", $output);
    }

    protected function extractDocx(string $path): string
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            return '';
        }
        $docXml = $zip->getFromName('word/document.xml');
        $zip->close();
        if ($docXml === false) {
            return '';
        }
        $text = strip_tags($docXml);
        return $this->cleanText(html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    protected function extractZip(string $path): string
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) {
            return '';
        }

        $output = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if ($name === false || $zip->isDir($i)) {
                continue;
            }
            if (!$this->isReadableExt(pathinfo($name, PATHINFO_EXTENSION))) {
                continue;
            }
            if ($zip->statIndex($i)['size'] > 300 * 1024) {
                continue;
            }
            $raw = $zip->getFromIndex($i);
            if ($raw === false) {
                continue;
            }
            $text = trim($this->cleanText($raw));
            if (mb_strlen($text) >= 20) {
                $output[] = "### {$name}\n" . mb_substr($text, 0, 8000);
            }
        }
        $zip->close();

        return implode("\n\n", $output);
    }

    protected function extractCsv(string $path, string $delimiter): string
    {
        $handle = @fopen($path, 'r');
        if ($handle === false) {
            return '';
        }

        $lines = [];
        $rowLimit = 2000;
        while (($row = @fgetcsv($handle, 0, $delimiter)) !== false && count($lines) < $rowLimit) {
            $clean = array_map(fn ($v) => trim((string)$v), $row);
            $lines[] = implode(' | ', $clean);
        }
        @fclose($handle);

        return implode("\n", $lines);
    }

    protected function cleanText(string $raw): string
    {
        $raw = str_replace("\r\n", "\n", $raw);
        return preg_replace('/[^\x09\x0A\x0D\x20-\x7E\xC2-\xFD][\x80-\xBF]*/', ' ', $raw) ?? $raw;
    }

    protected function truncate(string $text, int $max): string
    {
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        return mb_substr($text, 0, $max) . "\n…[truncated]";
    }

    protected function fail(string $message): array
    {
        return [
            'success' => false,
            'message' => $message,
            'repo' => '',
            'notes_count' => 0,
        ];
    }

    protected function isReadableExt(string $ext): bool
    {
        $ext = strtolower($ext);
        if ($ext === '') {
            return false;
        }
        return in_array($ext, self::TEXT_EXTENSIONS, true);
    }

    protected function isImageExt(string $ext): bool
    {
        return in_array(strtolower($ext), ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'], true);
    }
}