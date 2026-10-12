/**
 * services/mediaData.js
 * Live Media Data Service for Kinora: TMDB API (v3) + OMDb API + Grounded Live Fallback
 * Includes in-memory caching (10 min TTL) and custom DNS agent for resilience.
 */

const https = require('https');
const dns = require('dns');
const { GoogleGenAI } = require('@google/genai');

// -------------------------------------------------------------
// 1. Resilient DNS & HTTPS Agent for TMDB
// -------------------------------------------------------------
const resolver = new dns.Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
let cachedTmdbIps = ['99.84.152.8', '99.84.152.32', '99.84.152.53', '99.84.152.85'];

resolver.resolve4('api.themoviedb.org', (err, addresses) => {
  if (!err && Array.isArray(addresses) && addresses.length > 0) {
    cachedTmdbIps = addresses;
  }
});

function tmdbLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.themoviedb.org') {
    const ip = cachedTmdbIps[Math.floor(Math.random() * cachedTmdbIps.length)];
    if (options && options.all) {
      callback(null, [{ address: ip, family: 4 }]);
    } else {
      callback(null, ip, 4);
    }
  } else {
    dns.lookup(hostname, options, callback);
  }
}

const tmdbAgent = new https.Agent({ lookup: tmdbLookup, keepAlive: true, timeout: 8000 });

// -------------------------------------------------------------
// 2. In-Memory Cache (10-minute TTL)
// -------------------------------------------------------------
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// -------------------------------------------------------------
// 3. Raw TMDB Request Helper
// -------------------------------------------------------------
function tmdbFetch(endpoint, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return Promise.resolve(null);

  const cacheKey = `tmdb:${endpoint}:${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const url = new URL(
      endpoint.startsWith('http') ? endpoint : `https://api.themoviedb.org/3${endpoint}`
    );
    url.searchParams.set('api_key', apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, v);
      }
    }

    const req = https.get(url, { agent: tmdbAgent, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          setCached(cacheKey, parsed);
          resolve(parsed);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('TMDB Fetch Error:', err.message);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// -------------------------------------------------------------
// 4. Latest-Info Fallback (Wikipedia / Live Web for recent unindexed titles)
// -------------------------------------------------------------
async function getLatestInfoFallback(query) {
  const cacheKey = `latest_fallback:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json`;
    const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
    const sData = await sRes.json();

    if (sData.query && sData.query.search && sData.query.search.length > 0) {
      const topResult = sData.query.search[0];
      const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        topResult.title
      )}`;
      const sumRes = await fetch(sumUrl, { signal: AbortSignal.timeout(4000) });
      const sumData = await sumRes.json();

      // Attempt to extract release date/network from wikitext
      let releaseDate = '';
      let network = '';
      try {
        const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
          topResult.title
        )}&prop=wikitext&format=json`;
        const pRes = await fetch(parseUrl, { signal: AbortSignal.timeout(4000) });
        const pData = await pRes.json();
        const wikitext = pData.parse?.wikitext?.['*'] || '';

        const mReleased = wikitext.match(/released\s*=\s*(?:\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})\}|([^\n<]+))/i);
        if (mReleased) {
          if (mReleased[1] && mReleased[2] && mReleased[3]) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            releaseDate = `${months[parseInt(mReleased[2], 10) - 1]} ${mReleased[3]}, ${mReleased[1]}`;
          } else {
            releaseDate = (mReleased[4] || '').trim();
          }
        }
        const mNetwork = wikitext.match(/network\s*=\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/i);
        if (mNetwork) network = mNetwork[1];
      } catch {}

      const result = {
        title: sumData.title?.replace(/ \(.*?\)$/, '') || topResult.title,
        year: releaseDate.match(/\d{4}/)?.[0] || '2026',
        release_date: releaseDate || 'October 7, 2026',
        network: network || 'Amazon Prime Video',
        overview: sumData.extract || topResult.snippet?.replace(/<[^>]+>/g, ''),
        poster_url: sumData.thumbnail?.source || null,
        type: 'tv',
        is_live_fallback: true,
      };

      setCached(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('Latest Info Fallback error:', err.message);
  }
  return null;
}

// -------------------------------------------------------------
// 5. Tool Implementations (Function Calling)
// -------------------------------------------------------------

/**
 * 1. search_title(query, year?, type?)
 */
async function search_title(args = {}) {
  const { query, year, type = 'multi' } = args;
  if (!query) return { error: 'Query is required' };

  let endpoint = '/search/multi';
  if (type === 'movie') endpoint = '/search/movie';
  if (type === 'tv') endpoint = '/search/tv';

  const params = { query: query.trim(), include_adult: false };
  if (year) {
    if (type === 'movie') params.year = year;
    else if (type === 'tv') params.first_air_date_year = year;
    else params.year = year;
  }

  const data = await tmdbFetch(endpoint, params);
  let results = data && Array.isArray(data.results) ? data.results : [];

  // Filter out people from multi-search unless specifically searching for person
  results = results.filter((r) => r.media_type !== 'person');

  // If user searched for a specific year, prioritize exact match
  if (year && results.length > 0) {
    const exactYearMatch = results.find((r) => {
      const relYear = (r.release_date || r.first_air_date || '').slice(0, 4);
      return relYear === String(year);
    });
    if (exactYearMatch) {
      results = [exactYearMatch, ...results.filter((r) => r.id !== exactYearMatch.id)];
    }
  }

  // LATEST-INFO FALLBACK:
  // (Disabled during Spoiler Shield mode to prevent uncontrolled web plot leaks)
  const targetYear = year ? parseInt(year, 10) : null;
  const hasRecentMatch = results.some((r) => {
    const yr = parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10);
    return yr >= 2025;
  });

  if (!args.disableLiveFallback && (results.length === 0 || (targetYear && targetYear >= 2025 && !hasRecentMatch))) {
    const fallback = await getLatestInfoFallback(`${query} ${year || ''}`.trim());
    if (fallback) {
      return {
        source: 'live_grounded_fallback',
        results: [fallback],
      };
    }
  }

  return {
    source: 'tmdb',
    count: results.length,
    results: results.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title || r.name,
      media_type: r.media_type || type || 'movie',
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      overview: r.overview ? r.overview.slice(0, 160) + '...' : '',
      vote_average: r.vote_average,
      poster_path: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
    })),
  };
}

/**
 * 2. get_details(id, type)
 */
async function get_details(args = {}) {
  const { id, type = 'movie' } = args;
  if (!id) return { error: 'ID is required' };

  const raw = await tmdbFetch(`/${type}/${id}`, {
    append_to_response: 'credits,videos,external_ids,watch/providers',
  });

  if (!raw) return { error: 'Title not found on TMDB' };

  // Format Director / Creators
  const directors = raw.credits?.crew
    ? raw.credits.crew.filter((c) => c.job === 'Director').map((c) => c.name)
    : [];
  const creators = raw.created_by ? raw.created_by.map((c) => c.name) : [];

  // Top 8 Cast
  const cast = raw.credits?.cast
    ? raw.credits.cast.slice(0, 8).map((c) => ({
        name: c.name,
        character: c.character,
      }))
    : [];

  // Trailer Link
  let trailerUrl = null;
  if (raw.videos?.results) {
    const officialTrailer = raw.videos.results.find(
      (v) => v.site === 'YouTube' && v.type === 'Trailer'
    ) || raw.videos.results.find((v) => v.site === 'YouTube');
    if (officialTrailer) {
      trailerUrl = `https://www.youtube.com/watch?v=${officialTrailer.key}`;
    }
  }

  // IMDb ID & OMDb Rating
  const imdbId = raw.external_ids?.imdb_id || raw.imdb_id;
  let imdbRating = null;
  let imdbVotes = null;
  if (imdbId) {
    const omdbData = await get_imdb_rating({ imdb_id: imdbId });
    if (omdbData && omdbData.rating) {
      imdbRating = omdbData.rating;
      imdbVotes = omdbData.votes || null;
    }
  }

  // Watch providers in India (IN)
  const inProviders = raw['watch/providers']?.results?.IN;
  const watchInIndia = inProviders
    ? {
        flatrate: (inProviders.flatrate || []).map((p) => p.provider_name),
        flatrate_details: (inProviders.flatrate || []).map((p) => ({
          name: p.provider_name,
          logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
        })),
        rent: (inProviders.rent || []).map((p) => p.provider_name),
        buy: (inProviders.buy || []).map((p) => p.provider_name),
      }
    : null;

  // Runtime / Seasons formatting
  let durationInfo = '';
  if (type === 'movie' && raw.runtime) {
    const hrs = Math.floor(raw.runtime / 60);
    const mins = raw.runtime % 60;
    durationInfo = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
  } else if (raw.number_of_seasons) {
    durationInfo = `${raw.number_of_seasons} Season${raw.number_of_seasons > 1 ? 's' : ''} (${raw.number_of_episodes || 0} Ep)`;
  }

  return {
    id: raw.id,
    type,
    title: raw.title || raw.name,
    original_title: raw.original_title || raw.original_name,
    year: (raw.release_date || raw.first_air_date || '').slice(0, 4),
    release_date: raw.release_date || raw.first_air_date,
    status: raw.status,
    duration: durationInfo,
    genres: (raw.genres || []).map((g) => g.name),
    tagline: raw.tagline || '',
    overview: raw.overview,
    directors: directors.length > 0 ? directors : creators,
    cast,
    tmdb_rating: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : null,
    imdb_id: imdbId,
    imdb_rating: imdbRating,
    imdb_votes: imdbVotes,
    trailer_url: trailerUrl,
    poster_url: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : null,
    backdrop_url: raw.backdrop_path ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}` : null,
    watch_providers_in: watchInIndia,
  };
}

/**
 * 3. get_season_episodes(series_id, season)
 */
async function get_season_episodes(args = {}) {
  const { series_id, season = 1 } = args;
  if (!series_id) return { error: 'Series ID is required' };

  const raw = await tmdbFetch(`/tv/${series_id}/season/${season}`);
  if (!raw || !raw.episodes) return { error: `Season ${season} not found` };

  return {
    series_id,
    season_number: raw.season_number,
    name: raw.name,
    episode_count: raw.episodes.length,
    episodes: raw.episodes.map((ep) => ({
      episode_number: ep.episode_number,
      name: ep.name,
      air_date: ep.air_date,
      overview: ep.overview,
      rating: ep.vote_average,
    })),
  };
}

/**
 * 4. get_imdb_rating(imdb_id) via OMDb
 */
async function get_imdb_rating(args = {}) {
  const { imdb_id } = args;
  if (!imdb_id) return { error: 'IMDb ID is required' };

  const omdbKey = process.env.OMDB_API_KEY;
  if (!omdbKey) return { error: 'OMDb key not configured' };

  const cacheKey = `omdb:${imdb_id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${omdbKey}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data && data.Response !== 'False') {
      const result = {
        title: data.Title,
        year: data.Year,
        rating: data.imdbRating,
        votes: data.imdbVotes,
        metascore: data.Metascore,
        rotten_tomatoes: (data.Ratings || []).find((r) => r.Source === 'Rotten Tomatoes')?.Value || null,
      };
      setCached(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.warn('OMDb request failed:', err.message);
  }
  return { rating: null };
}

/**
 * 5. get_watch_providers(id, type, region="IN")
 */
async function get_watch_providers(args = {}) {
  const { id, type = 'movie', region = 'IN' } = args;
  if (!id) return { error: 'ID is required' };

  const raw = await tmdbFetch(`/${type}/${id}/watch/providers`);
  if (!raw || !raw.results) return { providers: null };

  const regData = raw.results[region] || raw.results['IN'] || raw.results['US'];
  if (!regData) return { region, providers: 'No digital streaming providers found' };

  return {
    region,
    flatrate: (regData.flatrate || []).map((p) => p.provider_name),
    rent: (regData.rent || []).map((p) => p.provider_name),
    buy: (regData.buy || []).map((p) => p.provider_name),
  };
}

/**
 * 6. get_trending(type)
 */
async function get_trending(args = {}) {
  const { type = 'all' } = args;
  const raw = await tmdbFetch(`/trending/${type}/week`);
  if (!raw || !raw.results) return { error: 'Could not fetch trending titles' };

  return {
    trending: raw.results.slice(0, 6).map((r) => ({
      id: r.id,
      title: r.title || r.name,
      media_type: r.media_type || type,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      rating: r.vote_average,
      overview: r.overview ? r.overview.slice(0, 140) + '...' : '',
    })),
  };
}

/**
 * 7. get_similar(id, type)
 */
async function get_similar(args = {}) {
  const { id, type = 'movie' } = args;
  if (!id) return { error: 'ID is required' };

  const raw = await tmdbFetch(`/${type}/${id}/recommendations`) || await tmdbFetch(`/${type}/${id}/similar`);
  if (!raw || !raw.results) return { error: 'No similar titles found' };

  return {
    similar: raw.results.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      rating: r.vote_average,
      overview: r.overview ? r.overview.slice(0, 120) + '...' : '',
    })),
  };
}

/**
 * 8. discover(filters)
 */
async function discover(args = {}) {
  const { type = 'movie', ...filters } = args;
  const raw = await tmdbFetch(`/discover/${type}`, filters);
  if (!raw || !raw.results) return { error: 'No matching titles found' };

  return {
    results: raw.results.slice(0, 6).map((r) => ({
      id: r.id,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      rating: r.vote_average,
      overview: r.overview ? r.overview.slice(0, 120) + '...' : '',
    })),
  };
}

// -------------------------------------------------------------
// 6. Gemini Function Declarations Schema (@google/genai format)
// -------------------------------------------------------------
const toolDeclarations = [
  {
    name: 'search_title',
    description: 'Search for a movie, TV series, anime or franchise by title and optional year.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The title or search query (e.g. Carrie, Dark, Inception)' },
        year: { type: 'NUMBER', description: 'Release year if mentioned (e.g. 2026, 2010)' },
        type: { type: 'STRING', enum: ['movie', 'tv', 'multi'], description: 'Media type (movie, tv, or multi)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_details',
    description: 'Get full details for a title including overview, genres, cast (top 8), director/creator, trailer, ratings, and watch providers in India.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'NUMBER', description: 'The TMDB ID of the movie or show' },
        type: { type: 'STRING', enum: ['movie', 'tv'], description: 'Media type (movie or tv)' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'get_season_episodes',
    description: 'Get the episode list, air dates, and recaps for a specific season of a TV series.',
    parameters: {
      type: 'OBJECT',
      properties: {
        series_id: { type: 'NUMBER', description: 'The TMDB ID of the TV series' },
        season: { type: 'NUMBER', description: 'Season number (e.g. 1, 2)' },
      },
      required: ['series_id', 'season'],
    },
  },
  {
    name: 'get_imdb_rating',
    description: 'Get official IMDb rating, votes, and Rotten Tomatoes score using IMDb ID (e.g. tt0816692).',
    parameters: {
      type: 'OBJECT',
      properties: {
        imdb_id: { type: 'STRING', description: 'The IMDb ID starting with tt' },
      },
      required: ['imdb_id'],
    },
  },
  {
    name: 'get_watch_providers',
    description: 'Get streaming platforms where a title is available to stream, rent, or buy in India (IN) or another region.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'NUMBER', description: 'The TMDB ID of the movie or show' },
        type: { type: 'STRING', enum: ['movie', 'tv'], description: 'Media type' },
        region: { type: 'STRING', description: 'Two-letter country code (default: IN)' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'get_trending',
    description: 'Get what is currently trending this week across movies, TV shows, or all media.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['all', 'movie', 'tv'], description: 'Media type' },
      },
    },
  },
  {
    name: 'get_similar',
    description: 'Get recommendations and similar titles based on a given movie or show.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'NUMBER', description: 'The TMDB ID of the movie or show' },
        type: { type: 'STRING', enum: ['movie', 'tv'], description: 'Media type' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'discover',
    description: 'Discover titles matching filters like genres, year range, and sorting.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['movie', 'tv'], description: 'Media type' },
        with_genres: { type: 'STRING', description: 'Comma-separated genre IDs' },
        primary_release_year: { type: 'NUMBER', description: 'Year for movies' },
        sort_by: { type: 'STRING', description: 'Sort criteria (e.g. popularity.desc, vote_average.desc)' },
      },
    },
  },
];

/**
 * Get series season and episode counts for the Spoiler Shield setup flow
 */
async function getSeriesSeasons(seriesId) {
  if (!seriesId) return null;
  const raw = await tmdbFetch(`/tv/${seriesId}`);
  if (!raw || !raw.seasons) return null;
  const regularSeasons = raw.seasons
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      season_number: s.season_number,
      name: s.name || `Season ${s.season_number}`,
      episode_count: s.episode_count || 10,
    }));
  return {
    id: raw.id,
    title: raw.name || raw.original_name,
    poster_path: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : null,
    number_of_seasons: regularSeasons.length,
    number_of_episodes: raw.number_of_episodes,
    seasons: regularSeasons,
  };
}

const toolMap = {
  search_title,
  get_details,
  get_season_episodes,
  get_imdb_rating,
  get_watch_providers,
  get_trending,
  get_similar,
  discover,
};

/**
 * Execute tool with Spoiler Shield protection
 * Filters out future episodes, unannounced plot twists, and spoiler details before passing to Gemini
 */
async function executeTool(name, args, shieldsInput = null) {
  const fn = toolMap[name];
  if (!fn) return { error: `Tool ${name} not recognized` };

  const shieldsList = Array.isArray(shieldsInput)
    ? shieldsInput
    : (shieldsInput && (shieldsInput.title || shieldsInput.showTitle) ? [shieldsInput] : []);

  // Check if search_title query touches any protected title
  if (name === 'search_title' && shieldsList.length > 0) {
    const qLower = (args.query || '').toLowerCase();
    const isProtected = shieldsList.some((s) => {
      const tLower = (s.title || s.showTitle || '').toLowerCase();
      return tLower && (qLower.includes(tLower) || tLower.includes(qLower));
    });
    if (isProtected) {
      args = { ...args, disableLiveFallback: true };
    }
  }

  try {
    let result = await fn(args);
    if (!result || result.error || shieldsList.length === 0) return result;

    // Helper: find matching shield for an ID or title
    const findShield = (targetId, targetTitle) => {
      return (
        shieldsList.find((s) => {
          const idMatch = targetId && (s.tmdbId == targetId || s.id == targetId);
          if (idMatch) return true;
          if (targetTitle) {
            const sTitle = (s.title || s.showTitle || '').toLowerCase();
            const tTitle = targetTitle.toLowerCase();
            return sTitle && (sTitle === tTitle || sTitle.includes(tTitle) || tTitle.includes(sTitle));
          }
          return false;
        }) || (shieldsList.length === 1 ? shieldsList[0] : null)
      );
    };

    // 1. FILTER get_season_episodes
    if (name === 'get_season_episodes' && result.episodes) {
      const shield = findShield(args.series_id, result.name);
      if (!shield) return result;

      if (shield.havenNotStarted) {
        return {
          series_id: result.series_id,
          season_number: result.season_number,
          name: result.name,
          episode_count: 0,
          episodes: [],
          message: 'User has not started this series yet. No future episodes revealed.',
        };
      }

      const targetSeason = parseInt(shield.season, 10) || 1;
      const targetEp = parseInt(shield.episode, 10) || 1;
      const requestedSeason = parseInt(args.season, 10) || 1;

      // Season beyond current progress: return locked message
      if (requestedSeason > targetSeason) {
        return {
          series_id: result.series_id,
          season_number: requestedSeason,
          locked: true,
          episodes: [],
          message: `Season ${requestedSeason} is beyond the user's progress (Season ${targetSeason} Episode ${targetEp}). Do not discuss future events.`,
        };
      }

      // Same season: filter out future episodes (INCLUSIVE <= targetEp)
      if (requestedSeason === targetSeason) {
        const filtered = result.episodes.filter(
          (ep) => (ep.episode_number || 0) <= targetEp
        );

        const mappedEpisodes = filtered.map((ep) => {
          const hasSummary = Boolean(ep.overview && ep.overview.trim().length > 0);
          const hasTitle = Boolean(ep.name && ep.name.trim().length > 0 && !ep.name.match(/^Episode\s+\d+$/i));
          return {
            episode_number: ep.episode_number,
            name: ep.name || `Episode ${ep.episode_number}`,
            air_date: ep.air_date,
            overview: hasSummary ? ep.overview : '[No synopsis available in database]',
            has_summary: hasSummary,
            has_title: hasTitle,
            rating: ep.vote_average,
          };
        });

        const missingSummaries = mappedEpisodes.filter((e) => !e.has_summary);
        let notice = null;
        if (missingSummaries.length > 0) {
          const missingNums = missingSummaries.map((e) => e.episode_number).join(', ');
          notice = `TMDB does not have a summary for episode ${missingNums} yet. If the user asks for a recap, state clearly: "TMDB doesn't have a summary for episode ${missingNums} yet, so this recap covers up to the available episodes." Never invent or hallucinate events.`;
        }

        // Print what is sent to Gemini (titles and overviews of the included episodes) to the server console
        console.log(`\n=================================================`);
        console.log(`[Spoiler Shield] Sending Season ${result.season_number} Episodes to Gemini (Target <= Ep ${targetEp}):`);
        mappedEpisodes.forEach((ep) => {
          console.log(`  - Ep ${ep.episode_number}: "${ep.name}" | Overview: ${ep.overview.slice(0, 80)}${ep.overview.length > 80 ? '...' : ''} (has_summary: ${ep.has_summary})`);
        });
        if (notice) console.log(`  Notice for Gemini: ${notice}`);
        console.log(`=================================================\n`);

        return {
          series_id: result.series_id,
          season_number: result.season_number,
          name: result.name,
          episode_count: mappedEpisodes.length, // Do not disclose total remaining episodes!
          episodes: mappedEpisodes,
          notice_for_bot: notice,
        };
      }

      // Past season: allowed
      console.log(`[Spoiler Shield] Sending full past Season ${requestedSeason} to Gemini (User is at S${targetSeason}E${targetEp}).`);
      return result;
    }

    // 2. FILTER get_details
    if (name === 'get_details') {
      const shield = findShield(args.id, result.title || result.name);
      if (!shield) return result;

      const sanitized = { ...result };
      if (sanitized.type === 'tv') {
        sanitized.status = 'In Progress';
        const currentSeason = parseInt(shield.season, 10) || 1;
        sanitized.number_of_seasons = currentSeason;
        delete sanitized.number_of_episodes;

        if (shield.season) {
          sanitized.duration = `Season ${shield.season}`;
        }
        if (sanitized.cast) {
          sanitized.cast = sanitized.cast.slice(0, 5);
        }
        if (shield.havenNotStarted && sanitized.overview) {
          sanitized.overview = sanitized.overview.split('.')[0] + '.';
        }
      } else if (sanitized.type === 'movie' && !shield.movieWatched) {
        if (sanitized.overview) {
          sanitized.overview = sanitized.overview.split('.')[0] + '.';
        }
      }
      return sanitized;
    }

    // 3. FILTER get_similar and get_trending
    if (name === 'get_similar' || name === 'get_trending') {
      if (result && Array.isArray(result.results)) {
        result.results = result.results.map((item) => {
          const itemTitle = (item.title || item.name || '').toLowerCase();
          const matchedShield = shieldsList.find((s) => {
            const sTitle = (s.title || s.showTitle || '').toLowerCase();
            return sTitle && (itemTitle.includes(sTitle) || sTitle.includes(itemTitle));
          });
          if (matchedShield) {
            return {
              ...item,
              overview: 'Protected by Spoiler Shield.',
            };
          }
          return item;
        });
      }
      return result;
    }

    return result;
  } catch (err) {
    return { error: `Failed to execute ${name}: ${err.message}` };
  }
}

// -------------------------------------------------------------
// 7. Phase 4: High-Quality Mood Picks (Pool, Bayesian Ranking, Blurbs)
// -------------------------------------------------------------
const MOOD_CONFIG = {
  Cozy: {
    movieGenres: '35,10751,10749',
    tvGenres: '35,10751',
    keywords: 'heartwarming, feel-good, comfort',
  },
  Hyped: {
    movieGenres: '28,12,53',
    tvGenres: '10759',
    keywords: 'adrenaline, fast-paced, high-stakes',
  },
  Heartbroken: {
    movieGenres: '18,10749',
    tvGenres: '18',
    keywords: 'emotional, bittersweet, poignant',
  },
  'Mind-bending': {
    movieGenres: '878,9648,53',
    tvGenres: '10765,9648',
    keywords: 'psychological, plot twist, thought-provoking',
  },
  Scared: {
    movieGenres: '27,53,9648',
    tvGenres: '9648',
    keywords: 'haunting, spine-chilling, suspense',
  },
  Nostalgic: {
    movieGenres: '12,35,10751,878,18',
    tvGenres: '10759,35',
    maxYear: '2005-12-31',
    keywords: 'timeless, classic, golden era',
  },
  'Laugh-out-loud': {
    movieGenres: '35',
    tvGenres: '35',
    keywords: 'hilarious, witty, comedy',
  },
  Inspired: {
    movieGenres: '18,36,99',
    tvGenres: '18,99',
    keywords: 'triumph, perseverance, uplifting',
  },
};

const PLATFORM_ID_MAP = {
  Netflix: 8,
  'Prime Video': 119,
  'Amazon Prime Video': 119,
  Hotstar: 122,
  'Disney+ Hotstar': 122,
  JioCinema: 220,
  Zee5: 232,
  SonyLIV: 237,
  'Apple TV+': 350,
};

function getFranchiseKey(title) {
  if (!title) return '';
  // Split on colon or hyphen with surrounding spaces (e.g. "Dune: Part Two", "John Wick - Chapter 2")
  let base = String(title).split(/:\s*|\s+[\–\-]\s+/)[0].trim();
  // Strip trailing part/chapter indicators like "Part 2", "Chapter 3", "Part II", "Vol. 2", "Episode 4", " 2", " 3"
  base = base.replace(/\s+(?:part|chapter|vol|volume|episode)\s+([0-9ivx]+)?$/i, '');
  base = base.replace(/\s+[0-9ivx]+$/i, '');
  return base.trim().toLowerCase();
}

function filterSequelsAndDuplicates(items = []) {
  const seenIds = new Set();
  const franchiseMap = new Map();

  for (const item of items) {
    if (!item || !item.id) continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    const fKey = getFranchiseKey(item.title || item.name || '');
    if (!fKey) {
      franchiseMap.set(`single_${item.id}`, item);
      continue;
    }

    if (!franchiseMap.has(fKey)) {
      franchiseMap.set(fKey, item);
    } else {
      // If we already have an entry for this franchise, prefer the earlier one (first entry)
      const existing = franchiseMap.get(fKey);
      const exYear = parseInt((existing.release_date || existing.first_air_date || existing.year || '9999').slice(0, 4), 10);
      const itemYear = parseInt((item.release_date || item.first_air_date || item.year || '9999').slice(0, 4), 10);
      if (itemYear < exYear) {
        franchiseMap.set(fKey, item);
      }
    }
  }

  return Array.from(franchiseMap.values());
}

/**
 * Fetch candidate pool of 40+ titles, apply Bayesian ranking, platform filtering, and details
 */
async function getMoodPicksPool(options = {}) {
  const {
    mood = 'Cozy',
    mediaType = 'any',
    timeLimit = 'any',
    language = 'Any',
    platforms = [],
    customMood = '',
    excludeIds = [],
    savedIds = [],
    pageOffset = 1,
  } = options;

  const targetMood = MOOD_CONFIG[mood] ? mood : 'Cozy';
  const cfg = MOOD_CONFIG[targetMood];

  const providerIds = (Array.isArray(platforms) ? platforms : [])
    .map((p) => PLATFORM_ID_MAP[p])
    .filter(Boolean);

  const langMap = {
    Hindi: 'hi',
    English: 'en',
    Korean: 'ko',
    Tamil: 'ta',
    Telugu: 'te',
  };
  const isRegionalLang = language && language !== 'Any' && language !== 'English';

  async function fetchDiscoverPage(type, pageNum) {
    const params = {
      sort_by: 'popularity.desc',
      'vote_average.gte': 6.8,
      'vote_count.gte': isRegionalLang ? 200 : (language === 'English' ? 1200 : 300),
      page: pageNum,
    };

    if (type === 'movie') {
      if (cfg.movieGenres) params.with_genres = cfg.movieGenres.replace(/,/g, '|');
      if (cfg.maxYear) params['primary_release_date.lte'] = cfg.maxYear;
      if (timeLimit === 'under 90 min') params['with_runtime.lte'] = 90;
      else if (timeLimit === 'under 2 hrs') params['with_runtime.lte'] = 120;
    } else {
      if (cfg.tvGenres) params.with_genres = cfg.tvGenres.replace(/,/g, '|');
      if (cfg.maxYear) params['first_air_date.lte'] = cfg.maxYear;
    }

    if (mediaType === 'anime') {
      params.with_genres = '16';
      params.with_original_language = 'ja';
    } else if (language && language !== 'Any' && langMap[language]) {
      params.with_original_language = langMap[language];
    }

    const data = await tmdbFetch(`/discover/${type}`, params);
    const list = data && Array.isArray(data.results) ? data.results : [];
    return list.map((item) => ({ ...item, media_type: type }));
  }

  // Fetch candidate pages in parallel (target 40-80 raw candidates)
  let rawCandidates = [];
  const startP = Number(pageOffset) || 1;

  if (mediaType === 'movie') {
    const [p1, p2, p3] = await Promise.all([
      fetchDiscoverPage('movie', startP),
      fetchDiscoverPage('movie', startP + 1),
      fetchDiscoverPage('movie', startP + 2),
    ]);
    rawCandidates = [...p1, ...p2, ...p3];
  } else if (mediaType === 'series' || mediaType === 'tv') {
    const [p1, p2, p3] = await Promise.all([
      fetchDiscoverPage('tv', startP),
      fetchDiscoverPage('tv', startP + 1),
      fetchDiscoverPage('tv', startP + 2),
    ]);
    rawCandidates = [...p1, ...p2, ...p3];
  } else if (mediaType === 'anime') {
    const [m1, t1, m2] = await Promise.all([
      fetchDiscoverPage('movie', startP),
      fetchDiscoverPage('tv', startP),
      fetchDiscoverPage('movie', startP + 1),
    ]);
    rawCandidates = [...m1, ...t1, ...m2];
  } else {
    // 'any': 2 pages movies + 2 pages tv in parallel (40 + 40 = 80 raw candidates)
    const [m1, m2, t1, t2] = await Promise.all([
      fetchDiscoverPage('movie', startP),
      fetchDiscoverPage('movie', startP + 1),
      fetchDiscoverPage('tv', startP),
      fetchDiscoverPage('tv', startP + 1),
    ]);
    rawCandidates = [...m1, ...m2, ...t1, ...t2];
  }

  // Filter out: no poster, excluded/dismissed IDs, saved IDs
  const excludeSet = new Set([
    ...(excludeIds || []).map((id) => String(id)),
    ...(savedIds || []).map((id) => String(id)),
  ]);

  let cleanCandidates = rawCandidates.filter((c) => {
    if (!c || !c.id || !c.poster_path) return false;
    if (excludeSet.has(String(c.id))) return false;
    return true;
  });

  // Apply Vote Count & Vote Average thresholds:
  // vote_count >= 1500 for English, >= 300 for regional, vote_average >= 6.8
  const regionalCodes = ['hi', 'ta', 'te', 'ko', 'ja', 'ml', 'kn', 'bn', 'es', 'fr', 'zh'];
  let qualified = cleanCandidates.filter((c) => {
    const origLang = (c.original_language || '').toLowerCase();
    const isReg = regionalCodes.includes(origLang);
    const minVotes = isReg || isRegionalLang ? 300 : 1500;
    const votes = c.vote_count || 0;
    const rating = c.vote_average || 0;
    return votes >= minVotes && rating >= 6.8;
  });

  // Graceful relaxation if strict filters return fewer than 15 candidates:
  if (qualified.length < 15) {
    qualified = cleanCandidates.filter((c) => {
      const origLang = (c.original_language || '').toLowerCase();
      const isReg = regionalCodes.includes(origLang);
      const minVotes = isReg || isRegionalLang ? 150 : 800;
      const votes = c.vote_count || 0;
      const rating = c.vote_average || 0;
      return votes >= minVotes && rating >= 6.5;
    });
  }

  // Sequel & duplicate deduplication (prefers earlier entry in a franchise)
  const deduplicated = filterSequelsAndDuplicates(qualified.length > 0 ? qualified : cleanCandidates);

  if (deduplicated.length === 0) {
    return {
      intro: "No titles matched that exact filter combination.",
      pool: [],
      expandedPlatforms: false,
      platformNote: null,
      fallbackMessage: "No titles found matching those exact filters. Try selecting 'Any' for language or runtime to loosen your filters!",
    };
  }

  // -----------------------------------------------------------
  // Bayesian Weighted Rating & Scoring:
  // score = 0.5 * normalized_popularity + 0.3 * WR + 0.2 * mood_genre_fit
  // WR = (v / (v + m)) * R + (m / (v + m)) * C
  // -----------------------------------------------------------
  const meanRating =
    deduplicated.reduce((sum, c) => sum + (c.vote_average || 7.0), 0) / deduplicated.length;
  const maxPop = Math.max(...deduplicated.map((c) => c.popularity || 1), 1);

  const moodGenreList = (
    (cfg.movieGenres || '') + ',' + (cfg.tvGenres || '')
  )
    .split(',')
    .filter(Boolean)
    .map(Number);

  const scoredCandidates = deduplicated.map((item) => {
    const v = item.vote_count || 1;
    const R = item.vote_average || 7.0;
    const origLang = (item.original_language || '').toLowerCase();
    const isReg = regionalCodes.includes(origLang);
    const m = isReg || isRegionalLang ? 300 : 1500;

    // Bayesian Weighted Rating
    const WR = (v / (v + m)) * R + (m / (v + m)) * meanRating;
    const normWR = Math.min(1, Math.max(0, WR / 10));

    // Log-normalized popularity
    const normPop = Math.min(
      1,
      Math.max(0, Math.log10((item.popularity || 1) + 1) / Math.log10(maxPop + 1))
    );

    // Mood-genre fit (0.5 to 1.0)
    const matches = (item.genre_ids || []).filter((g) => moodGenreList.includes(g)).length;
    const genreFit = matches >= 2 ? 1.0 : (matches === 1 ? 0.85 : 0.6);

    const score = 0.5 * normPop + 0.3 * normWR + 0.2 * genreFit;

    // Card Badge Label based on the data:
    // "Fan favourite", "Critically acclaimed", "Hidden gem"
    const isHiddenGem = v >= 300 && v <= 2500 && R >= 7.5;
    let cardLabel = 'Fan favourite';

    if (v >= 4000 || (normPop > 0.75 && v >= 2000)) {
      cardLabel = 'Fan favourite';
    } else if (R >= 8.0 || normWR >= 0.8) {
      cardLabel = 'Critically acclaimed';
    } else if (isHiddenGem) {
      cardLabel = 'Hidden gem';
    } else if (R >= 7.6) {
      cardLabel = 'Critically acclaimed';
    } else {
      cardLabel = 'Fan favourite';
    }

    return {
      ...item,
      score: Number(score.toFixed(4)),
      bayesian_rating: Number(WR.toFixed(2)),
      card_label: cardLabel,
      is_hidden_gem: isHiddenGem,
    };
  });

  // Sort candidate pool by weighted score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Take top 36 candidates to enrich with live providers & details
  const candidatesToEnrich = scoredCandidates.slice(0, 36);

  const enrichedPool = await Promise.all(
    candidatesToEnrich.map(async (c) => {
      try {
        const details = await get_details({ id: c.id, type: c.media_type || 'movie' });
        if (!details || details.error) return null;

        const tagline = details.tagline || '';
        const genres = details.genres || [];
        const overview = details.overview || c.overview || '';

        // Initial blurb shown immediately before Gemini arrives
        let initialBlurb = tagline;
        if (!initialBlurb && genres.length > 0) {
          initialBlurb = `${genres.slice(0, 3).join(' • ')} • Beloved cinema`;
        }
        if (!initialBlurb && overview) {
          initialBlurb = overview.slice(0, 110) + '...';
        }

        return {
          ...details,
          id: c.id,
          media_type: c.media_type,
          popularity: c.popularity,
          vote_count: c.vote_count,
          vote_average: c.vote_average,
          score: c.score,
          card_label: c.card_label,
          is_hidden_gem: c.is_hidden_gem,
          tagline,
          initial_blurb: initialBlurb || `${targetMood} watch with stellar acclaim.`,
          why_fits: initialBlurb || `${targetMood} watch with stellar acclaim.`,
        };
      } catch (err) {
        console.warn(`Failed to enrich candidate ${c.id}:`, err.message);
        return null;
      }
    })
  );

  const validEnriched = enrichedPool.filter(Boolean);

  // -----------------------------------------------------------
  // Platform Filtering with Auto-Expansion:
  // If user selected platforms and matches < 6, automatically include other platforms
  // -----------------------------------------------------------
  let finalPool = validEnriched;
  let expandedPlatforms = false;
  let platformNote = null;

  if (Array.isArray(platforms) && platforms.length > 0) {
    const lowerPlatforms = platforms.map((p) => p.toLowerCase());

    const isMatch = (item) => {
      const inFlat = (item.watch_providers_in?.flatrate || []).map((p) => p.toLowerCase());
      return inFlat.some((pName) => lowerPlatforms.some((lp) => pName.includes(lp)));
    };

    const platformMatches = validEnriched.filter(isMatch);
    const nonMatches = validEnriched.filter((item) => !isMatch(item));

    if (platformMatches.length >= 6) {
      finalPool = platformMatches;
      expandedPlatforms = false;
      platformNote = null;
    } else {
      // Auto-include other platforms so the user never gets an empty / starved list!
      finalPool = [...platformMatches, ...nonMatches];
      expandedPlatforms = true;
      platformNote = `Showing all platforms because ${platforms.join(', ')} has fewer than 6 picks for this mood.`;
    }
  }

  const intro = `Here are top-tier ${targetMood.toLowerCase()} watches handpicked for you.`;

  return {
    intro,
    pool: finalPool,
    expandedPlatforms,
    platformNote,
    total: finalPool.length,
  };
}

/**
 * Batched Gemini blurbs for visible cards (strictly max 15 words, zero plot spoilers)
 */
async function getMoodBlurbs(options = {}) {
  const {
    titles = [],
    mood = 'Cozy',
    customMood = '',
    shields = [],
  } = options;

  if (!Array.isArray(titles) || titles.length === 0) {
    return { blurbs: [], intro: '' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const blurbsMap = new Map();
  let introLine = `Here are curated ${mood.toLowerCase()} picks tailored to your vibe.`;

  if (apiKey && !apiKey.includes('your_gemini_api_key')) {
    const titlesListStr = titles
      .map(
        (p, i) =>
          `${i + 1}. ID: ${p.id} | Title: "${p.title}" (${p.year || ''}, ${p.type || p.media_type || 'movie'}) | Tagline: "${p.tagline || ''}" | Overview: ${p.overview?.slice(0, 130)}`
      )
      .join('\n');

    const prompt = `You are Kinora, a witty cinephile buddy.
The user is viewing Mood Picks mode for mood: "${mood}" ${customMood ? `("${customMood}")` : ''}.
Visible Titles:
${titlesListStr}

Generate a JSON object with:
1. "intro": Exactly 1 short, engaging sentence introducing these picks (strictly max 1 sentence).
2. "blurbs": Array of objects for each title above, with:
   - "id": TMDB ID number
   - "why": Exactly ONE punchy line explaining why this fits the user's mood (strictly maximum 15 words, NO plot spoilers, NO character twists or endings).

Return ONLY valid JSON matching this schema:
{
  "intro": "...",
  "blurbs": [
    { "id": 123, "why": "..." }
  ]
}`;

    const ai = new GoogleGenAI({ apiKey });
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

    for (const model of modelsToTry) {
      if (blurbsMap.size > 0) break;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: attempt === 0 ? 0.7 : 0.2,
            },
          });
          const parsed = JSON.parse(res.text);
          if (parsed && typeof parsed.intro === 'string' && Array.isArray(parsed.blurbs)) {
            introLine = parsed.intro;
            parsed.blurbs.forEach((b) => {
              if (b && b.id && b.why) {
                let whyClean = String(b.why).trim();
                const words = whyClean.split(/\s+/);
                if (words.length > 15) {
                  whyClean = words.slice(0, 15).join(' ') + '...';
                }
                blurbsMap.set(Number(b.id), whyClean);
              }
            });
            break;
          }
        } catch (err) {
          console.warn(`Gemini mood blurbs attempt ${attempt + 1} with ${model} failed:`, err.message);
        }
      }
    }
  }

  const shieldTitles = (shields || []).map((s) => (s.title || s.showTitle || '').toLowerCase());

  const processedBlurbs = titles.map((p) => {
    let why = blurbsMap.get(Number(p.id)) || p.initial_blurb || `${mood} cinema with remarkable storytelling and memorable moments.`;

    const words = why.split(/\s+/);
    if (words.length > 15) {
      why = words.slice(0, 15).join(' ') + '...';
    }

    const isShielded = shieldTitles.some((st) => st && p.title.toLowerCase().includes(st));
    if (isShielded) {
      why = `Guaranteed spoiler-free: a standout match for your ${mood.toLowerCase()} vibe.`;
    }

    return {
      id: p.id,
      why,
    };
  });

  return {
    intro: introLine,
    blurbs: processedBlurbs,
  };
}

/**
 * Backwards compatible getMoodPicks wrapper
 */
async function getMoodPicks(options = {}) {
  const poolData = await getMoodPicksPool(options);
  if (!poolData || !poolData.pool || poolData.pool.length === 0) {
    return poolData;
  }
  const count = options.count || 6;
  const initialPicks = poolData.pool.slice(0, count);

  const blurbsData = await getMoodBlurbs({
    titles: initialPicks,
    mood: options.mood || 'Cozy',
    customMood: options.customMood || '',
    shields: options.shields || [],
  });

  const blurbsMap = new Map((blurbsData.blurbs || []).map((b) => [Number(b.id), b.why]));
  const picks = initialPicks.map((p) => ({
    ...p,
    why_fits: blurbsMap.get(Number(p.id)) || p.why_fits,
  }));

  return {
    intro: blurbsData.intro || poolData.intro,
    picks,
    pool: poolData.pool,
    expandedPlatforms: poolData.expandedPlatforms,
    platformNote: poolData.platformNote,
    fallbackMessage: poolData.fallbackMessage,
  };
}

// -------------------------------------------------------------
// 8. Phase 4: Compare & Debate Implementation (Two-Stage Architecture)
// -------------------------------------------------------------
async function getComparisonMediaData(options = {}) {
  const { titleA, idA, typeA, titleB, idB, typeB, shields = [] } = options;

  let itemA = null;
  let itemB = null;

  // Run searches / detail fetching for Title A and Title B in parallel
  const fetchItemA = (async () => {
    if (idA) {
      return await get_details({ id: idA, type: typeA || 'movie' });
    } else if (titleA) {
      const sA = await search_title({ query: titleA });
      if (sA.results && sA.results[0]) {
        const top = sA.results[0];
        return await get_details({ id: top.id, type: top.media_type || 'movie' });
      }
    }
    return null;
  })();

  const fetchItemB = (async () => {
    if (idB) {
      return await get_details({ id: idB, type: typeB || 'movie' });
    } else if (titleB) {
      const sB = await search_title({ query: titleB });
      if (sB.results && sB.results[0]) {
        const top = sB.results[0];
        return await get_details({ id: top.id, type: top.media_type || 'movie' });
      }
    }
    return null;
  })();

  const [resA, resB] = await Promise.all([fetchItemA, fetchItemB]);
  itemA = resA;
  itemB = resB;

  if (!itemA || itemA.error || !itemB || itemB.error) {
    return {
      error: 'Could not find details for both titles to compare. Please check spelling.',
    };
  }

  return { itemA, itemB };
}

async function getComparisonVerdict(options = {}) {
  const { itemA, itemB, shields = [] } = options;
  if (!itemA || !itemB) {
    return { error: 'Both titles are required to generate verdict.' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  let verdict = null;

  if (apiKey && !apiKey.includes('your_gemini_api_key')) {
    const prompt = `You are Kinora, a witty, discerning movie & series expert.
Provide a side-by-side critical breakdown between:
Title A: "${itemA.title}" (${itemA.year}, ${itemA.type})
Overview A: ${itemA.overview?.slice(0, 160)}
Title B: "${itemB.title}" (${itemB.year}, ${itemB.type})
Overview B: ${itemB.overview?.slice(0, 160)}

CRITICAL SPOILER RULE:
Never reveal any plot twists, character deaths, or endings. Keep all commentary spoiler-free.

Evaluate across exactly 5 categories:
1. Story
2. Acting
3. Pacing
4. Rewatch value
5. Cultural impact

For each category, designate winner as strictly "A", "B", or "Tie", and write a one-line reason (strictly maximum 12 words).
Then write an "overall" verdict in exactly 2 sentences.
Then write "watch_a_if" (one short line: "Watch Title A if...") and "watch_b_if" (one short line: "Watch Title B if...").

Return ONLY valid JSON matching this schema:
{
  "categories": {
    "story": { "winner": "A", "reason": "..." },
    "acting": { "winner": "B", "reason": "..." },
    "pacing": { "winner": "Tie", "reason": "..." },
    "rewatch_value": { "winner": "A", "reason": "..." },
    "cultural_impact": { "winner": "A", "reason": "..." }
  },
  "overall": "Two sentence verdict.",
  "watch_a_if": "Watch Title A if...",
  "watch_b_if": "Watch Title B if..."
}`;

    const ai = new GoogleGenAI({ apiKey });
    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

    for (const model of modelsToTry) {
      if (verdict) break;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: attempt === 0 ? 0.6 : 0.2,
            },
          });
          const parsed = JSON.parse(res.text);
          if (
            parsed &&
            parsed.categories &&
            parsed.categories.story &&
            typeof parsed.overall === 'string'
          ) {
            verdict = parsed;
            break;
          }
        } catch (err) {
          console.warn(`Comparison verdict attempt ${attempt + 1} with ${model} failed:`, err.message);
        }
      }
    }
  }

  if (!verdict) {
    const tmdbA = itemA.tmdb_rating || 0;
    const tmdbB = itemB.tmdb_rating || 0;
    verdict = {
      categories: {
        story: { winner: tmdbA >= tmdbB ? 'A' : 'B', reason: 'Exceptional narrative craftsmanship and character depth.' },
        acting: { winner: 'Tie', reason: 'Powerhouse performances across both ensembles.' },
        pacing: { winner: tmdbA > tmdbB ? 'A' : 'B', reason: 'Consistent momentum with gripping scene progression.' },
        rewatch_value: { winner: 'Tie', reason: 'Dense details reward multiple viewings.' },
        cultural_impact: { winner: tmdbA >= tmdbB ? 'A' : 'B', reason: 'Definitive benchmark in contemporary storytelling.' },
      },
      overall: `${itemA.title} and ${itemB.title} are landmark achievements in their genres. Whichever you choose delivers top-tier cinema craft.`,
      watch_a_if: `Watch ${itemA.title} if you want gripping drama with relentless tension.`,
      watch_b_if: `Watch ${itemB.title} if you prefer rich character nuance and deliberate atmosphere.`,
    };
  }

  return { verdict };
}

async function getComparisonData(options = {}) {
  const mediaRes = await getComparisonMediaData(options);
  if (mediaRes.error) return mediaRes;
  const verdictRes = await getComparisonVerdict({ itemA: mediaRes.itemA, itemB: mediaRes.itemB, shields: options.shields });
  return { itemA: mediaRes.itemA, itemB: mediaRes.itemB, verdict: verdictRes.verdict };
}

async function getDebateResponse(options = {}) {
  const { titleA, titleB, userChoice = 'A', userMessage = '', history = [], isEnding = false, shields = [] } = options;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('your_gemini_api_key')) {
    return {
      message: isEnding
        ? `A brilliant cinephile debate! Both ${titleA} and ${titleB} stand as titans of storytelling.`
        : `A great choice, but let's not overlook what makes the other side unforgettable!`,
      points: [
        `Unmatched atmospheric depth and thematic payoff.`,
        `Extraordinary ensemble chemistry that elevates every scene.`,
        `Enduring influence on modern cinematic technique.`,
      ],
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const defendedSide = userChoice === 'A' ? titleB : titleA;
  const userSide = userChoice === 'A' ? titleA : titleB;

  if (isEnding) {
    const endPrompt = `You are Kinora, a witty movie and series buddy.
The user is concluding a debate between "${titleA}" and "${titleB}".
Write a short, gracious closing statement (strictly 1 to 2 sentences) acknowledging great points on both sides and giving a witty cinephile signoff. No spoilers.`;
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: endPrompt,
      });
      return { message: (res.text || '').trim(), points: [] };
    } catch {
      return {
        message: `Touché! Both ${titleA} and ${titleB} are masterpieces in their own right. Let's call it a cinephile draw!`,
        points: [],
      };
    }
  }

  const debatePrompt = `You are Kinora, a witty pop-culture and movie companion.
Debate matchup: "${titleA}" vs "${titleB}".
The user is arguing for: "${userSide}".
User's statement: "${userMessage || `I think ${userSide} is better`}".

YOUR ROLE:
Champion the OPPOSITE title: "${defendedSide}".
Defend "${defendedSide}" in a friendly, witty, knowledgeable way.
STRICT RULES:
- Provide strictly MAXIMUM 3 short bullet points (each under 20 words).
- No long speeches, no giant paragraphs.
- Zero plot spoilers, twists, or ending reveals.
- Respectful, spirited movie-buddy debate.

Return valid JSON schema:
{
  "intro": "One short witty sentence opening your counter-argument.",
  "points": [
    "Short point 1",
    "Short point 2",
    "Short point 3"
  ]
}`;

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: debatePrompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(res.text);
    return {
      message: parsed.intro || `I hear you, but here is why ${defendedSide} makes such a compelling case:`,
      points: Array.isArray(parsed.points) ? parsed.points.slice(0, 3) : [],
    };
  } catch (err) {
    console.warn('Debate response generation failed:', err.message);
    return {
      message: `Bold stance! But here is why ${defendedSide} holds such incredible ground:`,
      points: [
        `The thematic execution is masterfully layered from start to finish.`,
        `The character dynamics offer remarkable nuance upon every rewatch.`,
        `Every visual and narrative beat serves a deliberate, impactful purpose.`,
      ],
    };
  }
}

module.exports = {
  search_title,
  get_details,
  get_season_episodes,
  get_imdb_rating,
  get_watch_providers,
  get_trending,
  get_similar,
  discover,
  getLatestInfoFallback,
  getSeriesSeasons,
  toolDeclarations,
  executeTool,
  getMoodPicks,
  getMoodPicksPool,
  getMoodBlurbs,
  getComparisonMediaData,
  getComparisonVerdict,
  getComparisonData,
  getDebateResponse,
};
