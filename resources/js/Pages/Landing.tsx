import { Head, Link } from '@inertiajs/react';
import { useEffect } from 'react';
import {
    ArrowRight,
    AtSign,
    BadgeCheck,
    Check,
    ChevronRight,
    Clock,
    MapPin,
    MessageCircle,
    RefreshCcw,
    Repeat,
    ShieldCheck,
    Smartphone,
    Star,
    Wallet,
} from 'lucide-react';

interface LandingSettings {
    company_name?: string;
    landing_enabled: boolean;
    landing_tagline: string;
    landing_description: string;
    instagram_handle: string;
    instagram_url: string;
    whatsapp_number: string;
    store_address: string;
    instagram_embeds: string[];
}

export default function Landing({ settings }: { settings: LandingSettings }) {
    useEffect(() => {
        document.documentElement.classList.remove('dark');
    }, []);

    const handle = settings.instagram_handle?.trim() || 'dailyphone.store';
    const igUrl = settings.instagram_url?.trim() || `https://www.instagram.com/${handle}/`;
    const waNumber = settings.whatsapp_number?.trim() || '0881010229772';
    const waDigits = waNumber.replace(/\D/g, '');
    const waLink = `https://wa.me/${waDigits.startsWith('0') ? '62' + waDigits.slice(1) : waDigits}`;
    const address = settings.store_address?.trim() || 'Pekoja, Jakarta Barat';
    const tagline = settings.landing_tagline?.trim() || 'Great iPhones. Honest Prices.';
    const description = settings.landing_description?.trim() ||
        'New and pre-owned iPhones at affordable prices — every unit quality-checked, officially warrantied, and ready with easy trade-in.';
    const embeds = (settings.instagram_embeds || []).filter(Boolean).map(instagramEmbedUrl);

    return (
        <div className="min-h-screen bg-[#f5f5f7] font-sans selection:bg-[#007AFF] selection:text-white text-neutral-900 transition-colors">
            <Head title="Daily Phone — Affordable iPhones with Warranty & Trade-In" />

            {/* ═══════════════ Navigation ═══════════════ */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
                    <a href="#top" className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-lg bg-[#007AFF] flex items-center justify-center shadow-sm">
                            <Smartphone className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="font-semibold text-[15px] tracking-tight text-neutral-900">
                            {settings.company_name?.trim() || 'Daily Phone'}
                        </span>
                    </a>

                    <nav className="hidden md:flex items-center gap-1 text-[13px] text-neutral-600">
                        <a href="#why" className="px-3 py-1.5 rounded-full hover:bg-black/5 transition">Why Us</a>
                        <a href="#trade-in" className="px-3 py-1.5 rounded-full hover:bg-black/5 transition">Trade-In</a>
                        <a href="#gallery" className="px-3 py-1.5 rounded-full hover:bg-black/5 transition">Gallery</a>
                        <a href="#visit" className="px-3 py-1.5 rounded-full hover:bg-black/5 transition">Visit Us</a>
                    </nav>

                    <div className="flex items-center gap-2">
                        <a
                            href={waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="hidden sm:inline-flex items-center h-8 px-4 rounded-full bg-[#007AFF] text-white text-[13px] font-semibold hover:opacity-90 active:scale-95 transition"
                        >
                            Contact
                        </a>
                        <Link
                            href={route('login')}
                            className="inline-flex items-center h-8 px-3.5 rounded-full border border-black/10 text-[13px] font-medium text-neutral-700 hover:bg-black/5 transition"
                        >
                            Open Portal
                        </Link>
                    </div>
                </div>
            </header>

            {/* ═══════════════ Hero ═══════════════ */}
            <section id="top" className="bg-[#f5f5f7]">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="max-w-xl">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-black/5 text-[12px] font-semibold text-[#007AFF] shadow-sm">
                            <Star className="h-3 w-3 fill-[#007AFF]" />
                            Trusted since 2015 · Pekoja, Jakarta Barat
                        </div>

                        <h1 className="mt-6 text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05] text-neutral-900">
                            {tagline.split('\n').map((line, i) => (
                                <span key={i}>
                                    {line}
                                    {i < tagline.split('\n').length - 1 && <br />}
                                </span>
                            ))}
                        </h1>

                        <p className="mt-5 text-base sm:text-lg text-neutral-500 leading-relaxed max-w-md">
                            {description}
                        </p>

                        <div className="mt-8 flex flex-wrap items-center gap-3">
                            <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center h-12 px-6 rounded-2xl bg-[#007AFF] text-white text-[15px] font-semibold hover:opacity-90 active:scale-[0.98] transition shadow-lg shadow-[#007AFF]/20"
                            >
                                <MessageCircle className="mr-2 h-[18px] w-[18px]" />
                                Chat on WhatsApp
                            </a>
                            <a
                                href={igUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center h-12 px-6 rounded-2xl bg-white text-neutral-900 border border-black/10 text-[15px] font-semibold hover:bg-black/5 active:scale-[0.98] transition"
                            >
                                <AtSign className="mr-2 h-[18px] w-[18px]" />
                                @{handle}
                            </a>
                        </div>

                        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-600">
                            <span className="inline-flex items-center gap-1.5">
                                <Check className="h-4 w-4 text-[#007AFF]" /> Official warranty
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Check className="h-4 w-4 text-[#007AFF]" /> Trade-in welcome
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Check className="h-4 w-4 text-[#007AFF]" /> Quality checked
                            </span>
                        </div>
                    </div>

                    {/* Device mockup */}
                    <div className="hidden lg:flex justify-center">
                        <div className="relative w-[300px]">
                            <div className="absolute -inset-8 bg-gradient-to-br from-[#007AFF]/10 via-transparent to-transparent blur-2xl rounded-full" />
                            <div className="relative rounded-[2.75rem] bg-gradient-to-b from-neutral-200 to-neutral-400 p-[3px] shadow-2xl">
                                <div className="rounded-[2.6rem] bg-white p-3 overflow-hidden">
                                    <div className="rounded-[2rem] bg-[#f5f5f7] overflow-hidden">
                                        <div className="px-5 pt-3.5 pb-4 flex justify-between items-center">
                                            <span className="w-8 h-3 rounded-full bg-black/80" />
                                            <span className="w-16 h-3 rounded-full bg-black/10" />
                                            <span className="w-8 h-3 rounded-full bg-black/80" />
                                        </div>

                                        <div className="px-4 pb-5 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[15px] font-bold text-neutral-900">Daily Phone</p>
                                                <span className="px-2 py-0.5 rounded-full bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold">
                                                    In Stock
                                                </span>
                                            </div>

                                            <div className="rounded-2xl bg-white p-3 shadow-sm border border-black/5">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#0057c8] flex items-center justify-center">
                                                        <Smartphone className="h-5 w-5 text-white" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[13px] font-semibold text-neutral-900 truncate">iPhone 15 Pro Max</p>
                                                        <p className="text-[11px] text-neutral-500">256GB · Natural Titanium · 100% Battery</p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex items-center justify-between">
                                                    <div>
                                                        <p className="text-[10px] text-neutral-400 line-through">Rp 18.000.000</p>
                                                        <p className="text-[15px] font-bold text-neutral-900">Rp 15.200.000</p>
                                                    </div>
                                                    <span className="inline-flex items-center h-7 px-3 rounded-full bg-[#007AFF] text-white text-[11px] font-semibold">
                                                        Order
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="rounded-2xl bg-white p-3 shadow-sm border border-black/5">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[12px] font-semibold text-neutral-900">Warranty</p>
                                                    <ShieldCheck className="h-4 w-4 text-[#007AFF]" />
                                                </div>
                                                <p className="text-[11px] text-neutral-500 mt-0.5">Official 1 year + 90 days extra</p>
                                            </div>

                                            <div className="rounded-2xl bg-white p-3 shadow-sm border border-black/5">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[12px] font-semibold text-neutral-900">Tukar Tambah</p>
                                                    <RefreshCcw className="h-4 w-4 text-[#007AFF]" />
                                                </div>
                                                <p className="text-[11px] text-neutral-500 mt-0.5">Your old phone accepted</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Why Daily Phone ═══════════════ */}
            <section id="why" className="bg-white scroll-mt-16">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
                    <div className="max-w-lg">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Why Daily Phone
                        </h2>
                        <p className="mt-3 text-base text-neutral-500 leading-relaxed">
                            More than a handphone store — a place you can trust with your next upgrade,
                            today's budget, and the phone you trade in.
                        </p>
                    </div>

                    <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="rounded-3xl border border-black/5 bg-[#f5f5f7] p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <Wallet className="h-5 w-5 text-white" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Murah, No Game</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                                iPhone murah tanpa drama — the fairest price with honest deals.
                                Nego friendly, transparent, and always worth the money.
                            </p>
                        </div>

                        <div className="rounded-3xl border border-black/5 bg-[#f5f5f7] p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <ShieldCheck className="h-5 w-5 text-white" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Bergaransi</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                                Every unit comes with an official warranty. Backed by honest
                                after-sales service and real protection for your peace of mind.
                            </p>
                        </div>

                        <div className="rounded-3xl border border-black/5 bg-[#f5f5f7] p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <RefreshCcw className="h-5 w-5 text-white" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Bisa Tukar Tambah</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                                Trade in your old phone and top up the difference. Upgrade to a
                                newer iPhone — your old unit counts as real value.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Trade-In CTABanner ═══════════════ */}
            <section id="trade-in" className="bg-[#f5f5f7] scroll-mt-16">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
                    <div className="rounded-[2rem] overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#0057c8] text-white shadow-2xl shadow-[#007AFF]/30">
                        <div className="grid grid-cols-1 lg:grid-cols-2">
                            <div className="p-8 sm:p-12">
                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 text-[12px] font-semibold">
                                    <RefreshCcw className="h-3.5 w-3.5" />
                                    Tukar Tambah
                                </div>
                                <h2 className="mt-5 text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
                                    Upgrade your iPhone <br className="hidden sm:block" /> with trade-in.
                                </h2>
                                <p className="mt-4 text-[15px] leading-relaxed text-white/80 max-w-md">
                                    Bring in your old phone, we appraise it on the spot, and you only
                                    pay the difference. Simple, fast, and no hassle — swap today.
                                </p>
                                <a
                                    href={waLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-6 inline-flex items-center h-11 px-6 rounded-full bg-white text-[#007AFF] text-[14px] font-semibold hover:bg-white/90 active:scale-[0.98] transition"
                                >
                                    Get a Trade-In Quote
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </a>
                            </div>

                            <div className="p-8 sm:p-12 flex flex-col justify-center gap-4 bg-white/5 border-l border-white/10">
                                {[
                                    { title: '1 · Bring it in', desc: 'Walk in with any phone, any condition — at Pekoja, Jakarta Barat.' },
                                    { title: '2 · Instant appraisal', desc: 'Fair market value, checked on the spot with transparent math.' },
                                    { title: '3 · Pay the difference', desc: 'Choose your new iPhone and only top up the remaining price.' },
                                ].map(item => (
                                    <div key={item.title} className="rounded-2xl bg-white/10 backdrop-blur p-4">
                                        <div className="flex items-center gap-2 text-[14px] font-semibold">
                                            <BadgeCheck className="h-4 w-4" />
                                            {item.title}
                                        </div>
                                        <p className="mt-1 text-[13px] text-white/70 leading-relaxed">{item.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Instagram Gallery ═══════════════ */}
            <section id="gallery" className="bg-white scroll-mt-16">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                        <div className="max-w-lg">
                            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                                @{handle}
                            </h2>
                            <p className="mt-3 text-base text-neutral-500 leading-relaxed">
                                Daily stock drops, real customer stories, and current deals — straight from our Instagram.
                            </p>
                        </div>
                        <a
                            href={igUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-[#007AFF] text-white text-[13px] font-semibold hover:opacity-90 active:scale-95 transition shrink-0"
                        >
                            <AtSign className="mr-2 h-4 w-4" />
                            Follow @{handle}
                        </a>
                    </div>

                    {embeds.length > 0 ? (
                        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {embeds.map((embed, i) => (
                                <div key={`${embed}-${i}`} className="rounded-3xl border border-black/5 bg-white overflow-hidden shadow-sm">
                                    <iframe
                                        src={embed}
                                        className="w-full h-[500px]"
                                        scrolling="no"
                                        frameBorder={0}
                                        allowTransparency
                                        loading="lazy"
                                        title={`Instagram post ${i + 1}`}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-10 rounded-3xl border border-dashed border-neutral-300 bg-[#fafafa] p-14 text-center">
                            <div className="mx-auto h-12 w-12 rounded-2xl bg-neutral-100 flex items-center justify-center">
                                <AtSign className="h-5 w-5 text-neutral-400" />
                            </div>
                            <p className="mt-4 text-[15px] font-semibold text-neutral-700">No Instagram posts yet</p>
                            <p className="mt-1 text-[13px] text-neutral-500">
                                Add Instagram embed links in Settings → Landing Page &amp; Instagram to show posts here.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* ═══════════════ Visit & Contact ═══════════════ */}
            <section id="visit" className="bg-[#f5f5f7] scroll-mt-16">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
                    <div className="max-w-lg">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Find us &amp; talk to us
                        </h2>
                        <p className="mt-3 text-base text-neutral-500 leading-relaxed">
                            Come visit the store or reach out on WhatsApp / Instagram — we reply fast.
                        </p>
                    </div>

                    <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-5">
                        <div className="rounded-3xl border border-black/5 bg-white p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF]/10 flex items-center justify-center">
                                <MapPin className="h-5 w-5 text-[#007AFF]" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Store Location</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">{address}</p>
                            <a
                                href="https://maps.google.com/?q=Pekoja+Jakarta+Barat"
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 inline-flex items-center text-[13px] font-semibold text-[#007AFF] hover:underline"
                            >
                                Open in Maps
                                <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                            </a>
                        </div>

                        <div className="rounded-3xl border border-black/5 bg-white p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF]/10 flex items-center justify-center">
                                <MessageCircle className="h-5 w-5 text-[#007AFF]" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">WhatsApp</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                                Quick quotes, trade-in appraisal, or reserving a unit.
                            </p>
                            <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 inline-flex items-center h-9 px-4 rounded-full bg-[#007AFF] text-white text-[13px] font-semibold hover:opacity-90 active:scale-95 transition"
                            >
                                {waNumber}
                            </a>
                        </div>

                        <div className="rounded-3xl border border-black/5 bg-white p-7">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF]/10 flex items-center justify-center">
                                <Clock className="h-5 w-5 text-[#007AFF]" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Opening Hours</h3>
                            <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                                Open daily, 09:00 – 18:00. Walk-ins welcome every day, including weekends.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Footer ═══════════════ */}
            <footer className="bg-[#1d1d1f] text-neutral-400">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                        <div className="md:col-span-2">
                            <div className="flex items-center gap-2.5">
                                <div className="h-7 w-7 rounded-lg bg-[#007AFF] flex items-center justify-center">
                                    <Smartphone className="h-3.5 w-3.5 text-white" />
                                </div>
                                <span className="font-semibold text-[15px] text-white tracking-tight">
                                    {settings.company_name?.trim() || 'Daily Phone'}
                                </span>
                            </div>
                            <p className="mt-3 text-[13px] leading-relaxed max-w-sm">
                                Affordable iPhones, official warranty, and easy trade-in — from {address}.
                            </p>
                        </div>

                        <div>
                            <p className="text-[12px] font-semibold text-white uppercase tracking-wide">Store</p>
                            <ul className="mt-3 space-y-2 text-[13px]">
                                <li><a href="#why" className="hover:text-white transition">Why Us</a></li>
                                <li><a href="#trade-in" className="hover:text-white transition">Trade-In</a></li>
                                <li><a href="#gallery" className="hover:text-white transition">Gallery</a></li>
                                <li><a href="#visit" className="hover:text-white transition">Visit Us</a></li>
                            </ul>
                        </div>

                        <div>
                            <p className="text-[12px] font-semibold text-white uppercase tracking-wide">Contact</p>
                            <ul className="mt-3 space-y-2 text-[13px]">
                                <li>
                                    <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white transition">
                                        <MessageCircle className="h-3.5 w-3.5" /> {waNumber}
                                    </a>
                                </li>
                                <li>
                                    <a href={igUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white transition">
                                        <AtSign className="h-3.5 w-3.5" /> @{handle}
                                    </a>
                                </li>
                                <li className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5" /> {address}
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px]">
                        <p>© {new Date().getFullYear()} {settings.company_name?.trim() || 'Daily Phone'}. All rights reserved.</p>
                        <p className="inline-flex items-center gap-1.5">
                            <Repeat className="h-3.5 w-3.5" /> iPhone murah, bergaransi & tukar tambah.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}

function instagramEmbedUrl(link: string): string {
    const trimmed = (link || '').trim();
    if (!trimmed) return '';

    if (trimmed.includes('/embed')) return trimmed;

    const match = trimmed.match(/instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/i);
    if (match) {
        return `https://www.instagram.com/p/${match[1]}/embed/captioned`;
    }

    return trimmed;
}