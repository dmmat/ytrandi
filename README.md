# YTrandI

Random video discovery for any YouTube channel — frontend-only, no tracking, no
required API key.

Paste **any** of the following and hit *Random video*:

- a channel URL: `https://www.youtube.com/@MrBeast`
- an `@handle`: `@MrBeast`
- a channel ID: `UCX6OQ3DkcsbYNE6H8uQQuVA`
- a legacy URL: `youtube.com/c/MrBeast` or `youtube.com/user/PewDiePie`
- a video URL: `https://youtu.be/dQw4w9WgXcQ` — resolves to its channel
- or just the channel name: `Veritasium`

## How it works

Channel resolution and video listing go through public **Invidious** and
**Piped** instances with automatic per-instance health-check and cross-backend
fallback. If both are unavailable, you can plug in your own
[YouTube Data API v3](https://console.developers.google.com/apis/library/youtube.googleapis.com)
key from the settings dialog as a final fallback.

## Features

- Multi-instance fallback (Invidious → Piped → optional YouTube key)
- Smart input parsing: URLs, `@handles`, channel IDs, video links, search text
- Saved channels with one-click random replay
- Per-channel video cache with configurable TTL
- "Avoid recently watched" mode so reruns feel fresh
- Auto-play next random when a video ends
- Light / dark theme
- Keyboard shortcuts: `N` next · `S` skip · `Space` play/pause · `M` mute · `T` theme
- Mobile-friendly responsive layout
- All data lives in `localStorage` — nothing leaves your browser

## Run locally

It's a static site, so any HTTP server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Credits

Thanks to the [Invidious](https://github.com/iv-org/invidious) and
[Piped](https://github.com/TeamPiped/Piped) projects, and to all who run
public instances of either.
