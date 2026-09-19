<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Stock;
use App\Models\Store;
use App\Models\MoneyNote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiActionExecutionTest extends TestCase
{
    use RefreshDatabase;

    public function test_non_superadmin_cannot_execute_ai_action()
    {
        $karyawan = User::factory()->create([
            'role' => 'karyawan',
        ]);

        $response = $this->actingAs($karyawan)->postJson(route('assistant.execute'), [
            'action' => 'create_money_note',
            'payload' => [
                'type' => 'expense',
                'amount' => 50000,
                'category' => 'Operasional',
                'description' => 'Test expense',
            ],
        ]);

        $response->assertStatus(403);
    }

    public function test_superadmin_can_execute_create_money_note()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'create_money_note',
            'payload' => [
                'type' => 'expense',
                'amount' => 75000,
                'category' => 'Listrik & Air',
                'description' => 'Bayar galon air toko',
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
        ]);

        $this->assertDatabaseHas('money_notes', [
            'type' => 'expense',
            'amount' => 75000,
            'category' => 'Listrik & Air',
        ]);
    }

    public function test_superadmin_can_execute_update_stock_price()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'Cabang Utama',
            'address' => 'Jl. Test No. 1',
            'latitude' => -6.200000,
            'longitude' => 106.816666,
            'radius_meters' => 100,
        ]);

        $stock = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 13 128GB Starlight',
            'serial_number' => 'SN-IPHONE13-TEST',
            'imei_1' => 'IMEI-TEST-123456789',
            'warranty_duration_days' => 30,
            'buy_price' => 7500000,
            'sell_price' => 9500000,
            'qty' => 1,
            'status' => 'available',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'update_stock',
            'payload' => [
                'stock_id' => $stock->id,
                'sell_price' => 9200000,
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
        ]);

        $this->assertEquals(9200000, (float)$stock->fresh()->sell_price);
    }

    public function test_superadmin_can_execute_python_script()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'run_python_script',
            'payload' => [
                'code' => 'print("DAILYPHONE_AI_PYTHON_OK")',
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'output' => 'DAILYPHONE_AI_PYTHON_OK',
        ]);
    }

    public function test_superadmin_can_generate_downloadable_files_via_python()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'run_python_script',
            'payload' => [
                'code' => <<<'PY'
import os, csv
with open('test_report.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Unit', 'Harga'])
    w.writerow(['iPhone 13', '7299000'])
with open('output.txt', 'w') as f:
    f.write('generated-artifact')
print('FILES_GENERATED')
PY
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
            'output' => 'FILES_GENERATED',
        ]);

        $fileNames = collect($response->json('files'))->pluck('name')->all();
        $this->assertContains('test_report.csv', $fileNames);
        $this->assertContains('output.txt', $fileNames);

        // The generated file URL must be reachable (validates path traversal guard too)
        $url = collect($response->json('files'))->firstWhere('name', 'test_report.csv')['url'] ?? null;
        $this->assertNotNull($url);
        $this->actingAs($superadmin)->get($url)->assertOk();

        // Superadmin-only: a plain user cannot download generated files
        $user = User::factory()->create(['role' => 'karyawan']);
        $this->actingAs($user)->get($url)->assertForbidden();
    }

    public function test_superadmin_can_execute_sell_stock_with_validation()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'Cabang Sudirman',
            'address' => 'Jl. Sudirman No. 10',
            'latitude' => -6.200000,
            'longitude' => 106.816666,
            'radius_meters' => 100,
        ]);

        $stock = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 13 128GB Midnight',
            'serial_number' => 'SN-MIDNIGHT-001',
            'imei_1' => 'IMEI-MIDNIGHT-001',
            'warranty_duration_days' => 30,
            'buy_price' => 7500000,
            'sell_price' => 9500000,
            'qty' => 1,
            'status' => 'available',
        ]);

        // Attempt sell without buyer name should fail
        $failResponse = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'sell_stock',
            'payload' => [
                'stock_id' => $stock->id,
                'buyer_name' => '',
            ],
        ]);
        $failResponse->assertJson(['success' => false]);

        // Valid sell request
        $successResponse = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'sell_stock',
            'payload' => [
                'stock_id' => $stock->id,
                'buyer_name' => 'Ahmad Rian',
                'buyer_phone' => '081299887766',
                'actual_sell_price' => 9300000,
                'payment_method' => 'bca',
            ],
        ]);

        $successResponse->assertStatus(200);
        $successResponse->assertJson(['success' => true]);

        // Verify stock is now sold
        $this->assertEquals('sold', $stock->fresh()->status);

        // Verify sale record created
        $this->assertDatabaseHas('sales', [
            'total_amount' => 9300000,
            'payment_method' => 'bca',
            'status' => 'completed',
        ]);
    }

    public function test_superadmin_can_execute_add_stock()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'PERENG STORE',
            'address' => 'Pereng Branch',
            'latitude' => -7.4244,
            'longitude' => 109.2301,
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'add_stock',
            'payload' => [
                'name' => 'iPhone 12 128GB Blue',
                'store_id' => $store->id,
                'category' => 'iphone',
                'type' => 'second',
                'buy_price' => 5000000,
                'sell_price' => 6500000,
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        $this->assertDatabaseHas('stocks', [
            'name' => 'iPhone 12 128GB Blue',
            'store_id' => $store->id,
            'sell_price' => 6500000,
            'status' => 'available',
        ]);
    }

    public function test_superadmin_can_execute_delete_stock()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'PERENG STORE',
            'address' => 'Pereng Branch',
            'latitude' => -7.4244,
            'longitude' => 109.2301,
        ]);

        $stock = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 11 64GB Black',
            'serial_number' => 'DP-DEL-TEST',
            'imei_1' => 'IMEI-DEL-TEST',
            'warranty_duration_days' => 30,
            'buy_price' => 3500000,
            'sell_price' => 4500000,
            'qty' => 1,
            'status' => 'available',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'delete_stock',
            'payload' => [
                'stock_id' => $stock->id,
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson(['success' => true]);

        $this->assertSoftDeleted('stocks', [
            'id' => $stock->id,
        ]);
    }

    public function test_superadmin_can_update_proposal_status_and_persists()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $chat = \App\Models\AiChat::create([
            'user_id' => $superadmin->id,
            'role' => 'assistant',
            'content' => '```action_proposal {"action":"update_stock","payload":{"stock_id":1}} ```',
            'action_status' => 'pending',
        ]);

        $response = $this->actingAs($superadmin)->postJson(route('assistant.proposal-status'), [
            'message_id' => $chat->id,
            'status' => 'rejected',
        ]);

        $response->assertStatus(200);
        $response->assertJson(['success' => true, 'status' => 'rejected']);

        $this->assertEquals('rejected', $chat->fresh()->action_status);
    }

    public function test_superadmin_can_undo_executed_add_stock_action()
    {
        $superadmin = User::factory()->create([
            'email' => 'superadmin@gmail.com',
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'PERENG STORE',
            'address' => 'Pereng Branch',
            'latitude' => -7.4244,
            'longitude' => 109.2301,
        ]);

        $chat = \App\Models\AiChat::create([
            'user_id' => $superadmin->id,
            'role' => 'assistant',
            'content' => '```action_proposal {"action":"add_stock"} ```',
            'action_status' => 'pending',
        ]);

        // 1. Execute add stock
        $execResponse = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'add_stock',
            'payload' => [
                'name' => 'iPhone 13 128GB Pink',
                'store_id' => $store->id,
                'sell_price' => 7000000,
                'buy_price' => 5500000,
            ],
            'message_id' => $chat->id,
        ]);

        $execResponse->assertStatus(200);
        $execResponse->assertJson(['success' => true]);

        $stock = Stock::where('name', 'iPhone 13 128GB Pink')->first();
        $this->assertNotNull($stock);
        $this->assertEquals('superadmin@gmail.com (AI)', $stock->created_by);
        $this->assertEquals('executed', $chat->fresh()->action_status);

        // 2. Undo execution
        $undoResponse = $this->actingAs($superadmin)->postJson(route('assistant.undo'), [
            'message_id' => $chat->id,
        ]);

        $undoResponse->assertStatus(200);
        $undoResponse->assertJson(['success' => true]);

        // Stock was force deleted by undo
        $this->assertNull(Stock::where('name', 'iPhone 13 128GB Pink')->first());
        $this->assertEquals('pending', $chat->fresh()->action_status);
    }

    public function test_superadmin_can_add_stock_which_restores_from_trash_if_imei_exists()
    {
        $superadmin = User::factory()->create([
            'email' => 'admin@housephone.com',
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'PERENG STORE',
            'address' => 'Pereng Branch',
            'latitude' => -7.4244,
            'longitude' => 109.2301,
        ]);

        // 1. Create a stock and soft delete it (moved to trash)
        $stock = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 13 128GB Pink',
            'serial_number' => 'DP-IP-D067FX',
            'imei_1' => '357891234567891',
            'warranty_duration_days' => 30,
            'buy_price' => 4500000,
            'sell_price' => 5750000,
            'qty' => 1,
            'status' => 'available',
        ]);

        $stock->delete(); // Soft delete into trash
        $this->assertTrue($stock->fresh()->trashed());

        // 2. User asks AI to add the same IMEI back via add_stock
        $response = $this->actingAs($superadmin)->postJson(route('assistant.execute'), [
            'action' => 'add_stock',
            'payload' => [
                'name' => 'iPhone 13 128GB Pink',
                'store_id' => $store->id,
                'imei_1' => '357891234567891',
                'serial_number' => 'DP-IP-D067FX',
                'buy_price' => 4500000,
                'sell_price' => 5750000,
            ],
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
        ]);

        // Unit should be restored, not throwing duplicate constraint violation
        $restoredStock = Stock::where('imei_1', '357891234567891')->first();
        $this->assertNotNull($restoredStock);
        $this->assertFalse($restoredStock->trashed());
        $this->assertEquals('admin@housephone.com (AI)', $restoredStock->created_by);
        $this->assertStringContainsString('dipulihkan dari keranjang sampah', $response->json('message'));
    }
}

