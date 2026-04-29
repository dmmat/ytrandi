// Parse arbitrary user input into a normalized form so the resolver knows what
// kind of YouTube reference we're dealing with.
//
// Output: { kind, value }, where kind is one of:
//   'ucid'   — direct channel ID (UC...)
//   'handle' — '@something'
//   'custom' — youtube.com/c/Name (legacy custom URL)
//   'user'   — youtube.com/user/Name (legacy username)
//   'video'  — a video ID, will be turned into channel via lookup
//   'search' — free-form text, used as channel search query

const UCID_RE = /^UC[\w-]{22}$/;
const HANDLE_RE = /^@[A-Za-z0-9._\-]{3,30}$/;
const VIDEO_ID_RE = /^[\w-]{11}$/;

const YT_HOSTS = new Set([
    'youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'youtu.be',
]);

export function parseInput(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;

    if (UCID_RE.test(s)) return { kind: 'ucid', value: s };
    if (HANDLE_RE.test(s)) return { kind: 'handle', value: s };

    let url;
    try {
        url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
        return { kind: 'search', value: s };
    }

    const host = url.hostname.replace(/^www\./, '');
    if (!YT_HOSTS.has(host)) {
        return { kind: 'search', value: s };
    }

    if (host === 'youtu.be') {
        const vid = url.pathname.split('/').filter(Boolean)[0];
        if (vid && VIDEO_ID_RE.test(vid)) return { kind: 'video', value: vid };
    }

    const path = url.pathname.replace(/\/+$/, '') || '/';

    let m = path.match(/^\/channel\/(UC[\w-]{22})/);
    if (m) return { kind: 'ucid', value: m[1] };

    m = path.match(/^\/(@[A-Za-z0-9._\-]+)/);
    if (m) return { kind: 'handle', value: m[1] };

    m = path.match(/^\/c\/([^\/]+)/);
    if (m) return { kind: 'custom', value: decodeURIComponent(m[1]) };

    m = path.match(/^\/user\/([^\/]+)/);
    if (m) return { kind: 'user', value: decodeURIComponent(m[1]) };

    if (path === '/watch') {
        const v = url.searchParams.get('v');
        if (v && VIDEO_ID_RE.test(v)) return { kind: 'video', value: v };
    }

    m = path.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return { kind: 'video', value: m[2] };

    return { kind: 'search', value: s };
}
