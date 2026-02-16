import {
  PLACEHOLDER_ARTIST,
  createSongCard,
  initShell,
  setImageWithFallback,
  setStatus,
  trackKey,
} from "./common.js?v=20260216m5";

const refs = {
  country: document.querySelector("#songsCountry"),
  refresh: document.querySelector("#songsRefresh"),
  trendingStatus: document.querySelector("#songsTrendingStatus"),
  trendingGrid: document.querySelector("#songsTrendingGrid"),
  searchForm: document.querySelector("#songSearchForm"),
  searchInput: document.querySelector("#songSearchInput"),
  searchStatus: document.querySelector("#songSearchStatus"),
  searchGrid: document.querySelector("#songsResultsGrid"),
  lyricsStatus: document.querySelector("#songsLyricsStatus"),
  lyrics: document.querySelector("#songsLyrics"),
  artistStatus: document.querySelector("#songsArtistStatus"),
  artistImage: document.querySelector("#songsArtistImage"),
  artistName: document.querySelector("#songsArtistName"),
  artistBio: document.querySelector("#songsArtistBio"),
};

const state = {
  app: null,
  activeTrackKey: "",
};

function applyActiveCards() {
  document.querySelectorAll(".song-card").forEach((card) => {
    card.classList.toggle(
      "active",
      card.dataset.trackKey === state.activeTrackKey,
    );
  });
}

async function ensurePlayableTrack(track) {
  if (track.previewUrl) return track;

  try {
    const data = await state.app.apiFetch(
      `/api/hydrate?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&country=US`,
    );
    if (data.item) {
      return { ...track, ...data.item, source: track.source };
    }
  } catch {
    // Keep original track.
  }

  return track;
}

async function loadLyrics(track) {
  setStatus(refs.lyricsStatus, "Loading lyrics...");
  refs.lyrics.textContent = "Fetching lyrics...";

  try {
    const data = await state.app.apiFetch(
      `/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`,
    );
    if (!data.lyrics) {
      refs.lyrics.textContent = "Lyrics unavailable for this track.";
      setStatus(refs.lyricsStatus, "Lyrics not found.", true);
      return;
    }

    refs.lyrics.textContent = data.lyrics;
    setStatus(refs.lyricsStatus, "Lyrics loaded.");
  } catch (error) {
    refs.lyrics.textContent = "Lyrics failed to load for this track.";
    setStatus(refs.lyricsStatus, "Lyrics API failed.", true);
    console.error(error);
  }
}

async function loadArtistProfile(track) {
  setStatus(refs.artistStatus, "Loading artist profile...");
  refs.artistName.textContent = track.artist;
  refs.artistBio.textContent = "Loading...";
  setImageWithFallback(refs.artistImage, track.image || "", PLACEHOLDER_ARTIST);

  try {
    const profile = await state.app.apiFetch(
      `/api/artist?name=${encodeURIComponent(track.artist)}`,
    );
    refs.artistName.textContent = profile.title || track.artist;
    refs.artistBio.textContent =
      profile.extract || "No artist biography found.";
    setImageWithFallback(
      refs.artistImage,
      profile.image || track.image || "",
      PLACEHOLDER_ARTIST,
    );
    setStatus(refs.artistStatus, "Artist profile loaded.");
  } catch (error) {
    refs.artistBio.textContent = "Could not load artist profile.";
    setStatus(refs.artistStatus, "Artist profile failed.", true);
    console.error(error);
  }
}

async function selectTrack(track, autoplay = true) {
  const playableTrack = await ensurePlayableTrack(track);
  state.activeTrackKey = trackKey(playableTrack);
  applyActiveCards();
  state.app.setTrack(playableTrack, { autoplay });
  await Promise.all([
    loadLyrics(playableTrack),
    loadArtistProfile(playableTrack),
  ]);
}

function renderSongGrid(container, items, badge) {
  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  items.forEach((track, index) => {
    const card = createSongCard(track, {
      badge,
      delay: index * 26,
      onSelect: () => {
        state.app.setQueue(items, index);
        state.app.openTrackPage(track);
      },
    });
    frag.appendChild(card);
  });
  container.appendChild(frag);
  applyActiveCards();
}

async function loadTrending() {
  setStatus(refs.trendingStatus, "Loading songs...");

  try {
    const data = await state.app.apiFetch(
      `/api/trending?country=${encodeURIComponent(refs.country.value)}&limit=24`,
    );
    const items = data.items ?? [];
    if (!items.length) {
      refs.trendingGrid.innerHTML = "";
      setStatus(refs.trendingStatus, "No trending songs available.", true);
      return;
    }

    renderSongGrid(refs.trendingGrid, items, "Trending");
    if (!state.activeTrackKey && items[0]) {
      await selectTrack(items[0], false);
    } else {
      state.app.ensureTrack(items[0]);
    }
    setStatus(refs.trendingStatus, `${items.length} songs loaded.`);
  } catch (error) {
    setStatus(refs.trendingStatus, "Failed to load trending songs.", true);
    console.error(error);
  }
}

async function searchSongs(term) {
  setStatus(refs.searchStatus, "Searching...");

  try {
    const data = await state.app.apiFetch(
      `/api/search?term=${encodeURIComponent(term)}&country=${encodeURIComponent(refs.country.value.toUpperCase())}&limit=24`,
    );
    const items = data.items ?? [];
    if (!items.length) {
      refs.searchGrid.innerHTML = "";
      setStatus(refs.searchStatus, "No tracks found.", true);
      return;
    }

    renderSongGrid(refs.searchGrid, items, "Search");
    if (!state.activeTrackKey) {
      state.app.ensureTrack(items[0]);
    }
    setStatus(refs.searchStatus, `${items.length} tracks found.`);
  } catch (error) {
    setStatus(refs.searchStatus, "Search failed.", true);
    console.error(error);
  }
}

function wireEvents() {
  refs.refresh.addEventListener("click", loadTrending);
  refs.country.addEventListener("change", loadTrending);

  refs.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = refs.searchInput.value.trim();
    if (!term) return;
    searchSongs(term);
  });
}

async function boot() {
  state.app = await initShell("songs");
  wireEvents();

  setImageWithFallback(refs.artistImage, "", PLACEHOLDER_ARTIST);

  if (!state.app.apiReady) {
    setStatus(
      refs.trendingStatus,
      "Backend not connected. Start .\\start-server.ps1",
      true,
    );
    setStatus(
      refs.searchStatus,
      "Backend not connected. Start .\\start-server.ps1",
      true,
    );
    return;
  }

  await Promise.all([loadTrending(), searchSongs("global hits")]);
}

boot();
