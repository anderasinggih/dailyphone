import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import axios from 'axios';

declare global {
    interface Window {
        Pusher: typeof Pusher;
        Echo: Echo<any>;
    }
}

// Reverb speaks the Pusher protocol, so the browser client is pusher-js wired
// through laravel-echo. `broadcaster: 'reverb'` points the transport at our
// self-hosted Reverb server instead of the public Pusher cloud.
if (typeof window !== 'undefined') {
    window.Pusher = Pusher;
    if (!window.axios) window.axios = axios;
}

let instance: Echo<any> | null = null;

export function echo(): Echo<any> | null {
    if (typeof window === 'undefined') return null;
    if (instance) return instance;

    const scheme = import.meta.env.VITE_REVERB_SCHEME || 'http';
    const key = (import.meta.env.VITE_REVERB_APP_KEY as string) || '';
    if (!key) return null;

    instance = new Echo({
        broadcaster: 'reverb',
        key,
        wsHost: import.meta.env.VITE_REVERB_HOST || window.location.hostname,
        wsPort: import.meta.env.VITE_REVERB_PORT ? Number(import.meta.env.VITE_REVERB_PORT) : 8080,
        wssPort: 443,
        forceTLS: scheme === 'https',
        encrypted: scheme === 'https',
        enabledTransports: ['ws', 'wss'],
        authEndpoint: '/broadcasting/auth',
        auth: {
            headers: {
                'X-CSRF-TOKEN':
                    (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content || '',
            },
        },
    });

    window.Echo = instance;
    return instance;
}