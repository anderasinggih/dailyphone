<?php

namespace App\Http\Controllers;

use App\Models\GeneralSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\View;

class AiTestController extends Controller
{
    public function index()
    {
        return View::make('ai-test');
    }

    public function send(Request $request): JsonResponse
    {
        $message = trim((string) $request->input('message'));
        if ($message === '') {
            return response()->json(['error' => 'Empty message']);
        }

        $settings = GeneralSetting::first();
        $keys = $settings ? $settings->apiKeyList() : [];
        if (empty($keys)) {
            $envKey = env('GEMINI_API_KEY');
            if (! empty($envKey)) {
                $keys = [$envKey];
            }
        }
        $model = $settings?->ai_model ?: env('GEMINI_MODEL', 'gemini-3.5-flash-lite');
        $key = (string) ($keys[0] ?? '');
        if ($key === '') {
            return response()->json(['error' => 'No Gemini API key configured']);
        }

        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:streamGenerateContent?alt=sse&key={$key}";
        $payload = [
            'contents' => [['role' => 'user', 'parts' => [['text' => $message]]]],
            'generationConfig' => [
                'temperature' => 0.7,
                'maxOutputTokens' => 1024,
                'candidateCount' => 1,
            ],
        ];

        $start = microtime(true);
        $ttfMs = null;
        $reply = '';
        $usage = null;
        $httpStatus = 0;
        $eventBuf = '';
        $errorEvent = null;

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_TIMEOUT => 120,
            CURLOPT_WRITEFUNCTION => function ($ch, string $data) use (&$httpStatus, &$eventBuf, &$ttfMs, &$reply, &$usage, &$errorEvent, $start): int {
                $httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                if ($ttfMs === null) {
                    $ttfMs = round((microtime(true) - $start) * 1000, 1);
                }
                $eventBuf .= $data;
                while (preg_match("/\A(.*?)\r?\n\r?\n/s", $eventBuf, $mm)) {
                    $eventData = $mm[1];
                    $eventBuf = substr($eventBuf, strlen($mm[0]));
                    foreach (preg_split("/\r?\n/", $eventData) as $line) {
                        if (str_starts_with(trim($line), 'data:')) {
                            $json = json_decode(trim(substr(trim($line), 5)), true);
                            if (! is_array($json)) {
                                continue;
                            }
                            if (isset($json['usageMetadata'])) {
                                $usage = $json['usageMetadata'];
                            }
                            $text = $json['candidates'][0]['content']['parts'][0]['text'] ?? '';
                            if ($text !== '') {
                                $reply .= $text;
                            } elseif ($errorEvent === null && (isset($json['promptFeedback']) || isset($json['candidates']))) {
                                $errorEvent = $json;
                            }
                        }
                    }
                }

                return strlen($data);
            },
        ]);

        $error = null;
        if (curl_exec($curl) === false) {
            $error = curl_error($curl);
        }

        $totalMs = round((microtime(true) - $start) * 1000, 1);

        return response()->json([
            'reply' => trim($reply),
            'model' => $model,
            'timing_ms' => [
                'ttf_ms' => $ttfMs,
                'total_ms' => $totalMs,
            ],
            'usage' => $usage,
            'http_status' => $httpStatus,
            'error_event' => $reply === '' ? $errorEvent : null,
            'raw_error' => $reply === '' ? mb_substr(trim($eventBuf), 0, 2000) : null,
            'error' => $error,
        ]);
    }
}