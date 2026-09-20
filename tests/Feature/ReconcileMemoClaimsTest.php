<?php

namespace Tests\Feature;

use App\Http\Controllers\AiAssistantController;
use App\Models\AiTrainingNote;
use App\Models\User;
use App\Services\AiActionService;
use App\Services\GeminiAssistantService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The model sometimes claims a memory was saved ("📝 Node baru: ...", "sudah
 * tersimpan") without ever emitting a real ```ai_memo block, so nothing would
 * be persisted. reconcileMemoClaims() must either reconstruct + really save the
 * node, or rewrite the claim so it no longer deceives the user.
 */
class ReconcileMemoClaimsTest extends TestCase
{
    use RefreshDatabase;

    private function reconcile(
        array $result,
        string $userText,
        string $ingestNotice = '',
        ?User $user = null,
        string $priorUserText = '',
    ): array {
        $controller = app(AiAssistantController::class, [
            'geminiService' => app(GeminiAssistantService::class),
            'aiActionService' => app(AiActionService::class),
        ]);
        $method = new \ReflectionMethod(AiAssistantController::class, 'reconcileMemoClaims');
        $method->setAccessible(true);

        $owner = $user ?? User::factory()->create();
        $method->invokeArgs($controller, [&$result, $owner, $userText, $ingestNotice, $priorUserText]);

        return $result;
    }

    public function test_reconstructs_and_persists_node_for_a_bare_node_claim(): void
    {
        $userText = 'Dewi punya adik bernama Dewi Puspita Sari';

        $result = $this->reconcile([
            'success' => true,
            'reply' => 'Oke, sudah kucatat. 📝 Node baru: Adik Dewi Puspita Sari',
            'raw_reply' => 'Oke, sudah kucatat. 📝 Node baru: Adik Dewi Puspita Sari',
        ], $userText);

        $note = AiTrainingNote::where('content', 'Adik Dewi Puspita Sari')->first();
        $this->assertNotNull($note, 'reconstructed memo must be really persisted');
        $this->assertSame('identity', $note->kind);

        // Visible reply keeps its (now truthful) confirmation…
        $this->assertStringContainsString('Adik Dewi Puspita Sari', $result['reply']);
        // …and the raw text gains the block the normal persistence path needs.
        $this->assertStringContainsString('```ai_memo', $result['raw_reply']);
    }

    public function test_leaves_claim_alone_when_a_real_memo_block_exists(): void
    {
        $raw = "Sudah kusimpan.\n```ai_memo\n{\"kind\":\"note\",\"content\":\"Yaya adalah adik Singgih\"}\n```";

        $result = $this->reconcile([
            'success' => true,
            'reply' => 'Sudah kusimpan.',
            'raw_reply' => $raw,
        ], 'Yaya adalah adik Singgih');

        $this->assertSame('Sudah kusimpan.', $result['reply']);
        $this->assertSame($raw, $result['raw_reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_corrects_claim_when_reconstruction_collides_with_an_existing_node(): void
    {
        AiTrainingNote::create([
            'user_id' => null,
            'author_name' => 'Test',
            'author_role' => 'system',
            'content' => 'iPhone 13 memasuki masa promo bulan ini',
            'title' => 'Promo iPhone 13',
            'content_hash' => md5('iPhone 13 memasuki masa promo bulan ini'),
            'kind' => 'note',
            'is_active' => true,
        ]);

        $result = $this->reconcile([
            'success' => true,
            'reply' => '📝 Node baru: iPhone 13 memasuki masa promo bulan ini',
            'raw_reply' => '📝 Node baru: iPhone 13 memasuki masa promo bulan ini',
        ], 'catat promo iphone 13');

        // The claim must be rewritten instead of deceiving the user.
        $this->assertStringContainsString('gagal', $result['reply']);
        $this->assertStringNotContainsString('📝', $result['reply']);
        $this->assertStringNotContainsString('```ai_memo', $result['raw_reply']);
        $this->assertSame(1, AiTrainingNote::count());
    }

    public function test_does_not_touch_negated_or_hypothetical_claims(): void
    {
        $negated = 'Mohon maaf, info ini belum tersimpan ke node memori.';

        $result = $this->reconcile([
            'success' => true,
            'reply' => $negated,
            'raw_reply' => $negated,
        ], 'simpan sesuatu');

        $this->assertSame($negated, $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_skips_reconciliation_for_system_made_ingest_claims(): void
    {
        $claim = '📝 Node baru: materi sudah tersimpan lewat sistem.';

        $result = $this->reconcile([
            'success' => true,
            'reply' => $claim,
            'raw_reply' => $claim,
        ], 'pelajari link ini', 'SISTEM INGEST (FAKTUAL): dokumen tersambung ke neuron network.');

        $this->assertSame($claim, $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_leaves_plain_replies_untouched(): void
    {
        $reply = 'Stok iPhone 13 ready di cabang utama. Harganya Rp 6.999.000.';

        $result = $this->reconcile([
            'success' => true,
            'reply' => $reply,
            'raw_reply' => $reply,
        ], 'berapa harga iphone 13?');

        $this->assertSame($reply, $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_does_not_reconcile_failure_results(): void
    {
        $result = $this->reconcile([
            'success' => false,
            'reply' => 'Maaf, sistem mengalami kendala.',
            'raw_reply' => 'Maaf, sistem mengalami kendala.',
        ], 'simpan');

        $this->assertSame('Maaf, sistem mengalami kendala.', $result['reply']);
    }

    public function test_stores_the_value_not_the_acknowledgment_for_lone_value_claims(): void
    {
        $result = $this->reconcile([
            'success' => true,
            'reply' => 'NIM Dewi berhasil dicatat.',
            'raw_reply' => 'NIM Dewi berhasil dicatat.',
        ], '052870905', '', null, 'emang udah aku sebutin niminya?');

        // The memory must contain the real fact, never the chat reply text.
        $note = AiTrainingNote::where('content', 'NIM Dewi: 052870905')->first();
        $this->assertNotNull($note, 'reconstructed memo must persist the value');
        $this->assertSame(0, AiTrainingNote::where('content', 'like', '%berhasil dicatat%')->count());
        $this->assertStringContainsString('```ai_memo', $result['raw_reply']);
    }

    public function test_does_not_store_node_naming_acknowledgments_as_memory(): void
    {
        $result = $this->reconcile([
            'success' => true,
            'reply' => 'Node baru tersebut saya beri nama "NIM Dewi".',
            'raw_reply' => 'Node baru tersebut saya beri nama "NIM Dewi".',
        ], 'apa nama nodenya');

        // No factual memory is recoverable → the claim is corrected, no junk node.
        $this->assertSame(0, AiTrainingNote::count());
        $this->assertStringNotContainsString('```ai_memo', $result['raw_reply']);
        $this->assertStringContainsString('gagal', $result['reply']);
    }

    public function test_does_not_store_repair_acknowledgments_without_a_user_value(): void
    {
        $result = $this->reconcile([
            'success' => true,
            'reply' => 'Sekarang saya perbarui dengan memasukkan nomor NIM 052870905 ke dalam catatan memorinya supaya tersimpan lengkap dan akurat di jaringan neuron.',
            'raw_reply' => 'Sekarang saya perbarui dengan memasukkan nomor NIM 052870905 ke dalam catatan memorinya supaya tersimpan lengkap dan akurat di jaringan neuron.',
        ], 'kok aku liat di description nodenya gaada nomer nimnya', '', null, 'berapa nimnya');

        $this->assertSame(0, AiTrainingNote::count());
        $this->assertStringNotContainsString('```ai_memo', $result['raw_reply']);
    }

    public function test_corrects_fabricated_node_count_claims(): void
    {
        $reply = 'Tadi sudah kusimpan 4 node baru berisi materi OWS Huawei.';

        $result = $this->reconcile([
            'success' => true,
            'reply' => $reply,
            'raw_reply' => $reply,
        ], 'belajar ows');

        // No database statistic existed → the invented number must be neutralised.
        $this->assertStringNotContainsString('4 node', $result['reply']);
        $this->assertStringNotContainsString('berhasil', $result['reply']);
        $this->assertStringContainsString('tidak dapat dipastikan', $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_corrects_contradictory_count_claims(): void
    {
        $reply = 'Belum tersimpan ada 4 node gagal dibuat yang berhasil ditambahkan dan dihubungkan ke graf.';

        $result = $this->reconcile([
            'success' => true,
            'reply' => $reply,
            'raw_reply' => $reply,
        ], 'sesi ini udah nambah berapa node?');

        $this->assertStringNotContainsString('berhasil ditambahkan', $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }

    public function test_allows_count_that_matches_real_database_statistics(): void
    {
        $controller = app(AiAssistantController::class, [
            'geminiService' => app(GeminiAssistantService::class),
            'aiActionService' => app(AiActionService::class),
        ]);
        $prop = new \ReflectionProperty(AiAssistantController::class, 'nodeStatsForGuard');
        $prop->setAccessible(true);
        $prop->setValue($controller, ['total' => 11, 'active' => 11, 'today' => 0, 'since_session' => 0]);

        $reply = 'Saat ini total node tersimpan = 11 di jaringan neuron.';

        $owner = User::factory()->create();
        $result = [
            'success' => true,
            'reply' => $reply,
            'raw_reply' => $reply,
        ];
        $method = new \ReflectionMethod(AiAssistantController::class, 'reconcileMemoClaims');
        $method->setAccessible(true);
        $method->invokeArgs($controller, [&$result, $owner, 'berapa total node?', '']);

        $this->assertSame($reply, $result['reply']);
        $this->assertSame(0, AiTrainingNote::count());
    }
}