<?php

namespace App\Http\Controllers;

use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleExtra;
use App\Models\Buyer;
use App\Models\Stock;
use App\Models\ReturnLog;
use App\Models\WarrantyRepair;
use App\Models\Store;
use App\Models\User;
use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SaleController extends Controller
{
    public function history(Request $request): Response
    {
        $user = $request->user();
        $storeId = $user->store_id;

        if ($user->role === 'superadmin' && $request->has('store_id')) {
            $storeId = $request->input('store_id');
        }

        $sales = Sale::with(['buyer', 'user', 'items.stock.brand', 'extras.extra', 'returns', 'repairs'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('created_at', 'desc')
            ->get();

        // Get list of affiliate users (employees/users) for checkout dropdown
        $affiliates = User::where('role', 'karyawan')->get();

        return Inertia::render('Sales/SalesHistory', [
            'sales' => $sales,
            'affiliates' => $affiliates,
            'stores' => Store::all(),
            'filters' => [
                'store_id' => $storeId
            ]
        ]);
    }

    public function checkout(Request $request): RedirectResponse
    {
        if ($request->has('buyer_phone')) {
            $phone = $request->input('buyer_phone');
            $phone = preg_replace('/[^0-9+]/', '', $phone);
            $phone = preg_replace('/^\+62/', '0', $phone);
            $phone = preg_replace('/^62/', '0', $phone);
            $request->merge(['buyer_phone' => $phone]);
        }

        if ($request->has('affiliate_user_id') && $request->input('affiliate_user_id') === '') {
            $request->merge(['affiliate_user_id' => null]);
        }

        $request->validate([
            'store_id' => 'nullable|exists:stores,id',
            'buyer_name' => 'required|string',
            'buyer_phone' => 'required|string',
            'buyer_address' => 'nullable|string',
            'payment_method' => 'required|in:cash,online',
            'payment_detail' => 'nullable|string',
            'dp_amount' => 'nullable|numeric|min:0',
            'status' => 'required|in:booking,completed',
            'affiliate_user_id' => 'nullable|exists:users,id',
            'affiliate_fee' => 'nullable|numeric|min:0',
            'transaction_date' => 'nullable|date',
            
            // Items purchased
            'items' => 'required|array|min:1',
            'items.*.stock_id' => 'required|exists:stocks,id',
            'items.*.qty' => 'required|integer|min:1',
            'items.*.actual_sell_price' => 'required|numeric|min:0',
            
            // Trade-in HP from buyer (optional)
            'trade_in' => 'nullable|array',
            'trade_in.name' => 'required_with:trade_in|string',
            'trade_in.brand_id' => 'required_with:trade_in|exists:dynamic_parameter_values,id',
            'trade_in.color_id' => 'required_with:trade_in|exists:dynamic_parameter_values,id',
            'trade_in.memory_id' => 'required_with:trade_in|exists:dynamic_parameter_values,id',
            'trade_in.license_id' => 'required_with:trade_in|exists:dynamic_parameter_values,id',
            'trade_in.serial_number' => 'required_with:trade_in|string|unique:stocks,serial_number',
            'trade_in.imei_1' => 'required_with:trade_in|string|unique:stocks,imei_1',
            'trade_in.buy_price' => 'required_with:trade_in|numeric|min:0', // nilai taksiran beli toko
            
            // Extras/Add-ons (optional)
            'extras' => 'nullable|array',
            'extras.*.extra_id' => 'required|exists:stocks,id',
            'extras.*.charge_to' => 'required|in:buyer,seller,free_promotion',
            'extras.*.sell_price' => 'required|numeric|min:0',
            'extras.*.buy_price' => 'required|numeric|min:0',
        ]);

        $user = $request->user();
        $storeId = $user->store_id;
        if ($user->role === 'superadmin' && $request->filled('store_id')) {
            $storeId = $request->input('store_id');
        }
        
        // Find active shift (optional — not required for checkout)
        $activeShift = DB::table('shifts')
            ->where('user_id', $user->id)
            ->where('store_id', $storeId)
            ->where('status', 'open')
            ->first();

        $sale = DB::transaction(function () use ($request, $user, $storeId, $activeShift) {
            // Find or create buyer
            $buyer = Buyer::firstOrCreate(
                ['phone' => $request->input('buyer_phone')],
                ['name' => $request->input('buyer_name'), 'address' => $request->input('buyer_address')]
            );

            // Compute total amount
            $totalAmount = 0;
            $itemsData = [];

            foreach ($request->input('items') as $item) {
                $stock = Stock::findOrFail($item['stock_id']);
                
                // Deduct inventory
                $soldStockId = $stock->id;
                if ($stock->category === 'accessories') {
                    if ($stock->qty < $item['qty']) {
                        throw new \Exception("Stok aksesoris '{$stock->name}' tidak mencukupi.");
                    }
                    $stock->decrement('qty', $item['qty']);
                    
                    // Create a separate sold stock record for tracking sold bulk items in Sale Data
                    $soldStock = $stock->replicate();
                    $soldStock->qty = $item['qty'];
                    $soldStock->status = 'sold';
                    $soldStock->serial_number = null;
                    $soldStock->imei_1 = null;
                    $soldStock->save();
                    
                    $soldStockId = $soldStock->id;

                    if ($stock->qty === 0) {
                        $stock->update(['status' => 'sold']);
                    }
                } else {
                    $stock->update(['status' => 'sold']);
                }

                $totalAmount += $item['actual_sell_price'] * $item['qty'];
                $itemsData[] = [
                    'stock_id' => $soldStockId,
                    'qty' => $item['qty'],
                    'actual_sell_price' => $item['actual_sell_price'],
                    'buy_price_snap' => $stock->buy_price,
                    'is_trade_in_item' => false
                ];
            }

            // Handle trade-in if any
            $tradeInAmount = 0;
            $tradeInStock = null;
            if ($request->has('trade_in') && $request->input('trade_in')) {
                $tradeIn = $request->input('trade_in');
                $tradeInAmount = $tradeIn['buy_price'];

                // Create new stock unit in inventory as second-hand available stock
                $tradeInStock = Stock::create([
                    'store_id' => $storeId,
                    'category' => 'iphone', // default category
                    'type' => 'second',
                    'name' => $tradeIn['name'],
                    'brand_id' => $tradeIn['brand_id'],
                    'color_id' => $tradeIn['color_id'],
                    'memory_id' => $tradeIn['memory_id'],
                    'license_id' => $tradeIn['license_id'],
                    'serial_number' => $tradeIn['serial_number'],
                    'imei_1' => $tradeIn['imei_1'],
                    'supplier' => 'Trade-In Customer: ' . $buyer->name,
                    'buy_price' => $tradeIn['buy_price'],
                    'sell_price' => $tradeIn['buy_price'] * 1.15,
                    'qty' => 1,
                    'status' => 'available',
                ]);
            }

            // Handle extras if any
            $extrasAmount = 0;
            $extrasData = [];
            if ($request->has('extras') && $request->input('extras')) {
                foreach ($request->input('extras') as $extra) {
                    // If charged to buyer, add to invoice total
                    if ($extra['charge_to'] === 'buyer') {
                        $extrasAmount += $extra['sell_price'];
                    }
                    $extrasData[] = [
                        'extra_id' => $extra['extra_id'],
                        'charge_to' => $extra['charge_to'],
                        'sell_price' => $extra['sell_price'],
                        'buy_price' => $extra['buy_price'],
                    ];
                }
            }

            // Net amount to pay: (items + buyer_extras) - trade_in_allowance
            $finalTotal = $totalAmount + $extrasAmount - $tradeInAmount;
            $finalTotal = max(0, $finalTotal);

            $sale = new Sale([
                'invoice_number' => 'INV-' . strtoupper(Str::random(3)) . '-' . date('YmdHis'),
                'store_id' => $storeId,
                'user_id' => $user->id,
                'buyer_id' => $buyer->id,
                'shift_id' => $activeShift?->id ?? null,
                'payment_method' => $request->input('payment_method'),
                'payment_detail' => $request->input('payment_detail'),
                'total_amount' => $finalTotal,
                'dp_amount' => $request->input('dp_amount') ?? 0,
                'status' => $request->input('status'),
                'affiliate_user_id' => $request->input('affiliate_user_id'),
                'affiliate_fee' => $request->input('affiliate_fee') ?? 0,
            ]);

            if ($request->filled('transaction_date')) {
                $sale->created_at = $request->input('transaction_date');
            }

            $sale->save();

            // Save sale items
            foreach ($itemsData as $item) {
                $sale->items()->create($item);
            }

            // If trade-in item was created, record it as a sold item connection with is_trade_in_item flag
            if ($tradeInStock) {
                $sale->items()->create([
                    'stock_id' => $tradeInStock->id,
                    'qty' => 1,
                    'actual_sell_price' => -$tradeInAmount,
                    'buy_price_snap' => $tradeInAmount,
                    'is_trade_in_item' => true
                ]);
            }

            // Save sale extras
            foreach ($extrasData as $extra) {
                $sale->extras()->create($extra);
            }

            // Log activity
            $itemsNames = [];
            foreach ($sale->items as $item) {
                if (!$item->is_trade_in_item && $item->stock) {
                    $itemsNames[] = $item->stock->name . ($item->stock->serial_number ? " (" . $item->stock->serial_number . ")" : "");
                }
            }
            ActivityLog::log('sale_checkout', Sale::class, $sale->id, [
                'invoice_number' => $sale->invoice_number,
                'total_amount' => $sale->total_amount,
                'buyer_name' => $buyer->name,
                'items_detail' => implode(', ', $itemsNames)
            ]);

            return $sale;
        });

        return redirect()->back()->with([
            'success' => 'Transaksi berhasil diselesaikan.',
            'invoice_number' => $sale->invoice_number,
        ]);
    }

    public function void(Request $request, $id): RedirectResponse
    {
        $request->validate([
            'void_reason' => 'required|string|min:5',
        ]);

        $user = $request->user();
        $sale = Sale::with(['items.stock'])->findOrFail($id);

        if ($sale->status === 'cancelled') {
            return redirect()->back()->withErrors(['error' => 'Transaksi sudah dibatalkan.']);
        }

        DB::transaction(function () use ($sale, $request, $user) {
            $sale->update([
                'status' => 'cancelled',
                'void_reason' => $request->input('void_reason'),
            ]);

            // Return items back to stock
            foreach ($sale->items as $item) {
                if (!$item->stock) continue;
                if ($item->is_trade_in_item) {
                    // Delete the trade-in stock that was created during checkout
                    $item->stock->delete();
                } else {
                    if ($item->stock->category === 'accessories') {
                        // The stock record on the item is a *sold replica* — find the original
                        // parent stock (same name, store, category) that still exists and restore qty
                        $originalStock = Stock::where('store_id', $item->stock->store_id)
                            ->where('category', 'accessories')
                            ->where('name', $item->stock->name)
                            ->where('id', '!=', $item->stock->id)
                            ->first();

                        if ($originalStock) {
                            $originalStock->increment('qty', $item->qty);
                            if ($originalStock->status === 'sold') {
                                $originalStock->update(['status' => 'available']);
                            }
                        }
                        // Delete the sold replica record
                        $item->stock->delete();
                    } else {
                        $item->stock->update(['status' => 'available']);
                    }
                }
            }

            ActivityLog::log('sale_void', Sale::class, $sale->id, [
                'invoice_number' => $sale->invoice_number,
                'void_reason' => $request->input('void_reason'),
                'voided_by' => $user->name,
            ]);
        });

        return redirect()->back()->with('success', 'Transaksi berhasil dibatalkan (void).');
    }

    // approveVoid kept for backward compatibility but redirects to void
    public function approveVoid(Request $request, $id): RedirectResponse
    {
        return redirect()->back()->with('info', 'Void langsung diproses tanpa persetujuan.');
    }

    public function returnItem(Request $request): RedirectResponse
    {
        $request->validate([
            'sale_id' => 'required|exists:sales,id',
            'stock_id' => 'required|exists:stocks,id',
            'restocking_fee' => 'required|numeric|min:0',
            'notes' => 'nullable|string',
        ]);

        $sale = Sale::findOrFail($request->input('sale_id'));
        $stock = Stock::findOrFail($request->input('stock_id'));

        // Check if item is part of sale
        $saleItem = SaleItem::where('sale_id', $sale->id)->where('stock_id', $stock->id)->first();
        if (!$saleItem) {
            return redirect()->back()->withErrors(['error' => 'Barang tidak cocok dengan transaksi.']);
        }

        DB::transaction(function () use ($request, $sale, $stock, $saleItem) {
            $refundAmount = ($saleItem->actual_sell_price * $saleItem->qty) - $request->input('restocking_fee');
            $refundAmount = max(0, $refundAmount);

            ReturnLog::create([
                'sale_id' => $sale->id,
                'stock_id' => $stock->id,
                'restocking_fee' => $request->input('restocking_fee'),
                'refund_amount' => $refundAmount,
                'notes' => $request->input('notes'),
            ]);

            // Revert stock
            if ($stock->category === 'accessories') {
                $stock->increment('qty', $saleItem->qty);
                $stock->update(['status' => 'available']);
            } else {
                $stock->update(['status' => 'available']);
            }

            ActivityLog::log('sale_return', Stock::class, $stock->id, [
                'invoice_number' => $sale->invoice_number,
                'stock_name' => $stock->name,
                'refund_amount' => $refundAmount,
                'restocking_fee' => $request->input('restocking_fee')
            ]);
        });

        return redirect()->back()->with('success', 'Retur barang berhasil dicatat.');
    }

    public function warrantyClaim(Request $request): RedirectResponse
    {
        $request->validate([
            'sale_id' => 'required|exists:sales,id',
            'stock_id' => 'required|exists:stocks,id',
            'damage_description' => 'required|string',
        ]);

        $repair = WarrantyRepair::create([
            'sale_id' => $request->input('sale_id'),
            'stock_id' => $request->input('stock_id'),
            'damage_description' => $request->input('damage_description'),
            'status' => 'pending',
        ]);

        $stock = Stock::find($request->input('stock_id'));

        ActivityLog::log('warranty_claim', WarrantyRepair::class, $repair->id, [
            'stock_name' => $stock ? $stock->name : '',
            'damage_description' => $repair->damage_description
        ]);

        return redirect()->back()->with('success', 'Klaim garansi servis berhasil diajukan.');
    }

    public function updateWarranty(Request $request, $id): RedirectResponse
    {
        $repair = WarrantyRepair::findOrFail($id);
        $user = $request->user();

        $request->validate([
            'status' => 'required|in:pending,approved,in_repair,repaired,rejected',
            'repair_cost' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string',
        ]);

        if ($user->role !== 'superadmin' && $request->input('status') === 'approved') {
            abort(403, 'Hanya superadmin yang dapat menyetujui klaim garansi.');
        }

        $repair->update([
            'status' => $request->input('status'),
            'repair_cost' => $request->input('repair_cost') ?? $repair->repair_cost,
            'notes' => $request->input('notes') ?? $repair->notes,
            'approved_by' => $user->role === 'superadmin' ? $user->id : $repair->approved_by
        ]);

        $stock = Stock::find($repair->stock_id);

        ActivityLog::log('warranty_update', WarrantyRepair::class, $repair->id, [
            'stock_name' => $stock ? $stock->name : '',
            'status' => $repair->status,
            'repair_cost' => $repair->repair_cost
        ]);

        return redirect()->back()->with('success', 'Status klaim garansi servis diperbarui.');
    }

    public function updateBuyer(Request $request, Sale $sale): RedirectResponse
    {
        $request->validate([
            'buyer_name' => 'required|string|max:255',
            'buyer_phone' => 'required|string|max:50',
            'buyer_address' => 'nullable|string|max:500',
        ]);

        $buyer = Buyer::find($sale->buyer_id);
        if (!$buyer) {
            return redirect()->back()->withErrors(['error' => 'Data pembeli tidak ditemukan.']);
        }

        $buyer->update([
            'name' => $request->input('buyer_name'),
            'phone' => $request->input('buyer_phone'),
            'address' => $request->input('buyer_address'),
        ]);

        ActivityLog::log('buyer_updated', Sale::class, $sale->id, [
            'invoice_number' => $sale->invoice_number,
            'buyer_name' => $buyer->name,
        ]);

        return redirect()->back()->with('success', 'Data pembeli berhasil diperbarui.');
    }

    public function publicInvoice($invoiceNumber)
    {
        $sale = Sale::with(['buyer', 'store', 'user', 'items.stock.brand', 'extras.extra'])
            ->where('invoice_number', $invoiceNumber)
            ->firstOrFail();

        return view('invoice.public', compact('sale'));
    }
}
