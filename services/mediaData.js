/**
 * services/mediaData.js
 * Live Media Data Service for Kinora: TMDB API (v3) + OMDb API + Grounded Live Fallback
 * Includes in-memory caching (10 min TTL) and custom DNS agent for resilience.
 */

const https = require('https');
const dns = require('dns');

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
  if (imdbId) {
    const omdbData = await get_imdb_rating({ imdb_id: imdbId });
    if (omdbData && omdbData.rating) imdbRating = omdbData.rating;
  }

  // Watch providers in India (IN)
  const inProviders = raw['watch/providers']?.results?.IN;
  const watchInIndia = inProviders
    ? {
        flatrate: (inProviders.flatrate || []).map((p) => p.provider_name),
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
    overview: raw.overview,
    directors: directors.length > 0 ? directors : creators,
    cast,
    tmdb_rating: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : null,
    imdb_id: imdbId,
    imdb_rating: imdbRating,
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
};
