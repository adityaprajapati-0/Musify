# Pulse Music Website

Multi-page aesthetic music web app with a shared top player bar and public API data.

## Features
- Sticky top play bar across all pages
- Player progress slider (seek/time) in the top bar
- Animated wave effect on the progress slider while playing
- `Save` and `Add to Playlist` actions in the player bar
- Separate pages for Home, Trending Songs, Trending Artists, and Playlists
- Dedicated per-song page (`track.html`) opened from song cards
- Animated glassmorphism UI and button hover effects
- Trending songs by region
- Trending artists with profile and top songs
- Song search with artwork + preview playback
- Lyrics and artist profile panel on Songs page
- Curated playlists with playable tracks
- My Playlist and Saved Songs (stored in localStorage)
- Local proxy API layer to avoid browser CORS failures
- Responsive desktop/mobile layout

## Public APIs Used
- Apple Music RSS (trending songs)
- iTunes Search API (songs, artists, previews, track art)
- Lyrics.ovh (lyrics)
- Wikipedia API (artist bio/image)
- Deezer API (trending artists + artist images fallback)

## Run
Use the included Node server (required for `/api/*` proxy routes):

```powershell
cd "d:\Music Website"
.\start-server.ps1
```

Then open:
- `http://localhost:5501`

If `5500` is free, you can also run:
```powershell
.\start-server.ps1 -Port 5500
```

Stop:
```powershell
cd "d:\Music Website"
.\stop-server.ps1
```

## AI Singing Judge Setup
The AI judge page (`ai.html`) now calls the local proxy route `/api/ai/judge`, which forwards requests to a Python FastAPI service on `http://127.0.0.1:8000`.

### 1) Install Python deps
```powershell
cd "d:\Music Website\ai_engine"
pip install -r requirements.txt
```

### 2) Set optional env vars
`GROQ_API_KEY` enables LLM-generated coach feedback. If unset, the system uses deterministic local feedback.

```powershell
$env:GROQ_API_KEY="your_key_here"
```

Optional:
- `GROQ_MODEL` (default: `llama3-8b-8192`)
- `EDGE_TTS_VOICE` (default: `en-US-GuyNeural`)
- `AI_MAX_AUDIO_SECONDS` (default: `60`)
- `AI_MAX_UPLOAD_BYTES` (default: `12582912`)
- `AI_LLM_TIMEOUT_SECONDS` (default: `10`)
- `AI_TTS_TIMEOUT_SECONDS` (default: `12`)
- `AI_USE_PYIN` (default: `0`; enable with `1` for slower but potentially finer pitch extraction)

### 3) Start AI backend
```powershell
cd "d:\Music Website\ai_engine"
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 4) Start site server
```powershell
cd "d:\Music Website"
.\start-server.ps1 -Port 5501
```

The Node server proxies:
- `POST /api/ai/judge` -> `http://127.0.0.1:8000/judge`
- `GET /api/ai/health` -> `http://127.0.0.1:8000/health`

## Files
- `index.html`
- `songs.html`
- `artists.html`
- `playlists.html`
- `track.html`
- `styles.css`
- `common.js`
- `home.js`
- `songs.js`
- `artists.js`
- `playlists.js`
- `track.js`
- `server.js`
- `ai_engine/main.py`
- `ai_engine/audio_analysis.py`
- `ai_engine/llm_feedback.py`
- `ai_engine/tts.py`
