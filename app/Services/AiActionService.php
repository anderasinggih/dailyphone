<?php

namespace App\Services;

use App\Models\Stock;
use App\Models\MoneyNote;
use App\Models\ActivityLog;
use App\Models\User;
use App\Models\Buyer;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\DynamicParameter;
use App\Models\DynamicParameterValue;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AiActionService
{
    /**
     * Execute an action proposal approved by Superadmin.
     */
    public function execute(string $action, array $payload, User $user): array
    {
        if ($user->role !== 'superadmin') {
            return [
                'success' => false,
                'message' => 'Unauthorized: Only Superadmin can execute AI actions.',
            ];
        }

        try {
            switch ($action) {
                case 'sell_stock':
                    return $this->executeSellStock($payload, $user);

                case 'update_stock':
                    return $this->executeUpdateStock($payload, $user);

                case 'add_stock':
                    return $this->executeAddStock($payload, $user);

                case 'add_bulk_stock':
                    return $this->executeAddBulkStock($payload, $user);

                case 'delete_stock':
                    return $this->executeDeleteStock($payload, $user);

                case 'delete_all_stocks':
                    return $this->executeDeleteAllStocks($payload, $user);

                case 'empty_trash':
                    return $this->executeEmptyTrash($payload, $user);

                case 'create_money_note':
                    return $this->executeCreateMoneyNote($payload, $user);

                case 'add_parameter':
                    return $this->executeAddParameter($payload, $user);

                case 'run_python_script':
                    return $this->executeRunPythonScript($payload, $user);

                case 'learn_repo':
                    return $this->executeLearnRepo($payload, $user);

                default:
                    return [
                        'success' => false,
                        'message' => "Unknown action '{$action}'. Execution aborted.",
                    ];
            }
        } catch (\Throwable $e) {
            Log::error("AI Action Execution Failed: " . $e->getMessage(), [
                'action' => $action,
                'payload' => $payload,
                'user_id' => $user->id,
            ]);

            // Auto-learn from the failure so the AI does not repeat the same
            // mistake in future proposals (persisted into AI training memory).
            $this->rememberFailure($action, $e->getMessage(), $payload, $user);

            return [
                'success' => false,
                'message' => 'Execution error: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Automatically write a durable AI training note when an execution fails,
     * so Gemini "learns" from past errors. Duplicate rules are skipped.
     */
    protected function rememberFailure(string $action, string $errorMessage, array $payload, User $user): void
    {
        $content = $this->failureLearningRule($action, $errorMessage);
        if (!$content || mb_strlen($content) < 20) {
            return;
        }

        $hash = md5($content);
        if (\App\Models\AiTrainingNote::where('content_hash', $hash)->exists()
            || app(\App\Services\AiMemoryGraphService::class)->isDuplicateContent($content)) {
            return;
        }

        try {
            \App\Models\AiTrainingNote::create([
                'user_id' => $user->id,
                'author_name' => 'System (Auto-Learn)',
                'author_role' => 'system',
                'content' => $content,
                'content_hash' => $hash,
                'kind' => $user->role === 'superadmin' ? 'rule' : 'note',
                'is_active' => true,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to persist auto-learned AI note: ' . $e->getMessage());
        }
    }

    /**
     * Translate a known failure signature into a concise learning rule.
     */
    protected function failureLearningRule(string $action, string $errorMessage): ?string
    {
        $msg = strtolower($errorMessage);

        if (str_contains($msg, 'foreign key constraint') || str_contains($msg, 'integrity constraint violation')) {
            return "Saat membuat proposal add_stock/update_stock, JANGAN pernah mengirim brand_id, color_id, memory_id, atau license_id berupa angka ID mentah di payload — angka seperti 128 seringkali berarti 128GB, bukan ID, dan langsung memicu error database foreign key. Selalu kirim nilai teks yang bisa dibaca (contoh: 'memory': '128GB', 'brand': 'Apple', 'color': 'Midnight', 'license': 'iBox (Resmi)'). Backend yang bertugas mencocokkan teks ke ID parameter yang valid.";
        }

        if (str_contains($msg, 'duplicate entry')) {
            return "Sebelum membuat proposal add_stock, pastikan serial_number atau IMEI unit belum pernah dipakai unit lain (termasuk yang sudah ada di keranjang sampah/trash) untuk menghindari error duplikat saat menambah stok.";
        }

        if (str_contains($msg, 'column cannot be null') || str_contains($msg, 'not null')) {
            return "Saat membuat proposal add_stock, pastikan semua kolom wajib (store, nama unit, harga, status) selalu diisi dan tidak boleh kosong/null, agar eksekusi ke database tidak gagal.";
        }

        if (str_contains($msg, 'out of range')) {
            return "Saat membuat proposal add_stock atau update_stock, gunakan angka harga yang wajar (tidak ekstrem besar) agar tidak melebihi batas kolom database.";
        }

        return null;
    }

    /**
     * Update stock prices, status, or notes.
     */
    protected function executeUpdateStock(array $payload, User $user): array
    {
        $stockId = $payload['stock_id'] ?? null;
        $serialNumber = $payload['serial_number'] ?? null;

        $stock = null;
        if ($stockId) {
            $stock = Stock::find($stockId);
        } elseif ($serialNumber) {
            $stock = Stock::where('serial_number', $serialNumber)->orWhere('imei_1', $serialNumber)->first();
        }

        if (!$stock) {
            return [
                'success' => false,
                'message' => 'Target unit/stock item not found.',
            ];
        }

        $oldValues = $stock->toArray();
        $allowedFields = ['sell_price', 'buy_price', 'sell_price_reseller', 'status', 'supplier', 'name'];
        $updatedData = [];

        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $payload)) {
                $updatedData[$field] = $payload[$field];
            }
        }

        if (empty($updatedData)) {
            return [
                'success' => false,
                'message' => 'No valid fields provided to update.',
            ];
        }

        DB::transaction(function () use ($stock, $updatedData, $oldValues) {
            $stock->update($updatedData);
            ActivityLog::log('ai_update_stock', Stock::class, $stock->id, $stock->fresh()->toArray(), $oldValues);
        });

        $stockName = $stock->name;
        $details = collect($updatedData)->map(fn($v, $k) => "{$k}: {$v}")->implode(', ');

        return [
            'success' => true,
            'message' => "Successfully updated stock unit '{$stockName}' ({$details}).",
            'data' => $stock->fresh(),
            'undo' => [
                'type' => 'stock_updated',
                'stock_id' => $stock->id,
                'previous' => $oldValues,
            ],
        ];
    }

    /**
     * Add a new stock unit to inventory.
     */
    protected function executeAddStock(array $payload, User $user): array
    {
        $name = trim($payload['name'] ?? '');
        if (empty($name)) {
            return [
                'success' => false,
                'message' => 'Gagal: Nama unit (name) wajib diisi.',
            ];
        }

        // Resolve and validate store_id
        $storeId = $payload['store_id'] ?? null;
        if ($storeId && !\App\Models\Store::where('id', $storeId)->exists()) {
            $storeId = null;
        }

        if (!$storeId) {
            $storeName = $payload['store_name'] ?? null;
            if ($storeName) {
                $matchedStore = \App\Models\Store::where('name', 'like', "%{$storeName}%")->first();
                if ($matchedStore) {
                    $storeId = $matchedStore->id;
                }
            }
        }

        if (!$storeId && $user->store_id && \App\Models\Store::where('id', $user->store_id)->exists()) {
            $storeId = $user->store_id;
        }

        if (!$storeId) {
            $store = \App\Models\Store::first();
            if (!$store) {
                $store = \App\Models\Store::create([
                    'name' => 'PERENG STORE',
                    'address' => 'Pereng Store Branch Address',
                    'latitude' => -7.4244,
                    'longitude' => 109.2301,
                    'geofence_radius' => 100,
                ]);
            }
            $storeId = $store->id;
        }

        $category = strtolower($payload['category'] ?? 'iphone');
        if (!in_array($category, ['iphone', 'android', 'accessories', 'extra'])) {
            $category = (stripos($name, 'iphone') !== false) ? 'iphone' : 'android';
        }

        $type = strtolower($payload['type'] ?? 'second');
        if (!in_array($type, ['new', 'second'])) {
            $type = 'second';
        }

        // Helper to resolve dynamic parameter ID by value name.
        // Never blindly casts numeric values to IDs: the model may output a raw
        // number like "128" (meaning 128GB) which is NOT a valid parameter value
        // ID and would violate the stocks foreign key.
        $resolveParamId = function($paramName, $valueName) {
            if (!$valueName) return null;

            $param = \App\Models\DynamicParameter::where('name', 'like', "%{$paramName}%")->first();
            if (!$param) return null;

            // 1. If the value looks like an ID, only trust it when a value row
            //    with that exact ID actually exists under this parameter.
            if (is_numeric($valueName)) {
                $byId = \App\Models\DynamicParameterValue::where('parameter_id', $param->id)
                    ->whereKey((int)$valueName)
                    ->first();
                if ($byId) return (int)$byId->id;
            }

            // 2. Fallback: match by value text (e.g. "128GB", "128", "Midnight").
            $byValue = \App\Models\DynamicParameterValue::where('parameter_id', $param->id)
                ->where('value', 'like', "%{$valueName}%")
                ->first();
            if ($byValue) return (int)$byValue->id;

            // 3. Last resort: use the first available option of the parameter so
            //    the foreign key can never be violated. Null only if there are
            //    no options at all (columns are nullable).
            $fallback = \App\Models\DynamicParameterValue::where('parameter_id', $param->id)->value('id');

            return $fallback ? (int)$fallback : null;
        };

        // Guarantee a valid parameter value id: if the payload supplied a raw
        // numeric id (e.g. "memory_id": 128), only keep it when it really exists
        // under the matching parameter; otherwise re-resolve from the text value.
        $safeParamId = function($paramName, $valueName, $candidateId = null) use ($resolveParamId) {
            if ($candidateId !== null && is_numeric($candidateId) && (int)$candidateId > 0) {
                $param = \App\Models\DynamicParameter::where('name', 'like', "%{$paramName}%")->first();
                if ($param) {
                    $exists = \App\Models\DynamicParameterValue::where('parameter_id', $param->id)
                        ->whereKey((int)$candidateId)
                        ->exists();
                    if ($exists) {
                        return (int)$candidateId;
                    }
                }
            }

            return $resolveParamId($paramName, $valueName);
        };

        // Extract memory from unit name if not explicitly provided
        $memoryVal = $payload['memory'] ?? null;
        if (!$memoryVal && preg_match('/(64\s*GB|128\s*GB|256\s*GB|512\s*GB|1\s*TB|8GB\/\d+GB|12GB\/\d+GB)/i', $name, $matches)) {
            $memoryVal = str_replace(' ', '', strtoupper($matches[1]));
        }

        // Extract brand from unit name if not explicitly provided
        $brandVal = $payload['brand'] ?? null;
        if (!$brandVal) {
            if ($category === 'iphone' || stripos($name, 'iphone') !== false) {
                $brandVal = 'Apple';
            } elseif (stripos($name, 'samsung') !== false) {
                $brandVal = 'Samsung';
            } elseif (stripos($name, 'xiaomi') !== false || stripos($name, 'redmi') !== false || stripos($name, 'poco') !== false) {
                $brandVal = 'Xiaomi';
            } elseif (stripos($name, 'oppo') !== false) {
                $brandVal = 'Oppo';
            } elseif (stripos($name, 'realme') !== false) {
                $brandVal = 'Realme';
            }
        }

        // Extract license if not provided
        $licenseVal = $payload['license'] ?? null;
        if (!$licenseVal) {
            if (stripos($name, 'ibox') !== false) {
                $licenseVal = 'iBox (Resmi)';
            } elseif (stripos($name, 'inter') !== false) {
                $licenseVal = 'Inter (Sinyal Off)';
            } elseif (stripos($name, 'bea cukai') !== false) {
                $licenseVal = 'Bea Cukai (Sinyal On)';
            } else {
                $licenseVal = ($category === 'iphone') ? 'iBox (Resmi)' : 'Android';
            }
        }

        // Extract color if not provided
        $colorVal = $payload['color'] ?? null;
        if (!$colorVal) {
            $commonColors = ['Midnight', 'Space Gray', 'Sierra Blue', 'Titanium Natural', 'Phantom Black', 'White', 'Black', 'Blue', 'Pink', 'Purple', 'Gold', 'Silver', 'Green', 'Red', 'Yellow'];
            foreach ($commonColors as $c) {
                if (stripos($name, $c) !== false) {
                    $colorVal = $c;
                    break;
                }
            }
            if (!$colorVal) {
                $colorVal = 'Midnight';
            }
        }

        $brandId = $safeParamId('Brand', $brandVal, $payload['brand_id'] ?? null);
        $colorId = $safeParamId('Warna', $colorVal, $payload['color_id'] ?? null);
        $memoryId = $safeParamId('Kapasitas Memori', $memoryVal, $payload['memory_id'] ?? null);
        $licenseId = $safeParamId('Tipe Lisensi', $licenseVal, $payload['license_id'] ?? null);

        // Generate unique Serial Number & IMEI if missing
        $serialNumber = trim($payload['serial_number'] ?? '');
        $imei = trim($payload['imei_1'] ?? '');

        // 1. Check if a unit with this IMEI or Serial Number already exists (including soft-deleted/trash)
        $existingStock = null;
        if (!empty($imei)) {
            $existingStock = Stock::withTrashed()->where('imei_1', $imei)->first();
        }
        if (!$existingStock && !empty($serialNumber)) {
            $existingStock = Stock::withTrashed()->where('serial_number', $serialNumber)->first();
        }

        $buyPrice = isset($payload['buy_price']) ? (float)$payload['buy_price'] : 0;
        $sellPrice = isset($payload['sell_price']) ? (float)$payload['sell_price'] : 0;
        $sellPriceReseller = isset($payload['sell_price_reseller']) ? (float)$payload['sell_price_reseller'] : null;
        $warrantyDays = isset($payload['warranty_duration_days']) ? (int)$payload['warranty_duration_days'] : 30;
        
        // Supplier fallback: ensure realistic distributor partner instead of empty or generic string
        $supplier = trim($payload['supplier'] ?? '');
        if (empty($supplier) || $supplier === 'AI Input') {
            $supplier = 'Distributor Utama Jakarta';
        }

        $status = $payload['status'] ?? 'available';
        $aiCreatorTag = ($user->email ?? $user->name) . ' (AI)';

        // If unit already exists in TRASH (soft deleted), RESTORE it and update specs instead of throwing duplicate constraint error
        if ($existingStock && $existingStock->trashed()) {
            $previousData = $existingStock->toArray();

            $existingStock->restore();
            $updateData = [
                'store_id' => $storeId,
                'category' => $category,
                'type' => $type,
                'name' => $name,
                'brand_id' => $brandId ?? $existingStock->brand_id,
                'color_id' => $colorId ?? $existingStock->color_id,
                'memory_id' => $memoryId ?? $existingStock->memory_id,
                'license_id' => $licenseId ?? $existingStock->license_id,
                'warranty_duration_days' => $warrantyDays,
                'buy_price' => $buyPrice > 0 ? $buyPrice : $existingStock->buy_price,
                'sell_price' => $sellPrice > 0 ? $sellPrice : $existingStock->sell_price,
                'sell_price_reseller' => $sellPriceReseller ?? $existingStock->sell_price_reseller,
                'supplier' => $supplier,
                'status' => $status,
                'created_by' => $aiCreatorTag,
            ];
            $existingStock->update($updateData);

            $existingStock->syncDynamicParameters(
                $this->resolveParameterMap($brandId, $colorId, $memoryId, $licenseId, $updateData['type'] ?? 'second')
            );

            ActivityLog::log('ai_restore_stock', Stock::class, $existingStock->id, $existingStock->fresh()->toArray());

            $formattedPrice = number_format($existingStock->sell_price, 0, ',', '.');

            return [
                'success' => true,
                'message' => "Unit '{$existingStock->name}' (IMEI: {$existingStock->imei_1}) berhasil dipulihkan dari keranjang sampah (Trash) dan diaktifkan kembali ke stok toko dengan harga Rp {$formattedPrice}.",
                'data' => $existingStock->fresh(['store', 'brand', 'color', 'memory', 'license']),
                'undo' => [
                    'type' => 'stock_created', // If undone, delete it again
                    'stock_id' => $existingStock->id,
                ],
            ];
        }

        // If unit already exists and is ACTIVE, alert the user rather than failing
        if ($existingStock && !$existingStock->trashed()) {
            return [
                'success' => false,
                'message' => "Unit dengan IMEI/Serial Number ini ({$existingStock->imei_1} / {$existingStock->serial_number}) sudah aktif di inventaris '{$existingStock->name}'.",
            ];
        }

        // Generate unique Serial Number & IMEI if missing
        if (empty($serialNumber)) {
            $prefix = ($category === 'iphone') ? 'IP' : 'AND';
            $serialNumber = 'DP-' . $prefix . '-' . strtoupper(Str::random(6));
        }

        // Check uniqueness or append random suffix if collision occurs
        if (Stock::withTrashed()->where('serial_number', $serialNumber)->exists()) {
            $serialNumber .= '-' . strtoupper(Str::random(3));
        }

        if (empty($imei)) {
            $imei = '35' . str_pad((string)mt_rand(1000000000000, 9999999999999), 13, '0', STR_PAD_LEFT);
        }
        if (Stock::withTrashed()->where('imei_1', $imei)->exists()) {
            $imei = '35' . str_pad((string)mt_rand(1000000000000, 9999999999999), 13, '0', STR_PAD_LEFT);
        }

        $stock = DB::transaction(function () use (
            $storeId, $category, $type, $name, $brandId, $colorId, $memoryId, $licenseId,
            $serialNumber, $imei, $supplier, $warrantyDays, $buyPrice, $sellPrice, $sellPriceReseller, $status,
            $aiCreatorTag
        ) {
            $createdStock = Stock::create([
                'store_id' => $storeId,
                'category' => $category,
                'type' => $type,
                'name' => $name,
                'brand_id' => $brandId,
                'color_id' => $colorId,
                'memory_id' => $memoryId,
                'license_id' => $licenseId,
                'serial_number' => $serialNumber,
                'imei_1' => $imei,
                'supplier' => $supplier,
                'warranty_duration_days' => $warrantyDays,
                'buy_price' => $buyPrice,
                'sell_price' => $sellPrice,
                'sell_price_reseller' => $sellPriceReseller,
                'qty' => 1,
                'status' => $status,
                'created_by' => $aiCreatorTag,
            ]);

            ActivityLog::log('ai_add_stock', Stock::class, $createdStock->id, $createdStock->toArray());

            $createdStock->syncDynamicParameters(
                $this->resolveParameterMap($brandId, $colorId, $memoryId, $licenseId, $type)
            );

            return $createdStock;
        });

        $formattedPrice = number_format($stock->sell_price, 0, ',', '.');

        return [
            'success' => true,
            'message' => "Successfully added new stock unit '{$stock->name}' (SN: {$stock->serial_number}) with sell price Rp {$formattedPrice}.",
            'data' => $stock->fresh(['store', 'brand', 'color', 'memory', 'license']),
            'undo' => [
                'type' => 'stock_created',
                'stock_id' => $stock->id,
            ],
        ];
    }

    /**
     * Add multiple stock units in bulk, recording an individual ActivityLog for EACH unit.
     */
    protected function executeAddBulkStock(array $payload, User $user): array
    {
        $items = $payload['items'] ?? [];
        $targetCount = isset($payload['count']) ? max(1, min(500, (int)$payload['count'])) : 0;

        // If targetCount is specified (e.g. 100) or items is empty, generate realistic smartphone items
        if ($targetCount > 0 && count($items) < $targetCount) {
            $existingCount = count($items);
            $needed = $targetCount - $existingCount;

            $dummyCatalogs = [
                // iPhones
                ['name' => 'iPhone 15 Pro Max 256GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Natural Titanium', 'memory' => '256GB', 'license' => 'iBox (Resmi)', 'buy_price' => 14500000, 'sell_price' => 16999000],
                ['name' => 'iPhone 15 Pro Max 512GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Black Titanium', 'memory' => '512GB', 'license' => 'iBox (Resmi)', 'buy_price' => 16000000, 'sell_price' => 18499000],
                ['name' => 'iPhone 15 Pro 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Blue Titanium', 'memory' => '128GB', 'license' => 'iBox (Resmi)', 'buy_price' => 12500000, 'sell_price' => 14499000],
                ['name' => 'iPhone 15 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Pink', 'memory' => '128GB', 'license' => 'iBox (Resmi)', 'buy_price' => 8800000, 'sell_price' => 10299000],
                ['name' => 'iPhone 15 Plus 256GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Black', 'memory' => '256GB', 'license' => 'iBox (Resmi)', 'buy_price' => 10500000, 'sell_price' => 11999000],
                ['name' => 'iPhone 14 Pro Max 256GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Deep Purple', 'memory' => '256GB', 'license' => 'iBox (Resmi)', 'buy_price' => 11500000, 'sell_price' => 13499000],
                ['name' => 'iPhone 14 Pro 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Space Black', 'memory' => '128GB', 'license' => 'iBox (Resmi)', 'buy_price' => 9800000, 'sell_price' => 11499000],
                ['name' => 'iPhone 14 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Starlight', 'memory' => '128GB', 'license' => 'Bea Cukai (Sinyal On)', 'buy_price' => 7200000, 'sell_price' => 8499000],
                ['name' => 'iPhone 13 Pro Max 256GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Sierra Blue', 'memory' => '256GB', 'license' => 'iBox (Resmi)', 'buy_price' => 9500000, 'sell_price' => 10999000],
                ['name' => 'iPhone 13 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Midnight', 'memory' => '128GB', 'license' => 'iBox (Resmi)', 'buy_price' => 6200000, 'sell_price' => 7299000],
                ['name' => 'iPhone 12 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'Blue', 'memory' => '128GB', 'license' => 'Inter (Sinyal Off)', 'buy_price' => 4500000, 'sell_price' => 5499000],
                ['name' => 'iPhone 11 128GB', 'brand' => 'Apple', 'category' => 'iphone', 'type' => 'second', 'color' => 'White', 'memory' => '128GB', 'license' => 'Inter (Sinyal Off)', 'buy_price' => 3500000, 'sell_price' => 4299000],
                // Samsungs
                ['name' => 'Samsung Galaxy S24 Ultra 512GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'second', 'color' => 'Titanium Gray', 'memory' => '512GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 13500000, 'sell_price' => 15999000],
                ['name' => 'Samsung Galaxy S24+ 256GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'second', 'color' => 'Amber Yellow', 'memory' => '256GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 9800000, 'sell_price' => 11499000],
                ['name' => 'Samsung Galaxy S24 256GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'second', 'color' => 'Onyx Black', 'memory' => '256GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 8500000, 'sell_price' => 9999000],
                ['name' => 'Samsung Galaxy Z Fold 5 512GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'second', 'color' => 'Phantom Black', 'memory' => '512GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 12000000, 'sell_price' => 14299000],
                ['name' => 'Samsung Galaxy Z Flip 5 256GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'second', 'color' => 'Mint', 'memory' => '256GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 7800000, 'sell_price' => 8999000],
                ['name' => 'Samsung Galaxy A55 5G 256GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'new', 'color' => 'Awesome Navy', 'memory' => '256GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 5200000, 'sell_price' => 5999000],
                ['name' => 'Samsung Galaxy A35 5G 256GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'new', 'color' => 'Awesome Iceblue', 'memory' => '256GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 4200000, 'sell_price' => 4999000],
                ['name' => 'Samsung Galaxy A15 5G 128GB', 'brand' => 'Samsung', 'category' => 'android', 'type' => 'new', 'color' => 'Optimistic Blue', 'memory' => '128GB', 'license' => 'SEIN (Resmi)', 'buy_price' => 2500000, 'sell_price' => 2999000],
                // Xiaomi & POCO
                ['name' => 'Xiaomi 14 256GB', 'brand' => 'Xiaomi', 'category' => 'android', 'type' => 'second', 'color' => 'Black', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 7500000, 'sell_price' => 8799000],
                ['name' => 'Xiaomi 13T 256GB', 'brand' => 'Xiaomi', 'category' => 'android', 'type' => 'second', 'color' => 'Meadow Green', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 4800000, 'sell_price' => 5699000],
                ['name' => 'POCO F6 256GB', 'brand' => 'POCO', 'category' => 'android', 'type' => 'new', 'color' => 'Black', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 4500000, 'sell_price' => 5199000],
                ['name' => 'POCO X6 Pro 256GB', 'brand' => 'POCO', 'category' => 'android', 'type' => 'new', 'color' => 'Yellow', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 3900000, 'sell_price' => 4599000],
                ['name' => 'Xiaomi Redmi Note 13 Pro 256GB', 'brand' => 'Xiaomi', 'category' => 'android', 'type' => 'new', 'color' => 'Midnight Black', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 3200000, 'sell_price' => 3799000],
                // OPPO, Vivo, Realme
                ['name' => 'OPPO Reno 12 Pro 512GB', 'brand' => 'OPPO', 'category' => 'android', 'type' => 'new', 'color' => 'Nebula Silver', 'memory' => '512GB', 'license' => 'Resmi Indonesia', 'buy_price' => 7500000, 'sell_price' => 8499000],
                ['name' => 'OPPO Reno 11 Pro 256GB', 'brand' => 'OPPO', 'category' => 'android', 'type' => 'second', 'color' => 'Pearl White', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 5000000, 'sell_price' => 5999000],
                ['name' => 'Vivo X100 Pro 512GB', 'brand' => 'Vivo', 'category' => 'android', 'type' => 'second', 'color' => 'Asteroid Black', 'memory' => '512GB', 'license' => 'Resmi Indonesia', 'buy_price' => 10500000, 'sell_price' => 12499000],
                ['name' => 'Vivo V30 Pro 512GB', 'brand' => 'Vivo', 'category' => 'android', 'type' => 'second', 'color' => 'Equinox Black', 'memory' => '512GB', 'license' => 'Resmi Indonesia', 'buy_price' => 5800000, 'sell_price' => 6799000],
                ['name' => 'Realme 12 Pro+ 512GB', 'brand' => 'Realme', 'category' => 'android', 'type' => 'new', 'color' => 'Submarine Blue', 'memory' => '512GB', 'license' => 'Resmi Indonesia', 'buy_price' => 5000000, 'sell_price' => 5899000],
                ['name' => 'Infinix Zero 30 5G 256GB', 'brand' => 'Infinix', 'category' => 'android', 'type' => 'new', 'color' => 'Rome Green', 'memory' => '256GB', 'license' => 'Resmi Indonesia', 'buy_price' => 3200000, 'sell_price' => 3799000],
            ];

            $catalogCount = count($dummyCatalogs);
            $storeId = $payload['store_id'] ?? null;

            for ($i = 0; $i < $needed; $i++) {
                $template = $dummyCatalogs[$i % $catalogCount];
                if ($storeId) {
                    $template['store_id'] = $storeId;
                }
                $items[] = $template;
            }
        }

        if (empty($items) || !is_array($items)) {
            return [
                'success' => false,
                'message' => 'Gagal: Daftar unit (items) kosong atau tidak valid.',
            ];
        }

        $addedStocks = [];
        $errors = [];

        foreach ($items as $index => $itemPayload) {
            $res = $this->executeAddStock($itemPayload, $user);
            if ($res['success'] && isset($res['data'])) {
                $addedStocks[] = $res['data'];
            } else {
                $errors[] = "Item #" . ($index + 1) . " (" . ($itemPayload['name'] ?? 'Unit') . "): " . ($res['message'] ?? 'Error');
            }
        }

        $count = count($addedStocks);
        if ($count === 0) {
            return [
                'success' => false,
                'message' => 'Tidak ada unit yang berhasil ditambahkan: ' . implode('; ', $errors),
            ];
        }

        $msg = "Berhasil menambahkan {$count} unit ke inventaris, dan masing-masing telah dicatat ke Activity Log.";
        if (!empty($errors)) {
            $msg .= " Catatan kendala: " . implode('; ', $errors);
        }

        return [
            'success' => true,
            'message' => $msg,
            'data' => $addedStocks,
        ];
    }

    /**
     * Delete a stock unit (move to trash).
     */
    protected function executeDeleteStock(array $payload, User $user): array
    {
        $stockId = $payload['stock_id'] ?? null;
        $serialNumber = $payload['serial_number'] ?? null;
        $imei = $payload['imei_1'] ?? $payload['imei'] ?? null;
        $target = $payload['target'] ?? null;

        $stock = null;
        if ($stockId) {
            $stock = Stock::find($stockId);
        }

        if (!$stock && $serialNumber) {
            $stock = Stock::where('serial_number', $serialNumber)
                ->orWhere('imei_1', $serialNumber)
                ->first();
        }

        if (!$stock && $imei) {
            $stock = Stock::where('imei_1', $imei)
                ->orWhere('serial_number', $imei)
                ->first();
        }

        // If not found in active stocks, check if it was ALREADY deleted (in trash)
        if (!$stock) {
            $trashedStock = null;
            if ($stockId) {
                $trashedStock = Stock::onlyTrashed()->find($stockId);
            }
            if (!$trashedStock && ($serialNumber || $imei)) {
                $searchVal = $serialNumber ?: $imei;
                $trashedStock = Stock::onlyTrashed()
                    ->where('serial_number', $searchVal)
                    ->orWhere('imei_1', $searchVal)
                    ->first();
            }

            if ($trashedStock) {
                return [
                    'success' => false,
                    'message' => "Unit '{$trashedStock->name}' (IMEI: {$trashedStock->imei_1}) sudah berada di keranjang sampah (sudah dihapus sebelumnya).",
                ];
            }

            return [
                'success' => false,
                'message' => 'Target unit/stock item to delete was not found in inventory.',
            ];
        }

        $oldValues = $stock->toArray();
        $stockName = $stock->name;
        $stockSn = $stock->serial_number;

        DB::transaction(function () use ($stock, $oldValues) {
            $stock->delete();
            ActivityLog::log('ai_delete_stock', Stock::class, $stock->id, null, $oldValues);
        });

        return [
            'success' => true,
            'message' => "Successfully deleted stock unit '{$stockName}' (SN: {$stockSn}).",
            'undo' => [
                'type' => 'stock_deleted',
                'stock_id' => $stock->id,
            ],
        ];
    }

    /**
     * Delete all available stock units (or store-specific), recording an activity log for each.
     */
    protected function executeDeleteAllStocks(array $payload, User $user): array
    {
        $storeId = $payload['store_id'] ?? null;
        $stockQuery = Stock::where('status', 'available');

        if ($storeId) {
            $stockQuery->where('store_id', $storeId);
        }

        $stocks = $stockQuery->get();
        $count = $stocks->count();

        if ($count === 0) {
            return [
                'success' => false,
                'message' => 'Tidak ada unit stok aktif yang ditemukan untuk dihapus.',
            ];
        }

        $deletedIds = [];
        DB::transaction(function () use ($stocks, &$deletedIds) {
            foreach ($stocks as $stock) {
                $oldValues = $stock->toArray();
                $stock->delete();
                $deletedIds[] = $stock->id;
                ActivityLog::log('ai_delete_stock', Stock::class, $stock->id, null, $oldValues);
            }
        });

        return [
            'success' => true,
            'message' => "Berhasil menghapus seluruh {$count} unit stok aktif ke keranjang sampah (soft delete), dan masing-masing telah dicatat di Activity Log.",
            'undo' => [
                'type' => 'bulk_stocks_deleted',
                'stock_ids' => $deletedIds,
            ],
        ];
    }

    /**
     * Permanently delete (force delete) units from the trash bin.
     * Irreversible action - permanently frees up IMEI and Serial Numbers.
     */
    protected function executeEmptyTrash(array $payload, User $user): array
    {
        $storeId = $payload['store_id'] ?? null;
        $stockId = $payload['stock_id'] ?? null;
        $serialNumber = $payload['serial_number'] ?? null;
        $imei = $payload['imei_1'] ?? $payload['imei'] ?? null;

        $trashQuery = Stock::onlyTrashed();

        if ($stockId) {
            $trashQuery->where('id', $stockId);
        } elseif ($serialNumber) {
            $trashQuery->where(function ($q) use ($serialNumber) {
                $q->where('serial_number', $serialNumber)->orWhere('imei_1', $serialNumber);
            });
        } elseif ($imei) {
            $trashQuery->where('imei_1', $imei);
        } elseif ($storeId) {
            $trashQuery->where('store_id', $storeId);
        }

        $trashedUnits = $trashQuery->get();
        $count = $trashedUnits->count();

        if ($count === 0) {
            return [
                'success' => false,
                'message' => 'Tidak ada unit di keranjang sampah (trash) yang cocok untuk dihapus permanen.',
            ];
        }

        DB::transaction(function () use ($trashedUnits) {
            foreach ($trashedUnits as $stock) {
                $oldValues = $stock->toArray();
                ActivityLog::log('ai_force_delete_stock', Stock::class, $stock->id, null, $oldValues);
                $stock->forceDelete();
            }
        });

        return [
            'success' => true,
            'message' => "Berhasil menghapus permanen (force delete) {$count} unit dari keranjang sampah. Seluruh data IMEI dan Serial Number telah dibersihkan dan dicatat di Activity Log.",
        ];
    }

    /**
     * Record a completed sale transaction for a stock unit.
     * All required operational fields must be present and valid.
     */
    protected function executeSellStock(array $payload, User $user): array
    {
        $stockId = $payload['stock_id'] ?? null;
        $serialNumber = $payload['serial_number'] ?? null;

        $stock = null;
        if ($stockId) {
            $stock = Stock::find($stockId);
        } elseif ($serialNumber) {
            $stock = Stock::where('serial_number', $serialNumber)->orWhere('imei_1', $serialNumber)->first();
        }

        if (!$stock) {
            return [
                'success' => false,
                'message' => 'Unit yang akan dijual tidak ditemukan dalam database.',
            ];
        }

        if ($stock->status === 'sold') {
            return [
                'success' => false,
                'message' => "Unit '{$stock->name}' sudah berstatus TERJUAL sebelumnya.",
            ];
        }

        // Required transaction values
        $buyerName = trim($payload['buyer_name'] ?? '');
        $buyerPhone = trim($payload['buyer_phone'] ?? '');
        $buyerAddress = trim($payload['buyer_address'] ?? 'Purwokerto');
        $paymentMethod = trim($payload['payment_method'] ?? 'cash');
        $paymentDetail = trim($payload['payment_detail'] ?? 'Lunas via AI Assistant');
        $actualSellPrice = isset($payload['actual_sell_price']) ? (float)$payload['actual_sell_price'] : (float)$stock->sell_price;

        if (empty($buyerName)) {
            return [
                'success' => false,
                'message' => 'Gagal: Nama pembeli wajib diisi untuk mencatat penjualan.',
            ];
        }

        $sale = DB::transaction(function () use (
            $stock, $user, $buyerName, $buyerPhone, $buyerAddress,
            $paymentMethod, $paymentDetail, $actualSellPrice
        ) {
            // Find or create Buyer
            $buyer = null;
            if (!empty($buyerPhone)) {
                $buyer = Buyer::where('phone', $buyerPhone)->first();
            }
            if (!$buyer) {
                $buyer = Buyer::create([
                    'name' => $buyerName,
                    'phone' => $buyerPhone ?: null,
                    'address' => $buyerAddress,
                ]);
            }

            // Generate Invoice Number
            $datePrefix = now()->format('Ymd');
            $randomSuffix = strtoupper(Str::random(4));
            $invoiceNumber = "INV-AI-{$datePrefix}-{$randomSuffix}";

            // Create Sale record
            $sale = Sale::create([
                'invoice_number' => $invoiceNumber,
                'store_id' => $stock->store_id,
                'user_id' => $user->id,
                'buyer_id' => $buyer->id,
                'payment_method' => strtolower($paymentMethod),
                'payment_detail' => $paymentDetail,
                'total_amount' => $actualSellPrice,
                'dp_amount' => 0,
                'status' => 'completed',
            ]);

            // Create Sale item
            SaleItem::create([
                'sale_id' => $sale->id,
                'stock_id' => $stock->id,
                'qty' => 1,
                'actual_sell_price' => $actualSellPrice,
                'buy_price_snap' => $stock->buy_price,
                'is_trade_in_item' => false,
            ]);

            // Update stock status to sold
            $oldStockValues = $stock->toArray();
            $stock->update(['status' => 'sold']);

            ActivityLog::log('ai_sell_stock', Sale::class, $sale->id, [
                'sale_id' => $sale->id,
                'stock_id' => $stock->id,
                'buyer' => $buyerName,
                'price' => $actualSellPrice,
                'invoice' => $invoiceNumber,
            ], $oldStockValues);

            return $sale;
        });

        $formattedPrice = number_format($actualSellPrice, 0, ',', '.');
        return [
            'success' => true,
            'message' => "Unit '{$stock->name}' berhasil dicatat TERJUAL ke '{$buyerName}' senilai Rp {$formattedPrice} (Invoice: {$sale->invoice_number}).",
            'data' => [
                'sale_id' => $sale->id,
                'invoice_number' => $sale->invoice_number,
                'stock' => $stock->fresh(),
            ],
            'undo' => [
                'type' => 'stock_sold',
                'sale_id' => $sale->id,
                'stock_id' => $stock->id,
            ],
        ];
    }

    /**
     * Create an operational expense or income note.
     */
    protected function executeCreateMoneyNote(array $payload, User $user): array
    {
        $type = $payload['type'] ?? 'expense';
        $amount = (float)($payload['amount'] ?? 0);
        $category = $payload['category'] ?? 'Operasional';
        $description = $payload['description'] ?? 'Catatan kas via AI Assistant';
        $date = $payload['date'] ?? now()->toDateString();

        if ($amount <= 0) {
            return [
                'success' => false,
                'message' => 'Invalid amount. Amount must be greater than 0.',
            ];
        }

        $note = DB::transaction(function () use ($type, $amount, $category, $description, $date) {
            $note = MoneyNote::create([
                'type' => in_array($type, ['income', 'expense']) ? $type : 'expense',
                'amount' => $amount,
                'category' => $category,
                'description' => $description,
                'date' => $date,
            ]);

            ActivityLog::log('ai_create_money_note', MoneyNote::class, $note->id, $note->toArray());
            return $note;
        });

        $formattedAmount = number_format($amount, 0, ',', '.');
        $typeName = $type === 'income' ? 'Pemasukan' : 'Pengeluaran';

        return [
            'success' => true,
            'message' => "Successfully recorded {$typeName} Rp {$formattedAmount} for '{$category}' ({$description}).",
            'data' => $note,
        ];
    }

    /**
     * Download a public GitHub repository and persist its text files as new
     * training-memory neurons (kind: knowledge, tagged with the repo as source).
     */
    protected function executeLearnRepo(array $payload, User $user): array
    {
        $repo = trim((string)($payload['repo'] ?? $payload['repo_url'] ?? $payload['repository'] ?? ''));

        $result = app(\App\Services\AiFileIngestService::class)->ingestRepository($repo, $user);

        return [
            'success' => $result['success'],
            'message' => $result['message'],
            'data' => [
                'repo' => $result['repo'],
                'notes_count' => $result['notes_count'],
            ],
        ];
    }

    /**
     * Add a new master data parameter (and optionally its option values).
     * ADD-ONLY: deleting or removing parameters is intentionally NOT supported for the AI.
     */
    protected function executeAddParameter(array $payload, User $user): array
    {
        $name = trim((string)($payload['name'] ?? ''));
        if ($name === '') {
            return [
                'success' => false,
                'message' => 'Gagal: Nama parameter (name) wajib diisi.',
            ];
        }

        $category = strtolower((string)($payload['category'] ?? 'global'));
        if (!in_array($category, ['iphone', 'android', 'global'], true)) {
            $category = 'global';
        }

        // Reuse existing parameter with the same name (case-insensitive) instead of duplicating
        $parameter = DynamicParameter::whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->first();
        $created = false;

        if (!$parameter) {
            $parameter = DynamicParameter::create([
                'name' => $name,
                'category' => $category,
            ]);
            $created = true;
            ActivityLog::log('ai_add_parameter', DynamicParameter::class, $parameter->id, $parameter->toArray());
        }

        // Add option values if provided (values may be strings or ["value" => x, "color" => y])
        $colors = ['blue', 'emerald', 'amber', 'red', 'purple', 'slate'];
        $addedValues = [];
        $values = $payload['values'] ?? $payload['options'] ?? [];

        if (is_array($values)) {
            foreach ($values as $entry) {
                if (is_array($entry)) {
                    $valueName = trim((string)($entry['value'] ?? $entry['name'] ?? ''));
                    $color = (string)($entry['color'] ?? 'blue');
                } else {
                    $valueName = trim((string)$entry);
                    $color = 'blue';
                }

                if ($valueName === '') {
                    continue;
                }
                if (!in_array($color, $colors, true)) {
                    $color = 'blue';
                }

                $exists = DynamicParameterValue::where('parameter_id', $parameter->id)
                    ->whereRaw('LOWER(value) = ?', [mb_strtolower($valueName)])
                    ->exists();
                if ($exists) {
                    continue;
                }

                $value = DynamicParameterValue::create([
                    'parameter_id' => $parameter->id,
                    'value' => $valueName,
                    'color' => $color,
                    'is_active' => true,
                ]);
                $addedValues[] = $valueName;
                ActivityLog::log('ai_add_parameter_value', DynamicParameterValue::class, $value->id, $value->toArray());
            }
        }

        $valueCount = count($addedValues);
        if ($created) {
            $message = "Successfully created parameter '{$name}' (category: {$category})";
        } else {
            $message = "Parameter '{$name}' already exists — no duplicate was created";
        }
        if ($valueCount > 0) {
            $message .= ' and added ' . $valueCount . ' new option(s): ' . implode(', ', $addedValues);
        }

        return [
            'success' => true,
            'message' => $message . '.',
            'data' => [
                'parameter_id' => $parameter->id,
                'name' => $parameter->name,
                'category' => $parameter->category,
                'created' => $created,
                'added_values' => $addedValues,
            ],
        ];
    }

    /**
     * Safely run a Python 3 script with timeout and output capture.
     */
    protected function executeRunPythonScript(array $payload, User $user): array
    {
        $scriptContent = $payload['code'] ?? null;
        if (empty($scriptContent)) {
            return [
                'success' => false,
                'message' => 'No python code provided to execute.',
            ];
        }

        // Temp script file
        $tempDir = storage_path('app/ai_scripts');
        if (!is_dir($tempDir)) {
            mkdir($tempDir, 0755, true);
        }

        $tempFile = $tempDir . '/script_' . uniqid() . '.py';
        file_put_contents($tempFile, $scriptContent);

        try {
            $process = proc_open(
                ['python3', $tempFile],
                [
                    0 => ['pipe', 'r'],
                    1 => ['pipe', 'w'],
                    2 => ['pipe', 'w'],
                ],
                $pipes
            );

            if (!is_resource($process)) {
                return [
                    'success' => false,
                    'message' => 'Failed to spawn Python process.',
                ];
            }

            fclose($pipes[0]);
            
            // Read stdout & stderr
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);

            $exitCode = proc_close($process);

            ActivityLog::log('ai_run_python', null, null, [
                'exit_code' => $exitCode,
                'code_snippet' => mb_substr($scriptContent, 0, 200),
                'output_snippet' => mb_substr($stdout, 0, 200),
            ]);

            if ($exitCode !== 0) {
                return [
                    'success' => false,
                    'message' => 'Python script returned error: ' . ($stderr ?: $stdout ?: "Exit code {$exitCode}"),
                    'output' => $stderr ?: $stdout,
                ];
            }

            return [
                'success' => true,
                'message' => 'Python script executed successfully.',
                'output' => trim($stdout),
            ];
        } finally {
            if (file_exists($tempFile)) {
                @unlink($tempFile);
            }
        }
    }

    /**
     * Revert / Undo a previously executed action.
     */
    public function undoAction(array $undoData, User $user): array
    {
        $type = $undoData['type'] ?? null;

        switch ($type) {
            case 'stock_created':
                $stockId = $undoData['stock_id'] ?? null;
                $stock = Stock::find($stockId);
                if ($stock) {
                    $name = $stock->name;
                    $stock->forceDelete();
                    ActivityLog::log('ai_undo_add_stock', Stock::class, $stockId, null);
                    return [
                        'success' => true,
                        'message' => "Unit '{$name}' yang baru ditambahkan telah berhasil dibatalkan (dihapus).",
                    ];
                }
                return ['success' => false, 'message' => 'Unit yang ingin di-undo tidak ditemukan atau sudah dihapus.'];

            case 'stock_updated':
                $stockId = $undoData['stock_id'] ?? null;
                $previous = $undoData['previous'] ?? [];
                $stock = Stock::find($stockId);
                if ($stock && !empty($previous)) {
                    $allowed = ['sell_price', 'buy_price', 'sell_price_reseller', 'status', 'supplier', 'name'];
                    $restoreData = array_intersect_key($previous, array_flip($allowed));
                    $stock->update($restoreData);
                    ActivityLog::log('ai_undo_update_stock', Stock::class, $stockId, $stock->fresh()->toArray());
                    return [
                        'success' => true,
                        'message' => "Perubahan pada unit '{$stock->name}' berhasil dikembalikan ke nilai semula.",
                    ];
                }
                return ['success' => false, 'message' => 'Gagal memulihkan nilai unit sebelumnya.'];

            case 'stock_deleted':
                $stockId = $undoData['stock_id'] ?? null;
                $stock = Stock::withTrashed()->find($stockId);
                if ($stock && $stock->trashed()) {
                    $stock->restore();
                    ActivityLog::log('ai_undo_delete_stock', Stock::class, $stockId, $stock->fresh()->toArray());
                    return [
                        'success' => true,
                        'message' => "Unit '{$stock->name}' yang dihapus telah berhasil dipulihkan kembali.",
                    ];
                }
                return ['success' => false, 'message' => 'Unit tidak ditemukan di keranjang sampah.'];

            case 'bulk_stocks_deleted':
                $stockIds = $undoData['stock_ids'] ?? [];
                if (!empty($stockIds) && is_array($stockIds)) {
                    $restoredCount = 0;
                    DB::transaction(function () use ($stockIds, &$restoredCount) {
                        foreach ($stockIds as $id) {
                            $stk = Stock::withTrashed()->find($id);
                            if ($stk && $stk->trashed()) {
                                $stk->restore();
                                ActivityLog::log('ai_undo_delete_stock', Stock::class, $id, $stk->fresh()->toArray());
                                $restoredCount++;
                            }
                        }
                    });

                    return [
                        'success' => true,
                        'message' => "Berhasil memulihkan kembali {$restoredCount} unit stok yang sebelumnya dihapus massal.",
                    ];
                }
                return ['success' => false, 'message' => 'Tidak ada data ID unit untuk dipulihkan.'];

            case 'stock_sold':
                $saleId = $undoData['sale_id'] ?? null;
                $stockId = $undoData['stock_id'] ?? null;
                $sale = Sale::find($saleId);
                $stock = Stock::find($stockId);

                DB::transaction(function () use ($sale, $stock) {
                    if ($sale) {
                        $sale->items()->delete();
                        $sale->delete();
                    }
                    if ($stock) {
                        $stock->update(['status' => 'available']);
                    }
                });

                return [
                    'success' => true,
                    'message' => "Transaksi penjualan berhasil dibatalkan dan status unit dikembalikan menjadi 'Available'.",
                ];

            default:
                return [
                    'success' => false,
                    'message' => "Jenis aksi ini tidak mendukung operasi Undo otomatis.",
                ];
        }
    }

    /**
     * Build a dynamic_parameter_id => dynamic_parameter_value_id map from the
     * resolved legacy spec columns so AI-created units get consistent EAV rows.
     */
    protected function resolveParameterMap(?int $brandId, ?int $colorId, ?int $memoryId, ?int $licenseId, string $type = 'second'): array
    {
        $map = [];

        $resolveParamId = function (string $alias): ?int {
            $id = DynamicParameter::where('name', 'like', "%{$alias}%")->value('id');
            return $id ? (int) $id : null;
        };

        $slots = [
            'brand' => ['brand', 'merek'],
            'color' => ['color', 'warna'],
            'memory' => ['memory', 'storage', 'capacity', 'memori'],
            'license' => ['license', 'licence', 'lisensi'],
        ];

        $ids = ['brand' => $brandId, 'color' => $colorId, 'memory' => $memoryId, 'license' => $licenseId];

        foreach ($slots as $slot => $aliases) {
            if (! $ids[$slot]) {
                continue;
            }
            foreach ($aliases as $alias) {
                $paramId = $resolveParamId($alias);
                if ($paramId) {
                    $map[$paramId] = (int) $ids[$slot];
                    break;
                }
            }
        }

        foreach (['condition', 'kondisi'] as $alias) {
            $condParamId = $resolveParamId($alias);
            if ($condParamId) {
                $condValueId = DynamicParameterValue::where('parameter_id', $condParamId)
                    ->where('value', 'like', "{$type}%")
                    ->value('id');
                if ($condValueId) {
                    $map[$condParamId] = (int) $condValueId;
                }
                break;
            }
        }

        return $map;
    }
}

