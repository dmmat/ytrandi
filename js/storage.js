// Thin localStorage helpers + cache schema.
//
// Schema:
//   ytrandi:settings           -> { theme, avoidWatched, cacheDays }
//   ytrandi:apiKey             -> string (YouTube Data API key, optional)
//   ytrandi:history            -> [videoId, ...] capped at HISTORY_MAX
//   ytrandi:channels           -> { [ucid]: { title, addedAt, lastUsed } }
//   ytrandi:videos:<ucid>      -> { videos: [...], updatedAt, backend }
//   ytrandi:health:v1          -> instance health (managed in api.js)
//   ytrandi:instances          -> custom instance lists (optional)

const HISTORY_MAX = 300;
const DEFAULT_CACHE_DAYS = 1;

function safeGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const settings = {
    load() {
        return Object.assign(
            { theme: 'dark', avoidWatched: true, cacheDays: DEFAULT_CACHE_DAYS },
            safeGet('ytrandi:settings', {})
        );
    },
    save(patch) {
        const cur = this.load();
        const next = { ...cur, ...patch };
        safeSet('ytrandi:settings', next);
        return next;
    },
};

export const apiKey = {
    get: () => localStorage.getItem('ytrandi:apiKey') || '',
    set: (v) => {
        if (v) localStorage.setItem('ytrandi:apiKey', v);
        else localStorage.removeItem('ytrandi:apiKey');
    },
};

export const history = {
    list: () => safeGet('ytrandi:history', []),
    has: (id) => history.list().includes(id),
    add(id) {
        if (!id) return;
        const cur = history.list().filter(x => x !== id);
        cur.unshift(id);
        if (cur.length > HISTORY_MAX) cur.length = HISTORY_MAX;
        safeSet('ytrandi:history', cur);
    },
    clear: () => safeSet('ytrandi:history', []),
};

export const channels = {
    map: () => safeGet('ytrandi:channels', {}),
    list() {
        const m = channels.map();
        return Object.entries(m)
            .map(([ucid, v]) => ({ ucid, ...v }))
            .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    },
    upsert(ucid, title) {
        const m = channels.map();
        const cur = m[ucid] || {};
        m[ucid] = {
            title: title || cur.title || ucid,
            addedAt: cur.addedAt || Date.now(),
            lastUsed: Date.now(),
        };
        safeSet('ytrandi:channels', m);
    },
    remove(ucid) {
        const m = channels.map();
        delete m[ucid];
        safeSet('ytrandi:channels', m);
        try { localStorage.removeItem(`ytrandi:videos:${ucid}`); } catch {}
    },
    rename(ucid, title) {
        const m = channels.map();
        if (m[ucid]) { m[ucid].title = title; safeSet('ytrandi:channels', m); }
    },
};

export const videoCache = {
    get(ucid, { maxAgeDays } = {}) {
        const c = safeGet(`ytrandi:videos:${ucid}`, null);
        if (!c) return null;
        const days = maxAgeDays != null ? maxAgeDays : settings.load().cacheDays;
        if (Date.now() - (c.updatedAt || 0) > days * 86400 * 1000) return null;
        return c;
    },
    set(ucid, videos, backend) {
        safeSet(`ytrandi:videos:${ucid}`, { videos, updatedAt: Date.now(), backend });
    },
    drop(ucid) {
        try { localStorage.removeItem(`ytrandi:videos:${ucid}`); } catch {}
    },
};

export function clearAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('ytrandi:'));
    keys.forEach(k => { try { localStorage.removeItem(k); } catch {} });
}
