<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>Invoice {{ $sale->invoice_number }} — Daily Phone</title>

    {{-- Open Graph / WhatsApp Link Preview --}}
    @php
        $ogTitle = 'Invoice ' . $sale->invoice_number . ' — Daily Phone';
        $ogDesc  = 'Customer: ' . ($sale->buyer->name ?? 'Walk-in Customer') .
                   ' | Total: Rp ' . number_format($sale->total_amount, 0, ',', '.') .
                   ' | Status: ' . ($sale->status === 'completed' ? 'PAID' : strtoupper($sale->status)) .
                   ' | Tgl: ' . $sale->created_at->format('d M Y');
        $ogUrl   = url('/invoice/' . $sale->invoice_number);
    @endphp
    <meta property="og:type"        content="website">
    <meta property="og:url"         content="{{ $ogUrl }}">
    <meta property="og:title"       content="{{ $ogTitle }}">
    <meta property="og:description" content="{{ $ogDesc }}">
    <meta property="og:site_name"   content="Daily Phone">
    {{-- Twitter/X Card --}}
    <meta name="twitter:card"        content="summary">
    <meta name="twitter:title"       content="{{ $ogTitle }}">
    <meta name="twitter:description" content="{{ $ogDesc }}">

    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Outfit', 'sans-serif'],
                    }
                }
            }
        }
    </script>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Outfit', sans-serif; }
        .mono { font-family: 'Courier New', monospace; }
        @media print {
            body { background: white !important; }
            .no-print { display: none !important; }
        }
    </style>
</head>
<body class="bg-slate-100 antialiased min-h-screen py-4 sm:py-10 px-3 sm:px-6">

    <div class="max-w-2xl mx-auto">

        {{-- ── CARD WRAPPER ── --}}
        <div class="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200">

            {{-- ── HEADER ── --}}
            <div class="bg-indigo-600 px-5 py-5 sm:px-8 sm:py-7">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <p class="text-indigo-300 text-[10px] font-bold uppercase tracking-widest mb-0.5">Purchase Receipt</p>
                        <h1 class="text-white text-2xl sm:text-3xl font-black tracking-tight leading-none">DAILY PHONE</h1>
                        <p class="text-indigo-300 text-xs font-semibold mt-1">Premium Devices & Accessories</p>
                    </div>
                    <div class="text-right flex-shrink-0">
                        @php
                            $statusColor = $sale->status === 'completed' ? 'bg-emerald-400/20 text-emerald-200 border-emerald-400/30'
                                : ($sale->status === 'booking' ? 'bg-amber-400/20 text-amber-200 border-amber-400/30'
                                : 'bg-slate-400/20 text-slate-200 border-slate-400/30');
                        @endphp
                        <span class="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border {{ $statusColor }}">
                            {{ $sale->status === 'completed' ? 'PAID' : strtoupper($sale->status) }}
                        </span>
                        <p class="text-indigo-200 text-xs font-bold mt-1.5 mono">{{ $sale->invoice_number }}</p>
                        <p class="text-indigo-300 text-[11px] mt-0.5">{{ $sale->created_at->format('d M Y, H:i') }}</p>
                    </div>
                </div>
            </div>

            <div class="px-5 py-5 sm:px-8 sm:py-6 space-y-5">

                {{-- ── INFO GRID: Store Branch & Customer ── --}}
                <div class="grid grid-cols-2 gap-4 pb-5 border-b border-slate-100 text-sm">
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Store Branch</p>
                        <p class="font-bold text-slate-800 leading-snug">{{ $sale->store->name ?? 'Daily Phone' }}</p>
                        @if($sale->store && $sale->store->location)
                            <p class="text-slate-500 text-xs mt-0.5 leading-snug">{{ $sale->store->location }}</p>
                        @endif
                        <p class="text-slate-400 text-xs mt-1">Cashier: <span class="font-semibold text-slate-600">{{ $sale->user->name ?? '—' }}</span></p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Customer</p>
                        <p class="font-bold text-slate-800 leading-snug">{{ $sale->buyer->name ?? 'Walk-in Customer' }}</p>
                        @if($sale->buyer && $sale->buyer->phone)
                            <p class="text-indigo-600 font-bold text-xs mt-0.5 select-all mono">{{ $sale->buyer->phone }}</p>
                        @endif
                        @if($sale->buyer && $sale->buyer->address)
                            <p class="text-slate-400 text-xs mt-0.5 leading-snug">{{ $sale->buyer->address }}</p>
                        @endif
                    </div>
                </div>

                {{-- ── ITEMS ── --}}
                @php
                    $mainItems = $sale->items->filter(fn($i) => !$i->is_trade_in_item);
                    $tradeInItem = $sale->items->firstWhere('is_trade_in_item', true);
                    $hasExtras = $sale->extras->count() > 0;
                @endphp

                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Item Customeran</p>
                    <div class="space-y-3">
                        @foreach($mainItems as $item)
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <p class="font-bold text-slate-800 text-sm leading-snug">{{ $item->stock->name ?? 'Device Unit' }}</p>
                                    <div class="flex flex-wrap gap-x-2.5 gap-y-1 mt-1 text-[11px] text-slate-500">
                                        @if($item->stock && $item->stock->serial_number)
                                            <span class="mono">SN: <strong class="text-slate-600 select-all">{{ $item->stock->serial_number }}</strong></span>
                                        @endif
                                        @if($item->stock && $item->stock->imei_1)
                                            <span class="mono">IMEI: <strong class="text-slate-600 select-all">{{ $item->stock->imei_1 }}</strong></span>
                                        @endif
                                        @if($item->stock && $item->stock->warranty_duration_days)
                                            <span class="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-bold uppercase text-[9px] border border-indigo-100">
                                                Warranty {{ $item->stock->warranty_duration_days }} Days
                                            </span>
                                        @endif
                                    </div>
                                </div>
                                <div class="text-right flex-shrink-0">
                                    @if($item->qty > 1)
                                        <p class="text-xs text-slate-400 font-semibold">{{ $item->qty }}×</p>
                                    @endif
                                    <p class="font-bold text-slate-900 text-sm">Rp {{ number_format($item->actual_sell_price * $item->qty, 0, ',', '.') }}</p>
                                </div>
                            </div>
                        @endforeach
                    </div>
                </div>

                {{-- ── EXTRAS ── --}}
                @if($hasExtras)
                    <div class="border-t border-slate-100 pt-4">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Add-ons & Services</p>
                        <div class="space-y-2">
                            @foreach($sale->extras as $extra)
                                <div class="flex items-center justify-between gap-3 text-sm">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <span class="font-semibold text-slate-700 truncate">{{ $extra->extra->name ?? 'Service' }}</span>
                                        @if($extra->charge_to === 'buyer')
                                            <span class="flex-shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black text-indigo-700 border border-indigo-100 uppercase">Buyer</span>
                                        @elseif($extra->charge_to === 'seller')
                                            <span class="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-600 border border-slate-200 uppercase">Store</span>
                                        @else
                                            <span class="flex-shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 border border-emerald-100 uppercase">Free</span>
                                        @endif
                                    </div>
                                    <p class="font-bold text-slate-800 flex-shrink-0">
                                        @if($extra->charge_to === 'buyer')
                                            Rp {{ number_format($extra->sell_price, 0, ',', '.') }}
                                        @else
                                            <span class="text-slate-400 font-semibold text-xs">—</span>
                                        @endif
                                    </p>
                                </div>
                            @endforeach
                        </div>
                    </div>
                @endif

                {{-- ── TRADE-IN ── --}}
                @if($tradeInItem)
                    <div class="border-t border-slate-100 pt-4">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Trade-In</p>
                        <div class="flex items-center justify-between gap-3 bg-rose-50 rounded-xl p-3 border border-rose-100">
                            <div class="min-w-0">
                                <p class="font-bold text-slate-800 text-sm truncate">{{ $tradeInItem->stock->name ?? 'Trade-In Device' }}</p>
                                @if($tradeInItem->stock && $tradeInItem->stock->serial_number)
                                    <p class="text-xs text-slate-500 mt-0.5 mono">SN: {{ $tradeInItem->stock->serial_number }}</p>
                                @endif
                            </div>
                            <p class="font-extrabold text-rose-600 flex-shrink-0 text-sm">
                                − Rp {{ number_format(abs($tradeInItem->actual_sell_price), 0, ',', '.') }}
                            </p>
                        </div>
                    </div>
                @endif

                {{-- ── TOTALS ── --}}
                @php
                    $subtotalUnits = $mainItems->sum(fn($i) => $i->actual_sell_price * $i->qty);
                    $subtotalExtras = $sale->extras->filter(fn($e) => $e->charge_to === 'buyer')->sum('sell_price');
                    $tradeInDeduct = $tradeInItem ? abs($tradeInItem->actual_sell_price) : 0;
                @endphp
                <div class="border-t border-slate-200 pt-4 space-y-2 text-sm">
                    @if($subtotalExtras > 0 || $tradeInDeduct > 0)
                        <div class="flex justify-between text-slate-500">
                            <span>Unit Subtotal</span>
                            <span class="font-semibold text-slate-700">Rp {{ number_format($subtotalUnits, 0, ',', '.') }}</span>
                        </div>
                        @if($subtotalExtras > 0)
                            <div class="flex justify-between text-slate-500">
                                <span>Service & Add-on</span>
                                <span class="font-semibold text-slate-700">Rp {{ number_format($subtotalExtras, 0, ',', '.') }}</span>
                            </div>
                        @endif
                        @if($tradeInDeduct > 0)
                            <div class="flex justify-between text-rose-500">
                                <span>Trade-In Deduction</span>
                                <span class="font-bold">− Rp {{ number_format($tradeInDeduct, 0, ',', '.') }}</span>
                            </div>
                        @endif
                    @endif

                    <div class="flex items-center justify-between pt-3 border-t border-slate-200">
                        <span class="font-black text-slate-800 text-base">Total Payment</span>
                        <span class="font-black text-indigo-600 text-xl sm:text-2xl">Rp {{ number_format($sale->total_amount, 0, ',', '.') }}</span>
                    </div>
                </div>

                {{-- ── PAYMENT INFO ── --}}
                <div class="bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-start justify-between gap-4 text-sm">
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Payment Method</p>
                        <p class="font-extrabold text-indigo-600 uppercase tracking-wide text-sm">{{ $sale->payment_method }}</p>
                        @if($sale->payment_detail)
                            <p class="text-slate-500 text-xs mt-0.5 font-semibold">{{ $sale->payment_detail }}</p>
                        @endif
                    </div>
                    <div class="text-right flex-shrink-0">
                        @if($sale->status === 'booking')
                            <p class="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">Down Payment (DP)</p>
                            <p class="font-extrabold text-amber-600 text-sm">Rp {{ number_format($sale->dp_amount, 0, ',', '.') }}</p>
                            <p class="text-slate-400 text-[10px] mt-0.5">Remaining: Rp {{ number_format(max(0, $sale->total_amount - $sale->dp_amount), 0, ',', '.') }}</p>
                        @else
                            <span class="inline-block rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 px-2.5 py-1 text-[10px] font-black uppercase">✓ Paid</span>
                        @endif
                    </div>
                </div>

                {{-- ── FOOTER ── --}}
                <div class="text-center text-xs text-slate-400 pt-3 border-t border-slate-100 leading-relaxed font-semibold">
                    <p>Thank you for shopping at <strong class="text-slate-600">Daily Phone</strong>.</p>
                    <p class="mt-0.5">Keep this receipt as proof of official product warranty.</p>
                    <p class="mt-3 text-slate-300 font-bold text-[10px]">© {{ date('Y') }} Daily Phone. All rights reserved.</p>
                </div>

            </div>
        </div>

        {{-- ── PRINT BUTTON ── --}}
        <div class="mt-4 text-center no-print">
            <button
                onclick="window.print()"
                class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition shadow"
            >
                🖨 Print Invoice
            </button>
        </div>

    </div>
</body>
</html>
