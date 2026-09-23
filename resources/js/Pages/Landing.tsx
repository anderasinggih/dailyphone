import { Head } from '@inertiajs/react';
import { useEffect } from 'react';
import { ArrowUpRight, AtSign, MapPin, MessageCircle } from 'lucide-react';

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
    const address = settings.store_address?.trim() || 'Pekojan, Jakarta Barat';
    const tagline = settings.landing_tagline?.trim() || 'iPhone Berkualitas. Harga Bersahabat.';
    const description = settings.landing_description?.trim() ||
        'iPhone baru dan terawat dengan harga bersahabat — setiap unit dicek satu-satu, bergaransi resmi, dan siap tukar tambah.';
    const companyName = settings.company_name?.trim() || 'Daily Phone';
    const embeds = (settings.instagram_embeds || []).filter(Boolean).map(instagramEmbedUrl);

    return (
        <div className="min-h-screen bg-[#f5f5f7] font-sans selection:bg-[#007AFF] selection:text-white text-neutral-900">
            <Head title={`${companyName} — ${tagline}`} />

            {/* ═══════════════ Hero ═══════════════ */}
            <section className="bg-[#f5f5f7] overflow-hidden">
                <div className="relative">
                    <div className="absolute inset-x-0 -top-40 mx-auto h-[420px] w-[720px] max-w-full rounded-full bg-[#007AFF]/10 blur-3xl" />
                    <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-16 text-center">
                        <img
                            src="/media/logo.png"
                            alt={companyName}
                            className="mx-auto h-24 w-24 sm:h-28 sm:w-28 rounded-[1.5rem] object-contain shadow-sm border border-black/5 bg-white p-2"
                        />

                        <h1 className="mt-7 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.03] bg-gradient-to-b from-neutral-900 to-neutral-500 bg-clip-text text-transparent">
                            {tagline.split('\n').map((line, i) => (
                                <span key={i}>
                                    {line}
                                    {i < tagline.split('\n').length - 1 && <br />}
                                </span>
                            ))}
                        </h1>

                        <p className="mt-5 text-lg sm:text-xl text-neutral-500 leading-relaxed max-w-2xl mx-auto">
                            {description}
                        </p>

                        <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-black/5 shadow-sm text-[13px] font-medium text-neutral-600">
                            <MapPin className="h-3.5 w-3.5 text-[#007AFF]" />
                            {address} — mampir langsung, tim kami siap bantu pilih unit terbaikmu.
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Katalog & Promo ═══════════════ */}
            <section className="bg-white">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
                    <div className="text-center max-w-2xl mx-auto">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Lihat Katalog &amp; Promo Kami
                        </h2>
                        <p className="mt-3 text-base sm:text-lg text-neutral-500">
                            Sedang mencari iPhone impian? Intip dulu pilihan dan promo terbaru dari toko kami.
                        </p>
                    </div>

                    <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5 sm:items-start">
                        <figure className="rounded-[1.75rem] bg-white p-3 border border-black/5 shadow-sm overflow-hidden">
                            <img
                                src="/media/as1.png"
                                alt="Katalog & promo Daily Phone"
                                className="w-full h-auto rounded-[1.35rem]"
                                loading="lazy"
                            />
                        </figure>
                        <figure className="rounded-[1.75rem] bg-white p-3 border border-black/5 shadow-sm overflow-hidden">
                            <img
                                src="/media/as2.png"
                                alt="Katalog & promo Daily Phone"
                                className="w-full h-auto rounded-[1.35rem]"
                                loading="lazy"
                            />
                        </figure>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Hubungi Kami ═══════════════ */}
            <section className="bg-[#f5f5f7]">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
                    <div className="text-center max-w-2xl mx-auto">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Hubungi Kami
                        </h2>
                        <p className="mt-3 text-base sm:text-lg text-neutral-500">
                            Tanya stok, minta harga, atau konsultasi tukar tambah — tim kami fast response.
                        </p>
                    </div>

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="rounded-[1.75rem] bg-white border border-black/5 p-7 shadow-sm">
                            <div className="h-12 w-12 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <MapPin className="h-5 w-5 text-white" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold text-neutral-900">Lokasi Toko</h3>
                            <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-500">{address}</p>
                            <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
                                Buka setiap hari, 09.00–18.00. Datang aja, lihat unit secara langsung.
                            </p>
                        </div>

                        <a
                            href={waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-[1.75rem] bg-white border border-black/5 p-7 shadow-sm hover:bg-[#fafafa] transition active:scale-[0.99]"
                        >
                            <div className="h-12 w-12 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <MessageCircle className="h-5 w-5 text-white" />
                            </div>
                            <div className="mt-5 flex items-center justify-between gap-2">
                                <h3 className="text-lg font-semibold text-neutral-900">WhatsApp</h3>
                                <ArrowUpRight className="h-4 w-4 text-[#007AFF] opacity-0 -translate-y-0.5 translate-x-0.5 transition group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                            </div>
                            <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-500">{waNumber}</p>
                            <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
                                Chat untuk tanya stock terbaru, nego harga, atau taksir tukar tambah.
                            </p>
                        </a>

                        <a
                            href={igUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-[1.75rem] bg-white border border-black/5 p-7 shadow-sm hover:bg-[#fafafa] transition active:scale-[0.99]"
                        >
                            <div className="h-12 w-12 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <AtSign className="h-5 w-5 text-white" />
                            </div>
                            <div className="mt-5 flex items-center justify-between gap-2">
                                <h3 className="text-lg font-semibold text-neutral-900">Instagram</h3>
                                <ArrowUpRight className="h-4 w-4 text-[#007AFF] opacity-0 -translate-y-0.5 translate-x-0.5 transition group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                            </div>
                            <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-500">@{handle}</p>
                            <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
                                Update stok &amp; promo harian, plus cerita asli dari pelanggan kami.
                            </p>
                        </a>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Postingan Instagram ═══════════════ */}
            <section className="bg-white">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
                    <div className="text-center max-w-2xl mx-auto">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Postingan Terbaru
                        </h2>
                        <p className="mt-3 text-base sm:text-lg text-neutral-500">
                            Update stok, testimoni pelanggan, dan deal terbaru — langsung dari Instagram kami.
                        </p>
                    </div>

                    {embeds.length > 0 ? (
                        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {embeds.map((embed, i) => (
                                <div key={`${embed}-${i}`} className="rounded-[1.75rem] border border-black/5 bg-white overflow-hidden shadow-sm">
                                    <iframe
                                        src={embed}
                                        className="w-full h-[520px]"
                                        scrolling="no"
                                        frameBorder={0}
                                        allowTransparency
                                        loading="lazy"
                                        title={`Postingan Instagram ${i + 1}`}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-10 rounded-[1.75rem] border border-dashed border-neutral-300 bg-[#fafafa] p-14 text-center">
                            <div className="mx-auto h-12 w-12 rounded-2xl bg-neutral-100 flex items-center justify-center">
                                <AtSign className="h-5 w-5 text-neutral-400" />
                            </div>
                            <p className="mt-4 text-[15px] font-semibold text-neutral-700">Belum ada postingan</p>
                            <p className="mt-1 text-[13px] text-neutral-500 max-w-md mx-auto">
                                Tambahkan link embed Instagram di Pengaturan → Landing untuk menampilkan postingan di sini.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* ═══════════════ Footer ═══════════════ */}
            <footer className="bg-[#1d1d1f] text-neutral-400">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-x-2 gap-y-1.5 text-[12px] text-center flex-wrap">
                        <span>© {new Date().getFullYear()} {companyName}. Semua hak dilindungi.</span>
                        <span className="hidden sm:inline text-neutral-600">·</span>
                        <span>iPhone murah, bergaransi resmi, dan bisa tukar tambah.</span>
                        <span className="hidden sm:inline text-neutral-600">·</span>
                        <a href={waLink} target="_blank" rel="noreferrer" className="hover:text-white transition hover:underline underline-offset-4">
                            {waNumber}
                        </a>
                        <span className="hidden sm:inline text-neutral-600">·</span>
                        <a href={igUrl} target="_blank" rel="noreferrer" className="hover:text-white transition hover:underline underline-offset-4">
                            @{handle}
                        </a>
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