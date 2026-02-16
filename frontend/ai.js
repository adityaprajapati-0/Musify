import {
  initShell,
  setStatus,
  createSongCard,
  apiFetch,
} from "./common.js?v=20260216m6";

let audioChunks = [];
let isRecording = false;
let selectedTrack = null;
let cachedReferencePreviewUrl = "";
let cachedReferenceWavBlob = null;
let appInstance = null;
const LYRICS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LYRICS_NEGATIVE_CACHE_TTL_MS = 90 * 1000;
const LYRICS_CACHE_MAX = 200;
const LYRICS_PROVIDER_TIMEOUT_MS = 5000;
const BACKEND_LYRICS_TIMEOUT_MS = 8500;
const LYRICS_LOCAL_STORAGE_KEY = "pulse.music.lyrics.cache.v5";
const lyricsCache = new Map();
const lyricsInFlight = new Map();
let latestLyricsRequestToken = 0;
let latestSelectionToken = 0;
let lyricsStorageLoaded = false;
const JUDGE_TARGET_SR = 16000;
const JUDGE_MAX_SECONDS = 24;
const JUDGE_SILENCE_THRESHOLD = 0.007;

const refs = {};

function initRefs() {
  refs.recordBtn = document.querySelector("#recordBtn");
  refs.status = document.querySelector("#aiStatus");
  refs.stats = document.querySelector("#statsResult");
  refs.feedback = document.querySelector("#aiFeedback");
  refs.feedbackText = document.querySelector("#feedbackText");
  refs.audio = document.querySelector("#judgeVoice");
  refs.scorePitch = document.querySelector("#scorePitch");
  refs.scoreTiming = document.querySelector("#scoreTiming");
  refs.scoreStability = document.querySelector("#scoreStability");

  // Selection UI
  refs.searchForm = document.querySelector("#aiSearchForm");
  refs.searchInput = document.querySelector("#aiSearchInput");
  refs.grid = document.querySelector("#aiSelectionGrid");
  refs.selectedDisplay = document.querySelector("#selectedTrackDisplay");
  refs.selectedImg = document.querySelector("#selectedTrackImg");
  refs.selectedTitle = document.querySelector("#selectedTrackTitle");
  refs.selectedArtist = document.querySelector("#selectedTrackArtist");
  refs.clearBtn = document.querySelector("#clearSelection");
  refs.lyricsCoach = document.querySelector("#lyricsCoach");
  refs.lyricsStatus = document.querySelector("#aiLyricsStatus");
  refs.lyrics = document.querySelector("#aiLyrics");
  refs.practiceZone = document.querySelector("#aiPracticeZone");
  refs.boothBgArt = document.querySelector("#boothBgArt");
}

function lyricsCacheKey(track) {
  const artist = String(track?.artist || "")
    .trim()
    .toLowerCase();
  const title = String(track?.title || "")
    .trim()
    .toLowerCase();
  return `${artist}::${title}`;
}

function loadLyricsCacheFromStorage() {
  if (lyricsStorageLoaded) return;
  lyricsStorageLoaded = true;

  try {
    const raw = localStorage.getItem(LYRICS_LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    parsed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return;
      const [key, payload] = entry;
      if (!key || !payload || payload.expiresAt <= now) return;
      lyricsCache.set(key, payload);
    });
  } catch {
    // Ignore corrupted cache entries.
  }
}

function persistLyricsCacheToStorage() {
  try {
    const now = Date.now();
    const entries = [];
    for (const [key, value] of lyricsCache.entries()) {
      if (!value || value.expiresAt <= now) continue;
      if (!String(value?.data?.lyrics || "").trim()) continue;
      entries.push([key, value]);
      if (entries.length >= LYRICS_CACHE_MAX) break;
    }
    localStorage.setItem(LYRICS_LOCAL_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage may be unavailable.
  }
}

function getCachedLyrics(cacheKey) {
  loadLyricsCacheFromStorage();
  const cached = lyricsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    lyricsCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function setCachedLyrics(cacheKey, data) {
  loadLyricsCacheFromStorage();
  const hasLyrics = Boolean(String(data?.lyrics || "").trim());
  const ttlMs = hasLyrics ? LYRICS_CACHE_TTL_MS : LYRICS_NEGATIVE_CACHE_TTL_MS;

  lyricsCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttlMs,
  });

  while (lyricsCache.size > LYRICS_CACHE_MAX) {
    const oldestKey = lyricsCache.keys().next().value;
    if (!oldestKey) break;
    lyricsCache.delete(oldestKey);
  }

  persistLyricsCacheToStorage();
}

function normalizeLyricsQuery(text) {
  return String(text || "")
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+-.*$/g, "")
    .replace(/\s*feat\..*$/gi, "")
    .trim();
}

function pushUniqueInsensitive(target, value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return;
  if (!target.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
    target.push(cleaned);
  }
}

function splitArtistCandidates(text) {
  return String(text || "")
    .replace(/\b(feat\.?|ft\.?)\b/gi, ",")
    .replace(/\band\b/gi, ",")
    .replace(/[&/|xX]/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractFeaturedArtists(title) {
  const candidates = [];
  const raw = String(title || "");
  const patterns = [
    /\((?:feat\.?|ft\.?)\s*([^)]+)\)/gi,
    /(?:feat\.?|ft\.?)\s*([^\-\]\)]+)/gi,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      splitArtistCandidates(match[1]).forEach((artist) => {
        pushUniqueInsensitive(candidates, artist);
      });
    }
  });

  return candidates;
}

function buildArtistCandidates(track) {
  const candidates = [];
  const rawArtist = String(track?.artist || "");
  const normalizedArtist = normalizeLyricsQuery(rawArtist);
  pushUniqueInsensitive(candidates, normalizedArtist);
  pushUniqueInsensitive(candidates, rawArtist);

  splitArtistCandidates(rawArtist).forEach((artist) => {
    pushUniqueInsensitive(candidates, normalizeLyricsQuery(artist));
    pushUniqueInsensitive(candidates, artist);
  });

  extractFeaturedArtists(track?.title || "").forEach((artist) => {
    pushUniqueInsensitive(candidates, normalizeLyricsQuery(artist));
    pushUniqueInsensitive(candidates, artist);
  });

  return candidates.slice(0, 6);
}

function buildTitleCandidates(track) {
  const candidates = [];
  const rawTitle = String(track?.title || "");
  const normalizedTitle = normalizeLyricsQuery(rawTitle);
  const noAposTitle = normalizedTitle.replace(/['\u2019]/g, "");

  pushUniqueInsensitive(candidates, normalizedTitle);
  pushUniqueInsensitive(candidates, rawTitle);
  pushUniqueInsensitive(candidates, noAposTitle);
  pushUniqueInsensitive(candidates, normalizedTitle.split(":")[0]?.trim());
  pushUniqueInsensitive(candidates, normalizedTitle.split("/")[0]?.trim());

  return candidates.slice(0, 5);
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function areTitlesSimilar(expected, actual) {
  const a = normalizeForCompare(expected);
  const b = normalizeForCompare(actual);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function extractLyricsFromMatch(match) {
  const plain = String(match?.plainLyrics || "").trim();
  if (plain) return plain;

  const synced = String(match?.syncedLyrics || "").trim();
  if (!synced) return "";
  return synced.replace(/\[[0-9]{1,2}:[0-9]{2}(?:\.[0-9]{1,3})?\]/g, "").trim();
}

async function fetchJsonWithTimeout(
  url,
  timeoutMs = LYRICS_PROVIDER_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Lyrics provider failed: ${response.status}`);
    }
    return response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function promiseWithTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function fetchLyricsDirect(track) {
  const artistCandidates = buildArtistCandidates(track);
  const titleCandidates = buildTitleCandidates(track);
  const primaryArtist = artistCandidates[0];
  const primaryTitle = titleCandidates[0];
  if (!primaryArtist || !primaryTitle) {
    throw new Error("Missing artist/title for direct lyrics lookup.");
  }

  const queryTasks = [];
  const addLrcTask = (url, source) => {
    queryTasks.push(() =>
      fetchJsonWithTimeout(url).then((payload) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          const lyrics = extractLyricsFromMatch(row);
          if (lyrics) {
            return { lyrics, source };
          }
        }
        throw new Error("No lyrics in direct provider response.");
      }),
    );
  };
  const addOvhTask = (artist, title) => {
    queryTasks.push(() =>
      fetchJsonWithTimeout(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
        Math.max(1600, LYRICS_PROVIDER_TIMEOUT_MS + 500),
      ).then((payload) => {
        const lyrics = String(payload?.lyrics || "").trim();
        if (!lyrics) {
          throw new Error("No lyrics from lyrics.ovh");
        }
        return { lyrics, source: `lyrics.ovh-direct:${artist}` };
      }),
    );
  };

  const fetchLyricsFromSuggest = async () => {
    const payload = await fetchJsonWithTimeout(
      `https://api.lyrics.ovh/suggest/${encodeURIComponent(primaryTitle)}`,
      Math.max(2400, LYRICS_PROVIDER_TIMEOUT_MS + 900),
    );
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) {
      throw new Error("No suggest hits");
    }

    const suggestArtists = [];
    for (const row of rows) {
      const rowTitle = String(row?.title || "");
      const titleMatched = titleCandidates.some((candidate) =>
        areTitlesSimilar(candidate, rowTitle),
      );
      if (!titleMatched) continue;
      pushUniqueInsensitive(suggestArtists, row?.artist?.name);
      if (suggestArtists.length >= 10) break;
    }

    if (!suggestArtists.length) {
      rows.slice(0, 10).forEach((row) => {
        pushUniqueInsensitive(suggestArtists, row?.artist?.name);
      });
    }

    for (const suggestArtist of suggestArtists) {
      for (const candidateTitle of titleCandidates.slice(0, 3)) {
        try {
          const payloadOvh = await fetchJsonWithTimeout(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(suggestArtist)}/${encodeURIComponent(candidateTitle)}`,
            Math.max(1800, LYRICS_PROVIDER_TIMEOUT_MS + 700),
          );
          const lyrics = String(payloadOvh?.lyrics || "").trim();
          if (lyrics) {
            return {
              lyrics,
              source: `lyrics.ovh-suggest-direct:${suggestArtist}`,
            };
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    throw new Error("No lyrics from suggest fallback");
  };

  addLrcTask(
    `https://lrclib.net/api/get?artist=${encodeURIComponent(primaryArtist)}&track=${encodeURIComponent(primaryTitle)}`,
    "lrclib-direct-primary-get",
  );
  addLrcTask(
    `https://lrclib.net/api/search?artist=${encodeURIComponent(primaryArtist)}&track=${encodeURIComponent(primaryTitle)}`,
    "lrclib-direct-primary-search",
  );
  addLrcTask(
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${primaryArtist} ${primaryTitle}`)}`,
    "lrclib-direct-primary-q",
  );
  addLrcTask(
    `https://lrclib.net/api/search?q=${encodeURIComponent(primaryTitle)}`,
    "lrclib-direct-title-only",
  );

  artistCandidates.slice(1, 4).forEach((candidateArtist) => {
    addLrcTask(
      `https://lrclib.net/api/search?artist=${encodeURIComponent(candidateArtist)}&track=${encodeURIComponent(primaryTitle)}`,
      "lrclib-direct-alt-artist-search",
    );
  });

  titleCandidates.slice(1, 3).forEach((candidateTitle) => {
    addLrcTask(
      `https://lrclib.net/api/search?artist=${encodeURIComponent(primaryArtist)}&track=${encodeURIComponent(candidateTitle)}`,
      "lrclib-direct-title-variant-search",
    );
    addLrcTask(
      `https://lrclib.net/api/search?q=${encodeURIComponent(candidateTitle)}`,
      "lrclib-direct-title-variant-q",
    );
  });

  artistCandidates.slice(0, 3).forEach((candidateArtist) => {
    titleCandidates.slice(0, 2).forEach((candidateTitle) => {
      addOvhTask(candidateArtist, candidateTitle);
    });
  });

  queryTasks.push(() => fetchLyricsFromSuggest());

  return Promise.any(queryTasks.map((task) => task()));
}

async function fetchLyricsData(track) {
  if (!appInstance || !track) return { lyrics: "", source: "none" };
  const cacheKey = lyricsCacheKey(track);
  const cached = getCachedLyrics(cacheKey);
  if (cached?.lyrics) {
    return { ...cached, cached: true };
  }

  if (!lyricsInFlight.has(cacheKey)) {
    lyricsInFlight.set(
      cacheKey,
      (async () => {
        const backendPromise = promiseWithTimeout(
          appInstance.apiFetch(
            `/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`,
          ),
          BACKEND_LYRICS_TIMEOUT_MS,
        ).then((data) => ({
          lyrics: String(data?.lyrics || "").trim(),
          source: data?.source || "backend",
          cached: Boolean(data?.cached),
        }));

        const directPromise = fetchLyricsDirect(track).catch(() => null);

        let result = null;
        try {
          result = await Promise.any([
            backendPromise.then((data) => {
              if (!data.lyrics) throw new Error("Backend returned no lyrics");
              return data;
            }),
            directPromise.then((data) => {
              if (!data?.lyrics)
                throw new Error("Direct provider returned no lyrics");
              return data;
            }),
          ]);
        } catch {
          // Fall back to whichever finishes with data.
        }

        if (!result) {
          const backendData = await backendPromise.catch(() => null);
          if (backendData?.lyrics) {
            result = backendData;
          }
        }

        if (!result) {
          const directData = await directPromise;
          if (directData?.lyrics) {
            result = directData;
          }
        }

        if (!result) {
          result = { lyrics: "", source: "none" };
        }

        setCachedLyrics(cacheKey, result);
        return result;
      })().finally(() => {
        lyricsInFlight.delete(cacheKey);
      }),
    );
  }

  return lyricsInFlight.get(cacheKey);
}

function warmLyricsCache(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  tracks.slice(0, 6).forEach((track) => {
    void fetchLyricsData(track).catch(() => {});
  });
}

async function ensurePlayableTrack(track) {
  if (!appInstance || track.previewUrl) return track;
  try {
    const data = await appInstance.apiFetch(
      `/api/hydrate?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&country=US`,
    );
    if (data.item) {
      return { ...track, ...data.item, source: track.source };
    }
  } catch (error) {
    console.warn("Could not hydrate preview URL for selected track.", error);
  }
  return track;
}

async function loadLyrics(track) {
  if (!refs.lyrics || !appInstance || !track) return;

  const requestToken = ++latestLyricsRequestToken;
  const cacheKey = lyricsCacheKey(track);
  const cached = getCachedLyrics(cacheKey);
  if (cached?.lyrics) {
    refs.lyrics.textContent = cached.lyrics;
    if (refs.lyricsStatus) setStatus(refs.lyricsStatus, "Lyrics loaded.");
    return;
  }

  if (refs.lyricsStatus) setStatus(refs.lyricsStatus, "Loading lyrics...");
  refs.lyrics.textContent = "Fetching lyrics...";

  try {
    const data = await fetchLyricsData(track);
    if (requestToken !== latestLyricsRequestToken) return;

    if (!data.lyrics) {
      refs.lyrics.textContent = "Lyrics unavailable for this track.";
      if (refs.lyricsStatus)
        setStatus(refs.lyricsStatus, "Lyrics not found.", true);
      return;
    }

    refs.lyrics.textContent = data.lyrics;
    if (refs.lyricsStatus) setStatus(refs.lyricsStatus, "Lyrics loaded.");
  } catch (error) {
    if (requestToken !== latestLyricsRequestToken) return;
    refs.lyrics.textContent = "Could not load lyrics for this track.";
    if (refs.lyricsStatus)
      setStatus(refs.lyricsStatus, "Lyrics API failed.", true);
    console.error(error);
  }
}

async function searchSongs(term) {
  if (!appInstance) return;
  refs.status.textContent = "Searching songs...";
  try {
    const data = await appInstance.apiFetch(
      `/api/search?term=${encodeURIComponent(term)}&limit=10`,
    );
    const items = data.items ?? [];
    renderSelectionGrid(items);
    warmLyricsCache(items);
    refs.status.textContent = items.length
      ? "Found some options!"
      : "No songs found.";
  } catch (err) {
    console.error(err);
    refs.status.textContent = "Search failed.";
  }
}

function renderSelectionGrid(tracks) {
  refs.grid.innerHTML = "";
  tracks.forEach((track) => {
    const card = createSongCard(track, {
      compact: true,
      onSelect: () => selectTrack(track),
    });
    // Add a "Choose" overlay or icon if needed, but onSelect is enough
    refs.grid.appendChild(card);
  });
}

async function selectTrack(track) {
  const selectionToken = ++latestSelectionToken;
  selectedTrack = track;
  cachedReferencePreviewUrl = "";
  cachedReferenceWavBlob = null;
  refs.selectedImg.src = track.image || "./music logo.png";
  if (refs.boothBgArt) refs.boothBgArt.src = track.image || "./music logo.png";
  refs.selectedTitle.textContent = track.title;
  refs.selectedArtist.textContent = track.artist;

  refs.selectedDisplay?.classList.remove("hidden-el");
  refs.grid.classList.add("hidden-el");
  refs.searchForm.parentElement.classList.add("hidden-el");
  refs.practiceZone?.classList.add("visible");

  refs.status.textContent = "Song selected. Practice with lyrics, then record.";
  loadLyrics(track);

  if (typeof appInstance?.setTrack === "function") {
    appInstance.setTrack(track, { autoplay: false });
  }

  const playableTrack = await ensurePlayableTrack(track);
  if (selectionToken !== latestSelectionToken) return;

  selectedTrack = playableTrack;
  refs.selectedImg.src = playableTrack.image || "./music logo.png";
  if (refs.boothBgArt)
    refs.boothBgArt.src = playableTrack.image || "./music logo.png";

  if (typeof appInstance?.setTrack === "function") {
    appInstance.setTrack(playableTrack, { autoplay: false });
  }

  // Warm reference processing now so judge starts faster later.
  void getReferenceWavBlob(playableTrack).catch(() => {});
}

function clearSelection() {
  latestSelectionToken += 1;
  latestLyricsRequestToken += 1;
  selectedTrack = null;
  cachedReferencePreviewUrl = "";
  cachedReferenceWavBlob = null;
  refs.selectedDisplay?.classList.add("hidden-el");
  refs.grid?.classList.remove("hidden-el");
  if (refs.searchForm?.parentElement) {
    refs.searchForm.parentElement.classList.remove("hidden-el");
  }
  refs.practiceZone?.classList.remove("visible");
  if (refs.lyrics) {
    refs.lyrics.textContent = "No lyrics loaded yet.";
  }
  if (refs.lyricsStatus) {
    refs.lyricsStatus.textContent = "";
  }
  refs.status.textContent = "Select a song above to start coaching.";

  // Reset results
  refs.stats.classList.add("hidden-el");
  refs.feedback.classList.remove("visible");
}

// --- Audio Recording Logic ---
let audioContext;
let mediaStream;
let processor;
let sourceNode;
let recorderNode;
let recordingData = [];
let recordingLength = 0;
let sampleRate = 44100;

function trimSilence(samples, sr) {
  if (!samples?.length) return new Float32Array();
  let start = 0;
  let end = samples.length - 1;

  while (start < samples.length && Math.abs(samples[start]) < JUDGE_SILENCE_THRESHOLD) {
    start += 1;
  }
  while (end > start && Math.abs(samples[end]) < JUDGE_SILENCE_THRESHOLD) {
    end -= 1;
  }

  if (start >= end) {
    return samples;
  }

  const pad = Math.floor(sr * 0.08);
  const safeStart = Math.max(0, start - pad);
  const safeEnd = Math.min(samples.length, end + pad);
  return samples.slice(safeStart, safeEnd);
}

function limitDuration(samples, sr, maxSeconds = JUDGE_MAX_SECONDS) {
  const maxSamples = Math.floor(maxSeconds * sr);
  if (samples.length <= maxSamples) return samples;
  return samples.slice(0, maxSamples);
}

function resampleLinear(samples, inSr, outSr) {
  if (!samples?.length) return new Float32Array();
  if (!inSr || !outSr || inSr === outSr) return samples;

  const ratio = outSr / inSr;
  const outLength = Math.max(1, Math.floor(samples.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i / ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    out[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return out;
}

function normalizePeak(samples) {
  if (!samples?.length) return samples;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  if (peak < 1e-5) return samples;
  const gain = 0.92 / peak;
  if (gain >= 0.99 && gain <= 1.01) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

function prepareAudioForJudge(samples, sr) {
  let next = trimSilence(samples, sr);
  next = limitDuration(next, sr);
  next = resampleLinear(next, sr, JUDGE_TARGET_SR);
  next = normalizePeak(next);
  return { samples: next, sampleRate: JUDGE_TARGET_SR };
}

function prepareReferenceForJudge(samples, sr) {
  let next = limitDuration(samples, sr, 30);
  next = resampleLinear(next, sr, JUDGE_TARGET_SR);
  return { samples: next, sampleRate: JUDGE_TARGET_SR };
}

function setupScriptProcessorFallback(source) {
  processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    if (!isRecording) return;
    const channelData = e.inputBuffer.getChannelData(0);
    recordingData.push(new Float32Array(channelData));
    recordingLength += channelData.length;
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate = audioContext.sampleRate;

    // Create Source
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    recordingData = [];
    recordingLength = 0;

    if (audioContext.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await audioContext.audioWorklet.addModule(
          "./ai-recorder-worklet.js?v=20260216a",
        );
        recorderNode = new AudioWorkletNode(
          audioContext,
          "pcm-recorder-worklet",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            outputChannelCount: [1],
          },
        );
        recorderNode.port.onmessage = (event) => {
          if (!isRecording) return;
          const chunk = event.data;
          if (!chunk || !chunk.length) return;
          recordingData.push(new Float32Array(chunk));
          recordingLength += chunk.length;
        };
        sourceNode.connect(recorderNode);
        recorderNode.connect(audioContext.destination);
      } catch (workletError) {
        console.warn(
          "AudioWorklet unavailable; falling back to ScriptProcessorNode.",
          workletError,
        );
        setupScriptProcessorFallback(sourceNode);
      }
    } else {
      setupScriptProcessorFallback(sourceNode);
    }

    isRecording = true;
    updateUiState("recording");
  } catch (err) {
    console.error("Mic Error:", err);
    refs.status.textContent = "Microphone access denied.";
  }
}

function stopRecording() {
  if (isRecording) {
    isRecording = false;

    // Cleanup
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {}
      sourceNode = null;
    }
    if (recorderNode) {
      recorderNode.port.onmessage = null;
      recorderNode.disconnect();
      recorderNode = null;
    }
    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    updateUiState("processing");
    processWavRecording();
  }
}

function processWavRecording() {
  // Flatten buffer
  const buffer = mergeBuffers(recordingData, recordingLength);
  const prepared = prepareAudioForJudge(buffer, sampleRate);
  // Encode WAV
  const wavBlob = encodeWAV(prepared.samples, prepared.sampleRate);

  uploadAudio(wavBlob);
}

function mergeBuffers(channelBuffer, recordingLength) {
  const result = new Float32Array(recordingLength);
  let offset = 0;
  for (let i = 0; i < channelBuffer.length; i++) {
    result.set(channelBuffer[i], offset);
    offset += channelBuffer[i].length;
  }
  return result;
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // RIFF chunk length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, "WAVE");
  // format chunk identifier
  writeString(view, 12, "fmt ");
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, "data");
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  // write the PCM samples
  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: "audio/wav" });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function audioBufferToMonoFloat32(audioBuffer) {
  const channels = audioBuffer.numberOfChannels || 1;
  const length = audioBuffer.length;
  if (channels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

async function getReferenceWavBlob(track) {
  const previewUrl = (track?.previewUrl || "").trim();
  if (!previewUrl) return null;

  if (cachedReferenceWavBlob && cachedReferencePreviewUrl === previewUrl) {
    return cachedReferenceWavBlob;
  }

  let decodeContext = null;
  try {
    const response = await fetch(previewUrl, { mode: "cors" });
    if (!response.ok) return null;

    const sourceBytes = await response.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    decodeContext = new AudioCtx();
    const decodedBuffer = await decodeContext.decodeAudioData(
      sourceBytes.slice(0),
    );
    const mono = audioBufferToMonoFloat32(decodedBuffer);
    const prepared = prepareReferenceForJudge(mono, decodedBuffer.sampleRate);
    const wavBlob = encodeWAV(prepared.samples, prepared.sampleRate);

    cachedReferencePreviewUrl = previewUrl;
    cachedReferenceWavBlob = wavBlob;
    return wavBlob;
  } catch (error) {
    console.warn("Could not prepare reference preview as WAV.", error);
    return null;
  } finally {
    if (decodeContext) {
      decodeContext.close().catch(() => {});
    }
  }
}

async function buildJudgeFormData(audioBlob, includeReference = true) {
  const formData = new FormData();
  formData.append("file", audioBlob, "user.wav");
  formData.append("fast_mode", "1");
  formData.append("include_tts", "0");
  formData.append("include_llm", "0");

  if (includeReference && selectedTrack) {
    const referenceWavBlob = await getReferenceWavBlob(selectedTrack);
    if (referenceWavBlob) {
      formData.append("reference_file", referenceWavBlob, "reference.wav");
    } else {
      // Fallback when browser decode is unavailable.
      formData.append("reference_url", selectedTrack.previewUrl || "");
    }
    formData.append("reference_title", selectedTrack.title);
    formData.append("reference_artist", selectedTrack.artist);
  }
  return formData;
}

function parseJudgeError(data) {
  let msg =
    data.error ||
    (data.detail ? JSON.stringify(data.detail) : null) ||
    "Judge backend error";
  if (
    (!msg || msg === "Judge backend error") &&
    typeof data.traceback === "string" &&
    data.traceback.includes("NoBackendError")
  ) {
    msg =
      "Audio decode backend missing for one of the files. Try a different song preview or install ffmpeg on the AI backend.";
  }

  const normalized = [
    msg,
    typeof data.detail === "string" ? data.detail : "",
    typeof data.traceback === "string" ? data.traceback : "",
  ]
    .join(" ")
    .toLowerCase();

  const isDecodeBackendIssue =
    normalized.includes("nobackenderror") ||
    normalized.includes("audioread") ||
    normalized.includes("install ffmpeg") ||
    normalized.includes("could not read audio file");

  return { msg, isDecodeBackendIssue };
}

async function postJudge(audioBlob, includeReference = true) {
  const formData = await buildJudgeFormData(audioBlob, includeReference);
  // Using apiFetch ensures we use the correct backend URL (proxy or direct)
  return apiFetch("/api/ai/judge", {
    method: "POST",
    body: formData,
    returnResponse: true, // Request full response object for error handling
    timeout: 180000, // cold AI backends can take >60s to wake
  });
}

async function uploadAudio(audioBlob) {
  let retriedWithoutReference = false;

  try {
    setStatus(
      refs.status,
      "Analyzing... This might take a minute if the server is waking up.",
    );

    // Helper to show "Waking up..." message if it takes too long
    const wakeUpTimer = setTimeout(() => {
      setStatus(
        refs.status,
        "Server is waking up from sleep... please wait...",
      );
    }, 6000);

    let response = await postJudge(audioBlob, true);
    clearTimeout(wakeUpTimer);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `Backend Error (${response.status} ${response.statusText}):`,
        text,
      );

      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        // Not JSON (likely HTML error from Render or 502 proxy)
        data = {
          error: `Server Error (${response.status})`,
          detail: text.slice(0, 200),
        };
      }

      const parsed = parseJudgeError(data);

      if (selectedTrack && parsed.isDecodeBackendIssue) {
        retriedWithoutReference = true;
        refs.status.textContent =
          "Reference preview format unsupported. Retrying with vocal-only judging...";
        response = await postJudge(audioBlob, false);
        if (!response.ok) {
          const retryText = await response.text().catch(() => "");
          console.error(`Backend Retry Error (${response.status}):`, retryText);
          let retryData = {};
          try {
            retryData = JSON.parse(retryText);
          } catch {
            retryData = { error: "Retry failed", detail: retryText };
          }
          const retryParsed = parseJudgeError(retryData);
          throw new Error(retryParsed.msg);
        }
      } else {
        throw new Error(parsed.msg);
      }
    }

    const result = await response.json();
    if (retriedWithoutReference) {
      result.reference_used = false;
      result.reference_warning =
        result.reference_warning ||
        "Reference preview could not be decoded, so this score uses your vocal recording only.";
    }
    displayResults(result, audioBlob);
  } catch (error) {
    console.error("Judge Failure:", error);
    refs.status.textContent = `Error: ${error.message}`;
    updateUiState("idle");
  }
}

async function displayResults(data, userBlob) {
  refs.stats.classList.remove("hidden-el");
  updateUiState("idle");

  if (userBlob) {
    const reader = new FileReader();
    reader.onloadend = () => {
      data.userAudio = reader.result;
      localStorage.setItem("singingFeedback", JSON.stringify(data));
      window.location.href = "/feedback.html";
    };
    reader.readAsDataURL(userBlob);
  } else {
    localStorage.setItem("singingFeedback", JSON.stringify(data));
    window.location.href = "/feedback.html";
  }
}

function updateUiState(state) {
  if (state === "recording") {
    refs.recordBtn.classList.add("recording");
    refs.status.textContent = "Listening... Sing!";
  } else if (state === "processing") {
    refs.recordBtn.classList.remove("recording");
    refs.status.textContent = "Judging your performance...";
  } else {
    refs.recordBtn.classList.remove("recording");
  }
}

export async function mount(app) {
  appInstance = app;
  initRefs();

  refs.recordBtn?.addEventListener("click", () => {
    if (isRecording) stopRecording();
    else startRecording();
  });

  refs.searchForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const term = refs.searchInput.value.trim();
    if (term) searchSongs(term);
  });

  refs.clearBtn?.addEventListener("click", clearSelection);

  // Initial trending options
  searchSongs("trending hits");
}

export function unmount() {
  if (isRecording) stopRecording();
}

if (!window.HAS_ROUTER) {
  initShell("ai").then((app) => mount(app));
}
