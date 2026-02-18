import {
  PLACEHOLDER_ART,
  PLACEHOLDER_ARTIST,
  createSongCard,
  initShell,
  normalizeTrack,
  setImageWithFallback,
  setStatus,
} from "./common.js?v=20260218m7";

const refs = {
  cover: document.querySelector("#trackCover"),
  title: document.querySelector("#trackTitle"),
  artist: document.querySelector("#trackArtist"),
  external: document.querySelector("#trackExternal"),
  lyricsStatus: document.querySelector("#trackLyricsStatus"),
  lyrics: document.querySelector("#trackLyrics"),
  artistStatus: document.querySelector("#trackArtistStatus"),
  artistImage: document.querySelector("#trackArtistImage"),
  artistName: document.querySelector("#trackArtistName"),
  artistBio: document.querySelector("#trackArtistBio"),
  relatedGrid: document.querySelector("#trackRelatedGrid"),
};

const state = {
  app: null,
  track: null,
};

function trackFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get("title");
  const artist = params.get("artist");
  if (!title || !artist) return null;

  return normalizeTrack({
    id: params.get("id") || "",
    title,
    artist,
    image: params.get("image") || "",
    songUrl: params.get("songUrl") || "#",
    previewUrl: params.get("previewUrl") || "",
    source: params.get("source") || "track-page",
  });
}

async function hydrateTrackIfNeeded(track) {
  if (track.previewUrl) return track;

  try {
    const data = await state.app.apiFetch(
      `/api/hydrate?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&country=US`,
    );
    if (data.item) {
      return normalizeTrack({ ...track, ...data.item, source: track.source });
    }
  } catch {
    // Ignore hydrate failures and keep original.
  }
  return track;
}

function renderHeader(track) {
  refs.title.textContent = track.title;
  refs.artist.textContent = track.artist;
  refs.external.href = track.songUrl || "#";
  setImageWithFallback(refs.cover, track.image || "", PLACEHOLDER_ART);
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
    refs.lyrics.textContent = "Could not load lyrics for this track.";
    setStatus(refs.lyricsStatus, "Lyrics API failed.", true);
    console.error(error);
  }
}

async function loadArtistProfile(track) {
  setStatus(refs.artistStatus, "Loading artist profile...");
  refs.artistName.textContent = track.artist;
  refs.artistBio.textContent = "Loading profile...";
  setImageWithFallback(refs.artistImage, track.image || "", PLACEHOLDER_ARTIST);

  try {
    const profile = await state.app.apiFetch(
      `/api/artist?name=${encodeURIComponent(track.artist)}`,
    );
    refs.artistName.textContent = profile.title || track.artist;
    refs.artistBio.textContent = profile.extract || "No artist profile found.";
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

async function loadRelatedSongs(track) {
  refs.relatedGrid.innerHTML = "";
  try {
    const data = await state.app.apiFetch(
      `/api/search?term=${encodeURIComponent(track.artist)}&country=US&limit=8`,
    );
    const items = (data.items ?? []).filter(
      (item) =>
        item.title.toLowerCase() !== track.title.toLowerCase() ||
        item.artist.toLowerCase() !== track.artist.toLowerCase(),
    );
    if (!items.length) return;

    const frag = document.createDocumentFragment();
    items.forEach((item, index) => {
      const card = createSongCard(item, {
        compact: true,
        badge: "Track",
        delay: index * 24,
        onSelect: () => {
          state.app.setQueue(items, index);
          state.app.openTrackPage(item);
        },
      });
      frag.appendChild(card);
    });
    refs.relatedGrid.appendChild(frag);
  } catch (error) {
    console.error(error);
  }
}

async function boot() {
  state.app = await initShell("songs");

  if (!state.app.apiReady) {
    refs.title.textContent = "Backend not connected";
    refs.artist.textContent = "Start .\\start-server.ps1 to load track data.";
    setStatus(refs.lyricsStatus, "Backend not connected.", true);
    setStatus(refs.artistStatus, "Backend not connected.", true);
    return;
  }

  const queryTrack = trackFromQuery();
  const storedTrack = state.app.getTrack();
  let track = queryTrack || storedTrack;

  if (!track) {
    refs.title.textContent = "No track selected";
    refs.artist.textContent = "Open any song card to load this page.";
    setImageWithFallback(refs.cover, "", PLACEHOLDER_ART);
    setImageWithFallback(refs.artistImage, "", PLACEHOLDER_ARTIST);
    setStatus(refs.lyricsStatus, "No track selected.", true);
    setStatus(refs.artistStatus, "No track selected.", true);
    return;
  }

  track = await hydrateTrackIfNeeded(track);
  state.track = track;

  renderHeader(track);
  state.app.setTrack(track, { autoplay: false });

  await Promise.all([
    loadLyrics(track),
    loadArtistProfile(track),
    loadRelatedSongs(track),
  ]);
}

boot();
