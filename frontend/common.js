const FALLBACK_PROXY_BASES = ["http://localhost:5501", "http://127.0.0.1:5501"];
const API_FETCH_TIMEOUT_MS = 4500;
const HEALTHCHECK_TIMEOUT_MS = 1400;
const PLAYER_TRACK_KEY = "pulse.music.player.track";
const PLAYER_VOLUME_KEY = "pulse.music.player.volume";
const SAVED_TRACKS_KEY = "pulse.music.savedTracks";
const CUSTOM_PLAYLIST_KEY = "pulse.music.customPlaylist";
const QUEUE_KEY = "pulse.music.queue";
const QUEUE_INDEX_KEY = "pulse.music.queueIndex";
const LOOP_MODE_KEY = "pulse.music.loopMode";
const HISTORY_KEY = "pulse.music.history";

const LOOP_MODES = {
  OFF: 0,
  ALL: 1,
  ONE: 2,
};

const PLACEHOLDER_ART =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%231a2440'/%3E%3Cstop offset='1' stop-color='%230d1324'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='640' fill='url(%23g)'/%3E%3Ccircle cx='320' cy='240' r='112' fill='%2341547b'/%3E%3Crect x='152' y='412' width='336' height='46' rx='22' fill='%23384c78'/%3E%3C/svg%3E";

const PLACEHOLDER_ARTIST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23283052'/%3E%3Cstop offset='1' stop-color='%23101728'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='640' fill='url(%23a)'/%3E%3Ccircle cx='320' cy='232' r='110' fill='%234f618e'/%3E%3Crect x='150' y='386' width='340' height='170' rx='84' fill='%233e4f79'/%3E%3C/svg%3E";

let apiBase = "";
let playerReady = false;
let currentTrack = null;
let currentQueue = [];
let currentIndex = -1;
let currentLoopMode = LOOP_MODES.OFF;

const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.preload = "none";

let audioContext = null;
let audioSource = null;
let analyser = null;

const playerRefs = {
  root: null,
  artwork: null,
  title: null,
  artist: null,
  toggle: null,
  prev: null,
  next: null,
  loop: null,
  miniControls: null,
  miniToggle: null,
  miniPrev: null,
  miniNext: null,
  miniLoop: null,
  open: null,
  volume: null,
  saveTrack: null,
  addPlaylist: null,
  actionStatus: null,
  progress: null,
  timeCurrent: null,
  timeDuration: null,
};

const MINI_ICON_PREV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 20L9 12l10-8v16zM5 19V5h2v14H5z"/></svg>`;
const MINI_ICON_NEXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4l10 8-10 8V4zM19 5v14h-2V5h2z"/></svg>`;
const MINI_ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const MINI_ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>`;
const MINI_ICON_LOOP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
const MINI_ICON_LOOP_ONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="10" y="15" font-size="8" fill="currentColor" font-weight="bold">1</text></svg>`;

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function encodeTrackForQuery(track) {
  const normalized = normalizeTrack(track);
  const params = new URLSearchParams({
    id: String(normalized.id ?? ""),
    title: normalized.title,
    artist: normalized.artist,
    image: normalized.image,
    songUrl: normalized.songUrl,
    previewUrl: normalized.previewUrl,
    source: normalized.source,
  });
  return params.toString();
}

function openTrackPage(track) {
  const normalized = normalizeTrack(track);
  setCurrentTrack(normalized, { autoplay: false });
  const query = encodeTrackForQuery(normalized);
  window.location.href = `./track.html?${query}`;
}

function trackKey(track) {
  return `${safeText(track.artist).toLowerCase()}::${safeText(track.title).toLowerCase()}`;
}

function loadTrackCollection(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const map = new Map();
    parsed.forEach((item) => {
      const normalized = normalizeTrack(item);
      if (!normalized) return;
      map.set(trackKey(normalized), normalized);
    });
    return [...map.values()];
  } catch {
    return [];
  }
}

function saveTrackCollection(key, tracks) {
  localStorage.setItem(key, JSON.stringify(tracks));
}

function collectionHasTrack(collection, track) {
  const key = trackKey(track);
  return collection.some((item) => trackKey(item) === key);
}

function addTrackToCollection(key, track) {
  const normalized = normalizeTrack(track);
  const collection = loadTrackCollection(key);
  if (collectionHasTrack(collection, normalized)) {
    return { added: false, tracks: collection };
  }

  collection.unshift(normalized);
  saveTrackCollection(key, collection);
  window.dispatchEvent(
    new CustomEvent("pulse:library-updated", {
      detail: { key, count: collection.length },
    }),
  );
  return { added: true, tracks: collection };
}

function addToHistory(track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return;
  const history = loadTrackCollection(HISTORY_KEY);

  // Remove if already exists to move to top
  const existingIndex = history.findIndex(
    (item) => trackKey(item) === trackKey(normalized),
  );
  if (existingIndex !== -1) {
    history.splice(existingIndex, 1);
  }

  history.unshift(normalized);
  if (history.length > 20) {
    history.pop();
  }

  saveTrackCollection(HISTORY_KEY, history);
  window.dispatchEvent(
    new CustomEvent("pulse:history-updated", {
      detail: { count: history.length },
    }),
  );
}

function getStoredVolume() {
  const raw = localStorage.getItem(PLAYER_VOLUME_KEY);
  const value = Number.parseFloat(String(raw || "0.8"));
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function setImageWithFallback(node, src, fallback = PLACEHOLDER_ART) {
  if (!node) return;
  node.dataset.fallbackApplied = "0";
  node.onerror = () => {
    if (node.dataset.fallbackApplied === "1") return;
    node.dataset.fallbackApplied = "1";
    node.src = fallback;
  };
  node.src = safeText(src, "") || fallback;
}

function showActionStatus(message, isError = false) {
  if (!playerRefs.actionStatus) return;
  playerRefs.actionStatus.textContent = message;
  playerRefs.actionStatus.classList.toggle("status-error", isError);
  playerRefs.actionStatus.classList.add("visible");
  window.clearTimeout(showActionStatus._timer);
  showActionStatus._timer = window.setTimeout(() => {
    if (!playerRefs.actionStatus) return;
    playerRefs.actionStatus.classList.remove("visible");
  }, 1800);
}

function ensureActionButtons() {
  const controls = playerRefs.root.querySelector(".player-controls");
  if (!controls) return;

  playerRefs.addPlaylist = controls.querySelector("#playerAddPlaylist");
  if (!playerRefs.addPlaylist) {
    playerRefs.addPlaylist = document.createElement("button");
    playerRefs.addPlaylist.id = "playerAddPlaylist";
    playerRefs.addPlaylist.type = "button";
    playerRefs.addPlaylist.className = "btn btn-ghost";
    playerRefs.addPlaylist.textContent = "Add to Playlist";
    controls.insertBefore(playerRefs.addPlaylist, playerRefs.open);
  }

  playerRefs.saveTrack = controls.querySelector("#playerSaveTrack");
  if (!playerRefs.saveTrack) {
    playerRefs.saveTrack = document.createElement("button");
    playerRefs.saveTrack.id = "playerSaveTrack";
    playerRefs.saveTrack.type = "button";
    playerRefs.saveTrack.className = "btn btn-ghost";
    playerRefs.saveTrack.textContent = "Save";
    controls.insertBefore(playerRefs.saveTrack, playerRefs.addPlaylist);
  }

  playerRefs.actionStatus = playerRefs.root.querySelector(
    "#playerActionStatus",
  );
  if (!playerRefs.actionStatus) {
    playerRefs.actionStatus = document.createElement("p");
    playerRefs.actionStatus.id = "playerActionStatus";
    playerRefs.actionStatus.className = "player-action-status muted";
    playerRefs.root.appendChild(playerRefs.actionStatus);
  }

  // Ensure Prev/Next/Loop buttons exist
  const existingPrev = playerRefs.root.querySelector("#playerPrev");
  const existingNext = playerRefs.root.querySelector("#playerNext");
  const existingLoop = playerRefs.root.querySelector("#playerLoop");

  if (!existingPrev) {
    playerRefs.prev = document.createElement("button");
    playerRefs.prev.id = "playerPrev";
    playerRefs.prev.type = "button";
    playerRefs.prev.className = "btn btn-ghost btn-icon";
    playerRefs.prev.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 20L9 12l10-8v16zM5 19V5h2v14H5z"/></svg>`;
    playerRefs.prev.ariaLabel = "Previous Track";
    controls.insertBefore(playerRefs.prev, playerRefs.toggle);
  } else {
    playerRefs.prev = existingPrev;
  }

  if (!existingNext) {
    playerRefs.next = document.createElement("button");
    playerRefs.next.id = "playerNext";
    playerRefs.next.type = "button";
    playerRefs.next.className = "btn btn-ghost btn-icon";
    playerRefs.next.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4l10 8-10 8V4zM19 5v14h-2V5h2z"/></svg>`;
    playerRefs.next.ariaLabel = "Next Track";
    // Insert after Play/Pause
    controls.insertBefore(playerRefs.next, playerRefs.toggle.nextSibling);
  } else {
    playerRefs.next = existingNext;
  }

  if (!existingLoop) {
    playerRefs.loop = document.createElement("button");
    playerRefs.loop.id = "playerLoop";
    playerRefs.loop.type = "button";
    playerRefs.loop.className = "btn btn-ghost btn-icon";
    playerRefs.loop.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
    playerRefs.loop.ariaLabel = "Loop Mode";
    controls.insertBefore(playerRefs.loop, playerRefs.next.nextSibling);
  } else {
    playerRefs.loop = existingLoop;
  }
}

function normalizeTrack(track) {
  if (!track) return null;
  return {
    id: track.id ?? `${track.title}-${track.artist}`,
    title: safeText(track.title, "Unknown Title"),
    artist: safeText(track.artist, "Unknown Artist"),
    image: safeText(track.image, ""),
    songUrl: safeText(track.songUrl, "#"),
    previewUrl: safeText(track.previewUrl, ""),
    source: safeText(track.source, "search"),
  };
}

function saveCurrentTrack() {
  if (!currentTrack) return;
  localStorage.setItem(PLAYER_TRACK_KEY, JSON.stringify(currentTrack));
}

function loadCurrentTrack() {
  try {
    const raw = localStorage.getItem(PLAYER_TRACK_KEY);
    if (!raw) return null;
    return normalizeTrack(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadQueue() {
  try {
    const rawQueue = localStorage.getItem(QUEUE_KEY);
    const rawIndex = localStorage.getItem(QUEUE_INDEX_KEY);
    const rawLoop = localStorage.getItem(LOOP_MODE_KEY);

    if (rawQueue) {
      currentQueue = JSON.parse(rawQueue).map(normalizeTrack).filter(Boolean);
    }
    if (rawIndex) {
      currentIndex = parseInt(rawIndex, 10);
    }
    if (rawLoop) {
      currentLoopMode = parseInt(rawLoop, 10);
      if (!Object.values(LOOP_MODES).includes(currentLoopMode)) {
        currentLoopMode = LOOP_MODES.OFF;
      }
    }
  } catch (error) {
    console.warn("Failed to load queue from storage", error);
  }
}

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(currentQueue));
    localStorage.setItem(QUEUE_INDEX_KEY, String(currentIndex));
    localStorage.setItem(LOOP_MODE_KEY, String(currentLoopMode));
  } catch (error) {
    console.error("Failed to save queue", error);
  }
}

function updateLoopUi() {
  if (!playerRefs.loop && !playerRefs.miniLoop) return;

  if (playerRefs.loop) {
    playerRefs.loop.classList.remove("active", "loop-one", "loop-all");
  }

  let miniLoopTitle = "Loop: Off";
  let miniLoopIcon = MINI_ICON_LOOP;
  const miniLoopActive = currentLoopMode !== LOOP_MODES.OFF;

  switch (currentLoopMode) {
    case LOOP_MODES.OFF:
      if (playerRefs.loop) {
        playerRefs.loop.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
        playerRefs.loop.style.opacity = "0.6";
        playerRefs.loop.title = "Loop: Off";
      }
      break;
    case LOOP_MODES.ALL:
      if (playerRefs.loop) {
        playerRefs.loop.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
        playerRefs.loop.style.opacity = "1";
        playerRefs.loop.title = "Loop: All";
      }
      miniLoopTitle = "Loop: All";
      break;
    case LOOP_MODES.ONE:
      if (playerRefs.loop) {
        playerRefs.loop.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="10" y="15" font-size="8" fill="var(--accent)" font-weight="bold">1</text></svg>`;
        playerRefs.loop.style.opacity = "1";
        playerRefs.loop.title = "Loop: One";
      }
      miniLoopIcon = MINI_ICON_LOOP_ONE;
      miniLoopTitle = "Loop: One";
      break;
  }

  if (playerRefs.miniLoop) {
    playerRefs.miniLoop.innerHTML = miniLoopIcon;
    playerRefs.miniLoop.title = miniLoopTitle;
    playerRefs.miniLoop.setAttribute("aria-label", miniLoopTitle);
    playerRefs.miniLoop.classList.toggle("is-active", miniLoopActive);
  }
}

function updateNavigationUi() {
  const canLoopAround = currentLoopMode === LOOP_MODES.ALL;
  const disablePrev = currentIndex <= 0 && !canLoopAround;
  const disableNext = currentIndex >= currentQueue.length - 1 && !canLoopAround;

  if (playerRefs.prev) {
    playerRefs.prev.disabled = disablePrev;
  }
  if (playerRefs.miniPrev) {
    playerRefs.miniPrev.disabled = disablePrev;
  }
  if (playerRefs.next) {
    playerRefs.next.disabled = disableNext;
  }
  if (playerRefs.miniNext) {
    playerRefs.miniNext.disabled = disableNext;
  }
}

function updatePlayerUi() {
  const track = currentTrack;
  setImageWithFallback(playerRefs.artwork, track?.image || "", PLACEHOLDER_ART);

  playerRefs.title.textContent = track?.title || "No song selected";
  playerRefs.artist.textContent =
    track?.artist || "Pick any song from songs, artists, or playlists.";

  playerRefs.open.href = track?.songUrl || "#";
  playerRefs.toggle.disabled = !track?.previewUrl;
  if (playerRefs.miniToggle) {
    playerRefs.miniToggle.disabled = !track?.previewUrl;
  }
  if (playerRefs.saveTrack) {
    if (!track) {
      playerRefs.saveTrack.disabled = true;
      playerRefs.saveTrack.textContent = "Save";
    } else {
      const saved = loadTrackCollection(SAVED_TRACKS_KEY);
      const isSaved = collectionHasTrack(saved, track);
      playerRefs.saveTrack.disabled = false;
      playerRefs.saveTrack.textContent = isSaved ? "Saved" : "Save";
    }
  }
  if (playerRefs.addPlaylist) {
    playerRefs.addPlaylist.disabled = !track;
  }
  if (playerRefs.progress) {
    playerRefs.progress.disabled = !track?.previewUrl;
  }

  updateLoopUi();
  updateNavigationUi();

  if (audio.paused) {
    playerRefs.toggle.textContent = "Play";
    if (playerRefs.miniToggle) {
      playerRefs.miniToggle.innerHTML = MINI_ICON_PLAY;
      playerRefs.miniToggle.setAttribute("aria-label", "Play");
    }
    playerRefs.root.classList.remove("is-playing");
  } else {
    playerRefs.toggle.textContent = "Pause";
    if (playerRefs.miniToggle) {
      playerRefs.miniToggle.innerHTML = MINI_ICON_PAUSE;
      playerRefs.miniToggle.setAttribute("aria-label", "Pause");
    }
    playerRefs.root.classList.add("is-playing");
  }

  if (!track?.previewUrl) {
    if (playerRefs.progress) {
      playerRefs.progress.value = "0";
      playerRefs.progress.max = "100";
    }
    if (playerRefs.timeCurrent) playerRefs.timeCurrent.textContent = "0:00";
    if (playerRefs.timeDuration) playerRefs.timeDuration.textContent = "0:00";
  }
}

function playCurrent() {
  if (!currentTrack?.previewUrl) return;
  if (audio.src !== currentTrack.previewUrl) {
    audio.src = currentTrack.previewUrl;
  }
  audio.play().catch(() => {
    // Ignore autoplay/playback errors.
  });
}

function pauseCurrent() {
  audio.pause();
}

function toggleCurrentPlayback() {
  if (!currentTrack?.previewUrl) return;
  if (audio.paused) {
    playCurrent();
  } else {
    pauseCurrent();
  }
}

function setCurrentTrack(track, options = {}) {
  const normalized = normalizeTrack(track);
  if (!normalized) return;

  currentTrack = normalized;
  saveCurrentTrack();

  const shouldAutoplay = options.autoplay === true;
  if (!normalized.previewUrl) {
    audio.pause();
    audio.removeAttribute("src");
    audio.currentTime = 0;
    updatePlayerUi();
    return;
  }

  if (audio.src !== normalized.previewUrl) {
    audio.src = normalized.previewUrl;
    audio.currentTime = 0;
  }

  if (shouldAutoplay) {
    playCurrent();
  } else {
    pauseCurrent();
  }

  updatePlayerUi();
  if (normalized.previewUrl) {
    addToHistory(normalized);
  }
}

function playNext() {
  if (currentLoopMode === LOOP_MODES.ONE) {
    audio.currentTime = 0;
    audio.play().catch(console.error);
    return;
  }

  let nextIndex = currentIndex + 1;
  if (nextIndex >= currentQueue.length) {
    if (currentLoopMode === LOOP_MODES.ALL) {
      nextIndex = 0;
    } else {
      // End of queue, loop off
      return;
    }
  }

  if (currentQueue[nextIndex]) {
    currentIndex = nextIndex;
    setCurrentTrack(currentQueue[nextIndex], { autoplay: true });
    saveQueue();
  }
}

function playPrev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  let prevIndex = currentIndex - 1;
  if (prevIndex < 0) {
    if (currentLoopMode === LOOP_MODES.ALL) {
      prevIndex = currentQueue.length - 1;
    } else {
      // Start of queue
      return;
    }
  }

  if (currentQueue[prevIndex]) {
    currentIndex = prevIndex;
    setCurrentTrack(currentQueue[prevIndex], { autoplay: true });
    saveQueue();
  }
}

function toggleLoop() {
  currentLoopMode = (currentLoopMode + 1) % 3;
  saveQueue(); // Save loop state
  updateLoopUi();
  updateNavigationUi();
}

function setQueue(tracks, startIndex = 0) {
  currentQueue = tracks.map(normalizeTrack).filter(Boolean);
  currentIndex = startIndex;

  // Update internal queue storage
  saveQueue();

  if (currentQueue[currentIndex]) {
    setCurrentTrack(currentQueue[currentIndex], { autoplay: true });
  }

  updateNavigationUi();
}

function syncProgressUi() {
  if (!playerRefs.progress) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

  playerRefs.progress.max = duration > 0 ? String(duration) : "100";
  playerRefs.progress.value = duration > 0 ? String(current) : "0";

  if (playerRefs.timeCurrent)
    playerRefs.timeCurrent.textContent = formatTime(current);
  if (playerRefs.timeDuration)
    playerRefs.timeDuration.textContent = formatTime(duration);
}

function ensureMiniControls(wrap) {
  if (!wrap) return;

  let controls = wrap.querySelector("#playerMiniControls");
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "playerMiniControls";
    controls.className = "player-mini-controls";
    controls.innerHTML = `
      <button id="playerPrevMini" class="btn btn-ghost mini-control" type="button" aria-label="Previous Track" title="Previous Track">${MINI_ICON_PREV}</button>
      <button id="playerToggleMini" class="btn btn-primary mini-control" type="button" aria-label="Play" title="Play">${MINI_ICON_PLAY}</button>
      <button id="playerNextMini" class="btn btn-ghost mini-control" type="button" aria-label="Next Track" title="Next Track">${MINI_ICON_NEXT}</button>
      <button id="playerLoopMini" class="btn btn-ghost mini-control" type="button" aria-label="Loop: Off" title="Loop: Off">${MINI_ICON_LOOP}</button>
    `;
    wrap.appendChild(controls);
  }

  playerRefs.miniControls = controls;
  playerRefs.miniPrev = controls.querySelector("#playerPrevMini");
  playerRefs.miniToggle = controls.querySelector("#playerToggleMini");
  playerRefs.miniNext = controls.querySelector("#playerNextMini");
  playerRefs.miniLoop = controls.querySelector("#playerLoopMini");
}

function ensureProgressUi() {
  let wrap = playerRefs.root.querySelector(".player-progress");
  if (wrap) {
    playerRefs.progress = wrap.querySelector("#playerProgress");
    playerRefs.timeCurrent = wrap.querySelector("#playerCurrentTime");
    playerRefs.timeDuration = wrap.querySelector("#playerDuration");
    ensureMiniControls(wrap);
    return;
  }

  wrap = document.createElement("div");
  wrap.className = "player-progress";
  wrap.innerHTML = `
    <span id="playerCurrentTime">0:00</span>
    <div class="progress-slider-wrap">
      <div class="progress-wave" aria-hidden="true"></div>
      <input id="playerProgress" class="progress-slider" type="range" min="0" max="100" step="0.1" value="0" />
    </div>
    <span id="playerDuration">0:00</span>
  `;

  playerRefs.root.appendChild(wrap);
  playerRefs.progress = wrap.querySelector("#playerProgress");
  playerRefs.timeCurrent = wrap.querySelector("#playerCurrentTime");
  playerRefs.timeDuration = wrap.querySelector("#playerDuration");
  ensureMiniControls(wrap);
}

function initAudioContext() {
  if (audioContext) {
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return;
  }

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256; // 128 bins
    audioSource = audioContext.createMediaElementSource(audio);
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);
  } catch (e) {
    console.warn("AudioContext setup failed (CORS or browser restriction)", e);
  }
}

function initPlayer() {
  if (playerReady) return;

  playerRefs.root = document.querySelector(".top-player");
  playerRefs.artwork = document.querySelector("#playerArtwork");
  playerRefs.title = document.querySelector("#playerTitle");
  playerRefs.artist = document.querySelector("#playerArtist");
  playerRefs.toggle = document.querySelector("#playerToggle");
  playerRefs.open = document.querySelector("#playerOpen");
  playerRefs.volume = document.querySelector("#playerVolume");

  if (!playerRefs.root) {
    throw new Error("Missing top player bar in page markup.");
  }

  ensureProgressUi();
  ensureActionButtons();

  const initialVolume = getStoredVolume();
  audio.volume = initialVolume;
  playerRefs.volume.value = String(initialVolume);

  playerRefs.toggle.addEventListener("click", toggleCurrentPlayback);
  playerRefs.volume.addEventListener("input", () => {
    const value = Number(playerRefs.volume.value);
    audio.volume = value;
    localStorage.setItem(PLAYER_VOLUME_KEY, String(value));
  });
  playerRefs.progress.addEventListener("input", () => {
    const next = Number(playerRefs.progress.value);
    if (Number.isFinite(next) && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, Math.max(0, next));
      syncProgressUi();
    }
  });

  playerRefs.saveTrack.addEventListener("click", () => {
    if (!currentTrack) return;
    const result = addTrackToCollection(SAVED_TRACKS_KEY, currentTrack);
    if (result.added) {
      showActionStatus("Saved");
    } else {
      showActionStatus("Already saved");
    }
    updatePlayerUi();
  });

  playerRefs.addPlaylist.addEventListener("click", () => {
    if (!currentTrack) return;
    const result = addTrackToCollection(CUSTOM_PLAYLIST_KEY, currentTrack);
    if (result.added) {
      showActionStatus("Added to My Playlist");
    } else {
      showActionStatus("Already in My Playlist");
    }
    updatePlayerUi();
  });

  playerRefs.next.addEventListener("click", playNext);
  playerRefs.prev.addEventListener("click", playPrev);
  playerRefs.loop.addEventListener("click", toggleLoop);
  if (playerRefs.miniToggle) {
    playerRefs.miniToggle.addEventListener("click", toggleCurrentPlayback);
  }
  if (playerRefs.miniPrev) {
    playerRefs.miniPrev.addEventListener("click", playPrev);
  }
  if (playerRefs.miniNext) {
    playerRefs.miniNext.addEventListener("click", playNext);
  }
  if (playerRefs.miniLoop) {
    playerRefs.miniLoop.addEventListener("click", toggleLoop);
  }

  audio.addEventListener("play", () => {
    updatePlayerUi();
    initAudioContext(); // Initialize context on user interaction
  });
  audio.addEventListener("pause", updatePlayerUi);
  audio.addEventListener("ended", () => {
    updatePlayerUi();
    playNext();
  });
  audio.addEventListener("timeupdate", syncProgressUi);
  audio.addEventListener("loadedmetadata", syncProgressUi);
  audio.addEventListener("durationchange", syncProgressUi);

  loadQueue(); // Load queue and loop state first
  currentTrack = loadCurrentTrack();
  if (currentTrack?.previewUrl) {
    audio.src = currentTrack.previewUrl;
  }

  // Ensure we are synced if track is in queue
  if (currentTrack && currentQueue.length > 0) {
    const params = new URLSearchParams(window.location.search);
    // Only if we are not navigating to a specific track via URL should we potentially correct index
    if (!params.get("id")) {
      const found = currentQueue.findIndex(
        (t) => trackKey(t) === trackKey(currentTrack),
      );
      if (found !== -1) currentIndex = found;
    }
  }

  updatePlayerUi();
  syncProgressUi();
  playerReady = true;
}

function setActiveNav(navKey) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === navKey);
  });
}

function resolveUrl(base, path) {
  if (!path.startsWith("/")) {
    throw new Error(`Expected API path to start with '/': ${path}`);
  }
  return `${base}${path}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function detectApiBase() {
  const currentOrigin = window.location.origin;
  const candidates = [currentOrigin, ...FALLBACK_PROXY_BASES].filter(
    (value, index, array) => array.indexOf(value) === index,
  );

  for (const origin of candidates) {
    try {
      const response = await fetchWithTimeout(
        `${origin}/health`,
        {},
        HEALTHCHECK_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.ok === true && data?.service === "pulse-music-proxy") {
        return origin === currentOrigin ? "" : origin;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function apiFetch(path) {
  const baseCandidates = [apiBase, "", ...FALLBACK_PROXY_BASES].filter(
    (value, index, array) => array.indexOf(value) === index,
  );

  let lastError = new Error("No backend candidate available.");

  for (const base of baseCandidates) {
    const target = resolveUrl(base, path);
    try {
      const response = await fetchWithTimeout(target);
      if (response.ok) {
        apiBase = base;
        return response.json();
      }
      lastError = new Error(`Request failed: ${response.status} (${target})`);
      if (response.status === 404 || response.status >= 500) {
        continue;
      }
      throw lastError;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("status-error", isError);
}

function createSongCard(track, options = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `song-card glass-card reveal${options.compact ? " compact" : ""}`;
  card.style.setProperty("--delay", `${options.delay ?? 0}ms`);
  card.dataset.trackKey = trackKey(track);

  const imageWrap = document.createElement("div");
  imageWrap.className = "card-art";

  const image = document.createElement("img");
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.alt = `${track.title} artwork`;
  setImageWithFallback(image, track.image, PLACEHOLDER_ART);

  const badge = document.createElement("span");
  badge.className = "card-badge";
  badge.textContent =
    options.badge || (track.source === "trending" ? "Trending" : "Track");

  imageWrap.append(image, badge);

  const title = document.createElement("strong");
  title.textContent = track.title;

  const artist = document.createElement("span");
  artist.className = "muted";
  artist.textContent = track.artist;

  card.append(imageWrap, title, artist);

  card.addEventListener("click", () => {
    if (options.behavior === "play" && typeof options.onSelect === "function") {
      options.onSelect(track, card);
      return;
    }
    if (
      typeof options.onSelect === "function" &&
      options.behavior !== "navigate"
    ) {
      options.onSelect(track, card);
      return;
    }
    openTrackPage(track);
  });

  return card;
}

function createArtistCard(artist, options = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "artist-card glass-card reveal";
  card.style.setProperty("--delay", `${options.delay ?? 0}ms`);

  const image = document.createElement("img");
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.alt = `${artist.name} portrait`;
  setImageWithFallback(image, artist.image, PLACEHOLDER_ARTIST);

  const name = document.createElement("strong");
  name.textContent = artist.name;

  const sub = document.createElement("span");
  sub.className = "muted";
  if (artist.followers) {
    sub.textContent = `${artist.followers.toLocaleString()} followers`;
  } else {
    sub.textContent = options.subText || "Artist";
  }

  card.append(image, name, sub);

  card.addEventListener("click", () => {
    if (typeof options.onSelect === "function") {
      options.onSelect(artist, card);
    }
  });

  return card;
}

// --- SPA Router ---

let activeUnmount = null;

export async function navigateTo(url) {
  if (url === window.location.href) return;

  // 1. Update History
  window.history.pushState(null, "", url);

  // 2. Unmount previous page
  if (activeUnmount) {
    activeUnmount();
    activeUnmount = null;
  }

  // 3. Fetch new Content
  try {
    const response = await fetch(url);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 4. Swap Content
    const newMain = doc.querySelector("main");
    const currentMain = document.querySelector("main");
    if (newMain && currentMain) {
      currentMain.replaceWith(newMain);
    }

    // 5. Update Title
    document.title = doc.title;

    // 6. Update Active Nav
    // Extract filename from URL
    const filename = url.split("/").pop().split("?")[0] || "index.html";
    let navKey = "home";
    if (filename.includes("songs")) navKey = "songs";
    if (filename.includes("artists")) navKey = "artists";
    if (filename.includes("playlists")) navKey = "playlists";

    // Highlight nav
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.classList.toggle(
        "active",
        link.getAttribute("href").includes(filename),
      );
    });

    // 7. Load Module
    // We assume the script is named same as html: songs.html -> songs.js
    const scriptSrc = `./${filename.replace(".html", ".js")}`;

    // Dynamic import to load the new page's logic
    // We append a timestamp to force reload if needed, or rely on browser cache
    const module = await import(`${scriptSrc}?t=${Date.now()}`);

    if (module.mount && window.appInstance) {
      activeUnmount = module.unmount;
      await module.mount(window.appInstance);
    }
  } catch (error) {
    console.error("Navigation failed:", error);
  }
}

export function initRouter(app) {
  window.appInstance = app; // Store globally for router access
  window.HAS_ROUTER = true;

  document.body.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    // Check if internal link
    const href = link.getAttribute("href");
    if (href && href.startsWith("./") && href.endsWith(".html")) {
      e.preventDefault();
      const targetUrl = new URL(href, window.location.href).href;
      navigateTo(targetUrl);
    }
  });

  window.addEventListener("popstate", () => {
    navigateTo(window.location.href);
  });
}

export async function initShell(navKey) {
  initPlayer();
  setActiveNav(navKey);

  const detected = await detectApiBase();
  if (detected !== null) {
    apiBase = detected;
  }

  return {
    apiReady: detected !== null,
    apiFetch,
    setTrack: setCurrentTrack,
    getTrack: () => currentTrack,
    ensureTrack: (track) => {
      if (
        track &&
        (!currentTrack ||
          (!currentTrack.previewUrl && normalizeTrack(track).previewUrl))
      ) {
        setCurrentTrack(track, { autoplay: false });
      }
    },
    setQueue,
    addToQueue: (track) => {
      const norm = normalizeTrack(track);
      if (!norm) return;
      currentQueue.push(norm);
      saveQueue();
      updateNavigationUi();
    },
    getQueue: () => currentQueue,
    playNext,
    playPrev,
    toggleLoop,
    openTrackPage,
    getSavedTracks: () => loadTrackCollection(SAVED_TRACKS_KEY),
    getCustomPlaylistTracks: () => loadTrackCollection(CUSTOM_PLAYLIST_KEY),
    getHistory: () => loadTrackCollection(HISTORY_KEY),
    getAnalyser: () => analyser,
  };

  initRouter(apiShim);
  return apiShim;
}

export {
  PLACEHOLDER_ART,
  PLACEHOLDER_ARTIST,
  createArtistCard,
  createSongCard,
  setImageWithFallback,
  setStatus,
  trackKey,
  normalizeTrack,
  openTrackPage,
  loadTrackCollection,
  SAVED_TRACKS_KEY,
  CUSTOM_PLAYLIST_KEY,
};
