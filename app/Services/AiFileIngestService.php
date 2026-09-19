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

    /** Max characters of webpage text worth keeping after extraction. */
    public const URL_TEXT_MAX = 300000;

    /** Max characters of a webpage excerpt handed to Gemini for grounding. */
    public const URL_EXCERPT_MAX = 8000;

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
                    return $this->truncate($this->extractPdf($path), $max);

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
        $repo = preg_replace('/\.git$/i', '', $m[2]);

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

    /**
     * Fetch a public article / webpage / Wikipedia page, extract its readable
     * text and persist the content as new training-memory neurons (kind:
     * knowledge, tagged with the source URL). Supports HTML pages, plain text
     * and direct PDF links. Returns a grounded excerpt so Gemini can honestly
     * summarize what was just indexed.
     *
     * @return array{success: bool, message: string, url: string, title: string, notes_count: int, excerpt: string}
     */
    public function ingestUrl(string $url, User $user): array
    {
        $url = trim($url);
        if (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url)) {
            return $this->urlFail('URL tidak valid. Berikan tautan yang lengkap mulai dari https:// atau http://.');
        }

        $tempPdf = null;

        try {
            $response = Http::timeout(45)
                ->connectTimeout(15)
                ->withHeaders([
                    'User-Agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                    'Accept-Language' => 'en-US,en;q=0.9,id;q=0.8',
                ])
                ->accept('text/html,application/xhtml+xml,text/plain,application/pdf,*/*')
                ->get($url);

            if ($response->failed()) {
                return $this->urlFail("Gagal mengakses {$url}. Pastikan tautannya publik dan bisa dibuka (status HTTP {$response->status()}).");
            }

            // Follow redirects so the final URL is stored as the real source.
            $finalUrl = trim((string) ($response->effectiveUri() ?: $url));
            if ($finalUrl === '') {
                $finalUrl = $url;
            }

            $contentType = strtolower((string) $response->header('Content-Type'));
            $body = $response->body();
            if (mb_strlen($body) > 5 * 1024 * 1024) {
                return $this->urlFail('Halaman terlalu besar untuk dipelajari.');
            }

            $title = '';
            $text = '';

            if (str_contains($contentType, 'pdf') || str_ends_with(strtolower($finalUrl), '.pdf')) {
                $tempPdf = tempnam(sys_get_temp_dir(), 'dp_url_');
                if ($tempPdf === false) {
                    return $this->urlFail('Tidak dapat membuat file sementara untuk dokumen PDF.');
                }
                @file_put_contents($tempPdf, $body);
                $text = $this->extractPdf($tempPdf);
            } elseif (str_contains($contentType, 'text/plain')) {
                $text = $this->cleanText($body);
            } else {
                [$title, $text] = $this->htmlToText($body);
            }

            $text = trim($text);
            if ($title === '') {
                $title = $this->urlTitleFromUrl($finalUrl);
            }
            if (mb_strlen($text) < 60) {
                return $this->urlFail('Tidak ada konten teks yang bisa dibaca dari halaman tersebut.');
            }

            $saved = $this->persistUrlNodes($title, $text, $finalUrl, $user);
            $excerpt = $this->truncate($text, self::URL_EXCERPT_MAX);

            $message = $saved > 0
                ? "🧠 Berhasil mempelajari {$saved} node dari artikel \"{$title}\" dan menyimpannya sebagai neuron memory."
                : "Artikel \"{$title}\" sudah pernah dipelajari sebelumnya — tidak ada node baru yang dibuat (isinya sudah tersimpan di neuron network).";

            return [
                'success' => $saved > 0,
                'message' => $message,
                'url' => $finalUrl,
                'title' => $title,
                'notes_count' => $saved,
                'excerpt' => $excerpt,
            ];
        } catch (\Throwable $e) {
            Log::error('URL ingestion failed: ' . $e->getMessage(), [
                'url' => $url,
                'user_id' => $user->id,
            ]);
            return $this->urlFail('Terjadi kesalahan saat mempelajari artikel: ' . $e->getMessage());
        } finally {
            if ($tempPdf !== null && is_file($tempPdf)) {
                @unlink($tempPdf);
            }
        }
    }

    protected function urlFail(string $message): array
    {
        return [
            'success' => false,
            'message' => $message,
            'url' => '',
            'title' => '',
            'notes_count' => 0,
            'excerpt' => '',
        ];
    }

    /**
     * Chunk a webpage's extracted text into knowledge nodes tagged with the
     * source URL and meaningful keywords derived from the page title + host.
     */
    protected function persistUrlNodes(string $title, string $text, string $url, User $user): int
    {
        $related = $this->urlRelatedKeywords($title, $url);
        $saved = 0;

        foreach ($this->chunkText($text, 8000) as $i => $chunk) {
            $chunkNo = $i + 1;
            $nodeTitle = $chunkNo === 1
                ? Str::limit($title, 200)
                : Str::limit($title, 170) . ' (bagian ' . $chunkNo . ')';

            if ($this->persistUrlNode($nodeTitle, $chunk, $related, $url, $title, $user)) {
                $saved++;
            }
        }

        return $saved;
    }

    protected function urlRelatedKeywords(string $title, string $url): array
    {
        $stop = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'who', 'how', 'why', 'are', 'was', 'you', 'your', 'ini', 'dan', 'yang', 'untuk'];
        $words = preg_split('/\s+/', strtolower((string) preg_replace('/[^A-Za-z0-9\s]+/u', ' ', $title))) ?: [];
        $words = array_values(array_filter(array_map('trim', $words), fn ($w) => mb_strlen($w) >= 3 && !in_array($w, $stop, true)));

        $host = str_ireplace(['www.', 'http://', 'https://'], '', (string) parse_url($url, PHP_URL_HOST));
        $host = str_replace(['.', '-'], [' ', ' '], strtolower($host));

        $related = array_values(array_unique(array_filter(array_merge(
            $words,
            [$host, 'artikel', 'web']
        ), fn ($v) => $v !== null && trim((string) $v) !== '')));

        return array_slice($related, 0, 8);
    }

    protected function persistUrlNode(string $title, string $content, array $related, string $url, string $sourceLabel, User $user): bool
    {
        $content = mb_substr(trim($content), 0, self::NOTE_CONTENT_MAX);
        if (mb_strlen($content) < 60) {
            return false;
        }

        $hash = md5($content);
        if (AiTrainingNote::where('content_hash', $hash)->exists()
            || app(AiMemoryGraphService::class)->isDuplicateContent($content)) {
            return false;
        }

        try {
            AiTrainingNote::create([
                'user_id' => $user->id,
                'author_name' => 'Web Learn',
                'author_role' => 'system',
                'content' => $content,
                'title' => $title,
                'related_keywords' => $related === [] ? null : $related,
                'content_hash' => $hash,
                'kind' => 'knowledge',
                'is_active' => true,
                'source_url' => $url,
                'source_label' => $sourceLabel,
            ]);
            return true;
        } catch (\Throwable $e) {
            Log::warning('Failed to persist URL training node: ' . $e->getMessage(), [
                'url' => $url,
                'title' => $title,
            ]);
            return false;
        }
    }

    protected function urlTitleFromUrl(string $url): string
    {
        $host = str_ireplace(['www.', 'http://', 'https://'], '', (string) parse_url($url, PHP_URL_HOST));
        $host = $host !== '' ? $host : 'Web Article';

        $path = trim((string) parse_url($url, PHP_URL_PATH), '/');
        $parts = array_values(array_filter(explode('/', $path), fn ($p) => trim($p) !== ''));
        $label = implode(' › ', array_map(
            fn ($p) => ucwords(str_replace(['_', '-'], ' ', urldecode($p))),
            $parts
        ));

        return $label !== '' ? "{$host} — {$label}" : $host;
    }

    /**
     * Dependency-free HTML → text converter: drops scripts/styles/head/svg,
     * converts block-level elements to line breaks, then collapses whitespace
     * so the article body reads cleanly for chunking.
     *
     * @return array{0: string, 1: string} [page title, visible text]
     */
    protected function htmlToText(string $html): array
    {
        $title = '';
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
            $title = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }

        $html = preg_replace('#<(script|style|noscript|svg|head|iframe|template)\b[^>]*>.*?</\1>#is', ' ', $html) ?? $html;
        $html = preg_replace('/<!--.*?-->/s', ' ', $html) ?? $html;
        $html = preg_replace('/\b(?:class|id|style|data-[a-z-]+|role|aria-[a-z-]+|width|height|target|rel|href|src|alt|title|loading|tabindex|contenteditable)\s*=\s*"[^"]*"|\b[a-z-]+\s*=\s*\'[^\']*\'/i', ' ', $html) ?? $html;

        $html = preg_replace('#<(?:/?(?:p|div|h[1-6]|li|tr|td|th|section|article|header|footer|aside|nav|blockquote|pre|br|table|thead|tbody|tfoot|caption|figure|figcaption|summary|details|ul|ol|form|hr))[^>]*>#i', "\n", $html) ?? $html;

        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = $this->cleanText($text);
        $text = (string) preg_replace('/[ \t]+/', ' ', $text);
        $text = (string) preg_replace('/ *\n */', "\n", $text);
        $text = (string) preg_replace('/\n{3,}/', "\n\n", $text);

        $lines = array_map(fn ($l) => trim($l), explode("\n", $text));
        $lines = array_filter($lines, fn ($l) => mb_strlen($l) >= 3);
        $text = implode("\n", $lines);

        if (mb_strlen($text) > self::URL_TEXT_MAX) {
            $text = mb_substr($text, 0, self::URL_TEXT_MAX);
        }

        return [$title, trim($text)];
    }

    /**
     * Persist uploaded documents (PDF books, DOCX, spreadsheets, text, ...) as
     * real training-memory nodes. The extracted text is chunked so each node
     * stays within the content column limit, then wired into the neuron graph.
     *
     * @return array{success: bool, notes_count: int, files_done: int, message: string}
     */
    public function ingestDocument($attachments, User $user): array
    {
        $notesCount = 0;
        $filesDone = 0;
        $scanned = 0;

        foreach ($attachments as $att) {
            $scanned++;

            $text = trim((string)($att->extracted_text ?? ''));
            if ($text === '') {
                // PDFs/images may have yielded no text on upload; retry the
                // extraction from storage now that we have a concrete request.
                $fullPath = storage_path('app/private/' . $att->storage_path);
                if ($att->storage_path && is_file($fullPath)) {
                    $text = trim($this->extractText($fullPath, $att->mime_type, $att->original_name, self::NOTE_CONTENT_MAX * 8));
                }
            }

            if (mb_strlen($text) < 40) {
                continue;
            }

            $name = (string)($att->original_name ?? 'dokumen');
            $base = pathinfo($name, PATHINFO_FILENAME);
            $slug = strtolower((string)preg_replace('/[^A-Za-z0-9]+/', ' ', $base));
            $related = array_values(array_unique(array_filter([
                Str::limit($slug, 24),
                (string)($att->kind ?? ''),
                strtolower((string)pathinfo($name, PATHINFO_EXTENSION)),
            ], fn ($v) => $v !== null && trim((string)$v) !== '')));

            foreach ($this->chunkText($text, 9000) as $i => $chunk) {
                $chunkNo = $i + 1;
                $title = $chunkNo === 1
                    ? Str::limit($base, 200)
                    : Str::limit($base, 170) . ' (bagian ' . $chunkNo . ')';

                if ($this->persistDocumentNode($title, $chunk, $related, $name . ' (bagian ' . $chunkNo . ')', $user)) {
                    $notesCount++;
                }
            }
            $filesDone++;
        }

        return [
            'success' => $notesCount > 0,
            'notes_count' => $notesCount,
            'files_done' => $filesDone,
            'message' => $notesCount > 0
                ? "Dokumen telah diindeks menjadi {$notesCount} node memori baru."
                : 'Tidak ada teks baru yang layak disimpan sebagai node memory.',
        ];
    }

    /**
     * Split a long text into readable chunks of roughly $max characters,
     * preferring paragraph breaks near the boundary.
     *
     * @return string[]
     */
    protected function chunkText(string $text, int $max): array
    {
        $text = trim($text);
        if ($text === '' || mb_strlen($text) <= $max) {
            return $text === '' ? [] : [$text];
        }

        $chunks = [];
        $cursor = 0;
        $length = mb_strlen($text);

        while ($cursor < $length) {
            $end = min($cursor + $max, $length);
            if ($end < $length) {
                $span = mb_substr($text, $cursor, $end - $cursor);
                $break = mb_strrpos($span, "\n");
                if ($break !== false && $break > $max * 0.5) {
                    $end = $cursor + $break;
                }
            }
            $chunks[] = mb_substr($text, $cursor, $end - $cursor);
            $cursor = $end;
        }

        return $chunks;
    }

    /**
     * Save one document chunk as a knowledge neuron (deduplicated by content).
     */
    protected function persistDocumentNode(string $title, string $content, array $related, string $sourceLabel, User $user): bool
    {
        $content = mb_substr(trim($content), 0, self::NOTE_CONTENT_MAX);
        if (mb_strlen($content) < 40) {
            return false;
        }

        $hash = md5($content);
        if (AiTrainingNote::where('content_hash', $hash)->exists()
            || app(AiMemoryGraphService::class)->isDuplicateContent($content)) {
            return false;
        }

        try {
            AiTrainingNote::create([
                'user_id' => $user->id,
                'author_name' => 'Document Learn',
                'author_role' => 'system',
                'content' => $content,
                'title' => $title,
                'related_keywords' => $related === [] ? null : $related,
                'content_hash' => $hash,
                'kind' => 'knowledge',
                'is_active' => true,
                'source_url' => null,
                'source_label' => $sourceLabel,
            ]);
            return true;
        } catch (\Throwable $e) {
            Log::warning('Failed to persist document training node: ' . $e->getMessage(), [
                'source' => $sourceLabel,
            ]);
            return false;
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

    /**
     * Best-effort plain-text extraction from a PDF: inflate every FlateDecode
     * content stream, then pick out the literal strings shown by the text-showing
     * operators (Tj / TJ / ' / "). Works without any external binary or library;
     * scanned/image-only PDFs yield '' and are still sent as inline data instead.
     */
    protected function extractPdf(string $path): string
    {
        $raw = @file_get_contents($path);
        if ($raw === false || trim($raw) === '') {
            return '';
        }

        $pages = [];
        if (preg_match_all('/stream[\r\n]+(.*?)[\r\n]+endstream/s', $raw, $matches)) {
            foreach ($matches[1] as $stream) {
                $body = ltrim($stream);
                $decoded = @gzuncompress($body);
                if ($decoded === false) {
                    $decoded = @gzinflate($body);
                }
                if ($decoded === false) {
                    $decoded = @gzdecode($body);
                }
                if ($decoded === false) {
                    $decoded = $body;
                }
                $text = $this->pdfContentToText($decoded);
                if (trim($text) !== '') {
                    $pages[] = $text;
                }
            }
        }

        if ($pages === []) {
            $text = $this->pdfContentToText($raw);
            if (trim($text) !== '') {
                $pages[] = $text;
            }
        }

        return $this->cleanText(implode("\n\n", $pages));
    }

    /**
     * Convert one decoded PDF content stream into readable text by keeping only
     * literal strings that are actually rendered by a text-showing operator.
     */
    protected function pdfContentToText(string $decoded): string
    {
        $len = strlen($decoded);
        $literals = [];
        $i = 0;
        while ($i < $len) {
            if ($decoded[$i] !== '(') {
                $i++;
                continue;
            }
            $start = $i;
            $j = $i + 1;
            $depth = 1;
            $buf = '';
            while ($j < $len && $depth > 0) {
                $c = $decoded[$j];
                if ($c === '\\' && $j + 1 < $len) {
                    $buf .= $this->pdfEscape($decoded[$j + 1]);
                    $j += 2;
                    continue;
                }
                if ($c === '(') {
                    $depth++;
                } elseif ($c === ')') {
                    $depth--;
                    if ($depth === 0) {
                        $j++;
                        break;
                    }
                }
                $buf .= $c;
                $j++;
            }
            $literals[] = ['start' => $start, 'end' => $j, 'text' => trim($buf)];
            $i = $j;
        }

        // Keep only the literals that a text-showing operator (Tj / TJ / ' / ")
        // renders, ignoring dictionary strings far from any of them.
        $shown = [];
        $lastShownEnd = null;
        foreach ($literals as $lit) {
            $window = substr($decoded, $lit['end'], 140);
            if (!preg_match('/^.{0,140}?(?:ET|\b(Tj|TJ|\'|"))/s', $window, $mm) || empty($mm[1])) {
                continue;
            }

            // A Td/TD/T*/Tm/ET between two shown strings means a new line.
            $gapHasBreak = $lastShownEnd !== null
                && preg_match('/\b(E[TL]|T[dDm]|T\*)\b/', substr($decoded, $lastShownEnd, $lit['start'] - $lastShownEnd));
            $shown[] = ($gapHasBreak ? "\n" : ' ') . $lit['text'];
            $lastShownEnd = $lit['end'];
        }

        if ($shown === []) {
            return '';
        }

        $joined = implode('', $shown);
        return preg_replace('/\s+/', ' ', $joined);
    }

    /**
     * Un-escape a single PDF literal-string escaped character (\n \t \( \) \\ and octal \NNN).
     */
    protected function pdfEscape(string $char): string
    {
        return match ($char) {
            'n' => "\n",
            'r' => "\r",
            't' => "\t",
            'b' => "\b",
            'f' => "\f",
            '(', ')', '\\' => $char,
            default => ctype_digit($char) ? chr((int)octdec($char)) : ' ',
        };
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