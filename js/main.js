// Orchestrator: wires UI, parser, resolver, API, storage, and YT player.

import { parseInput } from './parse.js';
import { resolveToChannel, loadChannelVideos } from './resolve.js';
import {
    settings, apiKey, history, channels, videoCache, clearAll,
} from './storage.js';

// ---------- DOM refs ----------
const $ = (sel) => document.querySelector(sel);

const els = {
    form: $('#search-form'),
    input: $('#channel-input'),
    randomBtn: $('#random-btn'),
    status: $('#status-bar'),
    channelsList: $('#channels-list'),
    channelsEmpty: $('#channels-empty'),
    channelsCount: $('#channels-count'),
    playerSection: $('#player-section'),
    npChannel: $('#np-channel'),
    npTitle: $('#np-title'),
    npOpen: $('#np-open'),
    skipBtn: $('#skip-btn'),
    themeToggle: $('#theme-toggle'),
    settingsBtn: $('#settings-btn'),
    dialog: $('#settings-dialog'),
    optAvoidWatched: $('#opt-avoid-watched'),
    optCacheDays: $('#opt-cache-days'),
    optApiKey: $('#opt-api-key'),
    btnClearHistory: $('#btn-clear-history'),
    btnClearAll: $('#btn-clear-all'),
};

// ---------- App state ----------
const state = {
    player: null,
    playerReady: false,
    pendingVideo: null,           // queued before player ready
    currentChannel: null,         // { ucid, title }
    currentVideoId: null,
    isLoading: false,
};

// ---------- Status helpers ----------
let statusTimer;
function setStatus(text, kind) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (!text) { els.status.hidden = true; els.status.textContent = ''; els.status.className = 'status-bar'; return; }
    els.status.hidden = false;
    els.status.className = 'status-bar' + (kind ? ' ' + kind : '');
    els.status.textContent = text;
}
function flashStatus(text, kind, ms = 2500) {
    setStatus(text, kind);
    statusTimer = setTimeout(() => setStatus(''), ms);
}

function setLoading(on) {
    state.isLoading = on;
    els.randomBtn.classList.toggle('loading', !!on);
    els.randomBtn.disabled = !!on;
    els.input.disabled = !!on;
}

// ---------- Theme ----------
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f8fb' : '#0f0f12');
}
function toggleTheme() {
    const cur = settings.load().theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    settings.save({ theme: next });
    applyTheme(next);
}

// ---------- YT Player ----------
function createPlayer() {
    state.player = new YT.Player('player', {
        height: '360',
        width: '100%',
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
            onReady: () => {
                state.playerReady = true;
                if (state.pendingVideo) {
                    const v = state.pendingVideo;
                    state.pendingVideo = null;
                    playVideoNow(v);
                }
            },
            onStateChange: (e) => {
                if (e.data === YT.PlayerState.ENDED && state.currentChannel) {
                    pickAndPlayRandom(state.currentChannel).catch(err => {
                        console.error(err);
                        flashStatus(err.message || 'Failed to play next', 'error', 4000);
                    });
                }
            },
        },
    });
}

// Module scripts are deferred; YT iframe API may have already fired its
// callback before this module ran. Cover both orderings.
if (window.YT && window.YT.Player) {
    createPlayer();
} else {
    window.onYouTubeIframeAPIReady = createPlayer;
}

function playVideoNow(videoId) {
    if (!state.playerReady) {
        state.pendingVideo = videoId;
        return;
    }
    state.player.loadVideoById(videoId);
}

// ---------- Pick + play ----------
function randomFromList(videos, { avoidIds }) {
    if (!videos.length) return null;
    let pool = videos;
    if (avoidIds && avoidIds.size) {
        const filtered = videos.filter(v => !avoidIds.has(v.videoId));
        if (filtered.length) pool = filtered;
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

async function getOrLoadVideos(ucid) {
    const cached = videoCache.get(ucid);
    if (cached && cached.videos && cached.videos.length) return cached;
    setStatus('Fetching channel videos…');
    const { videos, backend } = await loadChannelVideos(ucid);
    videoCache.set(ucid, videos, backend);
    return { videos, backend, updatedAt: Date.now() };
}

async function pickAndPlayRandom(channel) {
    const cfg = settings.load();
    const cache = await getOrLoadVideos(channel.ucid);
    const avoid = cfg.avoidWatched ? new Set(history.list()) : null;
    const pick = randomFromList(cache.videos, { avoidIds: avoid });
    if (!pick) throw new Error('No videos found for this channel.');
    history.add(pick.videoId);
    state.currentChannel = channel;
    state.currentVideoId = pick.videoId;
    updateNowPlaying(channel, pick);
    showPlayer();
    playVideoNow(pick.videoId);
    setStatus('');
    return pick;
}

function updateNowPlaying(channel, video) {
    els.npChannel.textContent = channel.title || channel.ucid;
    els.npTitle.textContent = video.title || '';
    els.npOpen.href = `https://www.youtube.com/watch?v=${video.videoId}`;
}

function showPlayer() { els.playerSection.hidden = false; }

// ---------- Channels UI ----------
function renderChannels() {
    const list = channels.list();
    els.channelsList.innerHTML = '';
    if (list.length === 0) {
        els.channelsEmpty.hidden = false;
        els.channelsCount.textContent = '';
        return;
    }
    els.channelsEmpty.hidden = true;
    els.channelsCount.textContent = `${list.length} saved`;
    for (const c of list) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'channel-chip';
        chip.title = `Random from ${c.title}`;
        const label = document.createElement('span');
        label.className = 'chip-title';
        label.textContent = c.title;
        const x = document.createElement('span');
        x.className = 'chip-x';
        x.textContent = '✕';
        x.title = 'Forget this channel';
        x.setAttribute('role', 'button');
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            channels.remove(c.ucid);
            renderChannels();
        });
        chip.append(label, x);
        chip.addEventListener('click', async () => {
            if (state.isLoading) return;
            try {
                setLoading(true);
                channels.upsert(c.ucid, c.title);
                await pickAndPlayRandom({ ucid: c.ucid, title: c.title });
                renderChannels();
            } catch (err) {
                console.error(err);
                flashStatus(err.message || 'Failed to load channel', 'error', 4000);
            } finally {
                setLoading(false);
            }
        });
        els.channelsList.append(chip);
    }
}

// ---------- Submit handler ----------
async function handleSubmit(rawValue) {
    if (state.isLoading) return;
    const value = (rawValue ?? els.input.value).trim();
    if (!value) {
        // No input — if there's a current channel, just skip
        if (state.currentChannel) {
            try {
                setLoading(true);
                await pickAndPlayRandom(state.currentChannel);
            } catch (err) {
                flashStatus(err.message, 'error', 4000);
            } finally { setLoading(false); }
        }
        return;
    }
    setLoading(true);
    try {
        const parsed = parseInput(value);
        if (!parsed) { flashStatus('Could not understand that input', 'error'); return; }
        setStatus('Resolving channel…');
        const channel = await resolveToChannel(parsed);
        if (!channel || !channel.ucid) {
            flashStatus('Channel not found. Try another URL or name.', 'error', 4000);
            return;
        }
        channels.upsert(channel.ucid, channel.title);
        await pickAndPlayRandom(channel);
        renderChannels();
        els.input.value = '';
    } catch (err) {
        console.error(err);
        flashStatus(err.message || 'Something went wrong', 'error', 4000);
    } finally {
        setLoading(false);
    }
}

// ---------- Settings dialog ----------
function openSettings() {
    const cfg = settings.load();
    els.optAvoidWatched.checked = !!cfg.avoidWatched;
    els.optCacheDays.value = String(cfg.cacheDays);
    els.optApiKey.value = apiKey.get();
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
}

function saveSettings() {
    const days = Number(els.optCacheDays.value);
    settings.save({
        avoidWatched: els.optAvoidWatched.checked,
        cacheDays: Number.isFinite(days) ? days : 1,
    });
    apiKey.set(els.optApiKey.value.trim());
}

// ---------- Keyboard shortcuts ----------
function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}

function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTyping()) return;
        switch (e.key.toLowerCase()) {
            case 'n':
                e.preventDefault();
                if (state.currentChannel) handleSubmit('');
                break;
            case 's':
                e.preventDefault();
                if (state.currentChannel) handleSubmit('');
                break;
            case 't':
                e.preventDefault();
                toggleTheme();
                break;
            case ' ':
                if (state.player && state.playerReady) {
                    e.preventDefault();
                    const s = state.player.getPlayerState();
                    if (s === YT.PlayerState.PLAYING) state.player.pauseVideo();
                    else state.player.playVideo();
                }
                break;
            case 'm':
                if (state.player && state.playerReady) {
                    e.preventDefault();
                    if (state.player.isMuted()) state.player.unMute();
                    else state.player.mute();
                }
                break;
        }
    });
}

// ---------- Boot ----------
function boot() {
    applyTheme(settings.load().theme);

    els.form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSubmit();
    });
    els.skipBtn.addEventListener('click', () => handleSubmit(''));
    els.themeToggle.addEventListener('click', toggleTheme);

    els.settingsBtn.addEventListener('click', openSettings);
    els.dialog.addEventListener('close', () => {
        if (els.dialog.returnValue === 'save') saveSettings();
    });
    els.btnClearHistory.addEventListener('click', () => {
        history.clear();
        flashStatus('Watch history cleared', 'success');
    });
    els.btnClearAll.addEventListener('click', () => {
        if (!confirm('Forget all channels, history, and settings?')) return;
        clearAll();
        applyTheme('dark');
        renderChannels();
        flashStatus('All local data removed', 'success');
        els.dialog.close();
    });

    bindKeyboard();
    renderChannels();
    els.input.focus();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
