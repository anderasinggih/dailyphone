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
    }, []);

    const handle = settings.instagram_handle?.trim() || 'dailyphone.store';
    const igUrl = settings.instagram_url?.trim() || `https://www.instagram.com/${handle}/`;
    const waNumber = settings.whatsapp_number?.trim() || '0881010229772';
    const waDigits = waNumber.replace(/\D/g, '');
    const waLink = `https://wa.me/${waDigits.startsWith('0') ? '62' + waDigits.slice(1) : waDigits}`;
    const address = settings.store_address?.trim() || 'Pekoja, Jakarta Barat';
    const tagline = settings.landing_tagline?.trim() || 'iPhone Berkualitas. Harga Jujur.';
    const description = settings.landing_description?.trim() ||
        'iPhone baru dan terawat dengan harga bersahabat — setiap unit terjamin kualitas, bergaransi resmi, dan siap tukar tambah.';
    const companyName = settings.company_name?.trim() || 'Daily Phone';
    const embeds = (settings.instagram_embeds || []).filter(Boolean).map(instagramEmbedUrl);

    return (
        <div className="min-h-screen bg-[#f5f5f7] font-sans selection:bg-[#007AFF] selection:text-white text-neutral-900">
            <Head title={`${companyName} — ${tagline}`} />

            {/* ────── Single Section: Info to the point ────── */}
            <section className="bg-[#f5f5f7]">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-8 sm:pb-10 text-center">
                    <img
                        src="/media/logo.png"
                        alt={companyName}
                        className="mx-auto h-24 w-24 sm:h-28 sm:w-28 rounded-3xl object-contain shadow-sm"
                    />

                    <h1 className="mt-6 text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] text-neutral-900">
                        {tagline.split('\n').map((line, i) => (
                            <span key={i}>
                                {line}
                                {i < tagline.split('\n').length - 1 && <br />}
                            </span>
                        ))}
                    </h1>

                    <p className="mt-4 text-base sm:text-lg text-neutral-500 leading-relaxed max-w-xl mx-auto">
                        {description}
                    </p>

                    {/* Contact: place, WhatsApp, Instagram */}
                    <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                        <div className="rounded-3xl bg-white border border-black/5 p-6 flex flex-col items-start shadow-sm">
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <MapPin className="h-5 w-5 text-white" />
                            </div>
                            <h2 className="mt-4 text-[15px] font-semibold text-neutral-900">Lokasi</h2>
                            <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{address}</p>
                        </div>

                        <a
                            href={waLink}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-3xl bg-white border border-black/5 p-6 flex flex-col items-start shadow-sm hover:bg-[#fafafa] transition active:scale-[0.99]"
                        >
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <MessageCircle className="h-5 w-5 text-white" />
                            </div>
                            <h2 className="mt-4 text-[15px] font-semibold text-neutral-900">WhatsApp</h2>
                            <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{waNumber}</p>
                        </a>

                        <a
                            href={igUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-3xl bg-white border border-black/5 p-6 flex flex-col items-start shadow-sm hover:bg-[#fafafa] transition active:scale-[0.99]"
                        >
                            <div className="h-11 w-11 rounded-2xl bg-[#007AFF] flex items-center justify-center shadow-md shadow-[#007AFF]/25">
                                <AtSign className="h-5 w-5 text-white" />
                            </div>
                            <h2 className="mt-4 text-[15px] font-semibold text-neutral-900">Instagram</h2>
                            <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">@{handle}</p>
                        </a>
                    </div>

                    {/* Embedded Instagram posts */}
                    {embeds.length > 0 ? (
                        <div className="mt-12">
                            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">Postingan Terbaru</h2>
                            <p className="mt-2 text-base text-neutral-500">Update stok, testimoni, dan promo — langsung dari Instagram kami.</p>
                            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
                                {embeds.map((embed, i) => (
                                    <div key={`${embed}-${i}`} className="rounded-3xl border border-black/5 bg-white overflow-hidden shadow-sm">
                                        <iframe
                                            src={embed}
                                            className="w-full h-[500px]"
                                            scrolling="no"
                                            frameBorder={0}
                                            allowTransparency
                                            loading="lazy"
                                            title={`Postingan Instagram ${i + 1}`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="mt-12 rounded-3xl border border-dashed border-neutral-300 bg-[#fafafa] p-10 text-center">
                            <div className="mx-auto h-12 w-12 rounded-2xl bg-neutral-100 flex items-center justify-center">
                                <AtSign className="h-5 w-5 text-neutral-400" />
                            </div>
                            <p className="mt-4 text-[15px] font-semibold text-neutral-700">Belum ada postingan Instagram</p>
                            <p className="mt-1 text-[13px] text-neutral-500 max-w-md mx-auto">
                                Tambahkan link embed Instagram di Pengaturan → Landing untuk menampilkan postingan di sini.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* ────── Minimal footer ────── */}
            <footer className="bg-[#1d1d1f] text-neutral-400">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-center gap-2 text-[12px] text-center">
                    <p>© {new Date().getFullYear()} {companyName}. All rights reserved.</p>
                    <span className="hidden sm:inline text-neutral-600">·</span>
                    <p>iPhone murah, bergaransi &amp; tukar tambah.</p>
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