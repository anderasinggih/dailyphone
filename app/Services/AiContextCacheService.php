<?php

namespace App\Services;

use App\Models\AiContextCache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Gemini context-caching glue (item 11).
 *
 * The static preamble of a request — the role/system instruction plus the tool
 * declarations — almost never changes between turns, yet today it is re-tokenized
 * (and billed) on every request. This service creates a `cachedContents` resource
 * for that static preamble and reuses it while it is still valid (default TTL
 * 20 minutes), cutting cost and latency on long conversations.
 *
 * Design rule: only *static* system text + tools are ever cached. Anything that
 * changes per query (neuron memory snippets, ingest notices, live data) must live
 * in the contents, never in the cached system instruction, otherwise the cache
 * prefix no longer matches and Gemini rejects the request.
 */
class AiContextCacheService
{
    public function __construct(protected GeminiAssistantService $gemini)
    {
    }

    /**
     * A stable, content-addressed store for the cached resource name. Fresh
     * when no entry exists, the model changed, or the TTL has elapsed.
     */
    public function freshCacheName(string $model, string $key, array $cacheSettings = []): ?string
    {
        if (empty($key)) {
            return null;
        }

        $row = AiContextCache::where('cache_key', $key)->first();

        $ttlSeconds = (int)($cacheSettings['ttl_seconds'] ?? 1800);
        $expiresAt = $row?->expires_at ? \Illuminate\Support\Carbon::parse($row->expires_at) : null;

        if ($row && $row->model === $model && $expiresAt && $expiresAt->isFuture()) {
            return $row->cache_name;
        }

        return null;
    }

    /**
     * Resolve a cache name, creating (or refreshing) the Gemini cachedContents
     * resource when the stored one is missing or stale. Returns null when the
     * service is not configured, the API failed, or there is nothing to cache.
     */
    public function resolve(string $model, string $key, string $systemText, array $tools = [], array $cacheSettings = []): ?string
    {
        if ($systemText === '') {
            return null;
        }

        $existing = $this->freshCacheName($model, $key, $cacheSettings);
        if ($existing !== null) {
            return $existing;
        }

        $apiKeys = $this->gemini->apiKeyListForCaching();
        if ($apiKeys === []) {
            return null;
        }

        $payload = [
            'model' => 'models/' . trim($model),
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $systemText]]],
            ],
            'ttl' => $cacheSettings['ttl'] ?? '1800s',
        ];
        if ($tools !== []) {
            $payload['tools'] = $tools;
        }

        foreach (array_values($apiKeys) as $index => $keyVal) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/cachedContents?key={$keyVal}";
                $response = Http::timeout(20)->connectTimeout(10)->post($url, $payload);

                if ($response->successful()) {
                    $name = (string)$response->json('name', '');
                    if ($name === '') {
                        return null;
                    }

                    $ttlSeconds = (int)($cacheSettings['ttl_seconds'] ?? 1800);
                    AiContextCache::updateOrCreate(
                        ['cache_key' => $key],
                        [
                            'cache_name' => $name,
                            'model' => $model,
                            'expires_at' => now()->addSeconds($ttlSeconds),
                        ]
                    )->save();

                    return $name;
                }

                Log::warning('cachedContents create HTTP ' . $response->status() . ' (key #' . ($index + 1) . '): '
                    . ($response->json('error.message') ?? $response->body()));
            } catch (\Throwable $e) {
                Log::warning('cachedContents create threw (key #' . ($index + 1) . '): ' . $e->getMessage());
            }
        }

        return null;
    }
}