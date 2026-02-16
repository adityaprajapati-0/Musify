import { createSongCard, initShell, setStatus } from "./common.js?v=20260216m5";

const STATIC_PLAYLISTS = [
  {
    id: "night-drive",
    name: "Night Drive",
    description: "Neon synth, city lights, after-hours grooves.",
    query: "synthwave night drive",
  },
  {
    id: "summer-vibe",
    name: "Summer Vibe",
    description: "Bright rhythms and feel-good pop energy.",
    query: "summer pop hits",
  },
  {
    id: "focus-flow",
    name: "Focus Flow",
    description: "Chill electronic beats for deep work.",
    query: "lofi chill beats",
  },
  {
    id: "global-club",
    name: "Global Club",
    description: "Dancefloor momentum from around the world.",
    query: "electronic dance hits",
  },
  {
    id: "soul-rnb",
    name: "Soul & RnB",
    description: "Warm vocals, modern R&B and soul textures.",
    query: "modern rnb soul",
  },
  {
    id: "indie-mix",
    name: "Indie Mix",
    description: "Alternative and indie picks with fresh texture.",
    query: "indie alternative hits",
  },
];

const refs = {
  playlistGrid: document.querySelector("#playlistGrid"),
  playlistTitle: document.querySelector("#playlistTitle"),
  playlistDesc: document.querySelector("#playlistDesc"),
  tracksStatus: document.querySelector("#playlistTracksStatus"),
  tracksGrid: document.querySelector("#playlistTracksGrid"),
};

const state = {
  app: null,
  activePlaylistId: "",
  playlists: [],
};

function getPlaylistDefinitions() {
  return [
    {
      id: "my-playlist",
      name: "My Playlist",
      description: "Tracks added from the player bar.",
      type: "custom",
    },
    {
      id: "saved-songs",
      name: "Saved Songs",
      description: "Tracks marked with Save in the player bar.",
      type: "saved",
    },
    ...STATIC_PLAYLISTS.map((playlist) => ({ ...playlist, type: "query" })),
  ];
}

function createPlaylistCard(playlist, index) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "playlist-card reveal";
  card.style.setProperty("--delay", `${index * 30}ms`);
  card.dataset.playlistId = playlist.id;

  const name = document.createElement("strong");
  name.textContent = playlist.name;

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = playlist.description;

  const tag = document.createElement("span");
  tag.className = "pill";
  tag.textContent = "Open Playlist";

  card.append(name, desc, tag);
  card.addEventListener("click", () => selectPlaylist(playlist));
  return card;
}

function applyActivePlaylist() {
  document.querySelectorAll(".playlist-card").forEach((card) => {
    card.classList.toggle(
      "active",
      card.dataset.playlistId === state.activePlaylistId,
    );
  });
}

async function loadPlaylistTracks(playlist) {
  refs.playlistTitle.textContent = playlist.name;
  refs.playlistDesc.textContent = playlist.description;
  setStatus(refs.tracksStatus, "Loading tracks...");
  refs.tracksGrid.innerHTML = "";

  try {
    let items = [];
    if (playlist.type === "custom") {
      items = state.app.getCustomPlaylistTracks();
    } else if (playlist.type === "saved") {
      items = state.app.getSavedTracks();
    } else {
      const data = await state.app.apiFetch(
        `/api/search?term=${encodeURIComponent(playlist.query)}&country=US&limit=18`,
      );
      items = data.items ?? [];
    }

    if (!items.length) {
      setStatus(refs.tracksStatus, "No tracks found for this playlist.", true);
      refs.tracksGrid.innerHTML = "";
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((track, index) => {
      const card = createSongCard(track, {
        badge: playlist.name,
        delay: index * 24,
        delay: index * 24,
        onSelect: () => {
          state.app.setQueue(items, index);
          state.app.openTrackPage(track);
        },
      });
      frag.appendChild(card);
    });
    refs.tracksGrid.appendChild(frag);
    state.app.ensureTrack(items[0]);
    setStatus(refs.tracksStatus, `${items.length} tracks loaded.`);
  } catch (error) {
    setStatus(refs.tracksStatus, "Failed to load playlist tracks.", true);
    console.error(error);
  }
}

async function selectPlaylist(playlist) {
  state.activePlaylistId = playlist.id;
  applyActivePlaylist();
  await loadPlaylistTracks(playlist);
}

function renderPlaylists() {
  state.playlists = getPlaylistDefinitions();
  refs.playlistGrid.innerHTML = "";
  const frag = document.createDocumentFragment();
  state.playlists.forEach((playlist, index) => {
    frag.appendChild(createPlaylistCard(playlist, index));
  });
  refs.playlistGrid.appendChild(frag);
  applyActivePlaylist();
}

async function boot() {
  state.app = await initShell("playlists");
  renderPlaylists();
  window.addEventListener("pulse:library-updated", async () => {
    renderPlaylists();
    if (!state.activePlaylistId) return;
    const active = state.playlists.find(
      (playlist) => playlist.id === state.activePlaylistId,
    );
    if (!active) return;
    if (active.type === "custom" || active.type === "saved") {
      await loadPlaylistTracks(active);
    }
  });

  if (!state.app.apiReady) {
    setStatus(
      refs.tracksStatus,
      "Backend not connected. Start .\\start-server.ps1",
      true,
    );
    return;
  }

  const first = state.playlists[0];
  if (first) {
    await selectPlaylist(first);
  }
}

boot();
