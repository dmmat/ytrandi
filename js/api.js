// Backend abstraction with automatic fallback across multiple public instances.
//
// Strategy:
//   1. Try Invidious instances (in order, skipping ones marked unhealthy).
//   2. Try Piped instances.
//   3. If user provided a YouTube Data API v3 key, use it as last resort
//      (or as primary if forcePrimary === 'youtube').
//
// Each instance has a short-lived "unhealthy" flag in localStorage so we don't
// keep hitting dead servers within a session.

const HEALTH_KEY = 'ytrandi:health:v1';
const HEALTH_TTL_MS = 5 * 60 * 1000; // 5 min

const DEFAULT_INVIDIOUS = [
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacydev.net',
    'https://inv.nadeko.net',
    'https://invidious.fdn.fr',
    'https://invidious.lunar.icu',
    'https://invidious.materialio.us',
    'https://invidious.protokolla.fi',
];

const DEFAULT_PIPED = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.smnz.de',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.darkness.services',
];

const REQUEST_TIMEOUT_MS = 8000;

// CORS-anywhere style proxies. Used as a fallback when a direct request fails
// with a network/CORS error. Each entry is a function that wraps the target
// URL. Order = preference. User can disable via settings.
const CORS_PROXIES = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// Ring buffer of recent error attempts, exposed to the UI for diagnostics.
const errorLog = [];
const ERROR_LOG_MAX = 50;
function logError(entry) {
    errorLog.unshift({ ...entry, ts: Date.now() });
    if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
}
function getErrorLog() { return errorLog.slice(); }
function clearErrorLog() { errorLog.length = 0; }

function loadCustomInstances() {
    try {
        const raw = localStorage.getItem('ytrandi:instances');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            invidious: Array.isArray(parsed.invidious) ? parsed.invidious : null,
            piped: Array.isArray(parsed.piped) ? parsed.piped : null,
        };
    } catch {
        return null;
    }
}

function getInstances(kind) {
    const custom = loadCustomInstances();
    if (kind === 'invidious') return (custom && custom.invidious) || DEFAULT_INVIDIOUS;
    if (kind === 'piped') return (custom && custom.piped) || DEFAULT_PIPED;
    return [];
}

function loadHealth() {
    try {
        return JSON.parse(localStorage.getItem(HEALTH_KEY)) || {};
    } catch {
        return {};
    }
}

function saveHealth(h) {
    try { localStorage.setItem(HEALTH_KEY, JSON.stringify(h)); } catch {}
}

function isUnhealthy(host) {
    const h = loadHealth();
    const ts = h[host];
    if (!ts) return false;
    if (Date.now() - ts > HEALTH_TTL_MS) {
        delete h[host];
        saveHealth(h);
        return false;
    }
    return true;
}

function markUnhealthy(host) {
    const h = loadHealth();
    h[host] = Date.now();
    saveHealth(h);
}

function markHealthy(host) {
    const h = loadHealth();
    if (h[host]) { delete h[host]; saveHealth(h); }
}

function corsProxiesEnabled() {
    try {
        const cfg = JSON.parse(localStorage.getItem('ytrandi:settings') || '{}');
        return cfg.useCorsProxy !== false; // default: enabled
    } catch {
        return true;
    }
}

async function fetchJsonDirect(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal, ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// Try the URL directly; on TypeError (CORS/network) or AbortError (timeout),
// fall back through CORS proxies. 4xx/5xx responses are NOT proxied since the
// proxy would just relay the same status — those bubble up immediately.
async function fetchJson(url, opts = {}) {
    try {
        return await fetchJsonDirect(url, opts);
    } catch (err) {
        const isNetworkError = err.name === 'TypeError' || err.name === 'AbortError';
        if (!isNetworkError || !corsProxiesEnabled()) throw err;
        let lastErr = err;
        for (const wrap of CORS_PROXIES) {
            try {
                const proxied = wrap(url);
                return await fetchJsonDirect(proxied, opts);
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr;
    }
}

// Try a function across an ordered instance list, returning the first success.
async function tryInstances(kind, fn, opName = '?') {
    const instances = getInstances(kind);
    const ordered = [...instances].sort((a, b) => Number(isUnhealthy(a)) - Number(isUnhealthy(b)));
    let lastErr;
    for (const base of ordered) {
        try {
            const result = await fn(base);
            markHealthy(base);
            return { result, instance: base };
        } catch (err) {
            markUnhealthy(base);
            lastErr = err;
            logError({ backend: kind, op: opName, instance: base, message: err.message || String(err) });
        }
    }
    throw new Error(`All ${kind} instances failed for ${opName}: ${lastErr ? lastErr.message : 'unknown'}`);
}

// ---------- Invidious endpoints ----------

const invidious = {
    async resolveUrl(youtubeUrl) {
        return (await tryInstances('invidious', base =>
            fetchJson(`${base}/api/v1/resolveurl?url=${encodeURIComponent(youtubeUrl)}`)
        , 'resolveUrl')).result;
    },

    async videoMeta(videoId) {
        return (await tryInstances('invidious', base =>
            fetchJson(`${base}/api/v1/videos/${encodeURIComponent(videoId)}?fields=videoId,title,authorId,author`)
        , 'videoMeta')).result;
    },

    async searchChannels(query) {
        return (await tryInstances('invidious', base =>
            fetchJson(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=channel`)
        , 'searchChannels')).result;
    },

    async channelMeta(ucid) {
        return (await tryInstances('invidious', base =>
            fetchJson(`${base}/api/v1/channels/${encodeURIComponent(ucid)}?fields=author,authorId,authorThumbnails,subCount`)
        , 'channelMeta')).result;
    },

    async channelVideos(ucid, continuation) {
        const url = base => {
            const params = new URLSearchParams({ sort_by: 'newest' });
            if (continuation) params.set('continuation', continuation);
            return `${base}/api/v1/channels/${encodeURIComponent(ucid)}/videos?${params}`;
        };
        const { result } = await tryInstances('invidious',
            base => fetchJson(url(base)), 'channelVideos');
        if (Array.isArray(result)) return { videos: result, continuation: null };
        return { videos: result.videos || [], continuation: result.continuation || null };
    },
};

// ---------- Piped endpoints ----------

function ucidFromPipedUrl(s) {
    if (!s) return null;
    const m = String(s).match(/\/channel\/(UC[\w-]{20,})/);
    return m ? m[1] : null;
}

function videoIdFromPipedUrl(s) {
    if (!s) return null;
    const m = String(s).match(/[?&]v=([\w-]{6,})/);
    return m ? m[1] : null;
}

const piped = {
    async resolveUrl(youtubeUrl) {
        return (await tryInstances('piped', base =>
            fetchJson(`${base}/resolveurl?url=${encodeURIComponent(youtubeUrl)}`)
        , 'resolveUrl')).result;
    },

    async videoMeta(videoId) {
        return (await tryInstances('piped', base =>
            fetchJson(`${base}/streams/${encodeURIComponent(videoId)}`)
        , 'videoMeta')).result;
    },

    async searchChannels(query) {
        return (await tryInstances('piped', base =>
            fetchJson(`${base}/search?q=${encodeURIComponent(query)}&filter=channels`)
        , 'searchChannels')).result;
    },

    async channelMeta(ucid) {
        return (await tryInstances('piped', base =>
            fetchJson(`${base}/channel/${encodeURIComponent(ucid)}`)
        , 'channelMeta')).result;
    },

    async channelVideos(ucid, nextpage) {
        let result, instance;
        if (nextpage) {
            const r = await tryInstances('piped', base =>
                fetchJson(`${base}/nextpage/channel/${encodeURIComponent(ucid)}?nextpage=${encodeURIComponent(nextpage)}`)
            , 'channelVideos');
            result = r.result; instance = r.instance;
        } else {
            const r = await tryInstances('piped', base =>
                fetchJson(`${base}/channel/${encodeURIComponent(ucid)}`)
            , 'channelVideos');
            result = r.result; instance = r.instance;
        }
        const streams = result.relatedStreams || [];
        const videos = streams.map(s => ({
            videoId: videoIdFromPipedUrl(s.url),
            title: s.title,
            lengthSeconds: s.duration,
            viewCount: s.views,
            published: s.uploaded,
        })).filter(v => v.videoId);
        return { videos, continuation: result.nextpage || null, instance };
    },
};

// ---------- YouTube Data API v3 (requires key) ----------

const youtube = {
    enabled() { return !!localStorage.getItem('ytrandi:apiKey'); },
    key() { return localStorage.getItem('ytrandi:apiKey'); },

    async _get(path, params) {
        const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
        Object.entries({ ...params, key: this.key() }).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
        });
        try {
            return await fetchJson(url.toString());
        } catch (err) {
            logError({ backend: 'youtube', op: path, instance: 'googleapis.com', message: err.message || String(err) });
            throw err;
        }
    },

    async resolveByHandle(handle) {
        const data = await this._get('channels', { part: 'snippet', forHandle: handle });
        return data.items && data.items[0] ? data.items[0].id : null;
    },

    async resolveByUsername(username) {
        const data = await this._get('channels', { part: 'snippet', forUsername: username });
        return data.items && data.items[0] ? data.items[0].id : null;
    },

    async videoMeta(videoId) {
        const data = await this._get('videos', { part: 'snippet', id: videoId });
        return data.items && data.items[0] ? data.items[0] : null;
    },

    async searchChannels(query) {
        const data = await this._get('search', { part: 'snippet', type: 'channel', q: query, maxResults: 10 });
        return data.items || [];
    },

    async channelMeta(ucid) {
        const data = await this._get('channels', { part: 'snippet,contentDetails,statistics', id: ucid });
        return data.items && data.items[0] ? data.items[0] : null;
    },

    async _uploadsPlaylist(ucid) {
        const meta = await this.channelMeta(ucid);
        return meta && meta.contentDetails && meta.contentDetails.relatedPlaylists
            ? meta.contentDetails.relatedPlaylists.uploads
            : null;
    },

    async channelVideos(ucid, pageToken) {
        const playlistId = await this._uploadsPlaylist(ucid);
        if (!playlistId) return { videos: [], continuation: null };
        const data = await this._get('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId, maxResults: 50, pageToken,
        });
        const videos = (data.items || []).map(it => ({
            videoId: it.contentDetails.videoId,
            title: it.snippet.title,
            published: it.contentDetails.videoPublishedAt,
        }));
        return { videos, continuation: data.nextPageToken || null };
    },
};

// ---------- Public unified API with cross-backend fallback ----------

async function withFallback(operation) {
    const order = [
        { name: 'invidious', fn: invidious[operation.name] },
        { name: 'piped',     fn: piped[operation.name] },
    ];
    if (youtube.enabled() && youtube[operation.name]) {
        order.push({ name: 'youtube', fn: youtube[operation.name] });
    }
    let lastErr;
    for (const backend of order) {
        try {
            const value = await backend.fn.apply(
                backend.name === 'invidious' ? invidious :
                backend.name === 'piped'     ? piped     : youtube,
                operation.args
            );
            return { backend: backend.name, value };
        } catch (e) {
            lastErr = e;
            console.warn(`[ytrandi] ${backend.name}.${operation.name} failed:`, e.message);
        }
    }
    throw new Error(`All backends failed for ${operation.name}: ${lastErr ? lastErr.message : '?'}`);
}

export const api = {
    invidious, piped, youtube, withFallback,
    DEFAULT_INVIDIOUS, DEFAULT_PIPED,
    ucidFromPipedUrl,
    getErrorLog, clearErrorLog,
};
