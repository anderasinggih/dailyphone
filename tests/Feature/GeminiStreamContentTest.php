<?php

namespace Tests\Feature;

use App\Services\GeminiAssistantService;
use Psr\Http\Message\StreamInterface;
use Tests\TestCase;

/**
 * Regression/robustness suite for the :streamGenerateContent?alt=json scanner.
 *
 * The body is served through a genuinely fragmented PSR-7 stream (1..N bytes per
 * read) so braces, quotes and memo fences that land on chunk boundaries are
 * exercised — exactly the layout that used to re-scan the whole buffer per read,
 * inflate $depth and silently drop the tail of the response.
 */
class GeminiStreamContentTest extends TestCase
{
    public static function fragmentSizes(): array
    {
        return [[1], [2], [3], [5], [7], [16], [64], [255], [512], [8192]];
    }

    /**
     * @dataProvider fragmentSizes
     */
    public function test_stream_reconstructs_the_full_payload_at_every_fragment_size(int $fragment): void
    {
        [$payload, $expectedVisible, $expectedRaw] = $this->buildPayload();

        [$visible, $ret, $raw, $meta] = $this->consume($payload, $fragment);

        $this->assertSame($expectedVisible, $visible, "onChunk output at {$fragment}B fragments");
        $this->assertSame($expectedVisible, $ret, "returned text at {$fragment}B fragments");
        $this->assertSame($expectedRaw, $raw, "raw reply (memo included) at {$fragment}B fragments");
        $this->assertSame('STOP', $meta['finishReason'], "finishReason at {$fragment}B fragments");
    }

    public function test_stream_keeps_memo_in_raw_but_out_of_visible(): void
    {
        [$payload, $expectedVisible, $expectedRaw] = $this->buildPayload();

        [$visible, , $raw, ] = $this->consume($payload, 7);

        $this->assertSame($expectedVisible, $visible);
        $this->assertStringNotContainsString('ai_memo', $visible);
        $this->assertSame($expectedRaw, $raw);
        // The memo JSON braces survive inside the raw reply.
        $this->assertStringContainsString('{"type":"conversation"', $raw);
    }

    public function test_stream_survives_braces_and_escapes_inside_string_values(): void
    {
        $mid = 'Braces {21} and {22} stay literal; escaped "quote" and backslash C:\\temp\\. last one: x"y';
        $payload = $this->enclose([$this->candidate($mid, ['finishReason' => 'STOP'])]);

        [$visible, $ret, $raw, $meta] = $this->consume($payload, 3);

        $this->assertSame($mid, $visible);
        $this->assertSame($mid, $ret);
        $this->assertSame($mid, $raw);
        $this->assertSame('STOP', $meta['finishReason']);
    }

    public function test_stream_handles_a_single_object_larger_than_the_read_window(): void
    {
        $long = str_repeat('streaming tokenised text ', 600); // ~18 KB, spans many reads
        $payload = $this->enclose([$this->candidate($long, ['finishReason' => 'STOP'])]);

        [$visible, , $raw, $meta] = $this->consume($payload, 128);

        $this->assertSame($long, $visible);
        $this->assertSame($long, $raw);
        $this->assertSame('STOP', $meta['finishReason']);
    }

    public function test_stream_ignores_separators_and_leading_trailing_junk(): void
    {
        $payload = "  [\n" . $this->enclose([$this->candidate('hello', ['finishReason' => 'STOP'])]) . "\n, ] \n";

        [$visible, , , $meta] = $this->consume($payload, 1);

        $this->assertSame('hello', $visible);
        $this->assertSame('STOP', $meta['finishReason']);
    }

    public function test_stream_relays_safety_block_reason_on_empty_delta(): void
    {
        $payload = $this->enclose([$this->candidate('', ['finishReason' => 'SAFETY'], ['promptFeedback' => ['blockReason' => 'SAFETY']])]);

        [, , , $meta] = $this->consume($payload, 5);

        $this->assertSame('SAFETY', $meta['finishReason']);
        $this->assertSame('SAFETY', $meta['blockReason']);
    }

    public function test_stream_only_consumes_complete_top_level_objects(): void
    {
        // Second object is far bigger so a half-copy reliably cuts inside it,
        // leaving the first object complete.
        $payload = $this->enclose([
            $this->candidate('one', ['finishReason' => 'MAX_TOKENS']),
            $this->candidate(str_repeat('two ', 2000), ['finishReason' => 'STOP']),
        ]);

        // Cut mid-way through the second object: nothing of it may leak early.
        $mid = new FragmentStream(substr($payload, 0, (int)(strlen($payload) / 2)), 8);

        // EOF reached while the object is still open -> scanner returns cleanly
        // with only the complete objects consumed.
        $visible = '';
        $meta = [];
        $raw = null;
        $this->streamMethod()->invokeArgs($this->serviceWithoutDb(), [
            $this->fakeResponse($mid),
            function (string $chunk) use (&$visible): void {
                $visible .= $chunk;
            },
            &$meta,
            &$raw,
        ]);

        $this->assertSame('one', $visible);
        $this->assertSame('one', $raw);
        $this->assertSame('MAX_TOKENS', $meta['finishReason']);
    }

    private function consume(string $payload, int $fragment): array
    {
        $visible = '';
        $ret = '';
        $meta = [];
        $raw = null;

        $stream = new FragmentStream($payload, $fragment);
        $ret = $this->streamMethod()->invokeArgs($this->serviceWithoutDb(), [
            $this->fakeResponse($stream),
            function (string $chunk) use (&$visible): void {
                $visible .= $chunk;
            },
            &$meta,
            &$raw,
        ]);

        return [$visible, $ret, $raw, $meta];
    }

    private function streamMethod(): \ReflectionMethod
    {
        $method = new \ReflectionMethod(GeminiAssistantService::class, 'streamGeminiContent');
        $method->setAccessible(true);

        return $method;
    }

    private function serviceWithoutDb(): GeminiAssistantService
    {
        $refl = new \ReflectionClass(GeminiAssistantService::class);

        return $refl->newInstanceWithoutConstructor();
    }

    private function fakeResponse(FragmentStream $stream): object
    {
        return new class($stream) {
            public function __construct(public readonly FragmentStream $stream)
            {
            }

            public function toPsrResponse(): object
            {
                return new class($this->stream) {
                    public function __construct(public readonly FragmentStream $body)
                    {
                    }

                    public function getBody(): FragmentStream
                    {
                        return $this->body;
                    }
                };
            }
        };
    }

    /**
     * A realistic two-object pretty-printed stream: a memo block in the first
     * object (braces live inside the text string) and plain text with braces
     * and escapes in the second.
     *
     * @return array{0: string, 1: string, 2: string} [full stream, visible, raw]
     */
    private function buildPayload(): array
    {
        $memo = ['type' => 'conversation', 'summary' => 'birthday note'];
        $delta1 = '```ai_memo ' . json_encode($memo) . "```\nHappy birthday, ";
        $delta2 = 'Braces {21} and {22} inside a string stay put; escaped "quote" and C:\\temp\\. ';

        $payload = $this->enclose([
            $this->candidate($delta1, ['finishReason' => '']),
            $this->candidate($delta2, ['finishReason' => 'STOP'], ['promptFeedback' => ['blockReason' => '']]),
        ]);

        return [$payload, "\nHappy birthday, " . $delta2, $delta1 . $delta2];
    }

    /**
     * Build one inner object of the top-level array. $candidateExtra is merged
     * into candidates[0] (e.g. finishReason); $topLevel extra object keys
     * (e.g. promptFeedback) sit next to candidates.
     */
    private function candidate(string $text, array $candidateExtra = [], array $topLevel = []): array
    {
        return array_merge([
            'candidates' => [
                array_merge([
                    'content' => ['parts' => [['text' => $text]], 'role' => 'model'],
                ], $candidateExtra),
            ],
        ], $topLevel);
    }

    private function enclose(array $objects): string
    {
        return json_encode($objects, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}

/**
 * Minimal PSR-7 stream that hands out at most $fragment bytes per read so the
 * scanner only ever sees tiny slices of the payload (worst-case delivery).
 */
class FragmentStream implements StreamInterface
{
    private int $offset = 0;

    public function __construct(
        private readonly string $data,
        private readonly int $fragment = 8,
    ) {
    }

    public function __toString(): string
    {
        return $this->data;
    }

    public function close(): void
    {
    }

    public function detach()
    {
        return null;
    }

    public function getSize(): ?int
    {
        return strlen($this->data);
    }

    public function tell(): int
    {
        return $this->offset;
    }

    public function eof(): bool
    {
        return $this->offset >= strlen($this->data);
    }

    public function isSeekable(): bool
    {
        return true;
    }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        $this->offset = $offset;
    }

    public function rewind(): void
    {
        $this->offset = 0;
    }

    public function isWritable(): bool
    {
        return false;
    }

    public function write(string $string): int
    {
        throw new \RuntimeException('read-only stream');
    }

    public function isReadable(): bool
    {
        return true;
    }

    public function read(int $length): string
    {
        if ($this->eof()) {
            return '';
        }
        $remaining = strlen($this->data) - $this->offset;
        $take = min($length, $this->fragment, $remaining);
        $slice = substr($this->data, $this->offset, $take);
        $this->offset += $take;

        return $slice;
    }

    public function getContents(): string
    {
        $rest = substr($this->data, $this->offset);
        $this->offset = strlen($this->data);

        return $rest;
    }

    public function getMetadata(?string $key = null)
    {
        return $key === null ? [] : null;
    }
}