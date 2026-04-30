// Orchestrator: wires UI, parser, resolver, API, storage, and YT player.

import { parseInput } from './parse.js';
import { resolveToChannel, loadChannelVideos } from './resolve.js';
import {
    settings, apiKey, history, channels, videoCache, clearAll,
} from './storage.js';
import { api } from './api.js';

// ---------- DOM refs ----------
const $ = (sel) => document.querySelector(sel);

const els = {
    form: $('#search-form'),
    input: $('#channel-input'),
    randomBtn: $('#random-btn'),
    status: $('#status-bar'),
    statusText: $('#status-text'),
    statusDetailsBtn: $('#status-details-btn'),
    keyBanner: $('#key-banner'),
    keyBannerAdd: $('#key-banner-add'),
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
    optCorsProxy: $('#opt-cors-proxy'),
    btnClearHistory: $('#btn-clear-history'),
    btnClearAll: $('#btn-clear-all'),
    errorsDialog: $('#errors-dialog'),
    errorsLog: $('#errors-log'),
    errorsClear: $('#errors-clear'),
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
function setStatus(text, kind, { withDetails = false } = {}) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (!text) {
        els.status.hidden = true;
        els.statusText.textContent = '';
        els.statusDetailsBtn.hidden = true;
        els.status.className = 'status-bar';
        return;
    }
    els.status.hidden = false;
    els.status.className = 'status-bar' + (kind ? ' ' + kind : '');
    els.statusText.textContent = text;
    els.statusDetailsBtn.hidden = !withDetails;
}
function flashStatus(text, kind, ms = 2500) {
    setStatus(text, kind);
    statusTimer = setTimeout(() => setStatus(''), ms);
}

function showError(err, ctx = 'Something went wrong') {
    const msg = (err && err.message) ? err.message : String(err || ctx);
    setStatus(`${ctx}: ${msg}`, 'error', { withDetails: true });
    maybeShowKeyBanner();
}

function maybeShowKeyBanner() {
    if (api.youtube.enabled()) { els.keyBanner.hidden = true; return; }
    const log = api.getErrorLog();
    if (!log.length) return;
    // Only show when failures are logged for BOTH public backends in the
    // current operation window (the log is cleared at the start of each
    // user-triggered request, so any entry here is from the current run).
    const kinds = new Set(log.map(e => e.backend));
    if (kinds.has('invidious') && kinds.has('piped')) {
        els.keyBanner.hidden = false;
    }
}

function startRun() {
    api.clearErrorLog();
    els.keyBanner.hidden = true;
}

function renderErrorsLog() {
    const log = api.getErrorLog();
    if (!log.length) { els.errorsLog.textContent = '(no errors recorded)'; return; }
    const lines = log.map(e => {
        const t = new Date(e.ts).toLocaleTimeString();
        return `[${t}] ${e.backend}/${e.op} @ ${e.instance}\n         → ${e.message}`;
    });
    els.errorsLog.textContent = lines.join('\n\n');
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
                startRun();
                channels.upsert(c.ucid, c.title);
                await pickAndPlayRandom({ ucid: c.ucid, title: c.title });
                renderChannels();
            } catch (err) {
                console.error(err);
                showError(err, 'Failed to load channel');
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
        if (state.currentChannel) {
            try {
                setLoading(true);
                startRun();
                await pickAndPlayRandom(state.currentChannel);
            } catch (err) {
                console.error(err);
                showError(err, 'Failed to play next');
            } finally { setLoading(false); }
        }
        return;
    }
    setLoading(true);
    startRun();
    try {
        const parsed = parseInput(value);
        if (!parsed) {
            setStatus('Could not understand that input', 'error');
            return;
        }
        setStatus('Resolving channel…');
        const channel = await resolveToChannel(parsed);
        if (!channel || !channel.ucid) {
            setStatus('Channel not found. Try another URL or name.', 'error', { withDetails: true });
            maybeShowKeyBanner();
            return;
        }
        channels.upsert(channel.ucid, channel.title);
        await pickAndPlayRandom(channel);
        renderChannels();
        els.input.value = '';
    } catch (err) {
        console.error(err);
        showError(err, 'Something went wrong');
    } finally {
        setLoading(false);
    }
}

// ---------- Settings dialog ----------
function openSettings({ focusKey = false } = {}) {
    const cfg = settings.load();
    els.optAvoidWatched.checked = !!cfg.avoidWatched;
    els.optCacheDays.value = String(cfg.cacheDays);
    els.optApiKey.value = apiKey.get();
    els.optCorsProxy.checked = cfg.useCorsProxy !== false;
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
    if (focusKey) setTimeout(() => els.optApiKey.focus(), 50);
}

function saveSettings() {
    const days = Number(els.optCacheDays.value);
    settings.save({
        avoidWatched: els.optAvoidWatched.checked,
        cacheDays: Number.isFinite(days) ? days : 1,
        useCorsProxy: els.optCorsProxy.checked,
    });
    apiKey.set(els.optApiKey.value.trim());
    if (api.youtube.enabled()) els.keyBanner.hidden = true;
}

function openErrorsDialog() {
    renderErrorsLog();
    if (typeof els.errorsDialog.showModal === 'function') els.errorsDialog.showModal();
    else els.errorsDialog.setAttribute('open', '');
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

    els.settingsBtn.addEventListener('click', () => openSettings());
    els.dialog.addEventListener('close', () => {
        if (els.dialog.returnValue === 'save') saveSettings();
    });
    els.statusDetailsBtn.addEventListener('click', openErrorsDialog);
    els.errorsClear.addEventListener('click', () => { api.clearErrorLog(); renderErrorsLog(); });
    els.keyBannerAdd.addEventListener('click', () => openSettings({ focusKey: true }));
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
