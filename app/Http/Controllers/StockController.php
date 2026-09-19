<?php

namespace App\Http\Controllers;

use App\Models\Stock;
use App\Models\Store;
use App\Models\DynamicParameter;
use App\Models\DynamicParameterValue;
use App\Models\Buyer;
use App\Models\StockTransfer;
use App\Models\User;
use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class StockController extends Controller
{
    public function readyStock(Request $request): Response
    {
        $user = $request->user();
        $storeId = $user->store_id;

        // Superadmin and Viewer can view specific stores, otherwise default to all
        if (($user->role === 'superadmin' || $user->role === 'viewer') && $request->has('store_id')) {
            $storeId = $request->input('store_id');
        }

        // For superadmin/viewer: use the storeId from request filter (can be null = all stores)
        // For regular employees: always scope to their own store_id
        $isSuperOrViewer = in_array($user->role, ['superadmin', 'viewer']);

        $stocks = Stock::where('status', 'available')
            ->when(!$isSuperOrViewer && $user->store_id, fn($q) => $q->where('store_id', $user->store_id))
            ->when($isSuperOrViewer && $storeId, fn($q) => $q->where('store_id', $storeId))
            ->with(['brand', 'color', 'memory', 'license', 'parameterValues.value', 'parameterValues.parameter'])
            ->get();

        // Get list of other stores for Stock Transfer options
        $stores = Store::where('id', '!=', $user->store_id)->get();

        // Pending transfer requests incoming to this store or requested by this store
        $transfers = StockTransfer::with(['stock.brand', 'fromStore', 'toStore', 'requester'])
            ->where(function ($q) use ($user) {
                if ($user->store_id) {
                    $q->where('from_store_id', $user->store_id)
                      ->orWhere('to_store_id', $user->store_id);
                }
            })
            ->orderBy('created_at', 'desc')
            ->get();

        $parameters = DynamicParameter::with(['values' => function($q) {
            $q->where('is_active', true);
        }])->get();

        $buyers = Buyer::orderBy('name', 'asc')->get();

        return Inertia::render('Stocks/ReadyStock', [
            'stocks' => $stocks,
            'stores' => $stores,
            'transfers' => $transfers,
            'storesFilter' => Store::all(),
            'parameters' => $parameters,
            'users' => User::orderBy('name', 'asc')->get(),
            'buyers' => $buyers,
            'filters' => [
                'store_id' => $storeId,
            ]
        ]);
    }

    public function manageStock(Request $request): Response
    {
        $user = $request->user();
        $storeId = $user->store_id;

        if (($user->role === 'superadmin' || $user->role === 'viewer') && $request->has('store_id')) {
            $storeId = $request->input('store_id');
        }

        // Same pattern: superadmin/viewer use storeId from filter; employees scoped to their store
        $isSuperOrViewer = in_array($user->role, ['superadmin', 'viewer']);

        $stocks = Stock::withTrashed()->with([
            'store',
            'brand',
            'color',
            'memory',
            'license',
            'saleItems.sale.buyer',
            'saleItems.sale.affiliateUser',
            'saleItems.sale.extras.extra',
            'saleItems.sale.items',
            'parameterValues.value',
            'parameterValues.parameter'
        ])
        ->when(!$isSuperOrViewer && $user->store_id, fn($q) => $q->where('store_id', $user->store_id))
        ->when($isSuperOrViewer && $storeId, fn($q) => $q->where('store_id', $storeId))
        ->get();
        
        $stores = Store::all();
        
        $parameters = DynamicParameter::with(['values' => function($q) {
            $q->where('is_active', true);
        }])->get();

        return Inertia::render('Stocks/ManageStock', [
            'stocks' => $stocks,
            'stores' => $stores,
            'parameters' => $parameters,
            'filters' => [
                'store_id' => $storeId,
            ]
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            abort(403);
        }

        $validated = $request->validate([
            'store_id' => 'required',
            'category' => 'required|in:iphone,android,accessories,extra',
            'type' => 'required|in:new,second',
            'name' => 'required|string',
            'brand_id' => 'nullable|exists:dynamic_parameter_values,id',
            'color_id' => 'nullable|exists:dynamic_parameter_values,id',
            'memory_id' => 'nullable|exists:dynamic_parameter_values,id',
            'license_id' => 'nullable|exists:dynamic_parameter_values,id',
            'serial_number' => 'nullable|string|unique:stocks,serial_number',
            'imei_1' => 'nullable|string|unique:stocks,imei_1',
            'supplier' => 'nullable|string',
            'warranty_duration_days' => 'required|integer|min:0',
            'buy_price' => 'required|numeric|min:0',
            'sell_price' => 'required|numeric|min:0',
            'sell_price_reseller' => 'nullable|numeric|min:0',
            'qty' => 'required|integer|min:1',
            'default_charge_to' => 'nullable|in:buyer,seller,free_promotion',
            'parameter_values' => 'nullable|array',
        ]);
        
        if ($validated['store_id'] === 'all') {
            $stores = Store::all();
            DB::transaction(function() use ($validated, $stores, $user, $request) {
                foreach ($stores as $store) {
                    $data = $validated;
                    $data['store_id'] = $store->id;
                    $data['created_by'] = $user->email ?? $user->name;
                    $stock = Stock::create($data);
                    $stock->syncDynamicParameters($request->input('parameter_values', []));
                    ActivityLog::log('add_stock', Stock::class, $stock->id, $stock->toArray());
                }
            });
            return redirect()->back()->with('success', 'Stok berhasil ditambahkan untuk semua cabang.');
        } else {
            $request->validate(['store_id' => 'exists:stores,id']);
            $data = $validated;
            $data['created_by'] = $user->email ?? $user->name;
            $stock = Stock::create($data);
            $stock->syncDynamicParameters($request->input('parameter_values', []));
            ActivityLog::log('add_stock', Stock::class, $stock->id, $stock->toArray());
            return redirect()->back()->with('success', 'Stok berhasil ditambahkan.');
        }
    }

    public function storeBatch(Request $request): RedirectResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            abort(403);
        }

        $request->validate([
            'store_id' => 'required|exists:stores,id',
            'category' => 'required|in:iphone,android',
            'type' => 'required|in:new,second',
            'name' => 'required|string',
            'brand_id' => 'nullable|exists:dynamic_parameter_values,id',
            'color_id' => 'nullable|exists:dynamic_parameter_values,id',
            'memory_id' => 'nullable|exists:dynamic_parameter_values,id',
            'license_id' => 'nullable|exists:dynamic_parameter_values,id',
            'supplier' => 'nullable|string',
            'warranty_duration_days' => 'required|integer|min:0',
            'buy_price' => 'required|numeric|min:0',
            'sell_price' => 'required|numeric|min:0',
            'sell_price_reseller' => 'nullable|numeric|min:0',
            'items' => 'required|array|min:1',
            'items.*.serial_number' => 'nullable|string|distinct|unique:stocks,serial_number',
            'items.*.imei_1' => 'nullable|string|distinct|unique:stocks,imei_1',
        ]);

        $createdCount = 0;
        $creatorTag = $user->email ?? $user->name;

        DB::transaction(function() use ($request, &$createdCount, $creatorTag) {
            foreach ($request->input('items') as $item) {
                if (empty($item['serial_number']) && empty($item['imei_1'])) {
                    continue;
                }

                $stock = Stock::create([
                    'store_id' => $request->input('store_id'),
                    'category' => $request->input('category'),
                    'type' => $request->input('type'),
                    'name' => $request->input('name'),
                    'brand_id' => $request->input('brand_id'),
                    'color_id' => $request->input('color_id'),
                    'memory_id' => $request->input('memory_id'),
                    'license_id' => $request->input('license_id'),
                    'serial_number' => $item['serial_number'],
                    'imei_1' => $item['imei_1'],
                    'supplier' => $request->input('supplier'),
                    'warranty_duration_days' => $request->input('warranty_duration_days'),
                    'buy_price' => $request->input('buy_price'),
                    'sell_price' => $request->input('sell_price'),
                    'sell_price_reseller' => $request->input('sell_price_reseller'),
                    'qty' => 1,
                    'status' => 'available',
                    'created_by' => $creatorTag,
                ]);
                ActivityLog::log('add_stock', Stock::class, $stock->id, $stock->toArray());
            }
        });

        return redirect()->back()->with('success', 'Batch stok berhasil ditambahkan.');
    }

    public function transfer(Request $request): RedirectResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            return redirect()->back()->withErrors(['error' => 'Hanya Superadmin yang memiliki akses untuk melakukan mutasi unit.']);
        }

        $request->validate([
            'stock_id' => 'required|exists:stocks,id',
            'to_store_id' => 'required|exists:stores,id',
        ]);

        $stock = Stock::findOrFail($request->input('stock_id'));
        if ($stock->status !== 'available') {
            return redirect()->back()->withErrors(['error' => 'Barang tidak tersedia untuk mutasi.']);
        }

        DB::transaction(function () use ($request, $stock) {
            // Create transfer record as already approved
            $transfer = StockTransfer::create([
                'stock_id' => $stock->id,
                'from_store_id' => $stock->store_id,
                'to_store_id' => $request->input('to_store_id'),
                'requested_by' => $request->user()->id,
                'approved_by' => $request->user()->id,
                'status' => 'approved',
            ]);

            // Instantly move the stock to the destination store
            $stock->update([
                'store_id' => $request->input('to_store_id'),
                'status' => 'available',
            ]);

            ActivityLog::log('stock_transfer_initiated', Stock::class, $stock->id, [
                'from_store_id' => $transfer->from_store_id,
                'to_store_id' => $transfer->to_store_id,
                'transfer_id' => $transfer->id,
                'stock_name' => $stock->name,
                'serial_number' => $stock->serial_number
            ]);
        });

        return redirect()->back()->with('success', 'Unit berhasil dimutasi secara langsung.');
    }

    public function approveTransfer(Request $request, $id): RedirectResponse
    {
        $transfer = StockTransfer::findOrFail($id);
        $user = $request->user();

        // Must be the owner of the destination store or Superadmin to approve/receive
        if ($user->role !== 'superadmin' && $user->store_id !== $transfer->to_store_id) {
            abort(403);
        }

        DB::transaction(function () use ($transfer, $user) {
            $transfer->update([
                'approved_by' => $user->id,
                'status' => 'approved',
            ]);

            $transfer->stock->update([
                'store_id' => $transfer->to_store_id,
                'status' => 'available',
            ]);

            ActivityLog::log('stock_transfer_approved', Stock::class, $transfer->stock_id, [
                'from_store_id' => $transfer->from_store_id,
                'to_store_id' => $transfer->to_store_id,
                'transfer_id' => $transfer->id,
                'stock_name' => $transfer->stock->name,
                'serial_number' => $transfer->stock->serial_number
            ]);
        });

        return redirect()->back()->with('success', 'Mutasi stok berhasil disetujui.');
    }

    public function storeParameter(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $request->validate([
            'name' => 'required|string|max:100',
            'category' => 'required|in:iphone,android,global',
        ]);

        DynamicParameter::create([
            'name' => $request->input('name'),
            'category' => $request->input('category'),
        ]);

        return redirect()->back()->with('success', 'Parameter created successfully.');
    }

    public function storeParameterValue(Request $request): RedirectResponse
    {
        $request->validate([
            'parameter_id' => 'required|exists:dynamic_parameters,id',
            'value' => 'required|string|max:100',
            'color' => 'nullable|string|max:50',
        ]);

        DynamicParameterValue::create([
            'parameter_id' => $request->input('parameter_id'),
            'value' => $request->input('value'),
            'color' => $request->input('color', 'blue'),
            'is_active' => true,
        ]);

        return redirect()->back()->with('success', 'Parameter option added successfully.');
    }

    public function updateParameterValue(Request $request, $id): RedirectResponse
    {
        $request->validate([
            'value' => 'required|string|max:100',
            'color' => 'nullable|string|max:50',
        ]);

        $val = DynamicParameterValue::with('parameter')->findOrFail($id);
        $oldValue = $val->value;
        $newValue = $request->input('value');
        $newColor = $request->input('color', $val->color);

        $val->update([
            'value' => $newValue,
            'color' => $newColor,
        ]);

        // If this option belongs to "Customer Flags", cascade update to all buyers holding the old value
        if ($val->parameter && str_contains(strtolower($val->parameter->name), 'flag')) {
            \App\Models\Buyer::where('flag', $oldValue)->update(['flag' => $newValue]);
        }

        return redirect()->back()->with('success', 'Parameter option updated successfully.');
    }

    public function toggleParameterValue(Request $request, $id): RedirectResponse
    {
        $val = DynamicParameterValue::findOrFail($id);
        $val->update(['is_active' => !$val->is_active]);

        return redirect()->back()->with('success', 'Parameter status updated.');
    }

    public function deleteParameterValue(Request $request, $id): RedirectResponse
    {
        $val = DynamicParameterValue::findOrFail($id);
        $val->delete();

        return redirect()->back()->with('success', 'Parameter option deleted.');
    }

    public function destroyParameter(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $param = DynamicParameter::with('values')->findOrFail($id);
        $valueIds = $param->values->pluck('id');

        if ($valueIds->isNotEmpty()) {
            $usedCount = Stock::where(function ($q) use ($valueIds) {
                $q->whereIn('brand_id', $valueIds)
                    ->orWhereIn('color_id', $valueIds)
                    ->orWhereIn('memory_id', $valueIds)
                    ->orWhereIn('license_id', $valueIds);
            })->count();

            if ($usedCount > 0) {
                return redirect()->back()->with('error', "Parameter '{$param->name}' gagal dihapus karena masih dipakai oleh {$usedCount} unit stok. Kosongkan dulu pemakaian opsinya pada stok, lalu ulangi.");
            }
        }

        try {
            $param->delete();
        } catch (\Throwable $e) {
            return redirect()->back()->with('error', "Parameter '{$param->name}' gagal dihapus: " . $e->getMessage());
        }

        return redirect()->back()->with('success', "Parameter '{$param->name}' deleted successfully.");
    }

    public function parameters(Request $request): Response
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $parameters = DynamicParameter::with(['values' => function($q) {
            $q->orderBy('value', 'asc');
        }])->get();

        return Inertia::render('Settings/Parameters', [
            'parameters' => $parameters,
        ]);
    }

    public function update(Request $request, Stock $stock): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'category' => 'required|in:iphone,android,accessories,extra',
            'type' => 'required|in:new,second',
            'name' => 'required|string|max:255',
            'brand_id' => 'nullable|exists:dynamic_parameter_values,id',
            'color_id' => 'nullable|exists:dynamic_parameter_values,id',
            'memory_id' => 'nullable|exists:dynamic_parameter_values,id',
            'license_id' => 'nullable|exists:dynamic_parameter_values,id',
            'serial_number' => 'nullable|string|max:255',
            'imei_1' => 'nullable|string|max:255',
            'supplier' => 'nullable|string|max:255',
            'warranty_duration_days' => 'required|integer|min:0',
            'buy_price' => 'required|numeric|min:0',
            'sell_price' => 'required|numeric|min:0',
            'sell_price_reseller' => 'nullable|numeric|min:0',
            'qty' => 'required|integer|min:1',
            'status' => 'required|in:available,transit,sold',
            'default_charge_to' => 'nullable|in:buyer,seller,free_promotion',
            'buyer_name' => 'nullable|string|max:255',
            'buyer_phone' => 'nullable|string|max:50',
            'buyer_address' => 'nullable|string|max:500',
            'remove_extra_ids' => 'nullable|array',
            'remove_extra_ids.*' => 'integer|exists:sale_extras,id',
            'update_extras' => 'nullable|array',
            'update_extras.*.extra_id' => 'required|exists:stocks,id',
            'update_extras.*.charge_to' => 'required|in:buyer,seller,free_promotion',
            'update_extras.*.sell_price' => 'required|numeric|min:0',
            'update_extras.*.buy_price' => 'required|numeric|min:0',
            'parameter_values' => 'nullable|array',
        ]);

        $wasSold = $stock->status === 'sold';
        $oldValues = $stock->toArray();

        DB::transaction(function() use ($stock, $validated, $wasSold, $oldValues, $request) {
            $stockFields = collect($validated)->except(['buyer_name', 'buyer_phone', 'buyer_address', 'remove_extra_ids', 'update_extras', 'parameter_values'])->toArray();
            $stock->update($stockFields);

            if ($request->has('parameter_values') && is_array($request->input('parameter_values'))) {
                $stock->syncDynamicParameters($request->input('parameter_values'));
            }

            if ($stock->status === 'sold') {
                $saleItem = \App\Models\SaleItem::where('stock_id', $stock->id)->first();
                if ($saleItem && $sale = \App\Models\Sale::find($saleItem->sale_id)) {
                    // Remove checked/selected extra add-ons if requested
                    if ($request->has('remove_extra_ids') && is_array($request->input('remove_extra_ids'))) {
                        $sale->extras()->whereIn('id', $request->input('remove_extra_ids'))->delete();
                    }

                    // Sync/Add updated extras if provided
                    if ($request->has('update_extras') && is_array($request->input('update_extras'))) {
                        // Delete remaining extras and replace with updated selection
                        $sale->extras()->delete();
                        foreach ($request->input('update_extras') as $extra) {
                            $sale->extras()->create([
                                'extra_id' => $extra['extra_id'],
                                'charge_to' => $extra['charge_to'],
                                'sell_price' => $extra['sell_price'],
                                'buy_price' => $extra['buy_price'],
                            ]);
                        }
                    }

                    // Update HPP snap in sale item
                    $saleItem->update([
                        'buy_price_snap' => $stock->buy_price,
                        'actual_sell_price' => $stock->sell_price
                    ]);

                    // Recalculate and update the sale's total_amount
                    $itemsTotal = \App\Models\SaleItem::where('sale_id', $sale->id)
                        ->where('is_trade_in_item', false)
                        ->get()
                        ->sum(fn($i) => $i->actual_sell_price * $i->qty);

                    $tradeInTotal = \App\Models\SaleItem::where('sale_id', $sale->id)
                        ->where('is_trade_in_item', true)
                        ->get()
                        ->sum(fn($i) => abs($i->actual_sell_price));

                    $extrasTotal = $sale->extras()
                        ->where('charge_to', 'buyer')
                        ->get()
                        ->sum('sell_price');

                    $newFinalTotal = max(0, $itemsTotal + $extrasTotal - $tradeInTotal);
                    $sale->update(['total_amount' => $newFinalTotal]);

                    if ($buyer = \App\Models\Buyer::find($sale->buyer_id)) {
                        $buyer->update([
                            'name' => $request->input('buyer_name') ?? $buyer->name,
                            'phone' => $request->input('buyer_phone') ?? $buyer->phone,
                            'address' => $request->input('buyer_address') ?? $buyer->address,
                        ]);
                    }
                }
            }

            if ($wasSold && $stock->status !== 'sold') {
                $saleItem = \App\Models\SaleItem::where('stock_id', $stock->id)->first();
                if ($saleItem) {
                    $sale = \App\Models\Sale::find($saleItem->sale_id);
                    if ($sale) {
                        $sale->repairs()->delete();
                        $sale->returns()->delete();
                        $sale->extras()->delete();
                        $sale->items()->delete();
                        $sale->delete();
                        
                        ActivityLog::log('sale_deleted_via_stock_restore', \App\Models\Sale::class, $sale->id, [
                            'invoice_number' => $sale->invoice_number,
                            'reason' => 'Unit stock status changed back to available/transit'
                        ]);
                    }
                }
            }

            ActivityLog::log('stock_updated', Stock::class, $stock->id, $validated, $oldValues);
        });

        return redirect()->back()->with('success', 'Stok unit berhasil diperbarui.');
    }

    public function restore(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $stock = Stock::withTrashed()->findOrFail($id);
        $stock->restore();

        ActivityLog::log('stock_restored', Stock::class, $stock->id, $stock->toArray());

        return redirect()->back()->with('success', 'Stok unit berhasil dikembalikan.');
    }

    public function destroy(Request $request, Stock $stock): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $oldValues = $stock->toArray();
        $stock->delete();

        ActivityLog::log('stock_deleted', Stock::class, $stock->id, null, $oldValues);

        return redirect()->back()->with('success', 'Stok unit berhasil dihapus.');
    }
}
