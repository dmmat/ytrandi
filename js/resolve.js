// Turn a parsed input into a concrete channel { ucid, title, thumbnail? }.
// Uses the unified api layer so it transparently falls back across backends.

import { api } from './api.js';

function pickUcidFromInvidiousResolve(data) {
    if (!data) return null;
    if (data.ucid) return data.ucid;
    if (data.pageType === 'WEB_PAGE_TYPE_CHANNEL' && data.ucid) return data.ucid;
    if (data.authorId) return data.authorId;
    return null;
}

function pickUcidFromPipedResolve(data) {
    if (!data) return null;
    if (typeof data.url === 'string') {
        const m = data.url.match(/\/channel\/(UC[\w-]{20,})/);
        if (m) return m[1];
    }
    if (data.id && /^UC/.test(data.id)) return data.id;
    return null;
}

async function resolveByUrl(youtubeUrl) {
    try {
        const data = await api.invidious.resolveUrl(youtubeUrl);
        const ucid = pickUcidFromInvidiousResolve(data);
        if (ucid) return ucid;
    } catch (e) {
        console.warn('[ytrandi] invidious.resolveUrl failed:', e.message);
    }
    try {
        const data = await api.piped.resolveUrl(youtubeUrl);
        const ucid = pickUcidFromPipedResolve(data);
        if (ucid) return ucid;
    } catch (e) {
        console.warn('[ytrandi] piped.resolveUrl failed:', e.message);
    }
    return null;
}

async function resolveVideoToChannel(videoId) {
    // Try Invidious first
    try {
        const v = await api.invidious.videoMeta(videoId);
        if (v && v.authorId) return { ucid: v.authorId, title: v.author };
    } catch {}
    try {
        const v = await api.piped.videoMeta(videoId);
        if (v) {
            const ucid = api.ucidFromPipedUrl(v.uploaderUrl);
            if (ucid) return { ucid, title: v.uploader };
        }
    } catch {}
    if (api.youtube.enabled()) {
        try {
            const v = await api.youtube.videoMeta(videoId);
            if (v && v.snippet) {
                return { ucid: v.snippet.channelId, title: v.snippet.channelTitle };
            }
        } catch {}
    }
    return null;
}

async function searchTopChannel(query) {
    try {
        const items = await api.invidious.searchChannels(query);
        const first = (items || []).find(x => x.type === 'channel') || (items || [])[0];
        if (first && first.authorId) return { ucid: first.authorId, title: first.author };
    } catch {}
    try {
        const data = await api.piped.searchChannels(query);
        const items = data.items || [];
        const first = items[0];
        if (first) {
            const ucid = api.ucidFromPipedUrl(first.url);
            if (ucid) return { ucid, title: first.name };
        }
    } catch {}
    if (api.youtube.enabled()) {
        try {
            const items = await api.youtube.searchChannels(query);
            const first = items[0];
            if (first && first.id && first.id.channelId) {
                return { ucid: first.id.channelId, title: first.snippet.title };
            }
        } catch {}
    }
    return null;
}

async function fillTitle(channel) {
    if (channel.title) return channel;
    try {
        const m = await api.invidious.channelMeta(channel.ucid);
        if (m && m.author) return { ...channel, title: m.author };
    } catch {}
    try {
        const m = await api.piped.channelMeta(channel.ucid);
        if (m && m.name) return { ...channel, title: m.name };
    } catch {}
    return { ...channel, title: channel.ucid };
}

export async function resolveToChannel(parsed) {
    if (!parsed) return null;
    switch (parsed.kind) {
        case 'ucid':
            return fillTitle({ ucid: parsed.value });
        case 'video': {
            const r = await resolveVideoToChannel(parsed.value);
            return r ? fillTitle(r) : null;
        }
        case 'handle': {
            const url = `https://www.youtube.com/${parsed.value}`;
            const ucid = await resolveByUrl(url);
            if (ucid) return fillTitle({ ucid });
            if (api.youtube.enabled()) {
                const id = await api.youtube.resolveByHandle(parsed.value);
                if (id) return fillTitle({ ucid: id });
            }
            return searchTopChannel(parsed.value);
        }
        case 'custom': {
            const ucid = await resolveByUrl(`https://www.youtube.com/c/${encodeURIComponent(parsed.value)}`);
            if (ucid) return fillTitle({ ucid });
            return searchTopChannel(parsed.value);
        }
        case 'user': {
            const ucid = await resolveByUrl(`https://www.youtube.com/user/${encodeURIComponent(parsed.value)}`);
            if (ucid) return fillTitle({ ucid });
            if (api.youtube.enabled()) {
                const id = await api.youtube.resolveByUsername(parsed.value);
                if (id) return fillTitle({ ucid: id });
            }
            return searchTopChannel(parsed.value);
        }
        case 'search':
            return searchTopChannel(parsed.value);
        default:
            return null;
    }
}

// ---------- Channel video listing with cross-backend fallback ----------

// Pull at least `minVideos` videos from a channel (paginating through one
// backend that we successfully started with). Returns array of {videoId,title,...}.
export async function loadChannelVideos(ucid, { minVideos = 200, hardMaxPages = 8 } = {}) {
    const backends = [
        { name: 'invidious', call: api.invidious.channelVideos.bind(api.invidious) },
        { name: 'piped',     call: api.piped.channelVideos.bind(api.piped) },
    ];
    if (api.youtube.enabled()) {
        backends.push({ name: 'youtube', call: api.youtube.channelVideos.bind(api.youtube) });
    }

    let lastErr;
    for (const b of backends) {
        try {
            const all = [];
            const seen = new Set();
            let cont = null;
            for (let page = 0; page < hardMaxPages; page++) {
                const { videos, continuation } = await b.call(ucid, cont);
                if (!videos || videos.length === 0) break;
                for (const v of videos) {
                    if (v.videoId && !seen.has(v.videoId)) {
                        seen.add(v.videoId);
                        all.push(v);
                    }
                }
                if (all.length >= minVideos) break;
                if (!continuation) break;
                cont = continuation;
            }
            if (all.length > 0) return { videos: all, backend: b.name };
            lastErr = new Error('empty');
        } catch (e) {
            lastErr = e;
            console.warn(`[ytrandi] ${b.name}.channelVideos failed:`, e.message);
        }
    }
    throw new Error(`Could not load videos: ${lastErr ? lastErr.message : 'unknown'}`);
}
