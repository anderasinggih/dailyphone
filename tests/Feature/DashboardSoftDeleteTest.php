<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Store;
use App\Models\Stock;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Buyer;
use App\Models\Shift;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardSoftDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_soft_deleted_stocks_are_not_counted_in_dashboard()
    {
        $superadmin = User::factory()->create([
            'role' => 'superadmin',
        ]);

        $store = Store::create([
            'name' => 'Main Store',
            'address' => 'Jakarta Barat',
            'latitude' => -6.2,
            'longitude' => 106.8,
        ]);

        $buyer = Buyer::create([
            'name' => 'John Doe',
            'phone' => '08123456789',
        ]);

        $shift = Shift::create([
            'user_id' => $superadmin->id,
            'store_id' => $store->id,
            'opened_at' => now(),
            'start_cash' => 500000,
            'status' => 'open',
        ]);

        // Create 2 stock units
        $stockActive = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 13 Active',
            'serial_number' => 'SN-ACTIVE-001',
            'imei_1' => 'IMEI-ACTIVE-001',
            'buy_price' => 5000000,
            'sell_price' => 6000000,
            'qty' => 1,
            'status' => 'sold',
        ]);

        $stockTrashed = Stock::create([
            'store_id' => $store->id,
            'category' => 'iphone',
            'type' => 'second',
            'name' => 'iPhone 14 Trashed',
            'serial_number' => 'SN-TRASH-002',
            'imei_1' => 'IMEI-TRASH-002',
            'buy_price' => 7000000,
            'sell_price' => 8500000,
            'qty' => 1,
            'status' => 'sold',
        ]);

        // Sale 1: for active stock
        $sale1 = Sale::create([
            'invoice_number' => 'INV-TEST-001',
            'store_id' => $store->id,
            'user_id' => $superadmin->id,
            'buyer_id' => $buyer->id,
            'shift_id' => $shift->id,
            'payment_method' => 'cash',
            'total_amount' => 6000000,
            'status' => 'completed',
        ]);

        SaleItem::create([
            'sale_id' => $sale1->id,
            'stock_id' => $stockActive->id,
            'qty' => 1,
            'actual_sell_price' => 6000000,
            'buy_price_snap' => 5000000,
            'is_trade_in_item' => false,
        ]);

        // Sale 2: for stock that will be trashed
        $sale2 = Sale::create([
            'invoice_number' => 'INV-TEST-002',
            'store_id' => $store->id,
            'user_id' => $superadmin->id,
            'buyer_id' => $buyer->id,
            'shift_id' => $shift->id,
            'payment_method' => 'online',
            'total_amount' => 8500000,
            'status' => 'completed',
        ]);

        SaleItem::create([
            'sale_id' => $sale2->id,
            'stock_id' => $stockTrashed->id,
            'qty' => 1,
            'actual_sell_price' => 8500000,
            'buy_price_snap' => 7000000,
            'is_trade_in_item' => false,
        ]);

        // Soft delete the second stock
        $stockTrashed->delete();
        $this->assertNotNull($stockTrashed->deleted_at);

        // Request dashboard
        $response = $this->actingAs($superadmin)->get(route('dashboard', [
            'month' => now()->month,
            'year' => now()->year,
        ]));

        $response->assertStatus(200);

        // Verify Inertia props
        $props = $response->original->getData()['page']['props'];

        // Only active stock should be counted
        $this->assertEquals(1, $props['stats']['soldItemsCount'], 'soldItemsCount must only count active items');
        $this->assertEquals(6000000, $props['stats']['totalRevenue'], 'totalRevenue must exclude trashed stock revenue');
        $this->assertEquals(5000000, $props['stats']['totalHpp'], 'totalHpp must exclude trashed stock HPP');

        // All time stats
        $this->assertEquals(1, $props['allTimeStats']['soldItems'], 'allTimeStats.soldItems must exclude trashed items');
        $this->assertEquals(6000000, $props['allTimeStats']['revenue'], 'allTimeStats.revenue must exclude trashed items');

        // Top products
        $topProductNames = collect($props['topProducts'])->pluck('name')->toArray();
        $this->assertContains('iPhone 13 Active', $topProductNames);
        $this->assertNotContains('iPhone 14 Trashed', $topProductNames, 'topProducts must not contain trashed product');

        // Type data
        $typeNames = collect($props['typeData'])->pluck('type')->toArray();
        $this->assertContains('iPhone 13 Active', $typeNames);
        $this->assertNotContains('iPhone 14 Trashed', $typeNames, 'typeData must not contain trashed product');

        // Today stats
        $this->assertEquals(1, $props['todayStats']['gabungan']['soldItems']);
        $this->assertEquals(6000000, $props['todayStats']['gabungan']['revenue']);

        // Now restore the trashed stock
        $stockTrashed->restore();
        $this->assertNull($stockTrashed->fresh()->deleted_at);

        // Fetch dashboard again
        $responseAfterRestore = $this->actingAs($superadmin)->get(route('dashboard', [
            'month' => now()->month,
            'year' => now()->year,
        ]));

        $propsAfterRestore = $responseAfterRestore->original->getData()['page']['props'];

        // Both stocks should now be counted
        $this->assertEquals(2, $propsAfterRestore['stats']['soldItemsCount'], 'soldItemsCount must recount restored item');
        $this->assertEquals(14500000, $propsAfterRestore['stats']['totalRevenue'], 'totalRevenue must include restored item');
        $this->assertEquals(12000000, $propsAfterRestore['stats']['totalHpp'], 'totalHpp must include restored item');
        $this->assertEquals(2, $propsAfterRestore['allTimeStats']['soldItems']);
        $this->assertEquals(14500000, $propsAfterRestore['allTimeStats']['revenue']);
    }
}

