import {
  createArtistCard,
  createSongCard,
  initShell,
  setStatus,
} from "./common.js?v=20260216m5";

const refs = {
  songsStatus: document.querySelector("#homeSongsStatus"),
  songsGrid: document.querySelector("#homeSongsGrid"),
  artistsStatus: document.querySelector("#homeArtistsStatus"),
  artistsGrid: document.querySelector("#homeArtistsGrid"),
  historyGrid: document.querySelector("#homeHistoryGrid"),
  visualizerCtx: document.querySelector("#visualizer")?.getContext("2d"),
};

let visualizerFrame = 0;
let lastMood = "neutral";
let moodDebounce = 0;

// Particle logic moved to common.js for global effect

function renderVisualizer(app) {
  const canvas = refs.visualizerCtx?.canvas;
  const ctx = refs.visualizerCtx;
  if (!canvas || !ctx) return;

  const analyser = app.getAnalyser();
  if (!analyser) {
    visualizerFrame = requestAnimationFrame(() => renderVisualizer(app));
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    visualizerFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;

    // Analyze Bands
    let bass = 0;
    let mids = 0;
    let highs = 0;

    for (let i = 0; i < bufferLength; i++) {
      const val = dataArray[i];

      // Render Bar
      const barHeight = val / 2;
      ctx.fillStyle = `rgba(72, 243, 182, ${barHeight / 200})`;
      ctx.fillRect(x, canvas.height / 2 - barHeight / 2, barWidth, barHeight);
      x += barWidth + 1;

      // Band Calculation (Approx for 128 bins)
      if (i < 10) bass += val;
      else if (i < 80) mids += val;
      else highs += val;
    }

    // Averages
    const avgBass = bass / 10;
    const avgMids = mids / 70;
    const avgHighs = highs / 48;
    const totalEnergy = (avgBass * 1.5 + avgMids + avgHighs * 0.5) / 3;

    // Mood Logic with Debounce
    const now = Date.now();
    let detectedMood = lastMood;

    if (now - moodDebounce > 1000) {
      // Check every 1s
      if (totalEnergy > 160 && avgBass > 180) detectedMood = "energetic";
      else if (totalEnergy > 100) detectedMood = "happy";
      else if (totalEnergy > 40) detectedMood = "romantic";
      else if (totalEnergy > 5) detectedMood = "sad";
      else detectedMood = "neutral";

      if (detectedMood !== lastMood) {
        lastMood = detectedMood;
        moodDebounce = now;
        document.body.dataset.mood = lastMood;
      }
    }

    // Particle Generation (Rate depends on mood)
    if (Math.random() < 0.1) {
      // 10% chance per frame base
      if (lastMood === "sad" && Math.random() > 0.5) createParticle("rain");
      if (lastMood === "romantic" && Math.random() > 0.8)
        createParticle("heart");
      if (lastMood === "happy" && Math.random() > 0.7) createParticle("bubble");
      if (lastMood === "energetic") {
        if (Math.random() > 0.8) createParticle("neon");
        // Extra bass shake trigger
        if (avgBass > 220)
          document.body.style.transform = `scale(${1 + Math.random() * 0.01})`;
        else document.body.style.transform = "none";
      } else {
        document.body.style.transform = "none";
      }
    }
  };

  draw();
}

function loadHistory(app) {
  const history = app.getHistory();
  if (!history.length) return;

  refs.historyGrid.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Show only top 6 recent
  history.slice(0, 6).forEach((track, index) => {
    const card = createSongCard(track, {
      compact: true,
      badge: "Recent",
      delay: index * 40,
      onSelect: () => {
        app.setQueue(history, index);
        app.openTrackPage(track);
      },
    });
    frag.appendChild(card);
  });

  refs.historyGrid.appendChild(frag);
}

async function loadHomeSongs(app) {
  setStatus(refs.songsStatus, "Loading songs...");
  refs.songsGrid.innerHTML = "";

  try {
    const data = await app.apiFetch("/api/trending?country=us&limit=8");
    const items = data.items ?? [];
    if (!items.length) {
      setStatus(refs.songsStatus, "No songs found.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((track, index) => {
      const card = createSongCard(track, {
        badge: "Hot",
        delay: index * 35,
        onSelect: () => {
          app.setQueue(items, index);
          app.openTrackPage(track);
        },
      });
      frag.appendChild(card);
    });

    refs.songsGrid.appendChild(frag);
    let initialTrack = items.find((track) => track.previewUrl) || items[0];
    if (initialTrack && !initialTrack.previewUrl) {
      try {
        const hydrated = await app.apiFetch(
          `/api/hydrate?title=${encodeURIComponent(initialTrack.title)}&artist=${encodeURIComponent(initialTrack.artist)}&country=US`,
        );
        if (hydrated.item?.previewUrl) {
          initialTrack = {
            ...initialTrack,
            ...hydrated.item,
            source: initialTrack.source,
          };
        }
      } catch {
        // Ignore hydrate failures for initial song.
      }
    }
    app.ensureTrack(initialTrack);
    setStatus(refs.songsStatus, `${items.length} songs loaded.`);
  } catch (error) {
    setStatus(refs.songsStatus, "Could not load songs.", true);
    console.error(error);
  }
}

async function loadHomeArtists(app) {
  setStatus(refs.artistsStatus, "Loading artists...");
  refs.artistsGrid.innerHTML = "";

  try {
    const data = await app.apiFetch("/api/trending-artists?country=us&limit=8");
    const items = data.items ?? [];
    if (!items.length) {
      setStatus(refs.artistsStatus, "No artists found.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((artist, index) => {
      const card = createArtistCard(artist, {
        delay: index * 35,
        onSelect: () => {
          window.location.href = `./artists.html?artist=${encodeURIComponent(artist.name)}`;
        },
      });
      frag.appendChild(card);
    });

    refs.artistsGrid.appendChild(frag);
    setStatus(refs.artistsStatus, `${items.length} artists loaded.`);
  } catch (error) {
    setStatus(refs.artistsStatus, "Could not load artists.", true);
    console.error(error);
  }
}

// --- SPA Lifecycle ---

let activeApp = null;
let songsInterval = null;

export async function mount(app) {
  activeApp = app;

  if (!app.apiReady) {
    setStatus(refs.songsStatus, "Backend disconnected.", true);
    return;
  }

  await Promise.all([loadHomeSongs(app), loadHomeArtists(app)]);
  loadHistory(app);

  // Start visualizer
  renderVisualizer(app);

  // Listeners
  const onHistoryUpdate = () => loadHistory(app);
  window.addEventListener("pulse:history-updated", onHistoryUpdate);

  // Save unmount cleanup
  activeApp._homeCleanup = () => {
    window.removeEventListener("pulse:history-updated", onHistoryUpdate);
    if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  };
}

export function unmount() {
  if (activeApp && activeApp._homeCleanup) {
    activeApp._homeCleanup();
  }
}

// Self-boot if not controlled by Router
if (!window.HAS_ROUTER) {
  initShell("home").then((app) => mount(app));
}
