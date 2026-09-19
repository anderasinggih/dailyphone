<?php

namespace App\Services;

use App\Models\GeneralSetting;
use App\Models\Stock;
use App\Models\Sale;
use App\Models\Store;
use App\Models\Buyer;
use App\Models\DynamicParameter;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeminiAssistantService
{
    protected ?string $apiKey;
    protected string $model;
    protected bool $enabled;
    protected ?string $customInstruction;

    // The training-note selection is queried up to three times per chat
    // request (live neuron map, model context, memo-eligibility review).
    // Memoize per query so we hit the DB once.
    protected ?string $notesCacheKey = null;
    protected ?\Illuminate\Support\Collection $notesCache = null;

    public function __construct()
    {
        $this->reloadSettings();
    }

    public function reloadSettings(): void
    {
        $settings = GeneralSetting::first();
        
        $this->apiKey = $settings?->ai_api_key ?: env('GEMINI_API_KEY');
        $this->model = $settings?->ai_model ?: env('GEMINI_MODEL', 'gemini-3.5-flash-lite');
        $this->enabled = $settings ? (bool)$settings->ai_enabled : true;
        $this->customInstruction = $settings?->ai_system_instruction;
    }

    public function isConfigured(): bool
    {
        $this->reloadSettings();
        return !empty($this->apiKey);
    }

    public function isEnabled(): bool
    {
        $this->reloadSettings();
        return $this->enabled;
    }

    public function getModel(): string
    {
        return $this->model;
    }

    /**
     * Test connection to Gemini API.
     */
    public function testConnection(?string $testKey = null, ?string $testModel = null): array
    {
        $key = $testKey ?: $this->apiKey;
        $requestedModel = $testModel ?: $this->model;

        if (empty($key)) {
            return [
                'success' => false,
                'message' => 'API Key is missing. Please provide a valid Gemini API Key.'
            ];
        }

        // Try requested model first, then fall back to other available models
        $candidateModels = array_unique(array_filter([
            $requestedModel,
            'gemini-3.5-flash-lite',
            'gemini-3.5-flash',
            'gemini-flash-latest',
        ]));

        $lastError = '';

        foreach ($candidateModels as $model) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$key}";
                $response = Http::timeout(10)->post($url, [
                    'contents' => [
                        [
                            'role' => 'user',
                            'parts' => [['text' => 'Respond with the single word: ONLINE']]
                        ]
                    ]
                ]);

                if ($response->successful()) {
                    $reply = $response->json('candidates.0.content.parts.0.text', '');
                    return [
                        'success' => true,
                        'model_used' => $model,
                        'message' => "Connected successfully to {$model}! Response: " . trim($reply)
                    ];
                }

                $lastError = $response->json('error.message') ?? $response->body();
            } catch (\Exception $e) {
                $lastError = $e->getMessage();
            }
        }

        return [
            'success' => false,
            'message' => 'Google Gemini API Error: ' . $lastError
        ];
    }

    /**
     * Generate structured store context to ground the AI response.
     */
    public function generateStoreContext($user): string
    {
        $storeFilter = null;
        if ($user && $user->role === 'karyawan' && $user->store_id) {
            $storeFilter = $user->store_id;
        }

        // Stores
        $stores = Store::select('id', 'name', 'address')->get();
        $storeListStr = $stores->map(fn($s) => "Store ID {$s->id}: {$s->name} ({$s->address})")->implode("\n");

        // Available Stocks Summary
        $stockQuery = Stock::with(['store', 'brand', 'color', 'memory', 'license'])
            ->where('status', 'available');

        if ($storeFilter) {
            $stockQuery->where('store_id', $storeFilter);
        }

        $availableCount = (clone $stockQuery)->count();
        $stocks = $stockQuery->limit(70)->get();

        $stockSample = $stocks->map(function ($s) {
            $storeName = $s->store ? $s->store->name : 'Unknown Store';
            $brand = $s->brand ? $s->brand->value : '';
            $color = $s->color ? $s->color->value : '';
            $mem = $s->memory ? $s->memory->value : '';
            $lic = $s->license ? $s->license->value : '';
            $price = number_format($s->sell_price, 0, ',', '.');
            $imei = $s->imei_1 ? " (IMEI: {$s->imei_1})" : "";

            return "- [ID: {$s->id}] {$s->name} | {$brand} | {$color} | {$mem} | {$lic} | Type: {$s->type} | Price: Rp {$price} | Loc: {$storeName}{$imei}";
        })->implode("\n");

        // Today's Sales Digest
        $today = now()->format('Y-m-d');
        $salesTodayQuery = Sale::whereDate('created_at', $today)->where('status', 'completed');
        if ($storeFilter) {
            $salesTodayQuery->where('store_id', $storeFilter);
        }

        $salesTodayCount = $salesTodayQuery->count();
        $salesTodayTotal = $salesTodayQuery->sum('total_amount');
        $formattedSales = number_format($salesTodayTotal, 0, ',', '.');

        // AUDIT INTELLIGENCE DATA
        // 1. Void / Cancelled transactions in last 7 days (Audit flag)
        $voidSales = Sale::with(['store', 'user'])
            ->where('status', 'void')
            ->where('updated_at', '>=', now()->subDays(7))
            ->limit(10)
            ->get();
        $voidAuditStr = $voidSales->isEmpty() 
            ? "None (No void transactions in last 7 days)" 
            : $voidSales->map(function($v) {
                $st = $v->store ? $v->store->name : '-';
                $by = $v->user ? $v->user->name : '-';
                return "- Invoice #{$v->invoice_number} | Rp " . number_format($v->total_amount, 0, ',', '.') . " | Reason: {$v->void_reason} | Store: {$st} | Kasir: {$by}";
            })->implode("\n");

        // 2. Dead/Aging Stock Audit (>45 days available)
        $agingStocks = Stock::where('status', 'available')
            ->where('created_at', '<=', now()->subDays(45));
        if ($storeFilter) {
            $agingStocks->where('store_id', $storeFilter);
        }
        $agingCount = (clone $agingStocks)->count();
        $agingSample = $agingStocks->limit(5)->get()->map(function($a) {
            $days = $a->created_at ? (int)$a->created_at->diffInDays(now()) : 45;
            return "- [Aging {$days}d] {$a->name} (Rp " . number_format($a->sell_price, 0, ',', '.') . ")";
        })->implode("\n");

        // 3. Pending Stock Transfers
        $pendingTransfers = \App\Models\StockTransfer::with(['stock', 'fromStore', 'toStore'])
            ->where('status', 'pending')
            ->limit(10)
            ->get();
        $pendingTransferCount = $pendingTransfers->count();
        $transferStr = $pendingTransfers->isEmpty()
            ? "No pending inter-store transfers"
            : $pendingTransfers->map(fn($t) => "- Unit: {$t->stock?->name} | From {$t->fromStore?->name} -> To {$t->toStore?->name}")->implode("\n");

        // Customer count & recent customers list
        $customerCount = Buyer::count();
        $recentCustomers = Buyer::orderBy('updated_at', 'desc')->limit(15)->get();
        $customerSampleStr = $recentCustomers->isEmpty()
            ? "No registered customers yet"
            : $recentCustomers->map(fn($c) => "- [ID: {$c->id}] {$c->name} | Phone: {$c->phone} | Address: {$c->address}")->implode("\n");

        // Recently Deleted / Trashed Units (Soft deleted in Trash Bin)
        $trashedCount = Stock::onlyTrashed()->count();
        $trashedStocks = Stock::onlyTrashed()->with(['store'])->orderBy('deleted_at', 'desc')->limit(50)->get();
        $trashedStockStr = $trashedCount === 0
            ? "Kosong (0 unit di keranjang sampah)"
            : "Total {$trashedCount} unit di keranjang sampah (Trash Bin):\n" . $trashedStocks->map(function($t) {
                $st = $t->store ? $t->store->name : 'PERENG STORE';
                $imei = $t->imei_1 ? " | IMEI: {$t->imei_1}" : "";
                $sn = $t->serial_number ? " | SN: {$t->serial_number}" : "";
                return "- [ID: {$t->id}] {$t->name}{$imei}{$sn} | Branch: {$st} | Deleted at: {$t->deleted_at}";
            })->implode("\n");

        $userStoreName = $user && $user->store ? $user->store->name : 'All Stores (Admin View)';
        $userRole = $user ? $user->role : 'user';
        $parameterContext = $this->generateParametersContext();

        return <<<CONTEXT
SYSTEM CONTEXT & LIVE STORE DATA:
- Current Date & Time: {$today}
- Active User Role: {$userRole}
- Active Store Scope: {$userStoreName}
- Total Active Branches: {$stores->count()}
{$storeListStr}

LIVE INVENTORY HIGHLIGHTS:
- Total Units Available: {$availableCount}
- Active Stock Catalog Sample:
{$stockSample}

RECENTLY DELETED / TRASHED UNITS (Keranjang Sampah):
{$trashedStockStr}

TODAYS OPERATIONS:
- Today's Completed Sales Count: {$salesTodayCount}
- Today's Sales Volume: Rp {$formattedSales}
- Total Registered Customers: {$customerCount}

REGISTERED CUSTOMER DIRECTORY (Recent Sample):
{$customerSampleStr}

OPERATIONAL AUDIT DATA:
- Aging/Dead Stock (>45 days): {$agingCount} units
{$agingSample}
- Void Transactions (Last 7 Days):
{$voidAuditStr}
- Pending Inter-Store Transfers: {$pendingTransferCount} pending
{$transferStr}

LIVE PARAMETER & DROPDOWN OPTIONS REFERENCE (AUTHORITATIVE):
Use the EXACT values below as the complete, current list of selectable options in the system. NEVER invent, guess, or add options that are not listed here. When the user asks "what are the options/dropdowns/pilihannya", answer from this list.
{$parameterContext}
CONTEXT;
    }

    /**
     * Build the live, authoritative list of dropdown options & dynamic
     * parameters that the AI can reference instead of guessing.
     */
    public function generateParametersContext(): string
    {
        $lines = [];

        // 1. Dynamic parameters with their active values (Brand, Warna, Kapasitas Memori, Tipe Lisensi, dll.)
        $parameters = DynamicParameter::with(['values' => function ($q) {
            $q->where('is_active', true)->orderBy('value');
        }])->orderBy('name')->get();

        if ($parameters->isNotEmpty()) {
            foreach ($parameters as $param) {
                $values = $param->values->map(fn($v) => $v->value)->implode(', ');
                $lines[] = "- {$param->name} [{$param->category}]: {$values}";
            }
        } else {
            $lines[] = '- No dynamic parameters configured yet.';
        }

        // 2. Money note categories (income vs expense)
        $inCats = \App\Models\MoneyNoteCategory::where('type', 'in')->orderBy('name')->pluck('name')->implode(', ');
        $outCats = \App\Models\MoneyNoteCategory::where('type', 'out')->orderBy('name')->pluck('name')->implode(', ');
        $lines[] = "- Money Note Category (Income / in): {$inCats}";
        $lines[] = "- Money Note Category (Expense / out): {$outCats}";

        // 3. Stock type (condition) & status options
        $lines[] = '- Stock Type (Kondisi Unit) [type]: new (New / Baru), second (Pre-owned / Second)';
        $lines[] = '- Stock Status [status]: available (Available / Ready), transit (Transit / Transfer Proposed), sold (Sold / Terjual), trashed (Trash Bin / Dihapus Sementara)';

        // 4. Payment methods
        $lines[] = '- Sale Payment Method [payment_method]: cash (Cash / Tunai), online (Online: Transfer Bank / QRIS). If a bank name or detail is provided, put it in payment_detail (e.g. "BCA", "Mandiri", "QRIS").';
        $lines[] = '- Store Branches [store_id] are listed in SYSTEM CONTEXT above (use their exact Store ID & name).';

        return implode("\n", $lines);
    }

    /**
     * Send chat conversation to Gemini.
     *
     * @param  array  $messages  Recent session messages ([{role, content}]).
     * @param  mixed  $attachments  Collection of AiChatAttachment to include.
     * @param  callable|null  $onChunk  When given, uses :streamGenerateContent and
     *                                  receives each visible text delta as it streams
     *                                  (ai_memo blocks are stripped live).
     * @param  string  $ingestNotice  Verifiable system notice about documents that
     *                                were actually indexed into neurons this request.
     * @param  string|null  $model  Per-session model override (falls back to the
     *                              superadmin-configured model when empty).
     */
    public function chat(array $messages, $user, ?string $sessionRules = null, ?string $query = null, $attachments = null, ?callable $onChunk = null, string $ingestNotice = '', ?string $model = null): array
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'reply' => 'Gemini API Key has not been configured yet. Please ask the Superadmin to configure it in Settings > General.'
            ];
        }

        $userRole = $user ? $user->role : 'user';
        $userStoreName = $user && $user->store ? $user->store->name : 'All Stores (Admin View)';
        $storeContext = $this->generateStoreContext($user);
        $queryText = $query !== null ? trim($query) : $this->lastUserText($messages);
        $neurons = $this->resolveNeurons($queryText);
        $trainingNotesStr = $this->generateTrainingNotesContext($queryText);
        $customInst = $this->customInstruction ? "\nADDITIONAL STORE INSTRUCTIONS: {$this->customInstruction}" : "";
        $sessionRulesPrompt = !empty($sessionRules) ? "\nCUSTOM SESSION RULES & TRAINING DIRECTIVES (STRICTLY ADHERE TO THESE IN THIS CHAT SESSION):\n" . $sessionRules . "\n" : "";

        $systemPrompt = <<<PROMPT
You are "Daily Phone Intelligence", a high-precision AI Operations, Audit & Growth Marketing Assistant for Daily Phone gadget retail stores.
You possess advanced operational audit and growth marketing skills:
1. Operational Auditing & Anomaly Detection: You can audit and analyze inventory health, identify dead/aging stock (>45 days), evaluate voided/cancelled invoices for suspicious patterns, and review inter-store transfer delays.
2. Retail & Gadget Marketing Strategies: You are equipped with expert retail marketing skills (campaign ideas, promo offers, bundled packages, pricing psychology, social media copy, WhatsApp broadcast copywriting, ads creative, and customer retention/referral loops). When asked for promo ideas or marketing recommendations for specific smartphones or slow-moving stock, provide high-converting, creative, and realistic gadget retail campaigns.
3. Direct, Concise & To The Point (CRITICAL):
   - Answer directly and crisply like ChatGPT. Do NOT repeat redundant pleasantries ("Siap, Superadmin!", "Tentu saja!", "Berikut adalah rincian spesifikasi proposal aksi...").
   - Eliminate filler words and repetitive preamble text.
   - If proposing an action, state what is being done in 1-2 concise sentences, without echoing the entire table in normal text because the action proposal card already displays all details cleanly.
4. Markdown Formatting (REQUIRED): Always format replies cleanly using Markdown:
   - Headings with ## or ### for sections when appropriate.
   - Bold ** for key metrics/numbers.
   - Bullet lists (- ) for concise enumerations.
   - Use a Markdown table (| Col A | Col B |) whenever presenting structured comparative data (stock audit, aging, price checks).
5. Language Policy: Respond in the user's language (Indonesian or English). Maintain a calm, professional Apple HIG tone.

ACCESS RULES (STRICT):
- The current user role is: {$userRole}
- SUPERADMIN & ADMIN: Have FULL, unrestricted access to ALL information across ALL branches/stores — every stock item, every sale, every customer, every audit record. Never refuse or restrict data for these roles. Always answer with complete data.
- KARYAWAN (staff): Only access their assigned store ({$userStoreName}). Do not reveal data from other stores/branches.
- Never claim information is "not accessible" when it exists in the SYSTEM CONTEXT below.
- If a requested metric is absent from the context, say so honestly and suggest what data would be needed.

GENERAL KNOWLEDGE (SUPERADMIN):
- As a Superadmin you may discuss ANY topic — general knowledge, education, business/management theory, economics, world facts, science, tech, culture, etc. You are a general-purpose assistant, like any modern AI chatbot.
- If a question is general (world knowledge, theories, concepts, books, ideas) and NOT about Daily Phone store operations, answer openly and completely from your general knowledge. Do not force the store context below into general answers.
- The store context, actions, and neuron memory are only tools to use WHEN RELEVANT to the user's question — not a cage.
- Never claim that a training node/memory was saved unless the system confirms it (see the SISTEM INGEST notice below) or you genuinely emitted a valid ```ai_memo block yourself.

SUPERADMIN EXECUTION & ACTION PROPOSALS:
Whenever the Superadmin explicitly asks or implies an action (such as changing a price, marking a unit as sold/terjual, updating a stock status/note, recording a money note/expense/income, or running a python calculation/script), you MUST act as an intelligent business partner:

1. INTELLIGENT VALIDATION OF MANDATORY FIELDS:
   - Selling a stock unit (`action`: "sell_stock"):
     * STRICT CUSTOMER RULE: You CANNOT and MUST NOT invent, guess, hallucinate, or improvise dummy customer names (e.g. NEVER make up names like "Alex Turner", "John Doe", "Budi", or walk-in placeholders).
     * If the user asks to mark a unit as sold but HAS NOT provided customer details or payment method (e.g. user simply says "jadikan status terjual yg ip 12 itu" or "laku harga 6jt"):
       DO NOT EMIT AN ACTION PROPOSAL!
       Instead, politely and firmly ask the user for the customer and transaction details:
       "Untuk mencatat unit ini sebagai Terjual ke sistem kasir, mohon berikan data transaksi & pembeli:
       1. **Nama Pembeli** (atau pilih dari pelanggan terdaftar)
       2. **Nomor HP / WhatsApp** (wajib untuk data garansi & CRM)
       3. **Alamat Domisili** (kota/kabupaten, misal: Purwokerto, Cilacap, dsb.)
       4. **Metode Pembayaran** (Cash, Transfer BCA / Mandiri / BRI, atau QRIS)
       5. **Harga Deal Terjual** (jika berbeda dari Rp [harga katalog])"
     * ALL FIELDS REQUIRED FOR NEW CUSTOMERS:
       - `buyer_name`: Full name of customer
       - `buyer_phone`: Valid phone number (e.g. "08123456789")
       - `buyer_address`: City/Address
       - `actual_sell_price`: Transaction amount
       - `payment_method`: e.g. "cash", "bca", "transfer", "qris"
     * If the customer is already in the REGISTERED CUSTOMER DIRECTORY, user can just state the name/phone and you can match existing data.
     * ONLY emit the ```action_proposal when all of these verified details are provided!

2. ACTIONS SUPPORTED:
   - "add_stock": When the user asks to add, input, or create a new single stock/unit, OR when user asks to restore / put back a previously deleted unit (e.g. "add stok coy ip 12", "add <imei> back", "pulihkan unit <imei>", "tambah kembali"):
     * CRITICAL FIELD COMPLETENESS: The user requires ALL fields to be comprehensively filled and presented in BOTH the `changes` table and `payload`. DO NOT omit fields or provide only partial info!
     * The fields that MUST be included in `changes` and `payload` are:
       1. `Nama Unit` (`name`): e.g. "iPhone 13 128GB"
       2. `Brand` (`brand`): e.g. "Apple" or "Samsung"
       3. `Kapasitas Memori` (`memory`): e.g. "128GB", "256GB" (extract from name or set default)
       4. `Warna` (`color`): e.g. "Midnight", "Blue", "Space Gray"
       5. `Tipe Lisensi` (`license`): e.g. "iBox (Resmi)", "Bea Cukai (Sinyal On)", "Inter (Sinyal Off)"
       6. `Kondisi` (`type`): e.g. "Second" or "New"
       7. `Supplier / Distributor` (`supplier`): e.g. "Distributor Utama Jakarta", "Supplier Partner", or user specified supplier
       8. `Serial Number (SN)` (`serial_number`): e.g. "DP-IP-XXXXXX" (unique generated SN)
       9. `Nomor IMEI` (`imei_1`): e.g. "358729104829104" (15-digit realistic IMEI)
       10. `Garansi Toko (Hari)` (`warranty_duration_days`): e.g. 30 (or user specified)
       11. `Harga Beli (HPP)` (`buy_price`): Realistic purchase price e.g. Rp 6.200.000
       12. `Harga Jual` (`sell_price`): Realistic catalogue sell price e.g. Rp 7.299.000
       13. `Lokasi Cabang` (`store_name` / `store_id`): Branch store name e.g. "PERENG STORE" (ID: 1)
       14. `Status Unit` (`status`): e.g. "Available (Ready)" / "available"
     * RULE (SANGAT PENTING): JANGAN PERNAH kirim `brand_id`, `color_id`, `memory_id`, atau `license_id` berupa angka ID mentah di payload. Angka seperti 128 seringkali berarti "128GB", bukan ID, dan memicu error database (foreign key). SELALU kirim nilai teks yang bisa dibaca manusia (contoh: `"memory": "128GB"`, `"brand": "Apple"`, `"color": "Midnight"`, `"license": "iBox (Resmi)"`). Backend yang bertugas mencocokkan teks ke ID parameter.
     * Example `changes` for `add_stock`:
       [
         { "field": "Nama Unit", "old": "-", "new": "iPhone 13 128GB" },
         { "field": "Brand", "old": "-", "new": "Apple" },
         { "field": "Kapasitas Memori", "old": "-", "new": "128GB" },
         { "field": "Warna", "old": "-", "new": "Midnight" },
         { "field": "Tipe Lisensi", "old": "-", "new": "iBox (Resmi)" },
         { "field": "Kondisi", "old": "-", "new": "Second" },
         { "field": "Supplier / Distributor", "old": "-", "new": "Distributor Utama Jakarta" },
         { "field": "Serial Number (SN)", "old": "-", "new": "DP-IP-782190" },
         { "field": "Nomor IMEI", "old": "-", "new": "358729104829104" },
         { "field": "Garansi Toko (Hari)", "old": "-", "new": "30 Hari" },
         { "field": "Harga Beli (HPP)", "old": "-", "new": "Rp 6.200.000" },
         { "field": "Harga Jual", "old": "-", "new": "Rp 7.299.000" },
         { "field": "Lokasi Cabang", "old": "-", "new": "PERENG STORE" },
         { "field": "Status Unit", "old": "-", "new": "Available (Ready)" }
       ]
     * Example `payload` for `add_stock`:
       {
         "name": "iPhone 13 128GB",
         "brand": "Apple",
         "category": "iphone",
         "type": "second",
         "color": "Midnight",
         "memory": "128GB",
         "license": "iBox (Resmi)",
         "supplier": "Distributor Utama Jakarta",
         "serial_number": "DP-IP-782190",
         "imei_1": "358729104829104",
         "warranty_duration_days": 30,
         "buy_price": 6200000,
         "sell_price": 7299000,
         "store_id": 1,
         "status": "available"
       }
    - "add_bulk_stock": When the user asks to add multiple units, generate dummy inventory, or bulk import stocks (e.g. "buatkan data dummy 5 unit", "tambah 10 stok sekaligus", "bikin 100 data dummy"):
      * CRITICAL FOR LARGE QUANTITIES (>= 5 units): DO NOT write out dozens or hundreds of items in JSON! It will exceed token limits and break the JSON parser. Instead, simply specify `"count": <number>` in payload, and the backend engine will automatically generate diverse realistic phone specs (iPhone 11-15, Samsung S20-S24, Xiaomi, OPPO, Vivo, etc.)!
      * Payload structure for dummy / bulk generation:
        {
          "store_id": 1,
          "count": 100
        }
      * Or if the user specifies a specific small custom list (< 5 items):
        {
          "store_id": 1,
          "items": [
            { "name": "iPhone 13 128GB", "brand": "Apple", "color": "Midnight", "memory": "128GB", "license": "iBox (Resmi)", "type": "second", "buy_price": 6200000, "sell_price": 7299000 }
          ]
        }
   - "update_stock": When the user asks to update prices, status, or notes of an EXISTING stock item.
     * Ensure the target unit is clearly identified by `stock_id` or `serial_number` from the LIVE INVENTORY context. DO NOT use `update_stock` to create a new unit!
   - "delete_stock": When the user asks to delete or remove a single existing stock unit from inventory.
     * Must provide `stock_id` or `serial_number` of an existing unit.
   - "delete_all_stocks": When the user asks to delete all stock units, clear/reset inventory, or remove all units (e.g. "hapus semua unit", "kosongkan stok", "delete all units"):
     * CRITICAL: NEVER use "run_python_script" with a print statement or python code to simulate or delete stocks! You MUST emit "delete_all_stocks" so all units are ACTUALLY soft-deleted in the database and logged to the Activity Log!
     * Payload structure:
       { "store_id": 1 } (or omit store_id to clear all active branches)
     * Changes structure:
       [
         { "field": "Status Seluruh Stok", "old": "Aktif / Tersedia", "new": "Dihapus ke Keranjang Sampah" },
         { "field": "Lokasi Toko", "old": "-", "new": "PERENG STORE" }
       ]
   - "empty_trash": When the user asks to empty trash, clear the trash bin, or permanently delete all items in trash (e.g. "hapus isi trash", "kosongkan trash", "hapus permanen trash", "bersihkan tempat sampah"):
     * CRITICAL: This action permanently deletes (forceDelete) all soft-deleted units from the database. It cannot be undone!
     * NEVER write a python script (`run_python_script` or sqlite/mysql query) to empty trash or delete stocks! That will FAIL because the database is MySQL, not SQLite! You MUST use the native "empty_trash" action!
     * Must emit "empty_trash".
     * Payload structure:
       { "confirm": true }
     * Changes structure:
       [
         { "field": "Status Unit di Keranjang Sampah", "old": "Tersimpan di Trash", "new": "Dihapus Permanen (Force Delete)" },
         { "field": "Peringatan", "old": "-", "new": "Data tidak dapat dipulihkan kembali" }
       ]
   - "sell_stock": When the user asks to record a unit sale (mark as sold).
     * MANDATORY: `buyer_name`, `actual_sell_price`, `payment_method`.
- "create_money_note": When recording cash book income or expenses.
      * MANDATORY: `type` ("expense"|"income"), `amount`, `category`, `description`.
- "add_parameter": When the user asks to ADD/CREATE master data parameters or their option values (e.g. add a new parameter field such as Brand, Warna, Kapasitas Memori, Tipe Lisensi, Supplier/Kondisi, or add new option values to an existing parameter).
       * ADD-ONLY ACTION: You CANNOT delete, remove, or destroy any parameter or option — if asked to do so, politely state you cannot and suggest the Superadmin do it from Settings > Product & Unit Parameters.
       * Payload structure:
         {
           "name": "Supplier",
           "category": "global" | "iphone" | "android",
           "values": ["Distributor Utama Jakarta", "Supplier Partner"] or [{"value": "Warna Gold", "color": "amber"}]
         }
       * If the parameter name already exists, the engine will NOT create a duplicate — it will only add the new option values that do not exist yet.
   - "learn_repo": When the user asks the AI to learn / study / memorize a GitHub repository (e.g. "belajari repo ini", "pelajari https://github.com/owner/repo", "download skill dari repo github"), you MUST emit this action so the backend can download the repo and save its files as new AI memory neurons.
       * MANDATORY payload:
         {
           "repo": "https://github.com/owner/repo"  (full GitHub URL, or "owner/repo")
         }
       * This action does NOT modify business data — it only grows the AI's training memory network with the repo's text files as knowledge nodes.
       * "title": e.g. "Learn GitHub repo owner/repo". "changes": a summary row like { "field": "AI Memory", "old": "-", "new": "Pelajari repo owner/repo" }.

3. STRUCTURED ACTION PROPOSAL FORMAT:
When all criteria are met, formulate your response in two parts:
Part 1: A brief, polite explanation in friendly Markdown of the changes.
Part 2: A single structured code block starting with ```action_proposal and ending with ``` containing valid JSON:
```action_proposal
{
  "action": "add_stock" | "add_bulk_stock" | "delete_stock" | "delete_all_stocks" | "empty_trash" | "sell_stock" | "update_stock" | "create_money_note" | "add_parameter" | "learn_repo",
  "title": "Short title of action",
  "summary": "1 sentence explanation of the action",
  "target": "Target identifier (e.g. New Unit iPhone 12 128GB, or 5 Units Bulk Import)",
  "changes": [
    // For single unit actions (add_stock): MUST list all 14 detailed fields (Nama Unit, Brand, Kapasitas Memori, Warna, Tipe Lisensi, Kondisi, Supplier / Distributor, Serial Number (SN), Nomor IMEI, Garansi Toko (Hari), Harga Beli (HPP), Harga Jual, Lokasi Cabang, Status Unit).
    // For update_stock or sell_stock: list all relevant fields being changed.
    // For add_bulk_stock: provide high-level summary fields (Total Unit, Kategori, Lokasi Cabang, Status), while the full breakdown goes into payload.items!
    { "field": "Nama Unit", "old": "-", "new": "iPhone 13 128GB" },
    { "field": "Kapasitas Memori", "old": "-", "new": "128GB" },
    { "field": "Warna", "old": "-", "new": "Midnight" },
    { "field": "Tipe Lisensi", "old": "-", "new": "iBox (Resmi)" },
    { "field": "Supplier / Distributor", "old": "-", "new": "Distributor Utama Jakarta" },
    { "field": "Garansi Toko (Hari)", "old": "-", "new": "30 Hari" },
    { "field": "Harga Jual", "old": "-", "new": "Rp 7.299.000" }
  ],
  "payload": {
    // For add_stock:
    // "name": "iPhone 13 128GB", "brand": "Apple", "color": "Midnight", "memory": "128GB", "license": "iBox (Resmi)", "type": "second", "supplier": "Distributor Utama Jakarta", "serial_number": "DP-IP-782190", "imei_1": "358729104829104", "warranty_duration_days": 30, "buy_price": 6200000, "sell_price": 7299000, "store_id": 1, "status": "available"
    // For update_stock:
    // "stock_id": 123 (or "serial_number": "..."), "sell_price": 9200000, "buy_price": 7500000, "status": "available"
    // For delete_stock:
    // "stock_id": 123 (or "serial_number": "...")
    // For sell_stock:
    // "stock_id": 123 (or "serial_number": "..."), "buyer_name": "Budi Santoso", "buyer_phone": "08123456789", "buyer_address": "Purwokerto", "actual_sell_price": 9200000, "payment_method": "cash"|"transfer"|"qris"
    // For create_money_note:
    // "type": "expense"|"income", "amount": 250000, "category": "Operasional", "description": "Beli galon air"
    // For add_parameter:
    // "name": "Supplier", "category": "global", "values": ["Distributor Utama Jakarta", { "value": "Warna Gold", "color": "amber" }]
    // For learn_repo:
    // "repo": "https://github.com/owner/repo"
    // For empty_trash:
    // "confirm": true
  }
}
```
CRITICAL: Only emit ```action_proposal when the user role is 'superadmin'. For non-superadmin users, politely inform them that executing data mutations requires Superadmin privileges. Never emit fake actions.

{$storeContext}
{$customInst}
{$sessionRulesPrompt}

PERSISTENT TRAINING MEMORY — THE AI'S NEURON NETWORK (AI MENULIS SENDIRI — SANGAT PENTING):
- Memory kamu adalah jaringan neuron yang HIDUP & TIDAK TERBATAS: setiap catatan menjadi sebuah NODE, dan setiap node otomatis tersambung ke node-node terkait membentuk mind map.
- Ketika pengguna memberimu instruksi, feedback, koreksi perilaku, atau fakta toko yang layak diingat selamanya (contoh: "jangan pernah sebut nomor HPP/modal", "diskon maksimal 200 ribu", "warna unit wajib diisi", "customer X sering ngotot garansi"), kamu HARUS:
  1. Mengecek apakah hal itu sudah tercatat di GLOBAL AI TRAINING MEMORY di bawah. Jika sudah ada (ide sama), JANGAN mencatat ulang.
  2. Jika belum, kamu BISA membuat node BARU dan menentukan relasinya: pilih "related" (kata kunci) yang paling menggambarkan node-node mana saja yang harus tersambung dengannya (contoh: nama produk, "harga", "customer", "garansi", dsb).
- Jika belum tercatat, AKHIRI balasanmu dengan blok persis seperti ini (skala kecil, max 2 blok per balasan):
```ai_memo
{"kind": "rule", "title": "label pendek untuk node (maks 5 kata)", "related": ["kata-kunci-relasi-1", "kata-kunci-relasi-2"], "content": "instruksi singkat, spesifik, 1-2 kalimat"}
```
- Penting: blok ```ai_memo hanya untuk mencatat ATURAN/FAKTA singkat yang kamu simpulkan sendiri. JANGAN membuat ai_memo yang mengklaim "seluruh isi dokumen/PDF tersimpan" — dokumen yang sudah diindeks sistem tidak perlu kamu catat ulang (sudah menjadi node sendiri).
- "kind" harus "rule" HANYA jika pengguna SUPERADMIN (lihat ACCESS RULES). Untuk pengguna lain gunakan "kind": "knowledge".
- "title" boleh dihilangkan (otomatis dibuat dari content). "related" juga opsional tapi sangat dianjurkan karena itulah cara kamu menentukan "relasinya kemana" di dalam neuron map — isi 2-4 kata kunci spesifik yang menghubungkan node ini ke node lain yang relevan.
- Tulis content padat & actionable, hanya aturan/fakta yang belum tercatat.
- Di teks normal balasanmu, konfirmasikan catatan singkat (mis. "📝 Node baru: ...") supaya pengguna tahu catatan tersimpan & tersambung.

GLOBAL AI TRAINING MEMORY (Buku Besar Belajar AI — isi yang sudah tercatat, setiap baris = satu node):
{$trainingNotesStr}
{$ingestNotice}
PROMPT;

        // Build contents for Gemini API
        $contents = [];
        $includeAttachments = $attachments instanceof \Illuminate\Support\Collection
            ? $attachments->values()
            : collect($attachments ?? [])->values();
        $lastIndex = count($messages) - 1;

        foreach ($messages as $i => $msg) {
            $role = ($msg['role'] === 'user') ? 'user' : 'model';
            $parts = [
                ['text' => $msg['content']],
            ];

            if ($i === $lastIndex && $includeAttachments->isNotEmpty()) {
                $parts = $this->attachParts($parts, $includeAttachments);
            }

            $contents[] = [
                'role' => $role,
                'parts' => $parts,
            ];
        }

        // Gemini REST payload (Token-optimized)
        $payload = [
            'system_instruction' => [
                'parts' => [
                    ['text' => $systemPrompt]
                ]
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.2,
                'maxOutputTokens' => 16384,
            ]
        ];

        // Some Gemini models accept PDF inline_data and others reject it with
        // "Request contains an invalid argument" — so when the user attached a
        // PDF we put a PDF-capable model first, otherwise we honour the
        // configured model and nothing else. The list is capped so a busy
        // request never spirals into long serial retries that kill the stream
        // (and resemble "no response from the server" for the user).
        $hasPdf = $includeAttachments->contains(fn ($a) => (string)($a->kind ?? '') === 'pdf');
        $pdfModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
        $primaryModel = !empty($model) ? $model : $this->model;

        $candidateModels = array_values(array_unique(array_filter(array_merge(
            $hasPdf ? $pdfModels : [],
            [$primaryModel]
        ))));
        $candidateModels = array_slice($candidateModels, 0, 4);

        $lastErrorMsg = '';

        foreach ($candidateModels as $modelToTry) {
            try {
                $endpoint = $onChunk !== null ? 'streamGenerateContent?alt=json' : 'generateContent';
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$modelToTry}:{$endpoint}&key={$this->apiKey}";

                if ($onChunk === null) {
                    // Blocking call: wait for the full completion (used by non-chat
                    // callers or when the client did not ask for streaming).
                    $response = Http::timeout(90)->connectTimeout(15)->post($url, $payload);
                    if ($response->successful()) {
                        $text = $response->json('candidates.0.content.parts.0.text', '');
                        return [
                            'success' => true,
                            'reply' => trim($text),
                            'neurons' => $neurons,
                        ];
                    }
                    $lastErrorMsg = $response->json('error.message') ?? $response->body();
                } else {
                    // Token streaming: relay each visible delta to $onChunk while
                    // the rest of the route continues to think, so the UI renders
                    // words ~1s after the user sends the message.
                    $response = Http::withOptions(['stream' => true])
                        ->timeout(300)
                        ->connectTimeout(15)
                        ->post($url, $payload);

                    if (!$response->successful()) {
                        $lastErrorMsg = $response->json('error.message') ?? $response->body();
                        Log::warning("Gemini stream model {$modelToTry} failed: {$lastErrorMsg}");
                        continue;
                    }

                    $meta = [];
                    $text = $this->streamGeminiContent($response, $onChunk, $meta);
                    if ($text !== '') {
                        return [
                            'success' => true,
                            'reply' => trim($text),
                            'neurons' => $neurons,
                        ];
                    }
                    $lastErrorMsg = 'The model returned an empty stream.';
                    if (($meta['finishReason'] ?? '') !== '') {
                        $lastErrorMsg .= " Reason: {$meta['finishReason']}";
                    }
                    if (($meta['blockReason'] ?? '') !== '') {
                        $lastErrorMsg .= " (content blocked by safety filter: {$meta['blockReason']})";
                    }
                }

                Log::warning("Gemini model {$modelToTry} failed: {$lastErrorMsg}");
            } catch (\Exception $e) {
                $lastErrorMsg = $e->getMessage();
            }
        }

        return [
            'success' => false,
            'reply' => "I encountered an error communicating with Gemini: {$lastErrorMsg}"
        ];
    }

    /**
     * Consume a :streamGenerateContent?alt=json response and relay each visible
     * text delta to the callback. ```ai_memo blocks are dropped live so the
     * client never flashes the temporary memory JSON. Returns the full text.
     */
    protected function streamGeminiContent($response, callable $onChunk, ?array &$meta = null): string
    {
        $body = $response->toPsrResponse()->getBody();

        $out = '';
        $pending = '';
        $inMemo = false;

        $emitJson = function (array $json) use (&$out, &$pending, &$inMemo, $onChunk, &$meta): void {
            if (($meta['finishReason'] ?? '') === '' && !empty($json['candidates'][0]['finishReason'])) {
                $meta['finishReason'] = $json['candidates'][0]['finishReason'];
            }
            if (($meta['blockReason'] ?? '') === '' && !empty($json['promptFeedback']['blockReason'])) {
                $meta['blockReason'] = $json['promptFeedback']['blockReason'];
            }
            $delta = $json['candidates'][0]['content']['parts'][0]['text'] ?? '';
            if ($delta === '') {
                return;
            }
            $pending .= $delta;
            $this->streamVisible($pending, $inMemo, function (string $s) use (&$out, $onChunk): void {
                if ($s === '') {
                    return;
                }
                $out .= $s;
                $onChunk($s);
            });
        };

        // Gemini's :streamGenerateContent?alt=json streams a *pretty-printed*
        // JSON array  [ { ... }, { ... } ]  where each top-level object spans
        // many lines — so a naive line-by-line json_decode() always fails and
        // yields nothing ("empty stream"). Scan the byte stream for balanced
        // top-level objects, honouring braces inside JSON strings, and decode
        // each complete object as soon as it arrives (keeps live token flow).
        $buffer = '';
        $depth = 0;
        $start = -1;
        $inStr = false;
        $esc = false;

        while (!$body->eof()) {
            $buffer .= $body->read(8192);
            $len = strlen($buffer);
            for ($i = 0; $i < $len; $i++) {
                $ch = $buffer[$i];

                if ($inStr) {
                    if ($esc) {
                        $esc = false;
                    } elseif ($ch === '\\') {
                        $esc = true;
                    } elseif ($ch === '"') {
                        $inStr = false;
                    }
                    continue;
                }

                if ($ch === '"') {
                    $inStr = true;
                } elseif ($ch === '{') {
                    if ($depth === 0) {
                        $start = $i;
                    }
                    $depth++;
                } elseif ($ch === '}') {
                    $depth--;
                    if ($depth === 0 && $start >= 0) {
                        $json = json_decode(substr($buffer, $start, $i - $start + 1), true);
                        if (is_array($json)) {
                            $emitJson($json);
                        }
                        $buffer = substr($buffer, $i + 1);
                        $len = strlen($buffer);
                        $i = -1;
                        $start = -1;
                    }
                }
            }

            // Drop leading non-object junk (whitespace, "["/"]", ",") so the
            // buffer never grows unbounded while waiting for the next object.
            if ($depth === 0) {
                $clean = ltrim($buffer, " \t\r\n[],");
                $buffer = $clean;
                $start = -1;
            }
        }

        $this->streamVisible($pending, $inMemo, function (string $s) use (&$out, $onChunk): void {
            if ($s === '') {
                return;
            }
            $out .= $s;
            $onChunk($s);
        });

        return $out;
    }

    /**
     * Split the accumulated pending text into visible (emitted) and memo
     * (dropped) parts using a small state machine that survives chunk splits.
     */
    protected function streamVisible(string &$pending, bool &$inMemo, callable $flush): void
    {
        while ($pending !== '') {
            if (!$inMemo) {
                $idx = strpos($pending, '```ai_memo');
                if ($idx === false) {
                    $flush($pending);
                    $pending = '';
                    return;
                }
                $flush(substr($pending, 0, $idx));
                $pending = substr($pending, $idx);
                $inMemo = true;
                continue;
            }

            // Inside a memo: discard everything up to and including the closing
            // fence. If the closing fence has not arrived yet, drop the buffer
            // and keep waiting for more chunks.
            $close = strpos($pending, '```', 4);
            if ($close === false) {
                $pending = '';
                return;
            }
            $pending = substr($pending, $close + 3);
            $inMemo = false;
        }
    }

    /**
     * Expand the last user-message parts with uploaded attachments: images & PDFs
     * become Gemini inline_data (base64) parts so the model can see them, while
     * the text of every other file is folded into a labelled attachment block.
     */
    protected function attachParts(array $parts, \Illuminate\Support\Collection $attachments): array
    {
        $inline = 0;
        $maxInline = 3;
        $body = "\n\n📎 FILE ATTACHMENTS (uploaded by user — read carefully):\n";

        foreach ($attachments as $att) {
            $name = $att->original_name ?? 'attachment';
            $isVisual = in_array($att->kind ?? '', ['image', 'pdf'], true);
            $text = trim((string)($att->extracted_text ?? ''));

            // Server-extracted text (CSV/XLSX/DOCX/PDF/ZIP/...) is cheaper and
            // faster for the model than re-parsing blobs, so prefer it. Images
            // always go as inline data; PDFs only fall back to inline data when
            // no text could be extracted.
            $sendInline = false;
            if ($isVisual && $inline < $maxInline) {
                $fullPath = storage_path('app/private/' . $att->storage_path);
                if (is_file($fullPath) && filesize($fullPath) > 0) {
                    $mime = $att->mime_type ?: 'image/jpeg';
                    $isImage = str_starts_with($mime, 'image/');
                    $isPdf = $mime === 'application/pdf';
                    if ($text === '' && ($isImage || $isPdf)) {
                        $bytes = file_get_contents($fullPath);
                        if ($bytes !== false && strlen($bytes) <= 10 * 1024 * 1024) {
                            $parts[] = [
                                'inline_data' => [
                                    'mime_type' => $mime,
                                    'data' => base64_encode($bytes),
                                ],
                            ];
                            $inline++;
                            $body .= "\n— {$name} (dilampirkan sebagai {$mime})\n";
                            continue;
                        }
                    }
                }
            }

            $body .= "\n--- FILE: {$name} (" . ($att->mime_type ?: 'unknown') . ' / ' . number_format((int)$att->size_bytes) . " bytes) ---\n";
            $body .= $text === '' ? '(tidak ada teks yang bisa diekstrak dari file ini)' . "\n" : mb_substr($text, 0, 60000) . "\n";
        }

        $parts[0]['text'] .= mb_substr($body, 0, 220000);

        return $parts;
    }

    /**
     * The exact neurons that will be injected into the model context for a
     * query — every active rule first, then knowledge notes ranked by relevance
     * to the query text. Used to render "accessing neurons" live while thinking.
     */
    public function resolveNeurons(?string $query = null): array
    {
        return $this->resolveNeuronNetwork($query)['nodes'];
    }

    /**
     * The exact neurons injected into the model context for a query — every
     * active rule first, then knowledge notes ranked by relevance — together
     * with the real synapses that connect those neurons to each other. The
     * Assistant UI renders this as a live neuron map while the model thinks.
     */
    public function resolveNeuronNetwork(?string $query = null): array
    {
        $notes = $this->selectTrainingNotes($query);

        $nodes = $notes->map(function ($n) {
            return [
                'id' => (int)$n->id,
                'title' => $this->neuronLabel($n),
                'kind' => $n->kind === 'rule' ? 'rule' : 'knowledge',
            ];
        })->values()->all();

        $idSet = $notes->map(fn ($n) => (int)$n->id)->filter()->flip();

        $edges = [];
        if ($idSet->isNotEmpty()) {
            $seen = [];
            $links = \App\Models\AiTrainingNoteLink::whereIn('note_id', $idSet->keys())
                ->whereIn('linked_note_id', $idSet->keys())
                ->get(['note_id', 'linked_note_id']);

            foreach ($links as $link) {
                $source = (int)$link->note_id;
                $target = (int)$link->linked_note_id;
                if ($source === $target) {
                    continue;
                }
                $key = min($source, $target) . ':' . max($source, $target);
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $edges[] = ['source' => $source, 'target' => $target];
            }
        }

        return ['nodes' => $nodes, 'edges' => $edges];
    }

    /**
     * Choose which training notes reach the model: rules are always loaded
     * (they are directives), knowledge notes are ranked by token relevance to
     * the current query so the prompt stays tight and the access list honest.
     */
    protected function selectTrainingNotes(?string $query): \Illuminate\Support\Collection
    {
        $key = trim((string)$query);
        if ($this->notesCache !== null && $this->notesCacheKey === $key) {
            return $this->notesCache;
        }

        $rules = \App\Models\AiTrainingNote::where('is_active', true)
            ->where('kind', 'rule')
            ->orderBy('updated_at', 'desc')
            ->get();

        $knowledge = \App\Models\AiTrainingNote::where('is_active', true)
            ->where('kind', 'knowledge')
            ->get();

        $tokens = app(\App\Services\AiMemoryGraphService::class)->tokenize(trim((string)$query));

        if ($tokens === []) {
            $notes = $rules->merge($knowledge->sortByDesc('updated_at')->take(10)->values());
        } else {
            $scored = $knowledge->map(function ($n) use ($tokens) {
                return ['note' => $n, 'score' => $this->scoreAgainst($n, $tokens)];
            });

            $matched = $scored->filter(fn ($s) => $s['score'] > 0)
                ->sortByDesc('score')
                ->take(12)
                ->pluck('note')
                ->values();

            $selected = $matched->isNotEmpty()
                ? $matched
                : $knowledge->sortByDesc('updated_at')->take(6)->values();

            $notes = $rules->merge($selected);
        }

        $this->notesCacheKey = $key;
        $this->notesCache = $notes;

        return $notes;
    }

    protected function scoreAgainst($note, array $tokens): int
    {
        $title = strtolower((string)$note->title);
        $content = strtolower((string)$note->content);
        $related = strtolower(implode(' ', (array)($note->related_keywords ?? [])));

        $score = 0;
        foreach ($tokens as $token) {
            if ($token !== '' && str_contains($title, $token)) {
                $score += 3;
            }
            if ($token !== '' && str_contains($related, $token)) {
                $score += 2;
            }
            if ($token !== '' && str_contains($content, $token)) {
                $score += 1;
            }
        }
        return $score;
    }

    protected function neuronLabel($note): string
    {
        $title = trim((string)($note->title ?? ''));
        if ($title !== '') {
            return mb_strimwidth($title, 0, 60, '…');
        }
        $compact = preg_replace('/\s+/', ' ', trim((string)$note->content)) ?: '';
        return mb_strimwidth($compact, 0, 56, '…');
    }

    protected function lastUserText(array $messages): string
    {
        foreach (array_reverse($messages) as $msg) {
            if (($msg['role'] ?? '') === 'user') {
                return trim((string)($msg['content'] ?? ''));
            }
        }
        return '';
    }

    /**
     * Build the persistent AI training memory block (rules first, then the
     * knowledge notes most relevant to the current query) so the AI "remembers"
     * across sessions, stores, and users. Each memory also lists its typed
     * synapses, so the AI can navigate the neuron map along meaningful paths.
     */
    public function generateTrainingNotesContext(?string $query = null): string
    {
        $notes = $this->selectTrainingNotes($query);

        if ($notes->isEmpty()) {
            return "- (empty - no training memories yet)";
        }

        $linkRows = \App\Models\AiTrainingNoteLink::get(['note_id', 'linked_note_id', 'relation', 'label', 'weight']);

        $synapses = [];
        foreach ($linkRows as $l) {
            $rel = $l->relation ?: ($l->label ?: 'related');
            $synapses[$l->note_id][] = [
                'id' => (int)$l->linked_note_id,
                'rel' => (string)$rel,
                'w' => $l->weight !== null ? (float)$l->weight : 0.0,
            ];
        }

        return $notes->map(function ($n) use ($synapses) {
            $tag = $n->kind === 'rule' ? '[RULE]' : '[NOTE]';
            $content = mb_strimwidth((string)$n->content, 0, 170, '…');
            $author = $n->author_name ?? 'System';
            $line = "- {$tag} node #{$n->id}: {$content} (oleh: {$author})";

            $links = $synapses[$n->id] ?? [];
            usort($links, fn($a, $b) => ($b['w'] ?? 0) <=> ($a['w'] ?? 0));
            $links = array_slice($links, 0, 4);

            if ($links !== []) {
                $parts = array_map(fn($l) => "#{$l['id']}:{$l['rel']}", $links);
                $line .= " ⟶ terhubung: " . implode(', ', $parts);
            }

            return $line;
        })->implode("\n");
    }

    /**
     * Generate a concise AI Business Overview for the Dashboard.
     * Uses the exact data already computed for the dashboard page, so no
     * profit/HPP leakage rules apply — the caller decides what to include.
     */
    public function generateDashboardInsight(array $context): ?string
    {
        if (!$this->isConfigured()) {
            return null;
        }

        // Format a compact readable context snapshot for the model.
        $fmt = fn($v) => 'Rp ' . number_format((float)$v, 0, ',', '.');
        $lines = [];
        $lines[] = "Periode: {$context['periodLabel']}";
        $lines[] = "Cakupan: {$context['scopeLabel']}";
        $lines[] = "";
        $lines[] = "=== Ringkasan Periode ===";
        $lines[] = "- Revenue: {$fmt($context['stats']['totalRevenue'])}";
        $lines[] = "- HPP/COGS: {$fmt($context['stats']['totalHpp'])}";
        $lines[] = "- Reparasi/Garansi: {$fmt($context['stats']['totalRepairs'])}";
        $lines[] = "- Penalti Retur (10%): {$fmt($context['stats']['totalReturnPenalty'])}";
        $lines[] = "- Biaya Affiliator: {$fmt($context['stats']['totalAffiliatorFee'])}";
        $lines[] = "- Net Profit: {$fmt($context['stats']['netProfit'])}";
        $lines[] = "- Unit Terjual: {$context['stats']['soldItemsCount']}";
        $lines[] = "- Pending Profit (booking): {$fmt($context['stats']['pendingProfit'])}";
        $lines[] = "- Affiliator aktif: {$context['stats']['activeAffiliatorsCount']}";

        $lines[] = "";
        $lines[] = "=== Performa Hari Ini ===";
        $todayLines = [];
        $gabungan = $context['todayStats']['gabungan'] ?? null;
        if ($gabungan) {
            $todayLines[] = "- Semua Cabang: Revenue {$fmt($gabungan['revenue'])}, Net Profit {$fmt($gabungan['netProfit'])}, {$gabungan['soldItems']} unit, {$gabungan['transactions']} transaksi";
        }
        foreach ($context['todayStats']['stores'] as $s) {
            $todayLines[] = "- {$s['store_name']}: Revenue {$fmt($s['revenue'])}, Net Profit {$fmt($s['netProfit'])}, {$s['soldItems']} unit, {$s['transactions']} trx";
        }
        if ($context['todayStats']['store']) {
            $s = $context['todayStats']['store'];
            $todayLines[] = "- Toko ini: Revenue {$fmt($s['revenue'])}, Net Profit {$fmt($s['netProfit'])}, {$s['soldItems']} unit, {$s['transactions']} trx";
        }
        $lines[] = $todayLines ? implode("\n", $todayLines) : '- Belum ada transaksi hari ini.';

        $lines[] = "";
        $lines[] = "=== Model Terlaris (periode ini) ===";
        $top = collect($context['topProducts'])->map(fn($t) => "- {$t['name']}: {$t['total_sold']} unit")->implode("\n");
        $lines[] = $top ?: '- Belum ada data.';

        $lines[] = "";
        $lines[] = "=== Metode Pembayaran ===";
        $pays = collect($context['paymentData'])->map(fn($p) => "- {$p['method']}: {$p['count']} trx / {$fmt($p['revenue'])}")->implode("\n");
        $lines[] = $pays ?: '- Belum ada data.';

        $lines[] = "";
        $lines[] = "=== Tren 8 Bulan Terakhir (Revenue) ===";
        $trends = collect($context['monthlyRevenue'])->map(fn($m) => "- {$m['month']}: {$fmt($m['revenue'])}")->implode("\n");
        $lines[] = $trends ?: '- Belum ada data.';

        $lines[] = "";
        $lines[] = "=== Statistik All-Time ===";
        $lines[] = "- Revenue: {$fmt($context['allTimeStats']['revenue'])}";
        $lines[] = "- Gross Profit: {$fmt($context['allTimeStats']['actualProfit'])}";
        $lines[] = "- Net Profit: {$fmt($context['allTimeStats']['netProfit'])}";
        $lines[] = "- Unit Terjual: {$context['allTimeStats']['soldItems']}";

        $contextBlock = implode("\n", $lines);

        $prompt = <<<PROMPT
Kamu adalah "Daily Phone Intelligence", analis bisnis senior untuk toko retail gadget (Daily Phone). Di bawah ini adalah snapshot data performa toko yang dipilih. Analisislah dan tulis ringkasan eksekutif untuk SUPERADMIN/PEMILIK TOKO.

DATA SNAPSHOT:
{$contextBlock}

Tulis respons dalam Bahasa Indonesia dengan struktur Markdown yang ringkas namun padat informasi:
## Ringkasan Eksekutif
Tulis 2-3 kalimat paragraf singkat yang menggambarkan kesehatan performa periode ini (kuat/lemah, tren naik/turun, konteks 8 bulan terakhir).

## Sorotan Positif
- Maks 3 bullet: hal yang berjalan baik (produk terlaris, metode pembayaran dominan, profit sehat, cabang terbaik, dll).

## Perhatian / Risiko
- Maks 3 bullet: hal yang butuh perhatian (profit tipis, repair/garansi tinggi, revenue rendah vs all-time, unit sedikit, dependensi satu produk/cabang, dll).

## Rekomendasi Tindakan
- Maks 3 bullet actionable: saran konkret untuk superadmin (bundling, promo, stock moving, efisiensi, follow-up affiliator, dll), sesuai fakta data.

Aturan:
- HARUS berbasis data snapshot di atas. JANGAN mengarang/menghalusinasi angka yang tidak ada.
- Jika stock kosong / belum ada data berarti, katakan itu secara jujur.
- Format Markdown rapi; gunakan **bold** untuk angka penting dan tabel hanya jika benar-benar membantu.
- Ringkas dan profesional, total kurang lebih 180-260 kata. Jangan menyebut "HPP/modal/biaya beli" sebagai hal buruk, tapi wajar disebut sebagai COGS.
- Jangan menyematkan blok ```action_proposal, ```ai_memo, atau JSON apa pun.
PROMPT;

        $payload = [
            'system_instruction' => [
                'parts' => [['text' => 'Kamu analis bisnis retail gadget. Jawab dalam Bahasa Indonesia, berbasis data, ringkas dan profesional.']]
            ],
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $prompt]]]
            ],
            'generationConfig' => [
                'temperature' => 0.4,
                'maxOutputTokens' => 1200,
            ]
        ];

        $candidateModels = array_unique(array_filter([
            $this->model,
            'gemini-3.5-flash-lite',
            'gemini-2.5-flash',
            'gemini-flash-latest',
        ]));

        foreach ($candidateModels as $modelToTry) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$modelToTry}:generateContent?key={$this->apiKey}";
                $response = Http::timeout(30)->post($url, $payload);

                if ($response->successful()) {
                    $text = trim($response->json('candidates.0.content.parts.0.text', ''));
                    return $text === '' ? null : $text;
                }
            } catch (\Exception $e) {
                Log::warning("Gemini dashboard insight failed on {$modelToTry}: {$e->getMessage()}");
            }
        }

        return null;
    }

    public function generateCheckoutUpsell(Stock $stock, float $price): ?string
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $brand = $stock->brand ? $stock->brand->value : '-';
        $color = $stock->color ? $stock->color->value : '-';
        $mem = $stock->memory ? $stock->memory->value : '-';
        $license = $stock->license ? $stock->license->value : '-';
        $type = $stock->type === 'new' ? 'New' : 'Pre-owned (Second)';

        $prompt = <<<PROMPT
You are the retail operations & sales assistant of a gadget store. You are helping the STAFF member at the point-of-sale terminal — NOT the customer. A customer is buying this unit today:
- Unit: {$stock->name}
- Brand: {$brand}
- Color: {$color}
- Storage: {$mem}
- License: {$license}
- Condition: {$type}
- Agreed selling price: Rp " . number_format($price, 0, ',', '.') . "

The staff has just filled in the sell form. Give a SHORT pre-submit checklist (max 4 bullets) written FOR THE STAFF: what to verify or do before hitting submit — e.g. physically check the unit & accessories, offer add-ons to the customer (tempered glass, case, charger/power adapter, extended warranty, trade-in, loyalty tips), confirm payment/DP method, note warranty & after-sales reminders, and handle repeat-buyer/loyalty care for THIS exact device and condition.

Rules:
- Respond in Bahasa Indonesia, concise and professional.
- Address the STAFF directly with directives (e.g. "Tawarkan…", "Cek…", "Pastikan…") — do NOT speak to the customer.
- ONLY operational + marketing suggestions. NEVER mention profit, margin, HPP, modal, atau biaya beli.
- Format: plain bullet lines starting with "- ", no headings, no markdown tables.
PROMPT;

        $payload = [
            'system_instruction' => [
                'parts' => [['text' => 'Kamu asisten pemasaran toko gadget. Jawab singkat, profesional, dan dalam Bahasa Indonesia.']]
            ],
            'contents' => [
                ['role' => 'user', 'parts' => [['text' => $prompt]]]
            ],
            'generationConfig' => [
                'temperature' => 0.4,
                'maxOutputTokens' => 300,
            ]
        ];

        $candidateModels = array_unique(array_filter([
            $this->model,
            'gemini-3.5-flash-lite',
            'gemini-2.5-flash',
            'gemini-flash-latest',
        ]));

        foreach ($candidateModels as $modelToTry) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$modelToTry}:generateContent?key={$this->apiKey}";
                $response = Http::timeout(12)->post($url, $payload);

                if ($response->successful()) {
                    $text = trim($response->json('candidates.0.content.parts.0.text', ''));
                    return $text === '' ? null : $text;
                }
            } catch (\Exception $e) {
                Log::warning("Gemini checkout upsell failed on {$modelToTry}: {$e->getMessage()}");
            }
        }

        return null;
    }
}
