const refs = {
  countrySelect: document.querySelector("#countrySelect"),
  refreshTrending: document.querySelector("#refreshTrending"),
  trendingGrid: document.querySelector("#trendingGrid"),
  resultsGrid: document.querySelector("#resultsGrid"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchStatus: document.querySelector("#searchStatus"),
  trendingStatus: document.querySelector("#trendingStatus"),
  lyricsStatus: document.querySelector("#lyricsStatus"),
  lyricsContent: document.querySelector("#lyricsContent"),
  artistStatus: document.querySelector("#artistStatus"),
  artistName: document.querySelector("#artistName"),
  artistBio: document.querySelector("#artistBio"),
  artistImage: document.querySelector("#artistImage"),
  nowPlayingCard: document.querySelector("#nowPlayingCard"),
  nowPlayingImage: document.querySelector("#nowPlayingImage"),
  nowPlayingTitle: document.querySelector("#nowPlayingTitle"),
  nowPlayingArtist: document.querySelector("#nowPlayingArtist"),
  playPauseBtn: document.querySelector("#playPauseBtn"),
  openLinkBtn: document.querySelector("#openLinkBtn"),
  audioPlayer: document.querySelector("#audioPlayer"),
  volumeSlider: document.querySelector("#volumeSlider"),
  favoritesList: document.querySelector("#favoritesList"),
  favoritesEmpty: document.querySelector("#favoritesEmpty"),
  chips: [...document.querySelectorAll(".chip")],
};

const FAVORITES_STORAGE_KEY = "pulse-music:favorites:v1";
const FALLBACK_PROXY_BASES = ["http://localhost:5501", "http://127.0.0.1:5501"];
const PLACEHOLDER_ARTWORK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2317253a'/%3E%3Cstop offset='1' stop-color='%230d1324'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='640' fill='url(%23g)'/%3E%3Ccircle cx='320' cy='250' r='118' fill='%23334466'/%3E%3Crect x='150' y='430' width='340' height='42' rx='21' fill='%233d5079'/%3E%3C/svg%3E";
const PLACEHOLDER_ARTIST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23232d49'/%3E%3Cstop offset='1' stop-color='%23111728'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='640' fill='url(%23a)'/%3E%3Ccircle cx='320' cy='240' r='110' fill='%234e5f86'/%3E%3Crect x='155' y='390' width='330' height='170' rx='84' fill='%23394b73'/%3E%3C/svg%3E";

const state = {
  trending: [],
  results: [],
  selected: null,
  selectedTrackKey: "",
  favorites: new Map(),
  apiBase: "",
};

const safeText = (value, fallback = "Unknown") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeText = (value) => safeText(value, "").toLowerCase().replace(/\s+/g, " ").trim();

const trackStorageKey = (track) => `${normalizeText(track.artist)}::${normalizeText(track.title)}`;

function setStatus(node, message, isError = false) {
  node.textContent = message;
  node.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setImageWithFallback(element, primarySource, fallbackSource = PLACEHOLDER_ARTWORK) {
  const source = safeText(primarySource, "");
  element.dataset.fallbackApplied = "0";
  element.onerror = () => {
    if (element.dataset.fallbackApplied === "1") return;
    element.dataset.fallbackApplied = "1";
    element.src = fallbackSource;
  };
  element.src = source || fallbackSource;
}

function toAbsoluteUrl(url) {
  return new URL(url, window.location.origin).toString();
}

function isApiRequestUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname === "/health" || parsed.pathname.startsWith("/api/");
}

function buildFallbackUrl(url, fallbackBase) {
  const parsed = new URL(url);
  return `${fallbackBase}${parsed.pathname}${parsed.search}`;
}

async function fetchJson(url) {
  const primaryUrl = toAbsoluteUrl(url);
  let response = await fetch(primaryUrl);
  if (response.ok) {
    return response.json();
  }

  if (response.status === 404 && isApiRequestUrl(primaryUrl)) {
    for (const fallbackBase of FALLBACK_PROXY_BASES) {
      const fallbackUrl = buildFallbackUrl(primaryUrl, fallbackBase);
      if (fallbackUrl === primaryUrl) continue;
      const retryResponse = await fetch(fallbackUrl);
      if (retryResponse.ok) {
        state.apiBase = fallbackBase;
        return retryResponse.json();
      }
    }
  }

  throw new Error(`Request failed: ${response.status} (${primaryUrl})`);
}

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

async function detectApiBase() {
  const currentOrigin = `${window.location.protocol}//${window.location.host}`;
  const candidates = ["", ...FALLBACK_PROXY_BASES]
    .map((base) => (base === "" ? currentOrigin : base))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  for (const candidateOrigin of candidates) {
    const base = candidateOrigin === currentOrigin ? "" : candidateOrigin;
    try {
      const health = await fetchJson(`${candidateOrigin}/health`);
      if (health?.ok === true && health?.service === "pulse-music-proxy") {
        return base;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function setBackendUnavailableState() {
  const message = "Backend not connected. Start server and open http://localhost:5501";
  setStatus(refs.trendingStatus, message, true);
  setStatus(refs.searchStatus, message, true);
  setStatus(refs.lyricsStatus, "Select a track after backend is connected.", true);
  setStatus(refs.artistStatus, "Artist info needs backend connection.", true);
}

function loadFavoritesFromStorage() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((track) => {
      if (track && track.title && track.artist) {
        state.favorites.set(trackStorageKey(track), track);
      }
    });
  } catch (error) {
    console.error(error);
  }
}

function saveFavoritesToStorage() {
  try {
    localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([...state.favorites.values()]),
    );
  } catch (error) {
    console.error(error);
  }
}

function isFavorite(track) {
  return state.favorites.has(trackStorageKey(track));
}

function setFavoriteButtonState(button, track) {
  const on = isFavorite(track);
  button.textContent = on ? "On" : "+";
  button.classList.toggle("is-on", on);
  button.setAttribute("aria-label", on ? "Remove from favorites" : "Add to favorites");
}

function refreshFavoriteButtons() {
  document.querySelectorAll(".fav-btn").forEach((button) => {
    const key = button.dataset.trackKey;
    const on = !!key && state.favorites.has(key);
    button.textContent = on ? "On" : "+";
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-label", on ? "Remove from favorites" : "Add to favorites");
  });
}

function renderFavorites() {
  refs.favoritesList.innerHTML = "";
  const tracks = [...state.favorites.values()];

  refs.favoritesEmpty.style.display = tracks.length ? "none" : "block";

  const frag = document.createDocumentFragment();
  tracks.forEach((track) => {
    const li = document.createElement("li");
    li.className = "favorite-item";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "favorite-open";

    const name = document.createElement("strong");
    name.textContent = track.title;

    const artist = document.createElement("small");
    artist.textContent = track.artist;

    openBtn.append(name, artist);
    openBtn.addEventListener("click", () => selectTrack(track));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "favorite-remove";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${track.title} from favorites`);
    removeBtn.addEventListener("click", () => {
      state.favorites.delete(trackStorageKey(track));
      saveFavoritesToStorage();
      renderFavorites();
      refreshFavoriteButtons();
    });

    li.append(openBtn, removeBtn);
    frag.appendChild(li);
  });

  refs.favoritesList.appendChild(frag);
}

function toggleFavorite(track) {
  const key = trackStorageKey(track);
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
  } else {
    state.favorites.set(key, {
      id: track.id,
      title: track.title,
      artist: track.artist,
      image: track.image,
      songUrl: track.songUrl,
      previewUrl: track.previewUrl,
      source: track.source,
    });
  }
  saveFavoritesToStorage();
  renderFavorites();
  refreshFavoriteButtons();
}

function createTrackCard(track, indexPrefix, onSelect) {
  const card = document.createElement("article");
  card.className = "track-card";
  card.dataset.key = `${indexPrefix}-${track.id}`;
  card.dataset.trackKey = trackStorageKey(track);
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const media = document.createElement("div");
  media.className = "track-media";

  const artwork = document.createElement("img");
  artwork.alt = `${track.title} artwork`;
  artwork.loading = "lazy";
  artwork.referrerPolicy = "no-referrer";
  setImageWithFallback(artwork, track.image, PLACEHOLDER_ARTWORK);

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "fav-btn";
  favBtn.dataset.trackKey = trackStorageKey(track);
  setFavoriteButtonState(favBtn, track);
  favBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(track);
    setFavoriteButtonState(favBtn, track);
  });

  media.append(artwork, favBtn);

  const meta = document.createElement("div");
  meta.className = "track-meta";

  const title = document.createElement("strong");
  title.textContent = track.title;

  const artist = document.createElement("span");
  artist.textContent = track.artist;

  meta.append(title, artist);

  const foot = document.createElement("div");
  foot.className = "track-foot";

  const source = document.createElement("span");
  source.className = "badge";
  source.textContent = track.source === "trending" ? "Trending" : "Search";

  foot.appendChild(source);

  card.append(media, meta, foot);

  card.addEventListener("click", onSelect);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  });

  return card;
}

function highlightActiveTrack() {
  document.querySelectorAll(".track-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.trackKey === state.selectedTrackKey);
  });
}

async function loadTrending(country) {
  setStatus(refs.trendingStatus, "Loading charts...");
  refs.trendingGrid.innerHTML = "";

  try {
    const url = apiUrl(`/api/trending?country=${encodeURIComponent(country)}&limit=24`);
    const data = await fetchJson(url);
    const items = data.items ?? [];

    state.trending = items;
    if (!items.length) {
      setStatus(refs.trendingStatus, "No trending songs returned.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const card = createTrackCard(item, "trending", () => selectTrendingItem(item));
      frag.appendChild(card);
    });

    refs.trendingGrid.appendChild(frag);
    setStatus(refs.trendingStatus, `Loaded ${items.length} trending songs.`);
    highlightActiveTrack();
    refreshFavoriteButtons();
  } catch (error) {
    setStatus(
      refs.trendingStatus,
      "Could not load trending songs right now. Retry in a moment.",
      true,
    );
    console.error(error);
  }
}

async function searchSongs(term) {
  setStatus(refs.searchStatus, "Searching songs...");
  refs.resultsGrid.innerHTML = "";

  const url =
    apiUrl(`/api/search?term=${encodeURIComponent(term)}`) +
    "&country=US&limit=24";

  try {
    const data = await fetchJson(url);
    const items = data.items ?? [];

    state.results = items;
    if (!items.length) {
      setStatus(refs.searchStatus, "No songs found. Try a different query.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const card = createTrackCard(item, "search", () => selectTrack(item));
      frag.appendChild(card);
    });

    refs.resultsGrid.appendChild(frag);
    setStatus(refs.searchStatus, `Found ${items.length} songs.`);
    highlightActiveTrack();
    refreshFavoriteButtons();
  } catch (error) {
    setStatus(
      refs.searchStatus,
      "Search API failed. Check internet/CORS and retry.",
      true,
    );
    console.error(error);
  }
}

async function hydratePreviewFromSearch(seedTrack) {
  const url =
    apiUrl(`/api/hydrate?title=${encodeURIComponent(seedTrack.title)}`) +
    `&artist=${encodeURIComponent(seedTrack.artist)}&country=US`;
  const data = await fetchJson(url);
  const match = data.item;

  if (!match) return seedTrack;
  return {
    ...seedTrack,
    id: match.id ?? seedTrack.id,
    image: match.image || seedTrack.image,
    previewUrl: match.previewUrl || "",
    songUrl: match.songUrl || seedTrack.songUrl,
  };
}

function setNowPlaying(track) {
  setImageWithFallback(refs.nowPlayingImage, track.image, PLACEHOLDER_ARTWORK);
  refs.nowPlayingImage.alt = `${track.title} artwork`;
  refs.nowPlayingTitle.textContent = track.title;
  refs.nowPlayingArtist.textContent = track.artist;
  refs.openLinkBtn.href = track.songUrl || "#";
}

async function loadLyrics(artist, title) {
  setStatus(refs.lyricsStatus, "Loading lyrics...");
  refs.lyricsContent.textContent = "Fetching lyrics...";

  const url =
    apiUrl(`/api/lyrics?artist=${encodeURIComponent(artist)}`) +
    `&title=${encodeURIComponent(title)}`;

  try {
    const data = await fetchJson(url);
    if (!data.lyrics) {
      setStatus(refs.lyricsStatus, "Lyrics unavailable for this song.", true);
      refs.lyricsContent.textContent =
        "Lyrics not found. Try another version of this song from search.";
      return;
    }

    refs.lyricsContent.textContent = data.lyrics;
    setStatus(refs.lyricsStatus, "Lyrics loaded.");
  } catch (error) {
    refs.lyricsContent.textContent =
      "Lyrics endpoint failed for this track. Try another track.";
    setStatus(refs.lyricsStatus, "Lyrics API failed.", true);
    console.error(error);
  }
}

async function loadArtistProfile(artist, fallbackImage) {
  setStatus(refs.artistStatus, "Loading artist profile...");
  refs.artistName.textContent = artist;
  refs.artistBio.textContent = "Fetching artist details...";
  setImageWithFallback(
    refs.artistImage,
    fallbackImage || "",
    fallbackImage || PLACEHOLDER_ARTIST,
  );

  try {
    const profile = await fetchJson(apiUrl(`/api/artist?name=${encodeURIComponent(artist)}`));
    refs.artistName.textContent = profile.title || artist;
    refs.artistBio.textContent =
      profile.extract || "Artist info unavailable right now. Try another selection.";
    setImageWithFallback(
      refs.artistImage,
      profile.image || fallbackImage || "",
      fallbackImage || PLACEHOLDER_ARTIST,
    );
    setStatus(refs.artistStatus, "Artist profile loaded.");
  } catch (error) {
    setStatus(refs.artistStatus, "Artist profile API failed.", true);
    refs.artistBio.textContent =
      "Could not load profile information for this artist.";
    console.error(error);
  }
}

function setEqActive(active) {
  refs.nowPlayingCard
    .querySelectorAll(".eq-bars span")
    .forEach((bar) => (bar.style.animationPlayState = active ? "running" : "paused"));
}

function applyDynamicAccent(imageUrl) {
  if (!imageUrl) return;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;

  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, 24, 24);
      const pixels = ctx.getImageData(0, 0, 24, 24).data;

      let r = 0;
      let g = 0;
      let b = 0;
      const count = pixels.length / 4;

      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
      }

      const avgR = Math.round(r / count);
      const avgG = Math.round(g / count);
      const avgB = Math.round(b / count);

      document.documentElement.style.setProperty(
        "--accent",
        `rgb(${avgR}, ${avgG}, ${avgB})`,
      );
      document.documentElement.style.setProperty(
        "--accent-strong",
        `rgb(${Math.max(avgR - 20, 0)}, ${Math.max(avgG - 20, 0)}, ${Math.max(avgB - 20, 0)})`,
      );
    } catch {
      // Ignore cross-origin canvas restrictions for artwork analysis.
    }
  };
}

async function selectTrack(track) {
  state.selected = track;
  state.selectedTrackKey = trackStorageKey(track);

  setNowPlaying(track);
  highlightActiveTrack();

  refs.playPauseBtn.disabled = !track.previewUrl;
  refs.playPauseBtn.textContent = track.previewUrl ? "Play" : "Preview N/A";

  if (track.previewUrl) {
    refs.audioPlayer.src = track.previewUrl;
    refs.audioPlayer.pause();
    refs.audioPlayer.currentTime = 0;
    setEqActive(false);
  } else {
    refs.audioPlayer.removeAttribute("src");
  }

  await Promise.all([
    loadLyrics(track.artist, track.title),
    loadArtistProfile(track.artist, track.image),
  ]);

  applyDynamicAccent(track.image);
}

async function selectTrendingItem(item) {
  try {
    setStatus(refs.trendingStatus, `Matching preview for "${item.title}"...`);
    const hydrated = await hydratePreviewFromSearch(item);
    setStatus(refs.trendingStatus, `Loaded ${state.trending.length} trending songs.`);
    await selectTrack(hydrated);
  } catch (error) {
    console.error(error);
    setStatus(refs.trendingStatus, "Preview lookup failed for this song.", true);
    await selectTrack(item);
  }
}

function togglePlayPause() {
  if (!state.selected?.previewUrl) return;

  if (refs.audioPlayer.paused) {
    refs.audioPlayer
      .play()
      .then(() => {
        refs.playPauseBtn.textContent = "Pause";
        setEqActive(true);
      })
      .catch((error) => console.error(error));
  } else {
    refs.audioPlayer.pause();
    refs.playPauseBtn.textContent = "Play";
    setEqActive(false);
  }
}

function setupEvents() {
  refs.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = refs.searchInput.value.trim();
    if (!term) return;
    searchSongs(term);
  });

  refs.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const term = chip.dataset.term ?? "";
      refs.searchInput.value = term;
      searchSongs(term);
    });
  });

  refs.countrySelect.addEventListener("change", () => {
    loadTrending(refs.countrySelect.value);
  });

  refs.refreshTrending.addEventListener("click", () => {
    loadTrending(refs.countrySelect.value);
  });

  refs.playPauseBtn.addEventListener("click", togglePlayPause);

  refs.audioPlayer.addEventListener("ended", () => {
    refs.playPauseBtn.textContent = "Play";
    setEqActive(false);
  });

  refs.volumeSlider.addEventListener("input", () => {
    refs.audioPlayer.volume = Number(refs.volumeSlider.value);
  });

  document.addEventListener("keydown", (event) => {
    const isTyping =
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA";

    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      refs.searchInput.focus();
      refs.searchInput.select();
    }

    if (event.code === "Space" && !isTyping) {
      event.preventDefault();
      togglePlayPause();
    }
  });
}

async function boot() {
  setImageWithFallback(refs.nowPlayingImage, "", PLACEHOLDER_ARTWORK);
  setImageWithFallback(refs.artistImage, "", PLACEHOLDER_ARTIST);
  refs.audioPlayer.volume = Number(refs.volumeSlider.value);
  loadFavoritesFromStorage();
  renderFavorites();
  setupEvents();
  const base = await detectApiBase();
  if (!base && base !== "") {
    setBackendUnavailableState();
    return;
  }
  state.apiBase = base ?? "";
  loadTrending(refs.countrySelect.value);
  searchSongs("top hits");
}

boot();
