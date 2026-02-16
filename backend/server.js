const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const cliPortIndex = process.argv.indexOf("--port");
const cliPortValue =
  cliPortIndex >= 0
    ? Number.parseInt(process.argv[cliPortIndex + 1] || "", 10)
    : NaN;
const PORT = Number.isFinite(cliPortValue)
  ? cliPortValue
  : Number(process.env.PORT || 5500);
const ROOT = process.cwd();
const AI_ENGINE_URL = process.env.AI_ENGINE_URL || "http://127.0.0.1:8000";
const MAX_AI_BODY_BYTES = Number(
  process.env.MAX_AI_BODY_BYTES || 15 * 1024 * 1024,
);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);
const LYRICS_FETCH_TIMEOUT_MS = Number(
  process.env.LYRICS_FETCH_TIMEOUT_MS || 8500,
);
const LYRICS_CACHE_TTL_MS = Number(
  process.env.LYRICS_CACHE_TTL_MS || 6 * 60 * 60 * 1000,
);
const LYRICS_NEGATIVE_CACHE_TTL_MS = Number(
  process.env.LYRICS_NEGATIVE_CACHE_TTL_MS || 90 * 1000,
);
const LYRICS_CACHE_MAX = Number(process.env.LYRICS_CACHE_MAX || 500);

const lyricsCache = new Map();
const lyricsInFlight = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function safeCountry(value) {
  const normalized = String(value || "us").toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : "us";
}

function safeLimit(value, fallback = 24) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(n, 50));
}

function safeText(value, fallback = "Unknown") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function upscaleArtwork(url) {
  if (!url) return "";
  return url
    .replace("100x100bb", "600x600bb")
    .replace("100x100", "600x600")
    .replace("200x200bb", "600x600bb");
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PulseMusic/1.0 (+local-dev)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Upstream request failed: ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Upstream request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readRequestBody(req, maxBytes = MAX_AI_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error(`Request body exceeds ${maxBytes} bytes.`);
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyToAiEngine(req, reqUrl, res) {
  // Ensure targetPath starts with / and remove trailing slashes
  let targetPath = reqUrl.pathname.replace(/^\/api\/ai/, "");
  if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
  targetPath = targetPath.replace(/\/+$/, "") || "/";

  // Manual URL construction to be absolute
  const targetUrlStr = `${AI_ENGINE_URL.replace(/\/$/, "")}${targetPath}${reqUrl.search}`;
  console.log(`[Proxy] ${req.method} ${reqUrl.pathname} -> ${targetUrlStr}`);

  const headers = { ...req.headers };
  // Remove host header to avoid conflicts
  delete headers.host;
  // Ensure connection is clean
  delete headers.connection;

  try {
    const needsBody = req.method !== "GET" && req.method !== "HEAD";
    const body = needsBody ? await readRequestBody(req) : undefined;

    const upstream = await fetch(targetUrlStr, {
      method: req.method,
      headers,
      body,
      duplex: "half", // Required for streaming bodies in some versions of Node fetch
    });

    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    console.log(
      `[Proxy] Upstream responded ${upstream.status} for ${targetUrlStr} (${responseBuffer.length} bytes)`,
    );

    const resHeaders = {};
    upstream.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    res.writeHead(upstream.status, resHeaders);
    res.end(responseBuffer);
  } catch (error) {
    console.error("[Proxy Error]", error);
    sendJson(res, 502, {
      error: error.message || "AI engine proxy request failed.",
    });
  }
}

function mapAppleTrendingItem(item, index) {
  return {
    id: item.id ?? `${item.name}-${index}`,
    title: safeText(item.name),
    artist: safeText(item.artistName),
    image: safeText(item.artworkUrl100, "").replace("100x100", "600x600"),
    songUrl: item.url ?? "#",
    previewUrl: "",
    source: "trending",
  };
}

function mapItunesSong(item, source = "search") {
  return {
    id:
      item.trackId ??
      item.collectionId ??
      `${item.trackName}-${item.artistName}`,
    title: safeText(item.trackName),
    artist: safeText(item.artistName),
    image: upscaleArtwork(item.artworkUrl100),
    songUrl: item.trackViewUrl ?? item.collectionViewUrl ?? "#",
    previewUrl: item.previewUrl ?? "",
    album: safeText(item.collectionName, "Single"),
    genre: safeText(item.primaryGenreName, "Music"),
    source,
  };
}

function mapDeezerArtist(item, index) {
  return {
    id: item.id ?? `artist-${index}`,
    name: safeText(item.name),
    image:
      safeText(item.picture_xl, "") ||
      safeText(item.picture_big, "") ||
      safeText(item.picture_medium, "") ||
      "",
    link: safeText(item.link, ""),
    followers: Number.isFinite(Number(item.nb_fan))
      ? Number(item.nb_fan)
      : null,
    source: "deezer-chart",
  };
}

async function getTrending(country, limit) {
  const appleUrl = `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`;
  try {
    const appleData = await fetchJson(appleUrl);
    const items = (appleData.feed?.results ?? []).map(mapAppleTrendingItem);
    if (items.length) {
      return { items, source: "apple-rss" };
    }
  } catch (error) {
    // Fall through to iTunes fallback below.
  }

  const iTunesUrl =
    `https://itunes.apple.com/search?term=${encodeURIComponent("top hits")}` +
    `&entity=song&country=${country.toUpperCase()}&limit=${limit}`;
  const searchData = await fetchJson(iTunesUrl);
  const items = (searchData.results ?? []).map((item) =>
    mapItunesSong(item, "trending"),
  );
  return { items, source: "itunes-fallback" };
}

async function getSearch(term, country, limit) {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&entity=song&attribute=songTerm&country=${country.toUpperCase()}&limit=${limit}`;
  const data = await fetchJson(url);
  return (data.results ?? []).map((item) => mapItunesSong(item, "search"));
}

async function getTrendingArtists(country, limit) {
  try {
    const data = await fetchJson(
      `https://api.deezer.com/chart/0/artists?limit=${limit}`,
    );
    const items = (data.data ?? [])
      .map(mapDeezerArtist)
      .filter((artist) => artist.name);
    if (items.length) {
      return { items, source: "deezer-chart" };
    }
  } catch {
    // Fallback below.
  }

  const fallbackTracks = await getSearch(
    "top hits",
    country,
    Math.max(limit * 3, 30),
  );
  const map = new Map();
  for (const track of fallbackTracks) {
    const key = safeText(track.artist, "").toLowerCase();
    if (!key || map.has(key)) continue;
    map.set(key, {
      id: key,
      name: track.artist,
      image: track.image || "",
      link: track.songUrl || "",
      followers: null,
      source: "itunes-fallback",
    });
    if (map.size >= limit) break;
  }
  return { items: [...map.values()], source: "itunes-fallback" };
}

async function getArtistTopSongs(name, country, limit) {
  const songs = await getSearch(name, country, Math.max(limit * 2, limit));
  const lowered = safeText(name, "").toLowerCase();
  const exactMatches = songs.filter(
    (song) => safeText(song.artist, "").toLowerCase() === lowered,
  );
  const selected = exactMatches.length ? exactMatches : songs;
  return selected.slice(0, limit);
}

async function getHydratedPreview(title, artist, country) {
  const lookupTerm = `${title} ${artist}`;
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(lookupTerm)}` +
    `&entity=song&country=${country.toUpperCase()}&limit=5`;
  const data = await fetchJson(url);
  const results = data.results ?? [];
  const lowerArtist = safeText(artist, "").toLowerCase();
  const match =
    results.find(
      (item) => safeText(item.artistName, "").toLowerCase() === lowerArtist,
    ) ?? results[0];
  return match ? mapItunesSong(match, "search") : null;
}

function normalizeQuery(text) {
  if (!text) return "";
  return text
    .replace(/\s*\(.*?\)/g, "") // remove (Official Video), (feat. ...), etc.
    .replace(/\s*\[.*?\]/g, "") // remove [Remastered], etc.
    .replace(/\s+-.*$/g, "") // remove everything after a dash (e.g., - Single, - Remix)
    .replace(/\s*feat\..*$/gi, "") // remove feat. and everything after
    .trim();
}

function pushUniqueInsensitive(target, value) {
  const cleaned = safeText(value, "");
  if (!cleaned) return;
  const exists = target.some(
    (item) => item.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!exists) {
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

function buildArtistCandidates(artist, title) {
  const candidates = [];
  const normalizedArtist = normalizeQuery(artist);
  pushUniqueInsensitive(candidates, normalizedArtist);
  pushUniqueInsensitive(candidates, artist);

  splitArtistCandidates(artist).forEach((item) => {
    pushUniqueInsensitive(candidates, normalizeQuery(item));
    pushUniqueInsensitive(candidates, item);
  });

  extractFeaturedArtists(title).forEach((item) => {
    pushUniqueInsensitive(candidates, normalizeQuery(item));
    pushUniqueInsensitive(candidates, item);
  });

  return candidates.slice(0, 6);
}

function buildTitleCandidates(title) {
  const candidates = [];
  const rawTitle = safeText(title, "");
  const normalizedTitle = normalizeQuery(rawTitle);
  const noAposTitle = normalizedTitle.replace(/['\u2019]/g, "");

  pushUniqueInsensitive(candidates, normalizedTitle);
  pushUniqueInsensitive(candidates, rawTitle);
  pushUniqueInsensitive(candidates, noAposTitle);

  const colonSplit = normalizedTitle.split(":")[0]?.trim();
  const slashSplit = normalizedTitle.split("/")[0]?.trim();
  pushUniqueInsensitive(candidates, colonSplit);
  pushUniqueInsensitive(candidates, slashSplit);

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

function lyricsCacheKey(artist, title) {
  return `${normalizeQuery(artist).toLowerCase()}::${normalizeQuery(title).toLowerCase()}`;
}

function getLyricsFromCache(key) {
  const cached = lyricsCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    lyricsCache.delete(key);
    return null;
  }
  return cached.data;
}

function setLyricsInCache(key, data) {
  const ttlMs = data?.lyrics
    ? LYRICS_CACHE_TTL_MS
    : LYRICS_NEGATIVE_CACHE_TTL_MS;
  lyricsCache.set(key, { data, expiresAt: Date.now() + ttlMs });

  while (lyricsCache.size > LYRICS_CACHE_MAX) {
    const oldestKey = lyricsCache.keys().next().value;
    if (!oldestKey) break;
    lyricsCache.delete(oldestKey);
  }
}

function extractPlainLyrics(match) {
  const plain = safeText(match?.plainLyrics, "");
  if (plain) return plain;

  const synced = safeText(match?.syncedLyrics, "");
  if (!synced) return "";

  return synced.replace(/\[[0-9]{1,2}:[0-9]{2}(?:\.[0-9]{1,3})?\]/g, "").trim();
}

function buildLrcLibUrl(stage) {
  if (stage.mode === "get" && stage.a && stage.t) {
    return `https://lrclib.net/api/get?artist=${encodeURIComponent(stage.a)}&track=${encodeURIComponent(stage.t)}`;
  }
  if (stage.mode === "search" && stage.a && stage.t) {
    return `https://lrclib.net/api/search?artist=${encodeURIComponent(stage.a)}&track=${encodeURIComponent(stage.t)}`;
  }
  if (stage.mode === "q" && stage.q) {
    return `https://lrclib.net/api/search?q=${encodeURIComponent(stage.q)}`;
  }
  return "";
}

async function queryLrcLibStage(stage) {
  const url = buildLrcLibUrl(stage);
  if (!url) return null;

  const data = await fetchJson(url, { timeoutMs: LYRICS_FETCH_TIMEOUT_MS });
  const results = Array.isArray(data) ? data : [data];
  for (const match of results) {
    const lyrics = extractPlainLyrics(match);
    if (lyrics) {
      return { lyrics, source: stage.source };
    }
  }
  return null;
}

async function queryLyricsOvh(artist, title) {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const data = await fetchJson(url, {
    timeoutMs: Math.max(1500, LYRICS_FETCH_TIMEOUT_MS - 400),
  });
  const lyrics = safeText(data?.lyrics, "");
  return lyrics ? { lyrics, source: "lyrics.ovh" } : null;
}

async function queryLyricsOvhSuggest(searchTitle, titleCandidates = []) {
  const title = safeText(searchTitle, "");
  if (!title) return null;

  let payload;
  try {
    payload = await fetchJson(
      `https://api.lyrics.ovh/suggest/${encodeURIComponent(title)}`,
      { timeoutMs: Math.max(2200, LYRICS_FETCH_TIMEOUT_MS + 1200) },
    );
  } catch {
    return null;
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (!rows.length) return null;

  const artistCandidates = [];
  for (const row of rows) {
    const rowTitle = safeText(row?.title, "");
    const titleMatched =
      !titleCandidates.length ||
      titleCandidates.some((candidate) =>
        areTitlesSimilar(candidate, rowTitle),
      );
    if (!titleMatched) continue;
    pushUniqueInsensitive(artistCandidates, row?.artist?.name);
    if (artistCandidates.length >= 10) break;
  }

  if (!artistCandidates.length) {
    rows.slice(0, 10).forEach((row) => {
      pushUniqueInsensitive(artistCandidates, row?.artist?.name);
    });
  }

  for (const candidateArtist of artistCandidates) {
    for (const candidateTitle of titleCandidates.slice(0, 3)) {
      try {
        const result = await queryLyricsOvh(candidateArtist, candidateTitle);
        if (result?.lyrics) {
          return {
            ...result,
            source: `lyrics.ovh-suggest:${candidateArtist}`,
          };
        }
      } catch {
        // Try next candidate.
      }
    }
  }

  return null;
}

async function firstResolvedLyrics(tasks) {
  if (!tasks.length) return null;
  try {
    return await Promise.any(
      tasks.map((task) =>
        task().then((result) => {
          if (!result?.lyrics) {
            throw new Error("No lyrics in provider response");
          }
          return result;
        }),
      ),
    );
  } catch {
    return null;
  }
}

function uniqueStages(stages) {
  const seen = new Set();
  const deduped = [];
  for (const stage of stages) {
    if (!stage) continue;
    const signature = `${stage.mode}|${stage.a || ""}|${stage.t || ""}|${stage.q || ""}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(stage);
  }
  return deduped;
}

async function getLyrics(artist, title) {
  console.log(`[Lyrics] Looking up: "${title}" by "${artist}"`);

  const artistCandidates = buildArtistCandidates(artist, title);
  const titleCandidates = buildTitleCandidates(title);
  const primaryArtist = artistCandidates[0] || normalizeQuery(artist) || artist;
  const primaryTitle = titleCandidates[0] || normalizeQuery(title) || title;

  const fastStages = uniqueStages([
    {
      a: primaryArtist,
      t: primaryTitle,
      mode: "get",
      source: "lrclib-primary-get",
    },
    {
      a: primaryArtist,
      t: primaryTitle,
      mode: "search",
      source: "lrclib-primary-search",
    },
    ...artistCandidates.slice(1, 4).flatMap((candidateArtist) => [
      {
        a: candidateArtist,
        t: primaryTitle,
        mode: "search",
        source: "lrclib-alt-artist-search",
      },
      {
        a: candidateArtist,
        t: primaryTitle,
        mode: "get",
        source: "lrclib-alt-artist-get",
      },
    ]),
    ...titleCandidates.slice(1, 3).map((candidateTitle) => ({
      a: primaryArtist,
      t: candidateTitle,
      mode: "search",
      source: "lrclib-title-variant-search",
    })),
  ]);

  const firstHit = await firstResolvedLyrics(
    fastStages.map((stage) => () => queryLrcLibStage(stage)),
  );
  if (firstHit) {
    console.log(`[Lyrics] Found via ${firstHit.source}`);
    return firstHit;
  }

  const broadStages = uniqueStages([
    {
      q: `${primaryArtist} ${primaryTitle}`.trim(),
      mode: "q",
      source: "lrclib-broad-primary",
    },
    ...artistCandidates.slice(1, 4).map((candidateArtist) => ({
      q: `${candidateArtist} ${primaryTitle}`.trim(),
      mode: "q",
      source: "lrclib-broad-alt-artist",
    })),
    ...titleCandidates.slice(0, 3).map((candidateTitle) => ({
      q: candidateTitle,
      mode: "q",
      source: "lrclib-title-only",
    })),
    {
      q: `${artist} ${title}`.trim(),
      mode: "q",
      source: "lrclib-broad-raw",
    },
  ]);

  const broadHit = await firstResolvedLyrics(
    broadStages.map((stage) => () => queryLrcLibStage(stage)),
  );
  if (broadHit) {
    console.log(`[Lyrics] Found via ${broadHit.source}`);
    return broadHit;
  }

  const ovhAttempts = [];
  artistCandidates.slice(0, 4).forEach((candidateArtist) => {
    titleCandidates.slice(0, 3).forEach((candidateTitle) => {
      ovhAttempts.push(() =>
        queryLyricsOvh(candidateArtist, candidateTitle).then((result) =>
          result
            ? { ...result, source: `lyrics.ovh:${candidateArtist}` }
            : null,
        ),
      );
    });
  });

  const ovhHit = await firstResolvedLyrics(ovhAttempts);
  if (ovhHit) {
    console.log(`[Lyrics] Found via ${ovhHit.source}`);
    return ovhHit;
  }

  const suggestHit = await queryLyricsOvhSuggest(primaryTitle, titleCandidates);
  if (suggestHit) {
    console.log(`[Lyrics] Found via ${suggestHit.source}`);
    return suggestHit;
  }

  console.log(`[Lyrics] Failed to find lyrics for: ${title} - ${artist}`);
  return { lyrics: "", source: "none" };
}

async function getWikipediaProfile(name) {
  const searchData = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      name,
    )}&format=json&origin=*`,
  );
  const page = searchData.query?.search?.[0];
  if (!page?.title) {
    return { title: name, extract: "", image: "" };
  }

  const details = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=900&titles=${encodeURIComponent(
      page.title,
    )}&format=json&origin=*`,
  );
  const pages = details.query?.pages ?? {};
  const firstPage = Object.values(pages)[0] ?? {};

  return {
    title: safeText(firstPage.title, page.title),
    extract: safeText(firstPage.extract, ""),
    image: safeText(firstPage.thumbnail?.source, ""),
  };
}

async function getDeezerArtistImage(name) {
  const data = await fetchJson(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`,
  );
  const artist = data.data?.[0];
  if (!artist) return "";
  return (
    safeText(artist.picture_xl, "") ||
    safeText(artist.picture_big, "") ||
    safeText(artist.picture_medium, "")
  );
}

async function getItunesArtistImage(name) {
  const data = await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&limit=1`,
  );
  const item = data.results?.[0];
  if (!item) return "";
  return upscaleArtwork(item.artworkUrl100);
}

async function getArtistProfile(name) {
  const profile = {
    title: name,
    extract: "",
    image: "",
  };

  try {
    const wiki = await getWikipediaProfile(name);
    profile.title = safeText(wiki.title, name);
    profile.extract = safeText(wiki.extract, "");
    profile.image = safeText(wiki.image, "");
  } catch {
    // Continue with fallbacks.
  }

  if (!profile.image) {
    try {
      profile.image = await getDeezerArtistImage(name);
    } catch {
      // Continue with next fallback.
    }
  }

  if (!profile.image) {
    try {
      profile.image = await getItunesArtistImage(name);
    } catch {
      // Continue without image.
    }
  }

  if (!profile.extract) {
    profile.extract =
      "No extended biography found for this artist in the current sources.";
  }

  return profile;
}

async function handleApi(req, reqUrl, res) {
  try {
    if (reqUrl.pathname.startsWith("/api/ai/")) {
      if (reqUrl.pathname === "/api/ai/health" && req.method !== "GET") {
        return sendJson(res, 405, { error: "Method not allowed." });
      }
      if (reqUrl.pathname === "/api/ai/judge" && req.method !== "POST") {
        return sendJson(res, 405, { error: "Method not allowed." });
      }
      return proxyToAiEngine(req, reqUrl, res);
    }

    if (reqUrl.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "pulse-music-proxy" });
    }

    if (reqUrl.pathname === "/api/trending") {
      const country = safeCountry(reqUrl.searchParams.get("country"));
      const limit = safeLimit(reqUrl.searchParams.get("limit"), 24);
      const result = await getTrending(country, limit);
      return sendJson(res, 200, result);
    }

    if (reqUrl.pathname === "/api/search") {
      const term = safeText(reqUrl.searchParams.get("term"), "");
      const country = safeCountry(reqUrl.searchParams.get("country"));
      const limit = safeLimit(reqUrl.searchParams.get("limit"), 24);
      if (!term) {
        return sendJson(res, 400, { error: "Missing search term." });
      }
      const items = await getSearch(term, country, limit);
      return sendJson(res, 200, { items });
    }

    if (reqUrl.pathname === "/api/trending-artists") {
      const country = safeCountry(reqUrl.searchParams.get("country"));
      const limit = safeLimit(reqUrl.searchParams.get("limit"), 24);
      const result = await getTrendingArtists(country, limit);
      return sendJson(res, 200, result);
    }

    if (reqUrl.pathname === "/api/artist-top-songs") {
      const name = safeText(reqUrl.searchParams.get("name"), "");
      const country = safeCountry(reqUrl.searchParams.get("country"));
      const limit = safeLimit(reqUrl.searchParams.get("limit"), 12);
      if (!name) {
        return sendJson(res, 400, { error: "Missing artist name." });
      }
      const items = await getArtistTopSongs(name, country, limit);
      return sendJson(res, 200, { items });
    }

    if (reqUrl.pathname === "/api/hydrate") {
      const title = safeText(reqUrl.searchParams.get("title"), "");
      const artist = safeText(reqUrl.searchParams.get("artist"), "");
      const country = safeCountry(reqUrl.searchParams.get("country"));
      if (!title || !artist) {
        return sendJson(res, 400, { error: "Missing title or artist." });
      }
      const item = await getHydratedPreview(title, artist, country);
      return sendJson(res, 200, { item });
    }

    if (reqUrl.pathname === "/api/lyrics") {
      const artist = safeText(reqUrl.searchParams.get("artist"), "");
      const title = safeText(reqUrl.searchParams.get("title"), "");
      if (!artist || !title) {
        return sendJson(res, 400, { error: "Missing artist or title." });
      }

      const key = lyricsCacheKey(artist, title);
      const cached = getLyricsFromCache(key);
      if (cached?.lyrics) {
        return sendJson(res, 200, { ...cached, cached: true });
      }

      if (!lyricsInFlight.has(key)) {
        lyricsInFlight.set(
          key,
          getLyrics(artist, title)
            .then((data) => {
              setLyricsInCache(key, data);
              return data;
            })
            .finally(() => {
              lyricsInFlight.delete(key);
            }),
        );
      }

      const data = await lyricsInFlight.get(key);
      console.log(
        `[Lyrics] Served ${title} by ${artist} from ${data.source || "none"}`,
      );
      return sendJson(res, 200, data);
    }

    if (reqUrl.pathname === "/api/artist") {
      const name = safeText(reqUrl.searchParams.get("name"), "");
      if (!name) {
        return sendJson(res, 400, { error: "Missing artist name." });
      }
      const profile = await getArtistProfile(name);
      return sendJson(res, 200, profile);
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || "Upstream error." });
  }
}

function resolveSafePath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  // Serve from ../frontend relative to where server.js is running (backend/)
  const frontendRoot = path.join(ROOT, "../frontend");
  const filePath = path.resolve(frontendRoot, `.${relativePath}`);

  // Ensure the resolved path is inside the frontend directory
  if (!filePath.startsWith(frontendRoot)) {
    return null;
  }
  return filePath;
}

async function handleStatic(reqUrl, res) {
  const filePath = resolveSafePath(reqUrl.pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (reqUrl.pathname === "/health" || reqUrl.pathname.startsWith("/api/")) {
    await handleApi(req, reqUrl, res);
    return;
  }

  await handleStatic(reqUrl, res);
});

server.listen(PORT, () => {
  console.log(`Pulse Music server running on http://localhost:${PORT}`);
});
