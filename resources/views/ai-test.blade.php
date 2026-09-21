<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="csrf-token" content="{{ csrf_token() }}">
<meta name="robots" content="noindex, nofollow">
<title>AI Bare Test</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
    :root {
        --accent: #007AFF;
        --bg: #F5F5F7;
        --panel: #FFFFFF;
        --text: #1D1D1F;
        --muted: #86868B;
        --border: rgba(0, 0, 0, 0.10);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Helvetica, Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
        display: flex;
        justify-content: center;
        padding: 24px 12px;
    }
    .shell {
        width: 100%;
        max-width: 720px;
        height: calc(100dvh - 48px);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
    }
    header {
        padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(249, 249, 251, 0.8);
        backdrop-filter: blur(20px);
    }
    header .dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--accent);
    }
    header .title { font-size: 15px; font-weight: 600; }
    header .sub { font-size: 12px; color: var(--muted); margin-top: 1px; }
    #log {
        flex: 1;
        overflow-y: auto;
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .msg {
        max-width: 82%;
        padding: 10px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .msg.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
    .msg.bot { align-self: flex-start; background: #E9E9EB; color: var(--text); border-bottom-left-radius: 4px; }
    .msg .meta {
        display: block;
        font-size: 10.5px;
        color: rgba(0,0,0,0.5);
        margin-top: 6px;
        letter-spacing: 0.2px;
    }
    .msg.user .meta { color: rgba(255,255,255,0.75); }
    .typing { align-self: flex-start; color: var(--muted); font-size: 13px; padding: 4px 6px; }
    form {
        display: flex;
        gap: 8px;
        padding: 14px 16px;
        border-top: 1px solid var(--border);
        background: rgba(249, 249, 251, 0.8);
        backdrop-filter: blur(20px);
    }
    input[type=text] {
        flex: 1;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 11px 14px;
        font-size: 14px;
        background: #fff;
        color: var(--text);
        outline: none;
    }
    input[type=text]:focus { border-color: var(--accent); }
    button {
        border: 0;
        background: var(--accent);
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        border-radius: 12px;
        padding: 0 18px;
        cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<div class="shell">
    <header>
        <div class="dot"></div>
        <div>
            <div class="title">AI Bare Test</div>
            <div class="sub" id="modelTag">no retrieval · no rules · direct Gemini</div>
        </div>
    </header>
    <div id="log"></div>
    <form id="frm">
        <input type="text" id="q" placeholder="Type a message..." autocomplete="off">
        <button type="submit" id="btn">Send</button>
    </form>
</div>

<script>
const logEl = document.getElementById('log');
const form = document.getElementById('frm');
const input = document.getElementById('q');
const btn = document.getElementById('btn');

function bubble(kind, text, meta) {
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.textContent = text;
    if (meta) {
        const m = document.createElement('span');
        m.className = 'meta';
        m.textContent = meta;
        div.appendChild(m);
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
}

function typing(el) {
    el.textContent = 'Thinking…';
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    bubble('user', msg);
    const tEl = document.createElement('div');
    tEl.className = 'typing';
    typing(tEl);

    btn.disabled = true;
    try {
        const res = await fetch('/ai-test/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json',
                      'X-Requested-With': 'XMLHttpRequest',
                      'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content},
            body: JSON.stringify({message: msg}),
        });
        const data = await res.json();
        tEl.remove();
        if (data.error) {
            bubble('bot', 'Error: ' + data.error);
        } else {
            const meta = (data.model || '') + ' · TTF ' + (data.timing_ms?.ttf_ms ?? '?') + 'ms · total ' + (data.timing_ms?.total_ms ?? '?') + 'ms';
            bubble('bot', data.reply || '(empty reply)', meta);
            const tag = document.getElementById('modelTag');
            if (data.model) tag.textContent = data.model + ' · no retrieval · no rules';
        }
    } catch (err) {
        tEl.remove();
        bubble('bot', 'Request failed: ' + err.message);
    } finally {
        btn.disabled = false;
        input.focus();
    }
});
input.focus();
</script>
</body>
</html>