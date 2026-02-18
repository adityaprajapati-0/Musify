import {
  PLACEHOLDER_ARTIST,
  createArtistCard,
  createSongCard,
  initShell,
  setImageWithFallback,
  setStatus,
} from "./common.js?v=20260218m7";

const refs = {
  country: document.querySelector("#artistsCountry"),
  refresh: document.querySelector("#artistsRefresh"),
  artistsStatus: document.querySelector("#artistsStatus"),
  artistsGrid: document.querySelector("#artistsGrid"),
  topStatus: document.querySelector("#artistTopStatus"),
  topGrid: document.querySelector("#artistTopGrid"),
  profileImage: document.querySelector("#selectedArtistImage"),
  profileName: document.querySelector("#selectedArtistName"),
  profileBio: document.querySelector("#selectedArtistBio"),
};

const state = {
  app: null,
  selectedArtist: "",
};

function applyArtistSelection() {
  document.querySelectorAll(".artist-card").forEach((card) => {
    card.classList.toggle(
      "active",
      card.dataset.artistName === state.selectedArtist,
    );
  });
}

async function loadArtistTopSongs(artistName) {
  setStatus(refs.topStatus, "Loading artist songs...");
  refs.topGrid.innerHTML = "";

  try {
    const data = await state.app.apiFetch(
      `/api/artist-top-songs?name=${encodeURIComponent(artistName)}&country=${encodeURIComponent(refs.country.value)}&limit=12`,
    );
    const items = data.items ?? [];
    if (!items.length) {
      setStatus(refs.topStatus, "No songs found for this artist.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((track, index) => {
      const card = createSongCard(track, {
        compact: true,
        badge: "Track",
        delay: index * 24,
        delay: index * 24,
        onSelect: () => {
          state.app.setQueue(items, index);
          state.app.openTrackPage(track);
        },
      });
      frag.appendChild(card);
    });
    refs.topGrid.appendChild(frag);
    state.app.ensureTrack(items[0]);
    setStatus(refs.topStatus, `${items.length} top songs loaded.`);
  } catch (error) {
    setStatus(refs.topStatus, "Could not load artist songs.", true);
    console.error(error);
  }
}

async function loadArtistProfile(artistName, fallbackImage = "") {
  setStatus(refs.topStatus, "Loading artist profile...");
  refs.profileName.textContent = artistName;
  refs.profileBio.textContent = "Loading artist profile...";
  setImageWithFallback(refs.profileImage, fallbackImage, PLACEHOLDER_ARTIST);

  try {
    const profile = await state.app.apiFetch(
      `/api/artist?name=${encodeURIComponent(artistName)}`,
    );
    refs.profileName.textContent = profile.title || artistName;
    refs.profileBio.textContent =
      profile.extract || "No artist biography found.";
    setImageWithFallback(
      refs.profileImage,
      profile.image || fallbackImage,
      PLACEHOLDER_ARTIST,
    );
  } catch (error) {
    refs.profileBio.textContent = "Could not load artist profile.";
    console.error(error);
  }
}

async function selectArtist(artist) {
  state.selectedArtist = artist.name;
  applyArtistSelection();
  await Promise.all([
    loadArtistProfile(artist.name, artist.image || ""),
    loadArtistTopSongs(artist.name),
  ]);
}

async function loadTrendingArtists() {
  setStatus(refs.artistsStatus, "Loading artists...");
  refs.artistsGrid.innerHTML = "";

  try {
    const data = await state.app.apiFetch(
      `/api/trending-artists?country=${encodeURIComponent(refs.country.value)}&limit=24`,
    );
    const items = data.items ?? [];
    if (!items.length) {
      setStatus(refs.artistsStatus, "No trending artists found.", true);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((artist, index) => {
      const card = createArtistCard(artist, {
        delay: index * 22,
        onSelect: () => selectArtist(artist),
      });
      card.dataset.artistName = artist.name;
      frag.appendChild(card);
    });
    refs.artistsGrid.appendChild(frag);
    setStatus(refs.artistsStatus, `${items.length} artists loaded.`);

    const urlArtist = new URLSearchParams(window.location.search).get("artist");
    const initialArtist =
      items.find(
        (item) =>
          item.name.toLowerCase() === String(urlArtist || "").toLowerCase(),
      ) || items[0];

    if (initialArtist) {
      await selectArtist(initialArtist);
    }
  } catch (error) {
    setStatus(refs.artistsStatus, "Could not load artists.", true);
    console.error(error);
  }
}

function wireEvents() {
  refs.refresh.addEventListener("click", loadTrendingArtists);
  refs.country.addEventListener("change", loadTrendingArtists);
}

async function boot() {
  state.app = await initShell("artists");
  wireEvents();
  setImageWithFallback(refs.profileImage, "", PLACEHOLDER_ARTIST);

  if (!state.app.apiReady) {
    setStatus(
      refs.artistsStatus,
      "Backend not connected. Start .\\start-server.ps1",
      true,
    );
    setStatus(refs.topStatus, "Backend not connected.", true);
    return;
  }

  await loadTrendingArtists();
}

boot();
