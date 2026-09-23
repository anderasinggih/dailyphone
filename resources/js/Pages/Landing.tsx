import { Head } from '@inertiajs/react';
import { useEffect } from 'react';
import { AtSign, MapPin, MessageCircle } from 'lucide-react';

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

        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as unknown as { standalone?: boolean }).standalone === true;

        if (isStandalone) {
            window.location.href = route('login');
        }
    }, []);

    const handle = settings.instagram_handle?.trim() || 'dailyphone.store';
    const igUrl = settings.instagram_url?.trim() || `https://www.instagram.com/${handle}/`;
    const waNumber = settings.whatsapp_number?.trim() || '0881010229772';
    const waDigits = waNumber.replace(/\D/g, '');
    const waLink = `https://wa.me/${waDigits.startsWith('0') ? '62' + waDigits.slice(1) : waDigits}`;
    const address = settings.store_address?.trim() || 'Pekojan, Jakarta Barat';
    const tagline = settings.landing_tagline?.trim() || 'iPhone Berkualitas. Harga Bersahabat.';
    const description = settings.landing_description?.trim() ||
        'iPhone baru & terawat, bergaransi resmi, bisa tukar tambah.';
    const companyName = settings.company_name?.trim() || 'Daily Phone';
    const embeds = (settings.instagram_embeds || []).filter(Boolean).map(instagramEmbedUrl);

    return (
        <div className="min-h-screen bg-[#f5f5f7] font-sans selection:bg-[#007AFF] selection:text-white text-neutral-900">
            <Head title={`${companyName} — ${tagline}`} />

            {/* ═══════════════ Hero with poster background ═══════════════ */}
            <section className="relative overflow-hidden bg-[#f5f5f7]">
                <div className="absolute inset-0">
                    <img
                        src="/media/as1.png"
                        alt=""
                        aria-hidden
                        className="absolute inset-0 h-full w-full object-cover object-top opacity-35 lg:opacity-45"
                        loading="lazy"
                    />
                    <div className="absolute inset-0 bg-[#f5f5f7]/45 lg:bg-[#f5f5f7]/40" />
                    <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#f5f5f7] to-transparent" />
                </div>

                <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-20 text-center">
                    <img
                        src="/media/logo.png"
                        alt={companyName}
                        className="mx-auto h-24 w-24 sm:h-28 sm:w-28 rounded-[1.35rem] object-contain bg-white p-2 shadow-sm"
                    />

                    <h1 className="mt-7 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.03] bg-gradient-to-b from-neutral-900 to-neutral-500 bg-clip-text text-transparent">
                        {tagline.split('\n').map((line, i) => (
                            <span key={i}>
                                {line}
                                {i < tagline.split('\n').length - 1 && <br />}
                            </span>
                        ))}
                    </h1>

                    <p className="mt-5 text-lg sm:text-xl text-neutral-500 leading-relaxed">
                        {description}
                    </p>

                    {/* Contact info: place · WhatsApp · Instagram */}
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <div className="inline-flex items-center gap-2.5 h-12 px-5 rounded-full bg-white border border-black/5 shadow-sm">
                            <MapPin className="h-4 w-4 text-[#007AFF] shrink-0" />
                            <span className="text-[14px] font-medium text-neutral-700">{address}</span>
                        </div>

                        <a
                            href={waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2.5 h-12 px-5 rounded-full bg-white border border-black/5 shadow-sm hover:bg-[#fafafa] active:scale-95 transition"
                        >
                            <MessageCircle className="h-4 w-4 text-[#007AFF] shrink-0" />
                            <span className="text-[14px] font-medium text-neutral-700">{waNumber}</span>
                        </a>

                        <a
                            href={igUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2.5 h-12 px-5 rounded-full bg-white border border-black/5 shadow-sm hover:bg-[#fafafa] active:scale-95 transition"
                        >
                            <AtSign className="h-4 w-4 text-[#007AFF] shrink-0" />
                            <span className="text-[14px] font-medium text-neutral-700">@{handle}</span>
                        </a>
                    </div>
                </div>
            </section>

            {/* ═══════════════ Postingan Instagram ═══════════════ */}
            <section className="relative overflow-hidden bg-white">
                <div className="absolute inset-0">
                    <img
                        src="/media/as2.png"
                        alt=""
                        aria-hidden
                        className="absolute inset-0 h-full w-full object-cover object-top opacity-25 lg:opacity-30"
                        loading="lazy"
                    />
                    <div className="absolute inset-0 bg-white/75" />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent" />
                </div>

                <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
                    <div className="text-center max-w-2xl mx-auto">
                        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900">
                            Postingan Terbaru
                        </h2>
                        <p className="mt-3 text-base sm:text-lg text-neutral-500">
                            Update stok, testimoni pelanggan, dan deal terbaru dari Instagram kami.
                        </p>
                    </div>

                    {embeds.length > 0 ? (
                        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {embeds.map((embed, i) => (
                                <div key={`${embed}-${i}`} className="rounded-[1.75rem] border border-black/5 bg-white overflow-hidden shadow-sm">
                                    <iframe
                                        src={embed}
                                        className="w-full h-[620px]"
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
                <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-center flex-wrap gap-x-2 gap-y-1.5 text-[12px] text-center">
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
        return `https://www.instagram.com/p/${match[1]}/embed`;
    }

    return trimmed;
}