/**
 * Kinora - Frontend Application Logic
 * Clean, calm, fast vanilla JavaScript with "One request at a time" discipline.
 */

// Dynamic mobile viewport height calculation (handles address bar expansion and mobile virtual keyboards)
function updateAppHeight() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${vh}px`);
}
updateAppHeight();
window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', updateAppHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateAppHeight);
}

// ========================================================
// 1. STORAGE KEYS & APP STATE
// ========================================================
const STORAGE_KEYS = {
  SESSIONS: 'kinora_sessions_v1',
  ACTIVE_SESSION: 'kinora_active_session_id_v1',
  SHIELDS: 'kinora_shields',       // Single Source of Truth for all protected titles + activeId
  WATCHLIST: 'kinora_watchlist_v1',
  THEME: 'kinora_theme_v1',
  MODE: 'kinora_mode_v1',
  INSPECTOR_OPEN: 'kinora_inspector_open_v1',
  INSPECTOR_MANUAL_CLOSED: 'kinora_inspector_manual_closed_v1',
};

// ========================================================
// 1.1 SHIELDS STORE (SINGLE SOURCE OF TRUTH)
// ========================================================
const ShieldsStore = {
  getRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SHIELDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.shields)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error reading ShieldsStore:', e);
    }
    return this._migrateLegacy();
  },

  _migrateLegacy() {
    try {
      let migratedShields = [];
      let activeId = null;

      const oldList = localStorage.getItem('kinora_progress_titles');
      if (oldList) {
        try {
          const arr = JSON.parse(oldList);
          if (Array.isArray(arr)) migratedShields = arr;
        } catch {}
      }

      const oldActiveId = localStorage.getItem('kinora_progress_active_id');
      if (oldActiveId) activeId = oldActiveId;

      const legacySingle = localStorage.getItem('kinora_spoiler_shield_v1');
      if (legacySingle) {
        try {
          const s = JSON.parse(legacySingle);
          if (s && (s.showTitle || s.title)) {
            const id = s.tmdbId || s.id || s.showTitle || s.title;
            const exists = migratedShields.some((item) => (item.tmdbId || item.id || item.title || item.showTitle) === id);
            if (!exists) {
              migratedShields.unshift(s);
            }
            if (!activeId) activeId = id;
          }
        } catch {}
      }

      const normalized = migratedShields.map((item) => this._normalizeShield(item));
      const storeData = {
        activeId: activeId ? String(activeId) : (normalized[0] ? String(normalized[0].tmdbId || normalized[0].title) : null),
        shields: normalized,
      };

      localStorage.setItem(STORAGE_KEYS.SHIELDS, JSON.stringify(storeData));
      return storeData;
    } catch (e) {
      console.warn('Legacy shields migration error:', e);
      return { activeId: null, shields: [] };
    }
  },

  _normalizeShield(s) {
    const tmdbId = s.tmdbId || s.id || null;
    const title = s.title || s.showTitle || 'Unknown Title';
    const type = (s.type === 'movie' || s.media_type === 'movie') ? 'movie' : 'tv';
    const season = s.season != null ? parseInt(s.season, 10) : 1;
    const episode = s.episode != null ? parseInt(s.episode, 10) : 1;
    const absoluteEpisode = s.absoluteEpisode ? parseInt(s.absoluteEpisode, 10) : null;
    const havenNotStarted = Boolean(s.havenNotStarted);
    const movieWatched = Boolean(s.movieWatched);

    let progress = s.progress || '';
    if (!progress) {
      if (type === 'movie') {
        progress = movieWatched ? 'Watched' : 'Not Watched';
      } else if (havenNotStarted) {
        progress = "Haven't started";
      } else if (absoluteEpisode) {
        progress = `Ep ${absoluteEpisode}`;
      } else {
        progress = `S${season} E${episode}`;
      }
    }

    return {
      tmdbId,
      id: tmdbId,
      title,
      showTitle: title,
      type,
      media_type: type,
      poster: s.poster || s.poster_path || s.poster_url || null,
      poster_path: s.poster || s.poster_path || s.poster_url || null,
      year: s.year || '',
      season,
      episode,
      absoluteEpisode,
      havenNotStarted,
      movieWatched,
      progress,
      active: false,
    };
  },

  save(data) {
    try {
      localStorage.setItem(STORAGE_KEYS.SHIELDS, JSON.stringify(data));
    } catch (e) {
      console.warn('Error saving ShieldsStore:', e);
    }
    if (typeof onShieldsChanged === 'function') {
      onShieldsChanged();
    }
  },

  getAll() {
    const data = this.getRaw();
    return data.shields.map((s) => ({
      ...s,
      active: String(s.tmdbId || s.title) === String(data.activeId),
    }));
  },

  getActive() {
    const data = this.getRaw();
    if (!data.shields || data.shields.length === 0) return null;
    if (data.activeId) {
      const found = data.shields.find((s) => String(s.tmdbId || s.title) === String(data.activeId));
      if (found) return { ...found, active: true };
    }
    return { ...data.shields[0], active: true };
  },

  setActive(idOrTitle) {
    if (!idOrTitle) return null;
    const data = this.getRaw();
    const strId = String(idOrTitle).toLowerCase();
    const match = data.shields.find((s) =>
      String(s.tmdbId).toLowerCase() === strId ||
      String(s.title).toLowerCase() === strId
    );
    if (match) {
      data.activeId = String(match.tmdbId || match.title);
      this.save(data);
      return match;
    }
    return null;
  },

  upsert(shieldInput, makeActive = true) {
    const data = this.getRaw();
    const normalized = this._normalizeShield(shieldInput);
    const matchIdx = data.shields.findIndex((s) =>
      (normalized.tmdbId && String(s.tmdbId) === String(normalized.tmdbId)) ||
      String(s.title).toLowerCase() === String(normalized.title).toLowerCase()
    );

    if (matchIdx >= 0) {
      data.shields[matchIdx] = {
        ...data.shields[matchIdx],
        ...normalized,
        poster: normalized.poster || data.shields[matchIdx].poster,
        year: normalized.year || data.shields[matchIdx].year,
      };
      if (makeActive) {
        data.activeId = String(data.shields[matchIdx].tmdbId || data.shields[matchIdx].title);
      }
    } else {
      data.shields.unshift(normalized);
      if (makeActive || data.shields.length === 1) {
        data.activeId = String(normalized.tmdbId || normalized.title);
      }
    }

    this.save(data);
    return this.getActive();
  },

  updateProgress(targetIdOrTitle, season, episode, absoluteEpisode = null) {
    const data = this.getRaw();
    let target = null;
    if (targetIdOrTitle) {
      const query = String(targetIdOrTitle).toLowerCase();
      target = data.shields.find((s) =>
        String(s.tmdbId).toLowerCase() === query ||
        String(s.title).toLowerCase() === query ||
        String(s.title).toLowerCase().includes(query) ||
        query.includes(String(s.title).toLowerCase())
      );
    }
    if (!target) {
      target = this.getActive();
    }
    if (!target) return null;

    target.havenNotStarted = false;
    if (absoluteEpisode != null) {
      target.absoluteEpisode = parseInt(absoluteEpisode, 10);
      target.progress = `Ep ${target.absoluteEpisode}`;
    } else {
      target.season = season != null ? parseInt(season, 10) : (target.season || 1);
      target.episode = episode != null ? parseInt(episode, 10) : 1;
      target.progress = `S${target.season} E${target.episode}`;
    }

    return this.upsert(target, true);
  },

  remove(idOrTitle) {
    if (!idOrTitle) return null;
    const data = this.getRaw();
    const str = String(idOrTitle).toLowerCase();
    const idx = data.shields.findIndex((s) =>
      String(s.tmdbId).toLowerCase() === str ||
      String(s.title).toLowerCase() === str
    );
    if (idx === -1) return null;

    const [removed] = data.shields.splice(idx, 1);
    const removedKey = String(removed.tmdbId || removed.title).toLowerCase();
    const activeKey = String(data.activeId || '').toLowerCase();

    if (activeKey === str || activeKey === removedKey) {
      data.activeId = data.shields.length > 0
        ? String(data.shields[0].tmdbId || data.shields[0].title)
        : null;
    }

    // Clean legacy entries to avoid resurrecting
    try {
      localStorage.removeItem(`kinora_progress_${removed.tmdbId || removed.title}`);
      localStorage.removeItem('kinora_progress_active_id');
    } catch {}

    this.save(data);
    return removed;
  },

  undoRemove(removedItem) {
    if (!removedItem) return;
    const data = this.getRaw();
    const normalized = this._normalizeShield(removedItem);
    data.shields.unshift(normalized);
    data.activeId = String(normalized.tmdbId || normalized.title);
    this.save(data);
  },
};

const state = {
  sessions: [],
  currentSessionId: null,
  currentMode: 'general',
  lastUserPrompt: '',
  isGenerating: false,            // Single global flag for one request at a time
  currentAbortController: null,  // Active AbortController for cancelation
  spoilerShield: {
    active: false,
    tmdbId: null,
    showTitle: '',
    type: 'tv',
    season: 1,
    episode: 1,
    absoluteEpisode: null,
    havenNotStarted: false,
    movieWatched: false,
    poster_path: null,
    year: '',
    progress: '',
  },
  savedShields: [],               // Multi-show progress titles from ShieldsStore
  currentSetupMedia: null,        // Media currently being configured in the modal
  watchlist: [],
  theme: 'dark',
  isListening: false,
  activeTitleInspectorData: null,
};

// ========================================================
// 1.5 SVG ICON SYSTEM (Real Vector Graphics across Kinora)
// ========================================================
const ICONS = {
  general: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  'spoiler-safe': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  'mood-picks': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x2="15.01" y1="9" x2="15" y2="9"/></svg>`,
  quiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 4h16v6a6 6 0 0 1-12 0V4z"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>`,
  character: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  compare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
  'for-you': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x2="17" y2="22" x1="17" y1="2"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
  galaxy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="2" y1="12" x2="4" y2="12"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  scale: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`,
  user: `<svg class="avatar-user-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  brain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 4h16v6a6 6 0 0 1-12 0V4z"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>`,
  sword: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  fastForward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  ghost: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`,
  cassette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M8 12h8"/><path d="M6 16h12"/></svg>`,
  smile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x2="15.01" y1="9" x2="15" y2="9"/></svg>`,
  building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="12"/><line x1="15" y1="22" x2="15" y2="12"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
  flask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 9h4M10 3v6l-6 10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2L14 9V3"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M15 9a3 3 0 0 0-6 0c0 1.3.5 2.1 1.5 3.5.5.7.5 1.5.5 2.5h2c0-1 0-1.8.5-2.5 1-1.4 1.5-2.2 1.5-3.5z"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  panelRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>`,
  shieldPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
};

const EMOJI_MAP = {
  '⚡': 'general',
  '🛡️': 'shield',
  '🎭': 'mood-picks',
  '🏆': 'quiz',
  '🎙️': 'character',
  '⚖️': 'compare',
  '✨': 'sparkles',
  '🌌': 'galaxy',
  '☕': 'coffee',
  '🎬': 'film',
  '⭐': 'star',
  '⏱️': 'clock',
  '📺': 'tv',
  '👤': 'user',
  '🔍': 'search',
  '🧠': 'brain',
  '🌧️': 'rain',
  '💔': 'rain',
  '👻': 'ghost',
  '📼': 'cassette',
  '😂': 'smile',
  '🏢': 'building',
  '🐉': 'sword',
  '👑': 'crown',
  '🪐': 'galaxy',
  '🧪': 'flask',
  '🧙‍♂️': 'sparkles',
  '🦾': 'general',
  '⚗️': 'flask',
  '👔': 'user',
  '🚀': 'rocket',
  '🦇': 'shield',
  '⚔️': 'sword',
  '🍿': 'film',
  '💎': 'sparkles',
  '🇯🇵': 'film',
  '📝': 'fileText',
  '💡': 'lightbulb',
  '⏩': 'fastForward',
  '⏳': 'clock',
  '🤝': 'scale',
  '✕': 'close',
  '✓': 'check',
  '+': 'plus',
  '➔': 'arrowRight'
};

function renderIcon(keyOrEmoji, size = 20, extraClass = '') {
  if (!keyOrEmoji) return '';
  let svg = '';
  if (typeof keyOrEmoji === 'string' && keyOrEmoji.trim().startsWith('<svg')) {
    svg = keyOrEmoji.trim();
  } else if (ICONS[keyOrEmoji]) {
    svg = ICONS[keyOrEmoji];
  } else if (EMOJI_MAP[keyOrEmoji] && ICONS[EMOJI_MAP[keyOrEmoji]]) {
    svg = ICONS[EMOJI_MAP[keyOrEmoji]];
  } else {
    svg = ICONS.general;
  }

  // Ensure explicit width, height, stroke-width="1.75", and class="icon ..."
  svg = svg.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
    let cleaned = attrs
      .replace(/\s*width="[^"]*"/gi, '')
      .replace(/\s*height="[^"]*"/gi, '')
      .replace(/\s*stroke-width="[^"]*"/gi, '')
      .replace(/\s*class="[^"]*"/gi, '');
    const isFilled = attrs.includes('fill="currentColor"') && !attrs.includes('stroke=');
    const sw = isFilled ? '' : 'stroke-width="1.75"';
    const classes = ('icon ' + (extraClass || '')).trim();
    return `<svg width="${size}" height="${size}" ${sw} class="${classes}" ${cleaned}>`;
  });
  return svg;
}

// ========================================================
// 2. MODE CONFIGURATION & WELCOME CONTENT
// ========================================================
const MODE_DATA = {
  general: {
    icon: 'general',
    title: 'Kinora AI',
    tagline: 'Every story, zero spoilers.',
    chips: [
      { icon: 'galaxy', text: 'Mind-Bending Sci-Fi', desc: 'Under 2 hours • Twist endings', prompt: 'Recommend 3 mind-bending sci-fi movies under 2 hours' },
      { icon: 'shield', text: 'Dark S02E04 Safe Recap', desc: 'Spoiler Shield in action', prompt: 'I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap' },
      { icon: 'scale', text: 'Breaking Bad vs BCS', desc: 'Side-by-side cinema showdown', prompt: 'Compare Breaking Bad vs Better Call Saul' },
      { icon: 'coffee', text: 'Comfort Movie Night', desc: 'Cozy, warm & feel-good watches', prompt: 'Give me a cozy comfort movie to unwind after a long day' },
    ],
  },
  'spoiler-safe': {
    icon: 'spoiler-safe',
    title: 'Spoiler Shield',
    tagline: 'Guaranteed safe up to your exact episode.',
    chips: [
      { icon: 'clock', text: 'Dark Progress Check', prompt: 'I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap' },
      { icon: 'building', text: 'Severance S1 Recap', prompt: 'Give me a spoiler-safe recap of Severance Season 1 Episode 3' },
      { icon: 'sword', text: 'House of the Dragon', prompt: 'Where am I safe without spoilers in House of the Dragon Season 1?' },
      { icon: 'crown', text: 'Succession Safe Recap', prompt: 'Succession Season 2 Episode 5 safe plot recap' },
    ],
  },
  'mood-picks': {
    icon: 'mood-picks',
    title: 'Mood Picks',
    tagline: 'Tell me your vibe, get 3 tailored watches.',
    chips: [
      { icon: 'coffee', text: 'Cozy & Heartwarming', prompt: 'Give me 3 lighthearted cozy movies to cheer me up' },
      { icon: 'brain', text: 'Mind-Bending Mystery', prompt: 'Recommend 3 mind-bending mystery thrillers under 2 hours' },
      { icon: 'general', text: 'Hyped High-Octane', prompt: '3 pulse-pounding action movies with great pacing' },
      { icon: 'rain', text: 'Melancholic Drama', prompt: '3 beautifully bittersweet cinematic dramas' },
    ],
  },
  quiz: {
    icon: 'quiz',
    title: 'Quiz & Trivia',
    tagline: 'Test your cinephile knowledge.',
    chips: [
      { icon: 'galaxy', text: 'Interstellar Trivia', prompt: 'Quiz me on Interstellar with 3 multiple choice questions' },
      { icon: 'flask', text: 'Breaking Bad Quiz', prompt: 'Quiz me on Breaking Bad with 3 trivia questions' },
      { icon: 'sparkles', text: 'Lord of the Rings', prompt: 'Give me 3 tough Lord of the Rings trivia questions' },
      { icon: 'film', text: 'Classic Cinema Quiz', prompt: 'Quiz me on classic 90s cinema trivia' },
    ],
  },
  character: {
    icon: 'character',
    title: 'Character Chat',
    tagline: 'Chat directly in iconic character voices.',
    chips: [
      { icon: 'general', text: 'Tony Stark', prompt: 'Talk to Tony Stark about time travel and Jarvis' },
      { icon: 'flask', text: 'Walter White', prompt: 'Speak as Walter White about chemistry and ambition' },
      { icon: 'search', text: 'Sherlock Holmes', prompt: 'Speak as Sherlock Holmes and deduce my movie taste' },
      { icon: 'user', text: 'Michael Scott', prompt: 'Speak as Michael Scott recommending a movie for movie night' },
    ],
  },
  compare: {
    icon: 'compare',
    title: 'Compare & Debate',
    tagline: 'Side-by-side breakdowns and honest verdicts.',
    chips: [
      { icon: 'scale', text: 'Breaking Bad vs BCS', prompt: 'Compare Breaking Bad vs Better Call Saul across writing, pacing, acting' },
      { icon: 'rocket', text: 'Interstellar vs Inception', prompt: 'Compare Interstellar vs Inception and give your verdict' },
      { icon: 'shield', text: 'The Dark Knight vs The Batman', prompt: 'Compare The Dark Knight vs The Batman (2022)' },
      { icon: 'sword', text: 'House of Dragon vs Rings of Power', prompt: 'Compare House of the Dragon vs The Rings of Power' },
    ],
  },
  'for-you': {
    icon: 'for-you',
    title: 'Taste Profile',
    tagline: 'Personalized recommendations based on what you love.',
    chips: [
      { icon: 'sparkles', text: 'Recommend Based on Sci-Fi', prompt: 'Based on my love for Dark and Inception, recommend 3 hidden gems' },
      { icon: 'film', text: 'Weekend Watchlist Picks', prompt: 'Recommend 3 movies for my weekend watch' },
      { icon: 'film', text: 'Anime Recommendations', prompt: 'Recommend 3 gateway anime movies with deep philosophical themes' },
      { icon: 'sparkles', text: 'Under-the-radar Gems', prompt: 'Recommend 3 highly-rated under-the-radar movies from 2023-2024' },
    ],
  },
};

// ========================================================
// 3. DOM ELEMENT REFERENCES
// ========================================================
const dom = {
  // Sidebar & Navigation
  brandHomeLink: document.getElementById('brand-home-link'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  mobileOverlay: document.getElementById('mobile-overlay'),
  btnNewChat: document.getElementById('btn-new-chat'),
  modeNav: document.getElementById('mode-nav'),
  historyList: document.getElementById('history-list'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  btnOpenWatchlist: document.getElementById('btn-open-watchlist'),
  watchlistCount: document.getElementById('watchlist-count'),

  // Header & Topbar
  currentModeTitle: document.getElementById('current-mode-title'),
  topbarShieldsBar: document.getElementById('topbar-shields-bar'),
  topbarChipsList: document.getElementById('topbar-chips-list'),
  btnAddShieldTopbar: document.getElementById('btn-add-shield-topbar'),
  btnMobileAddShield: document.getElementById('btn-mobile-add-shield'),
  btnToggleInspector: document.getElementById('btn-toggle-inspector'),
  shieldOverflowWrapper: document.getElementById('shield-overflow-wrapper'),
  btnOverflowChip: document.getElementById('btn-overflow-chip'),
  shieldOverflowDropdown: document.getElementById('shield-overflow-dropdown'),
  btnToggleTheme: document.getElementById('btn-toggle-theme'),
  themeIconMoon: document.getElementById('theme-icon-moon'),
  themeIconSun: document.getElementById('theme-icon-sun'),

  // Chat Stage
  chatViewport: document.getElementById('chat-viewport'),
  heroWelcome: document.getElementById('hero-welcome'),
  heroTagline: document.getElementById('hero-tagline'),
  heroChipsGrid: document.getElementById('hero-chips-grid'),
  messagesContainer: document.getElementById('messages-container'),

  // Input
  chatForm: document.getElementById('chat-form'),
  inputWrapper: document.getElementById('input-wrapper'),
  inputFieldWrap: document.getElementById('input-field-wrap'),
  chatInput: document.getElementById('chat-input'),
  rotatingPlaceholder: document.getElementById('rotating-placeholder'),
  inputModeTag: document.getElementById('input-mode-tag'),
  btnVoiceInput: document.getElementById('btn-voice-input'),
  btnSend: document.getElementById('btn-send'),

  // Inspector Panel (Collapsed by default)
  inspectorPanel: document.getElementById('inspector-panel'),
  btnCloseInspector: document.getElementById('btn-close-inspector'),
  inspectorOverlay: document.getElementById('inspector-overlay'),
  inspectorDragHandle: document.getElementById('inspector-drag-handle'),
  mobileInspectorPill: document.getElementById('mobile-inspector-pill'),
  mobileInspectorPillText: document.getElementById('mobile-inspector-pill-text'),

  // Watchlist Modal
  watchlistModal: document.getElementById('watchlist-modal'),
  btnCloseWatchlistModal: document.getElementById('btn-close-watchlist-modal'),
  watchlistForm: document.getElementById('watchlist-form'),
  watchlistAddInput: document.getElementById('watchlist-add-input'),
  watchlistSearchWrapper: document.getElementById('watchlist-search-wrapper'),
  watchlistSearchSpinner: document.getElementById('watchlist-search-spinner'),
  watchlistSearchClear: document.getElementById('btn-watchlist-search-clear'),
  watchlistSearchResults: document.getElementById('watchlist-search-results'),
  watchlistFilterTabs: document.getElementById('watchlist-filter-tabs'),
  watchlistSortSelect: document.getElementById('watchlist-sort-select'),
  watchlistList: document.getElementById('watchlist-list'),

  // Spoiler Shield Setup & Management
  spoilerModal: document.getElementById('spoiler-modal'),
  btnCloseSpoilerModal: document.getElementById('btn-close-spoiler-modal'),
  btnOpenAddShow: document.getElementById('btn-open-add-show'),
  btnCancelSearch: document.getElementById('btn-cancel-search'),
  shieldSearchSection: document.getElementById('shield-search-section'),
  shieldSearchInput: document.getElementById('shield-search-input'),
  shieldSearchSpinner: document.getElementById('shield-search-spinner'),
  shieldResultsList: document.getElementById('shield-results-list'),
  shieldsListSection: document.getElementById('shields-list-section'),
  shieldSavedCount: document.getElementById('shield-saved-count'),
  shieldSavedList: document.getElementById('shield-saved-list'),
  shieldSetupCard: document.getElementById('shield-setup-card'),
  btnBackToList: document.getElementById('btn-back-to-list'),
  shieldPreviewPoster: document.getElementById('shield-preview-poster'),
  shieldPreviewTitle: document.getElementById('shield-preview-title'),
  shieldPreviewType: document.getElementById('shield-preview-type'),
  shieldPreviewYear: document.getElementById('shield-preview-year'),
  btnChangeTitle: document.getElementById('btn-change-title'),
  shieldTvProgress: document.getElementById('shield-tv-progress'),
  shieldSeasonEpRow: document.getElementById('shield-season-ep-row'),
  shieldSeasonSelect: document.getElementById('shield-season-select'),
  shieldEpisodeSelect: document.getElementById('shield-episode-select'),
  shieldAbsEpRow: document.getElementById('shield-abs-ep-row'),
  shieldAbsEpInput: document.getElementById('shield-abs-ep-input'),
  shieldEpOnlyToggle: document.getElementById('shield-ep-only-toggle'),
  shieldNotStartedToggle: document.getElementById('shield-not-started-toggle'),
  shieldMovieProgress: document.getElementById('shield-movie-progress'),
  movieWatchedNo: document.getElementById('movie-watched-no'),
  movieWatchedYes: document.getElementById('movie-watched-yes'),
  btnSaveShield: document.getElementById('btn-save-shield'),
  btnUnlockShield: document.getElementById('btn-unlock-shield'),

  // Undo Toast
  toastUndo: document.getElementById('toast-undo'),
  toastUndoMsg: document.getElementById('toast-undo-msg'),
  btnUndoAction: document.getElementById('btn-undo-action'),

  // Phase 4: Mood Picks
  moodPicksContainer: document.getElementById('mood-picks-container'),
  moodEntrySection: document.getElementById('mood-entry-section'),
  moodCardsGrid: document.getElementById('mood-cards-grid'),
  filterMediaChips: document.getElementById('filter-media-chips'),
  filterTimeChips: document.getElementById('filter-time-chips'),
  filterLangChips: document.getElementById('filter-lang-chips'),
  filterRankingChips: document.getElementById('filter-ranking-chips'),
  filterPlatformChips: document.getElementById('filter-platform-chips'),
  platformFilterBanner: document.getElementById('platform-filter-banner'),
  platformBannerText: document.getElementById('platform-banner-text'),
  btnClearPlatforms: document.getElementById('btn-clear-platforms'),
  moodPlatformNote: document.getElementById('mood-platform-note'),
  moodCustomInput: document.getElementById('mood-custom-input'),
  btnFindMoodPicks: document.getElementById('btn-find-mood-picks'),
  moodResultsSection: document.getElementById('mood-results-section'),
  moodBotIntro: document.getElementById('mood-bot-intro'),
  btnChangeMoodFilters: document.getElementById('btn-change-mood-filters'),
  moodCardsLoading: document.getElementById('mood-cards-loading'),
  moodCardsList: document.getElementById('mood-cards-list'),
  moodFallbackBox: document.getElementById('mood-fallback-box'),
  moodFallbackMsg: document.getElementById('mood-fallback-msg'),
  btnLoosenFilters: document.getElementById('btn-loosen-filters'),
  btnMoodMore: document.getElementById('btn-mood-more'),

  // Phase 4: Compare & Debate
  compareContainer: document.getElementById('compare-container'),
  compareEntrySection: document.getElementById('compare-entry-section'),
  compareResultsSection: document.getElementById('compare-results-section'),
  compareLoadingState: document.getElementById('compare-loading-state'),
  btnLaunchCompare: document.getElementById('btn-launch-compare'),
  btnCompareReset: document.getElementById('btn-compare-reset'),
  btnCompareSwap: document.getElementById('btn-compare-swap'),
  btnCompareDebateToggle: document.getElementById('btn-compare-debate-toggle'),
  debateContainer: document.getElementById('debate-container'),
  btnEndDebate: document.getElementById('btn-end-debate'),
  debateThread: document.getElementById('debate-thread'),
  debateReplyForm: document.getElementById('debate-reply-form'),
  debateReplyInput: document.getElementById('debate-reply-input'),
};

// ========================================================
// 3.1 ROTATING PLACEHOLDERS CONTROLLER
// ========================================================
const MODE_PLACEHOLDERS = {
  general: [
    'Tell me about any movie...',
    'Ask about a series...',
    'Who directed Inception?',
    'Where can I watch Dark?',
    'Explain a movie ending...',
    'Best anime to start with?',
  ],
  'spoiler-safe': [
    "I'm on season 1 episode 3...",
    "Recap what I've watched...",
    'Who is this character?',
  ],
  'mood-picks': [
    'Something light after a bad day...',
    'Mind-bending, under 2 hours...',
    'A cozy comfort watch...',
  ],
  quiz: [
    'Quiz me on Breaking Bad...',
    'Test me on Marvel...',
    'Give me a movie riddle...',
  ],
  character: [
    'Talk to Tony Stark...',
    'Ask Walter White anything...',
    'Chat with Sherlock...',
  ],
  compare: [
    'Breaking Bad vs Better Call Saul',
    'Dark vs Stranger Things',
  ],
  'for-you': [
    'What should I watch next?',
    'Recommend based on my likes',
  ],
};

const STATIC_FOCUSED_PLACEHOLDER = 'Ask anything about movies...';

let placeholderTimer = null;
let placeholderAnimTimeout = null;
let currentPlaceholderMode = 'general';
let placeholderIndex = 0;

function isPlaceholderPaused() {
  if (!dom.chatInput) return true;
  if (document.hidden) return true;
  if (state.isGenerating) return true;
  if (document.activeElement === dom.chatInput) return true;
  if (dom.chatInput.value && dom.chatInput.value.length > 0) return true;
  return false;
}

function syncPlaceholderInputState() {
  if (!dom.inputFieldWrap || !dom.chatInput) return;
  const hasText = dom.chatInput.value.length > 0;
  dom.inputFieldWrap.classList.toggle('has-text', hasText);
  const isFocused = document.activeElement === dom.chatInput;
  dom.inputFieldWrap.classList.toggle('is-focused', isFocused);

  if (isFocused || hasText || state.isGenerating || document.hidden) {
    stopRotatingPlaceholder();
  } else {
    startRotatingPlaceholder();
  }
}

function stepRotatingPlaceholder() {
  if (isPlaceholderPaused()) return;
  const list = MODE_PLACEHOLDERS[currentPlaceholderMode] || MODE_PLACEHOLDERS.general;
  if (!list || list.length === 0) return;

  placeholderIndex = (placeholderIndex + 1) % list.length;
  const nextText = list[placeholderIndex];

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    if (dom.rotatingPlaceholder) dom.rotatingPlaceholder.textContent = nextText;
    return;
  }

  if (!dom.rotatingPlaceholder) return;

  // Slide up and fade out (300ms)
  dom.rotatingPlaceholder.classList.add('fade-out');

  clearTimeout(placeholderAnimTimeout);
  placeholderAnimTimeout = setTimeout(() => {
    if (!dom.rotatingPlaceholder) return;
    dom.rotatingPlaceholder.textContent = nextText;
    dom.rotatingPlaceholder.classList.add('slide-prep');
    dom.rotatingPlaceholder.classList.remove('fade-out');

    // Force reflow
    void dom.rotatingPlaceholder.offsetHeight;

    // Slide in from slightly below
    dom.rotatingPlaceholder.classList.remove('slide-prep');
  }, 300);
}

function startRotatingPlaceholder() {
  stopRotatingPlaceholder();
  if (isPlaceholderPaused()) return;

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const intervalMs = prefersReduced ? 4000 : 3000;

  placeholderTimer = setInterval(() => {
    if (isPlaceholderPaused()) {
      stopRotatingPlaceholder();
      return;
    }
    stepRotatingPlaceholder();
  }, intervalMs);
}

function stopRotatingPlaceholder() {
  if (placeholderTimer) {
    clearInterval(placeholderTimer);
    placeholderTimer = null;
  }
}

function updateRotatingPlaceholderMode(modeKey) {
  currentPlaceholderMode = modeKey || 'general';
  placeholderIndex = 0;
  const list = MODE_PLACEHOLDERS[currentPlaceholderMode] || MODE_PLACEHOLDERS.general;

  if (dom.rotatingPlaceholder && list && list.length > 0) {
    clearTimeout(placeholderAnimTimeout);
    dom.rotatingPlaceholder.classList.remove('fade-out', 'slide-prep');
    dom.rotatingPlaceholder.textContent = list[0];
  }

  syncPlaceholderInputState();
}

function initRotatingPlaceholder() {
  if (!dom.chatInput) return;

  // Set fallback accessible placeholder
  dom.chatInput.setAttribute('placeholder', STATIC_FOCUSED_PLACEHOLDER);

  // Input event listeners
  dom.chatInput.addEventListener('focus', syncPlaceholderInputState);
  dom.chatInput.addEventListener('blur', syncPlaceholderInputState);
  dom.chatInput.addEventListener('input', syncPlaceholderInputState);

  // Tab visibility changes to save battery
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRotatingPlaceholder();
    } else {
      syncPlaceholderInputState();
    }
  });

  // Watch for prefers-reduced-motion dynamic changes
  if (window.matchMedia) {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', () => {
        if (!isPlaceholderPaused()) startRotatingPlaceholder();
      });
    }
  }

  updateRotatingPlaceholderMode(state.currentMode || 'general');
}

// ========================================================
// 4. INITIALIZATION
// ========================================================
function init() {
  updateAppHeight();
  loadFromStorage();
  applyTheme(state.theme);
  initMoodPicksState();
  setupComparePickers();
  setMode(state.currentMode, false);
  onShieldsChanged();
  updateWatchlistBadge();
  renderHistory();
  renderActiveSession();
  bindEvents();
  initRotatingPlaceholder();

  // Restore desktop inspector state
  if (window.innerWidth >= 1200 && localStorage.getItem(STORAGE_KEYS.INSPECTOR_OPEN) === 'true') {
    dom.inspectorPanel?.classList.remove('collapsed');
    dom.btnToggleInspector?.classList.add('active');
  }
}

function loadFromStorage() {
  try {
    const savedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    state.sessions = savedSessions ? JSON.parse(savedSessions) : [];

    const activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
    state.currentSessionId = activeId || (state.sessions[0] ? state.sessions[0].id : null);

    // Single source of truth: read ONLY from ShieldsStore
    state.savedShields = ShieldsStore.getAll();
    state.spoilerShield = ShieldsStore.getActive() || { active: false };

    const savedWatchlist = localStorage.getItem(STORAGE_KEYS.WATCHLIST);
    const parsedWatchlist = savedWatchlist ? JSON.parse(savedWatchlist) : [];
    state.watchlist = Array.isArray(parsedWatchlist)
      ? parsedWatchlist.map((item) => normalizeWatchlistEntry(item)).filter(Boolean)
      : [];

    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    if (savedTheme) {
      state.theme = savedTheme;
    } else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = prefersDark ? 'dark' : 'light';
    }

    const savedMode = localStorage.getItem(STORAGE_KEYS.MODE);
    if (savedMode && MODE_DATA[savedMode]) state.currentMode = savedMode;
  } catch (err) {
    console.warn('Error reading localStorage:', err);
  }
}

function saveSessionsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
    if (state.currentSessionId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, state.currentSessionId);
    }
  } catch (err) {
    console.warn('Error saving sessions:', err);
  }
}

// ========================================================
// 5. MARKDOWN RENDERING (marked + DOMPurify with safe fallback)
// ========================================================
function renderMarkdown(text) {
  if (!text) return '';
  try {
    if (window.marked && typeof window.marked.parse === 'function' && window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
      const rawHtml = window.marked.parse(String(text), { breaks: true, gfm: true });
      return window.DOMPurify.sanitize(rawHtml);
    }
  } catch (err) {
    console.warn('Markdown parsing error, falling back to plain text:', err);
  }
  // Safe plain-text fallback: cannot throw, safely formats basic markdown
  try {
    return escapeHtml(String(text))
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br />');
  } catch (err) {
    return String(text);
  }
}

// ========================================================
// 6. CHAT SESSION MANAGEMENT
// ========================================================
function createNewChat() {
  if (state.isGenerating) return;

  // 1. Switch active mode to Kinora AI ('general')
  setMode('general', false);

  // 2. Hide any open mode-specific views and modals
  if (dom.moodPicksContainer) dom.moodPicksContainer.classList.add('hidden');
  if (dom.compareContainer) dom.compareContainer.classList.add('hidden');
  closeWatchlistModal();

  // 3. Clear input box and reset height/styling
  if (dom.chatInput) {
    dom.chatInput.value = '';
    updateChatInputHeight();
    setChatInputFilled(false);
  }

  // 4. Close Title Inspector if showing a title from old chat
  state.activeTitleInspectorData = null;
  hideMobileInspectorPill();
  closeInspectorPanel(false);

  // 5. Create fresh empty conversation (prevent duplicate empty sessions)
  const activeSession = getActiveSession();
  if (activeSession && (!activeSession.messages || activeSession.messages.length === 0)) {
    activeSession.mode = 'general';
    activeSession.title = 'New Chat';
  } else {
    const newSession = {
      id: 'chat_' + Date.now(),
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      mode: 'general',
      messages: [],
    };
    state.sessions.unshift(newSession);
    state.currentSessionId = newSession.id;
  }

  saveSessionsToStorage();
  renderHistory();
  renderActiveSession();
  closeMobileSidebar();

  // 8. Move focus to chat input only on desktop (never on mobile touch devices)
  const isDesktop = window.innerWidth > 768 && !('ontouchstart' in window);
  if (isDesktop && dom.chatInput) {
    dom.chatInput.focus();
  }
}

function getActiveSession() {
  if (!state.currentSessionId) return null;
  return state.sessions.find((s) => s.id === state.currentSessionId) || null;
}

function renderActiveSession() {
  const session = getActiveSession();

  if (state.currentMode === 'mood-picks') {
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.remove('hidden');
    if (dom.compareContainer) dom.compareContainer.classList.add('hidden');
    if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
    if (dom.messagesContainer) dom.messagesContainer.classList.add('hidden');
    syncPlatformChipsUI();
  } else if (state.currentMode === 'compare') {
    if (dom.compareContainer) dom.compareContainer.classList.remove('hidden');
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.add('hidden');
    if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
    if (dom.messagesContainer) dom.messagesContainer.classList.add('hidden');
  } else {
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.add('hidden');
    if (dom.compareContainer) dom.compareContainer.classList.add('hidden');

    if (!session || !session.messages || session.messages.length === 0) {
      if (dom.heroWelcome) dom.heroWelcome.classList.remove('hidden');
      if (dom.messagesContainer) {
        dom.messagesContainer.classList.add('hidden');
        dom.messagesContainer.innerHTML = '';
      }
      updateWelcomeViewForMode(state.currentMode);
    } else {
      if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
      if (dom.messagesContainer) {
        dom.messagesContainer.classList.remove('hidden');
        dom.messagesContainer.innerHTML = '';
      }

      session.messages.forEach((msg) => {
        appendMessageToDOM(msg.role, msg.content, false, msg.titleData);
      });

      const lastBotMsg = [...session.messages].reverse().find((m) => m.role === 'model' && m.titleData);
      if (lastBotMsg && lastBotMsg.titleData) {
        state.activeTitleInspectorData = lastBotMsg.titleData;
        if (window.innerWidth <= 768) {
          showMobileInspectorPill(lastBotMsg.titleData);
        }
      }

      scrollToBottom();
    }
  }
}

function updateWelcomeViewForMode(modeKey) {
  const data = MODE_DATA[modeKey] || MODE_DATA.general;

  // Dynamic customization for Spoiler Shield mode
  if (modeKey === 'spoiler-safe') {
    const activeShield = ShieldsStore.getActive();
    if (activeShield && (activeShield.title || activeShield.showTitle)) {
      const title = activeShield.title || activeShield.showTitle;
      const prog = activeShield.progress || 'S1 E1';
      if (dom.heroTagline) {
        dom.heroTagline.textContent = `Guaranteed safe for ${title} up to ${prog}.`;
      }
      if (dom.heroChipsGrid) {
        dom.heroChipsGrid.innerHTML = `
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Give me a concise recap of ${escapeHtml(title)} up to ${escapeHtml(prog)}">
            <span class="chip-icon">${renderIcon('fileText')}</span>
            <div class="chip-meta">
              <span class="chip-text">Recap so far</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Who is the main character in ${escapeHtml(title)}? Only tell me what is known up to ${escapeHtml(prog)}.">
            <span class="chip-icon">${renderIcon('user')}</span>
            <div class="chip-meta">
              <span class="chip-text">Who is [character]?</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Explain ${escapeHtml(title)} ${escapeHtml(prog)} without spoiling anything ahead.">
            <span class="chip-icon">${renderIcon('search')}</span>
            <div class="chip-meta">
              <span class="chip-text">Explain this episode</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Theory time: what theories make sense for ${escapeHtml(title)} based only on clues up to ${escapeHtml(prog)}?">
            <span class="chip-icon">${renderIcon('lightbulb')}</span>
            <div class="chip-meta">
              <span class="chip-text">Theory time</span>
            </div>
          </button>
          <button class="hero-chip-btn btn-advance-ep-chip ${state.isGenerating ? 'ui-locked-disabled' : ''}" id="btn-advance-ep-chip">
            <span class="chip-icon">${renderIcon('fastForward')}</span>
            <div class="chip-meta">
              <span class="chip-text">I finished the next episode</span>
            </div>
          </button>
        `;
        return;
      }
    } else {
      if (dom.heroTagline) {
        dom.heroTagline.textContent = 'Guaranteed safe up to your exact episode.';
      }
      if (dom.heroChipsGrid) {
        dom.heroChipsGrid.innerHTML = `
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" id="btn-setup-shield-chip">
            <span class="chip-icon">${renderIcon('shield')}</span>
            <div class="chip-meta">
              <span class="chip-text">Set Up Your Show</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap">
            <span class="chip-icon">${renderIcon('clock')}</span>
            <div class="chip-meta">
              <span class="chip-text">Dark S02E04 Safe Recap</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Give me a spoiler-safe recap of Severance Season 1 Episode 3">
            <span class="chip-icon">${renderIcon('building')}</span>
            <div class="chip-meta">
              <span class="chip-text">Severance S1 Safe Recap</span>
            </div>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Succession Season 2 Episode 5 safe plot recap">
            <span class="chip-icon">${renderIcon('crown')}</span>
            <div class="chip-meta">
              <span class="chip-text">Succession S2 Safe Recap</span>
            </div>
          </button>
        `;
        return;
      }
    }
  }

  if (dom.heroTagline) dom.heroTagline.textContent = data.tagline;

  if (dom.heroChipsGrid) {
    dom.heroChipsGrid.innerHTML = data.chips
      .map(
        (chip) => `
        <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="${escapeHtml(chip.prompt)}">
          <span class="chip-icon">${renderIcon(chip.icon)}</span>
          <div class="chip-meta">
            <span class="chip-text">${escapeHtml(chip.text)}</span>
            ${chip.desc ? `<span class="chip-desc">${escapeHtml(chip.desc)}</span>` : ''}
          </div>
        </button>
      `
      )
      .join('');
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderHistory() {
  dom.historyList.innerHTML = '';

  if (state.sessions.length === 0) {
    dom.historyList.innerHTML = '<div class="empty-history">No past conversations yet.</div>';
    return;
  }

  state.sessions.forEach((s) => {
    const item = document.createElement('div');
    item.className = `history-item ${s.id === state.currentSessionId ? 'active' : ''} ${state.isGenerating ? 'ui-locked-disabled' : ''}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'history-title';
    titleSpan.textContent = s.title || 'Movie Discussion';
    titleSpan.title = s.title || 'Movie Discussion';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete-session';
    btnDelete.innerHTML = '&times;';
    btnDelete.title = 'Delete chat';
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.isGenerating) return;
      deleteSession(s.id);
    });

    item.appendChild(titleSpan);
    item.appendChild(btnDelete);

    item.addEventListener('click', () => {
      if (state.isGenerating) return;
      switchSession(s.id);
    });

    dom.historyList.appendChild(item);
  });
}

function switchSession(id) {
  if (state.isGenerating) return;
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return;

  state.currentSessionId = id;
  const targetMode = session.mode || 'general';
  setMode(targetMode, false);

  state.activeTitleInspectorData = null;
  hideMobileInspectorPill();
  closeInspectorPanel(false);

  saveSessionsToStorage();
  renderHistory();
  renderActiveSession();
  closeMobileSidebar();
}

function deleteSession(id) {
  if (state.isGenerating) return;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.currentSessionId === id) {
    state.currentSessionId = state.sessions[0] ? state.sessions[0].id : null;
    const nextSession = getActiveSession();
    if (nextSession) {
      setMode(nextSession.mode || 'general', false);
    } else {
      createNewChat();
      return;
    }
  }
  saveSessionsToStorage();
  renderHistory();
  renderActiveSession();
}

// ========================================================
// 7. MESSAGE RENDERING & SPEED STREAMING
// ========================================================
function appendMessageToDOM(role, content, isStreaming = false, titleData = null) {
  dom.heroWelcome.classList.add('hidden');
  dom.messagesContainer.classList.remove('hidden');

  const row = document.createElement('div');
  row.className = `message-row ${role === 'user' ? 'user' : 'bot'}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'user' ? 'avatar-user' : 'avatar-bot'}`;
  avatar.innerHTML = role === 'user' ? renderIcon('user') : `<img src="logo.png?v=3" alt="Kinora" class="avatar-logo-img" onerror="this.outerHTML='${renderIcon('film').replace(/"/g, '&quot;')}'" />`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (isStreaming) {
    // Shows typing indicator ONLY until the first token arrives
    bubble.innerHTML = `
      <span class="typing-indicator" id="live-typing-dots">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </span>
      <span class="stream-content"></span>
      <span class="typing-cursor hidden"></span>
    `;
  } else {
    bubble.innerHTML = renderMarkdown(content);

    if (role === 'model' || role === 'bot') {
      addBubbleActions(bubble, content, titleData);
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  dom.messagesContainer.appendChild(row);

  scrollToBottom();
  return { row, bubble };
}

function addBubbleActions(bubble, content, titleData = null) {
  if (!content) return;
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const tData = titleData || state.activeTitleInspectorData;
  if (tData && tData.title) {
    const inspectBtn = document.createElement('button');
    inspectBtn.className = 'btn-bubble-action btn-bubble-inspect';
    inspectBtn.innerHTML = `${renderIcon('film', 16)} <span>${escapeHtml(tData.title)} - Details</span>`;
    inspectBtn.title = `View ${escapeHtml(tData.title)} details in Title Inspector`;
    inspectBtn.addEventListener('click', () => {
      openTitleInspector(tData, tData.media_type || tData.type || 'movie', true);
    });
    actions.appendChild(inspectBtn);

    const wlBtn = document.createElement('button');
    wlBtn.className = 'btn-bubble-action btn-bubble-watchlist';
    wlBtn.dataset.title = tData.title;
    const inWl = isItemInWatchlist(tData);
    if (inWl) wlBtn.classList.add('saved');
    wlBtn.innerHTML = `${renderIcon(inWl ? 'check' : 'bookmark', 14)} <span>${inWl ? 'Saved' : 'Add to Watchlist'}</span>`;
    wlBtn.title = inWl ? 'In Watchlist' : 'Add to Watchlist';
    wlBtn.addEventListener('click', () => {
      toggleWatchlist(tData);
    });
    actions.appendChild(wlBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-bubble-action btn-copy';
  copyBtn.title = 'Copy text';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(content);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 2000);
  });
  actions.appendChild(copyBtn);

  bubble.appendChild(actions);
}

function scrollToBottom() {
  dom.chatViewport.scrollTo({
    top: dom.chatViewport.scrollHeight,
    behavior: 'smooth',
  });
}

// ========================================================
// 8. ONE REQUEST AT A TIME: LOCK / UNLOCK CONTROLS
// ========================================================
function setControlsLocked(locked) {
  state.isGenerating = locked;

  // 1. Text input: disabled & dimmed
  dom.chatInput.disabled = locked;
  if (locked) {
    dom.chatInput.classList.add('disabled-input');
    if (dom.inputWrapper) dom.inputWrapper.classList.add('is-generating');
  } else {
    dom.chatInput.classList.remove('disabled-input');
    if (dom.inputWrapper) dom.inputWrapper.classList.remove('is-generating');
  }
  syncPlaceholderInputState();

  // 2. Send / Stop button state
  const iconSend = dom.btnSend.querySelector('.icon-send');
  const iconStop = dom.btnSend.querySelector('.icon-stop');

  if (locked) {
    dom.btnSend.classList.add('btn-stop');
    dom.btnSend.title = 'Stop generating';
    dom.btnSend.setAttribute('aria-label', 'Stop generating');
    if (iconSend) iconSend.classList.add('hidden');
    if (iconStop) iconStop.classList.remove('hidden');
  } else {
    dom.btnSend.classList.remove('btn-stop');
    dom.btnSend.title = 'Send message';
    dom.btnSend.setAttribute('aria-label', 'Send message');
    if (iconSend) iconSend.classList.remove('hidden');
    if (iconStop) iconStop.classList.add('hidden');
  }

  // 3. Disable all other controls that could navigate or send a message
  const elementsToLock = [
    dom.btnNewChat,
    dom.btnOpenWatchlist,
    dom.btnClearHistory,
    dom.btnVoiceInput,
    dom.btnFindMoodPicks,
    dom.btnMoodMore,
    dom.btnLaunchCompare,
    dom.btnCompareReset,
    dom.btnCompareSwap,
    ...document.querySelectorAll('.mode-item'),
    ...document.querySelectorAll('.hero-chip-btn'),
    ...document.querySelectorAll('.history-item'),
    ...document.querySelectorAll('.btn-delete-session'),
    ...document.querySelectorAll('.mood-card'),
    ...document.querySelectorAll('.chip-filter'),
    ...document.querySelectorAll('.platform-chip'),
  ];

  elementsToLock.forEach((el) => {
    if (!el) return;
    if (locked) {
      el.classList.add('ui-locked-disabled');
      if ('disabled' in el) el.disabled = true;
    } else {
      el.classList.remove('ui-locked-disabled');
      if ('disabled' in el) el.disabled = false;
    }
  });

  if (!locked) {
    dom.chatInput.focus();
  }
}

function abortGenerating() {
  if (state.isGenerating && state.currentAbortController) {
    state.currentAbortController.abort();
  }
}

// ========================================================
// 9. CHAT SUBMISSION (AbortController, 60s timeout, try/finally)
// ========================================================
async function handleChatSubmit(e) {
  if (e) e.preventDefault();

  // 1. Enforce single request: ignore immediately if already generating
  if (state.isGenerating) {
    console.warn('Kinora: Request already in progress. Ignoring duplicate submission.');
    return;
  }

  const userText = dom.chatInput.value.trim();
  if (!userText) return;

  // Check if user entered a comparison query like "Breaking Bad vs Better Call Saul"
  const vsQuery = detectComparisonQuery(userText);
  if (vsQuery) {
    dom.chatInput.value = '';
    syncPlaceholderInputState();
    loadComparisonByTitles(vsQuery.titleA, vsQuery.titleB);
    return;
  }

  // Immediately lock to prevent duplicate user bubbles from double-clicks or rapid Enters
  state.isGenerating = true;
  setControlsLocked(true);

  state.lastUserPrompt = userText;
  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';
  syncPlaceholderInputState();

  // Session management
  let session = getActiveSession();
  if (!session) {
    session = {
      id: 'chat_' + Date.now(),
      title: userText.slice(0, 28) + (userText.length > 28 ? '...' : ''),
      createdAt: new Date().toISOString(),
      mode: state.currentMode,
      messages: [],
    };
    state.sessions.unshift(session);
    state.currentSessionId = session.id;
  } else if (session.messages.length === 0) {
    session.title = userText.slice(0, 28) + (userText.length > 28 ? '...' : '');
  }

  // Natural language progress checking:
  // e.g. "I'm on season 1 episode 2", "Carrie S1 E2", "just finished episode 3"
  const nlParsed = parseNaturalLanguageProgress(userText);
  if (nlParsed) {
    let targetShield = null;
    const allSaved = ShieldsStore.getAll();

    if (nlParsed.title) {
      const q = nlParsed.title.toLowerCase().trim();
      targetShield = allSaved.find((s) => {
        const sTitle = (s.title || s.showTitle || '').toLowerCase();
        return sTitle === q || sTitle.includes(q) || q.includes(sTitle);
      });
    }

    // If no title was named in message, apply it to the ACTIVE title
    if (!targetShield && !nlParsed.title) {
      targetShield = ShieldsStore.getActive();
    }

    // If a title was named but wasn't in saved shields yet, create new shield entry
    if (!targetShield && nlParsed.title) {
      targetShield = {
        title: nlParsed.title,
        showTitle: nlParsed.title,
        type: 'tv',
        season: nlParsed.season || 1,
        episode: nlParsed.episode || 1,
      };
    }

    if (targetShield) {
      const updated = ShieldsStore.updateProgress(
        targetShield.tmdbId || targetShield.title,
        nlParsed.season || targetShield.season || 1,
        nlParsed.episode,
        (nlParsed.season === null && targetShield.absoluteEpisode) ? nlParsed.episode : null
      );

      // If it's a pure update, confirm in one line with the title name
      if (nlParsed.isPureUpdate) {
        session.messages.push({ role: 'user', content: userText });
        appendMessageToDOM('user', userText, false);
        renderHistory();

        const shortConfirm = `Progress updated to **${updated.title} ${updated.progress}**. Spoiler Shield is locked.`;
        session.messages.push({ role: 'model', content: shortConfirm });
        appendMessageToDOM('model', shortConfirm, false);
        saveSessionsToStorage();

        setControlsLocked(false);
        state.isGenerating = false;
        return;
      }
    }
  }

  // Add user message to session & DOM
  session.messages.push({ role: 'user', content: userText });
  appendMessageToDOM('user', userText, false);
  renderHistory();
  saveSessionsToStorage();

  // Initialize AbortController & 60s timeout
  const abortController = new AbortController();
  state.currentAbortController = abortController;

  const timeoutId = setTimeout(() => {
    if (state.isGenerating && state.currentAbortController) {
      console.warn('Kinora stream timed out after 60s, aborting...');
      abortController.abort();
    }
  }, 60000);

  // Append bot row with initial typing indicator dots
  const { row: botRow, bubble } = appendMessageToDOM('model', '', true);
  const streamContentEl = bubble.querySelector('.stream-content');
  const cursorEl = bubble.querySelector('.typing-cursor');

  let accumulatedResponse = '';
  let firstTokenReceived = false;
  let isAborted = false;
  let hadError = false;
  let currentStreamInspectorData = null;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: userText,
        history: session.messages.slice(0, -1),
        mode: state.currentMode,
        spoilerShield: ShieldsStore.getActive(),
        shields: ShieldsStore.getAll(),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === 'title_inspector' && parsed.titleData) {
            currentStreamInspectorData = parsed.titleData;
            state.activeTitleInspectorData = parsed.titleData;
            openTitleInspector(parsed.titleData, parsed.titleData.media_type || parsed.titleData.type || 'movie', false);
          } else if (parsed.text) {
            // First token arrives: remove typing dots and reveal cursor
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              const dots = bubble.querySelector('#live-typing-dots');
              if (dots) dots.remove();
              if (cursorEl) cursorEl.classList.remove('hidden');
            }
            accumulatedResponse += parsed.text;
            try {
              streamContentEl.innerHTML = renderMarkdown(accumulatedResponse);
            } catch (rErr) {
              streamContentEl.textContent = accumulatedResponse;
            }
            scrollToBottom();
          } else if (parsed.error) {
            hadError = true;
            accumulatedResponse = parsed.error;
            console.error('Server reported stream error:', parsed.error);
          }
        } catch {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            const dots = bubble.querySelector('#live-typing-dots');
            if (dots) dots.remove();
            if (cursorEl) cursorEl.classList.remove('hidden');
          }
          accumulatedResponse += dataStr;
          try {
            streamContentEl.innerHTML = renderMarkdown(accumulatedResponse);
          } catch (rErr) {
            streamContentEl.textContent = accumulatedResponse;
          }
          scrollToBottom();
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      isAborted = true;
      console.log('Stream aborted by user or timeout.');
    } else {
      hadError = true;
      console.error('Chat Streaming Technical Error:', error);
      accumulatedResponse = 'Kinora is having trouble connecting right now. Please try again.';
    }
  } finally {
    // try/finally guarantees the UI is ALWAYS unlocked even if an error occurred!
    clearTimeout(timeoutId);

    // Clean up cursor and typing dots
    if (cursorEl) cursorEl.remove();
    const liveDots = bubble.querySelector('#live-typing-dots');
    if (liveDots) liveDots.remove();

    if (isAborted) {
      if (!accumulatedResponse.trim()) {
        // Stopped by user before any tokens arrived: remove empty bubble completely
        botRow.remove();
      } else {
        // Partial text arrived before stop: keep what arrived
        bubble.innerHTML = renderMarkdown(accumulatedResponse);
        addBubbleActions(bubble, accumulatedResponse, currentStreamInspectorData);
        session.messages.push({ role: 'model', content: accumulatedResponse, titleData: currentStreamInspectorData });
        saveSessionsToStorage();
      }
    } else if (hadError) {
      if (!accumulatedResponse.trim() || !firstTokenReceived) {
        // Failed before response: show friendly message with Retry button
        const friendlyMsg = accumulatedResponse.trim() || 'Kinora is having trouble connecting right now. Please try again.';
        bubble.innerHTML = `
          <p>${escapeHtml(friendlyMsg)}</p>
          <button class="btn-retry" id="btn-chat-retry">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Retry
          </button>
        `;
        const retryBtn = bubble.querySelector('#btn-chat-retry');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            dom.chatInput.value = state.lastUserPrompt;
            handleChatSubmit();
          });
        }
      } else {
        // Partial text arrived before error: keep what arrived
        bubble.innerHTML = renderMarkdown(accumulatedResponse);
        addBubbleActions(bubble, accumulatedResponse, currentStreamInspectorData);
        session.messages.push({ role: 'model', content: accumulatedResponse, titleData: currentStreamInspectorData });
        saveSessionsToStorage();
      }
    } else {
      // Completed normally
      if (!accumulatedResponse.trim()) {
        const friendlyMsg = 'Kinora is taking a moment to gather those titles. Click below to try again.';
        bubble.innerHTML = `
          <p>${escapeHtml(friendlyMsg)}</p>
          <button class="btn-retry" id="btn-chat-retry">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Retry
          </button>
        `;
        const retryBtn = bubble.querySelector('#btn-chat-retry');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            dom.chatInput.value = state.lastUserPrompt;
            handleChatSubmit();
          });
        }
      } else {
        bubble.innerHTML = renderMarkdown(accumulatedResponse);
        addBubbleActions(bubble, accumulatedResponse, currentStreamInspectorData);
        session.messages.push({ role: 'model', content: accumulatedResponse, titleData: currentStreamInspectorData });
        saveSessionsToStorage();
      }
    }

    state.currentAbortController = null;
    setControlsLocked(false);
    scrollToBottom();
  }
}

// ========================================================
// 10. MODE SWITCHER (No automatic messages sent!)
// ========================================================
function setMode(modeKey, saveSession = true) {
  if (state.isGenerating) return;

  const data = MODE_DATA[modeKey];
  if (!data) return;

  state.currentMode = modeKey;
  localStorage.setItem(STORAGE_KEYS.MODE, modeKey);
  state.activeTitleInspectorData = null;
  hideMobileInspectorPill();
  closeInspectorPanel(false);

  // Update active state in sidebar
  document.querySelectorAll('.mode-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.mode === modeKey);
  });

  // Update header title
  if (dom.currentModeTitle) {
    dom.currentModeTitle.textContent = data.title;
  }
  if (dom.inputModeTag) {
    dom.inputModeTag.innerHTML = `${renderIcon(data.icon)} <span>${escapeHtml(data.title)}</span>`;
  }
  updateRotatingPlaceholderMode(modeKey);

  // Handle mode-specific views:
  if (modeKey === 'mood-picks') {
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.remove('hidden');
    if (dom.compareContainer) dom.compareContainer.classList.add('hidden');
    if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
    if (dom.messagesContainer) dom.messagesContainer.classList.add('hidden');
    syncPlatformChipsUI();
  } else if (modeKey === 'compare') {
    if (dom.compareContainer) dom.compareContainer.classList.remove('hidden');
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.add('hidden');
    if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
    if (dom.messagesContainer) dom.messagesContainer.classList.add('hidden');
  } else {
    if (dom.moodPicksContainer) dom.moodPicksContainer.classList.add('hidden');
    if (dom.compareContainer) dom.compareContainer.classList.add('hidden');

    const session = getActiveSession();
    if (!session || !session.messages || session.messages.length === 0) {
      if (dom.heroWelcome) dom.heroWelcome.classList.remove('hidden');
      if (dom.messagesContainer) dom.messagesContainer.classList.add('hidden');
      updateWelcomeViewForMode(modeKey);
    } else {
      if (dom.heroWelcome) dom.heroWelcome.classList.add('hidden');
      if (dom.messagesContainer) dom.messagesContainer.classList.remove('hidden');
    }
  }

  const session = getActiveSession();
  if (session && saveSession) {
    session.mode = modeKey;
    saveSessionsToStorage();
  }
}

// ========================================================
// 11. WATCHLIST MODAL MANAGEMENT (Upgraded with TMDB Search, Filters & Sync)
// ========================================================
let watchlistFilter = 'all'; // 'all' | 'movie' | 'tv' | 'watched'
let watchlistSort = 'recent'; // 'recent' | 'title'
let watchlistSearchDebounceTimer = null;
let watchlistLastResults = [];

function openWatchlistModal() {
  if (state.isGenerating) return;
  if (dom.watchlistAddInput) dom.watchlistAddInput.value = '';
  if (dom.watchlistSearchClear) dom.watchlistSearchClear.classList.add('hidden');
  if (dom.watchlistSearchResults) {
    dom.watchlistSearchResults.innerHTML = '';
    dom.watchlistSearchResults.classList.add('hidden');
  }
  watchlistLastResults = [];
  renderWatchlistItems();
  dom.watchlistModal.classList.remove('hidden');
  setTimeout(() => dom.watchlistAddInput?.focus(), 80);
}

function closeWatchlistModal() {
  dom.watchlistModal.classList.add('hidden');
  if (dom.watchlistSearchResults) dom.watchlistSearchResults.classList.add('hidden');
}

function normalizeWatchlistEntry(itemObj) {
  if (!itemObj) return null;
  const isStr = typeof itemObj === 'string';
  const title = isStr ? itemObj : (itemObj.title || itemObj.name || String(itemObj));
  const rawId = !isStr ? (itemObj.id || itemObj.tmdbId || null) : null;
  const id = rawId ? parseInt(rawId, 10) : null;
  const rawType = !isStr ? (itemObj.type || itemObj.media_type || 'movie') : 'movie';
  const type = (rawType === 'tv' || rawType === 'series') ? 'tv' : 'movie';
  let year = '';
  if (!isStr) {
    year = itemObj.year || (itemObj.release_date || itemObj.first_air_date ? String(itemObj.release_date || itemObj.first_air_date).slice(0, 4) : '');
  }
  let poster = null;
  if (!isStr) {
    poster = itemObj.poster || itemObj.poster_url || (itemObj.poster_path ? (itemObj.poster_path.startsWith('http') ? itemObj.poster_path : `https://image.tmdb.org/t/p/w500${itemObj.poster_path}`) : null);
  }
  return {
    id,
    title,
    type,
    year,
    poster,
    rating: !isStr ? (itemObj.tmdb_rating || itemObj.rating || null) : null,
    imdb_rating: !isStr ? (itemObj.imdb_rating || null) : null,
    status: (!isStr && itemObj.status) ? itemObj.status : 'want_to_watch',
    addedAt: (!isStr && itemObj.addedAt) ? itemObj.addedAt : Date.now(),
  };
}

function addToWatchlist(itemObj) {
  if (!itemObj) return false;
  const entry = normalizeWatchlistEntry(itemObj);
  if (!entry || !entry.title) return false;

  if (isItemInWatchlist(entry)) {
    return false;
  }

  state.watchlist.unshift(entry);
  localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
  updateAllWatchlistButtons();
  renderWatchlistItems();

  showUndoToast(`Added to Watchlist - Undo`, () => {
    removeFromWatchlist(entry, false);
  });
  return true;
}

function removeFromWatchlist(itemObj, showToast = true) {
  if (!itemObj) return false;
  const targetId = (itemObj.id != null) ? String(itemObj.id) : null;
  const targetTitle = String(itemObj.title || itemObj).trim().toLowerCase();

  const idx = state.watchlist.findIndex((w) => {
    if (typeof w === 'object' && w !== null) {
      if (targetId && w.id != null && String(w.id) === targetId) return true;
      if (w.title && String(w.title).trim().toLowerCase() === targetTitle) return true;
    }
    return String(w).trim().toLowerCase() === targetTitle;
  });

  if (idx >= 0) {
    const [removed] = state.watchlist.splice(idx, 1);
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
    updateAllWatchlistButtons();
    renderWatchlistItems();

    if (showToast) {
      const titleName = (typeof removed === 'object' && removed !== null) ? removed.title : removed;
      showUndoToast(`Removed ${titleName} - Undo`, () => {
        state.watchlist.splice(idx, 0, removed);
        localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
        updateAllWatchlistButtons();
        renderWatchlistItems();
      });
    }
    return true;
  }
  return false;
}

function toggleWatchlist(itemObj) {
  if (isItemInWatchlist(itemObj)) {
    removeFromWatchlist(itemObj, true);
    return false;
  } else {
    addToWatchlist(itemObj);
    return true;
  }
}

function isItemInWatchlist(itemObj) {
  if (!itemObj) return false;
  const targetId = (itemObj.id != null) ? String(itemObj.id) : null;
  const targetTitle = String(itemObj.title || itemObj).trim().toLowerCase();

  return state.watchlist.some((w) => {
    if (typeof w === 'object' && w !== null) {
      if (targetId && w.id != null && String(w.id) === targetId) return true;
      if (w.title && String(w.title).trim().toLowerCase() === targetTitle) return true;
    }
    return String(w).trim().toLowerCase() === targetTitle;
  });
}

function updateWatchlistBadge() {
  if (dom.watchlistCount) {
    dom.watchlistCount.textContent = state.watchlist.length;
  }
}

function updateAllWatchlistButtons() {
  updateWatchlistBadge();

  // 1. Mood Cards
  if (typeof updateMoodCardWatchlistButtons === 'function') {
    updateMoodCardWatchlistButtons();
  }

  // 2. Title Inspector button
  const inspectorWlBtn = document.getElementById('btn-inspector-watchlist');
  if (inspectorWlBtn && state.activeTitleInspectorData) {
    const inWl = isItemInWatchlist(state.activeTitleInspectorData);
    inspectorWlBtn.classList.toggle('saved', inWl);
    inspectorWlBtn.innerHTML = `${renderIcon(inWl ? 'check' : 'bookmark', 14)} <span>${inWl ? 'In Watchlist' : 'Add to Watchlist'}</span>`;
  }

  // 3. Bot bubble watchlist buttons
  document.querySelectorAll('.btn-bubble-watchlist').forEach((btn) => {
    const t = btn.dataset.title;
    if (t) {
      const inWl = isItemInWatchlist({ title: t });
      btn.classList.toggle('saved', inWl);
      btn.innerHTML = `${renderIcon(inWl ? 'check' : 'bookmark', 14)} <span>${inWl ? 'Saved' : 'Add to Watchlist'}</span>`;
    }
  });

  // 4. Compare hero cards buttons
  document.querySelectorAll('.btn-compare-watchlist').forEach((btn) => {
    const t = btn.dataset.title;
    if (t) {
      const inWl = isItemInWatchlist({ title: t });
      btn.classList.toggle('saved', inWl);
      btn.innerHTML = `${renderIcon(inWl ? 'check' : 'bookmark', 12)} <span>${inWl ? 'Saved' : 'Watchlist'}</span>`;
    }
  });

  // 5. Watchlist Search Dropdown buttons if active
  if (dom.watchlistSearchResults) {
    dom.watchlistSearchResults.querySelectorAll('.btn-wl-add-result').forEach((btn) => {
      const id = btn.dataset.id;
      const t = btn.dataset.title;
      const inWl = isItemInWatchlist({ id, title: t });
      btn.disabled = inWl;
      btn.classList.toggle('saved', inWl);
      btn.innerHTML = inWl ? `${renderIcon('check', 14)} Saved` : `${renderIcon('plus', 14)} Add`;
    });
  }
}

function handleWatchlistSearchInput(e) {
  const query = (e.target.value || '').trim();
  if (dom.watchlistSearchClear) {
    dom.watchlistSearchClear.classList.toggle('hidden', query.length === 0);
  }
  clearTimeout(watchlistSearchDebounceTimer);
  if (query.length < 2) {
    if (dom.watchlistSearchResults) {
      dom.watchlistSearchResults.innerHTML = '';
      dom.watchlistSearchResults.classList.add('hidden');
    }
    watchlistLastResults = [];
    if (dom.watchlistSearchSpinner) dom.watchlistSearchSpinner.classList.add('hidden');
    return;
  }

  if (dom.watchlistSearchSpinner) dom.watchlistSearchSpinner.classList.remove('hidden');

  watchlistSearchDebounceTimer = setTimeout(() => {
    fetchWatchlistSearchResults(query);
  }, 300);
}

async function fetchWatchlistSearchResults(query) {
  try {
    const res = await fetch(`/api/media/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    const results = (data && Array.isArray(data.results)) ? data.results : [];
    watchlistLastResults = results;
    renderWatchlistSearchResults(results, query);
  } catch (err) {
    console.warn('Watchlist search error:', err);
    if (dom.watchlistSearchResults) {
      dom.watchlistSearchResults.innerHTML = `
        <div style="padding: 12px; font-size: 12.5px; color: var(--text-muted); text-align: center;">
          Couldn't load search results. <button type="button" class="btn-text-retry" style="color:var(--accent-primary);text-decoration:underline;background:none;border:none;cursor:pointer;font-size:12.5px;">Retry</button>
        </div>
      `;
      dom.watchlistSearchResults.classList.remove('hidden');
      dom.watchlistSearchResults.querySelector('.btn-text-retry')?.addEventListener('click', () => {
        fetchWatchlistSearchResults(query);
      });
    }
  } finally {
    if (dom.watchlistSearchSpinner) dom.watchlistSearchSpinner.classList.add('hidden');
  }
}

function renderWatchlistSearchResults(results, query) {
  if (!dom.watchlistSearchResults) return;
  if (!results || results.length === 0) {
    dom.watchlistSearchResults.innerHTML = `
      <div style="padding: 14px; font-size: 12.5px; color: var(--text-muted); text-align: center;">
        No results for "${escapeHtml(query)}"
      </div>
    `;
    dom.watchlistSearchResults.classList.remove('hidden');
    return;
  }

  dom.watchlistSearchResults.innerHTML = results.slice(0, 6).map((item, idx) => {
    const isMovie = item.media_type === 'movie';
    const typeBadge = isMovie ? '<span class="badge-type movie">Movie</span>' : '<span class="badge-type">TV Series</span>';
    const poster = item.poster_path ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w500${item.poster_path}`) : '';
    const year = item.year || '';
    const isSaved = isItemInWatchlist(item);

    return `
      <div class="wl-search-result-item" data-index="${idx}">
        ${poster ? `<img class="shield-result-thumb" src="${escapeHtml(poster)}" alt="" />` : `<div class="shield-result-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
        <div class="shield-result-info">
          <div class="shield-result-title">${escapeHtml(item.title)}</div>
          <div class="shield-result-meta">
            ${typeBadge}
            ${year ? `<span>• ${escapeHtml(year)}</span>` : ''}
          </div>
        </div>
        <button type="button" class="btn-wl-add-result ${isSaved ? 'saved' : ''}" data-index="${idx}" ${isSaved ? 'disabled' : ''} data-id="${item.id}" data-title="${escapeHtml(item.title)}">
          ${isSaved ? renderIcon('check', 14) + ' Saved' : renderIcon('plus', 14) + ' Add'}
        </button>
      </div>
    `;
  }).join('');

  dom.watchlistSearchResults.classList.remove('hidden');

  dom.watchlistSearchResults.querySelectorAll('.wl-search-result-item').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.index, 10);
      const item = results[idx];
      if (!item || isItemInWatchlist(item)) return;
      addToWatchlist(item);
      const btn = row.querySelector('.btn-wl-add-result');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('saved');
        btn.innerHTML = `${renderIcon('check', 14)} Saved`;
      }
    });
  });
}

function handleWatchlistSearchKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (watchlistLastResults && watchlistLastResults.length > 0) {
      const firstItem = watchlistLastResults[0];
      if (!isItemInWatchlist(firstItem)) {
        addToWatchlist(firstItem);
        const firstBtn = dom.watchlistSearchResults?.querySelector('.btn-wl-add-result');
        if (firstBtn) {
          firstBtn.disabled = true;
          firstBtn.classList.add('saved');
          firstBtn.innerHTML = `${renderIcon('check', 14)} Saved`;
        }
      }
    }
  }
}

function clearWatchlistSearch() {
  if (dom.watchlistAddInput) {
    dom.watchlistAddInput.value = '';
    dom.watchlistAddInput.focus();
  }
  if (dom.watchlistSearchClear) dom.watchlistSearchClear.classList.add('hidden');
  if (dom.watchlistSearchResults) {
    dom.watchlistSearchResults.innerHTML = '';
    dom.watchlistSearchResults.classList.add('hidden');
  }
  watchlistLastResults = [];
}

function renderWatchlistItems() {
  if (!dom.watchlistList) return;

  let items = [...state.watchlist];

  // Apply Filter Tab
  if (watchlistFilter === 'movie') {
    items = items.filter((i) => (typeof i === 'object' && i !== null ? (i.type === 'movie' || i.media_type === 'movie') : true));
  } else if (watchlistFilter === 'tv') {
    items = items.filter((i) => (typeof i === 'object' && i !== null ? (i.type === 'tv' || i.media_type === 'tv') : false));
  } else if (watchlistFilter === 'watched') {
    items = items.filter((i) => (typeof i === 'object' && i !== null ? i.status === 'watched' : false));
  }

  // Apply Sort
  if (watchlistSort === 'title') {
    items.sort((a, b) => {
      const tA = (typeof a === 'object' && a !== null ? a.title : a) || '';
      const tB = (typeof b === 'object' && b !== null ? b.title : b) || '';
      return tA.localeCompare(tB);
    });
  } else {
    // 'recent': newest addedAt first
    items.sort((a, b) => {
      const timeA = (typeof a === 'object' && a !== null ? (a.addedAt || 0) : 0);
      const timeB = (typeof b === 'object' && b !== null ? (b.addedAt || 0) : 0);
      return timeB - timeA;
    });
  }

  if (items.length === 0) {
    const emptyMsg = state.watchlist.length === 0
      ? 'Nothing saved yet. Search above to add movies and series!'
      : `No titles match the "${watchlistFilter === 'tv' ? 'Series' : (watchlistFilter === 'movie' ? 'Movies' : (watchlistFilter === 'watched' ? 'Watched' : watchlistFilter))}" filter.`;
    dom.watchlistList.innerHTML = `<div class="watchlist-empty">${emptyMsg}</div>`;
    return;
  }

  dom.watchlistList.innerHTML = items.map((item) => {
    const isObj = typeof item === 'object' && item !== null;
    const id = isObj ? item.id : null;
    const title = isObj ? item.title : item;
    const year = isObj && item.year ? item.year : '';
    const type = isObj && (item.type === 'tv' || item.media_type === 'tv') ? 'tv' : 'movie';
    const poster = isObj && item.poster ? item.poster : null;
    const status = isObj && item.status ? item.status : 'want_to_watch';
    const rating = isObj && item.imdb_rating ? `<span class="star-icon-wrap">${renderIcon('star', 12)}</span> ${item.imdb_rating}` : (isObj && item.rating ? `<span class="film-icon-wrap">${renderIcon('film', 12)}</span> ${item.rating}` : '');

    return `
      <div class="watchlist-item-rich" data-title="${escapeHtml(title)}">
        <div class="wl-left">
          ${poster ? `<img class="wl-poster" src="${escapeHtml(poster)}" alt="" />` : `<div class="wl-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
          <div class="wl-meta">
            <div class="wl-title-row">
              <span class="wl-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
              <span class="badge-type ${type}">${type === 'movie' ? 'Movie' : 'TV Series'}</span>
            </div>
            <div class="wl-sub">
              ${year ? `<span>${escapeHtml(year)}</span>` : ''}
              ${rating ? `<span>• ${rating}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="wl-actions">
          <select class="wl-status-select" data-title="${escapeHtml(title)}" aria-label="Watch status">
            <option value="want_to_watch" ${status === 'want_to_watch' ? 'selected' : ''}>Want to watch</option>
            <option value="watching" ${status === 'watching' ? 'selected' : ''}>Watching</option>
            <option value="watched" ${status === 'watched' ? 'selected' : ''}>Watched</option>
          </select>
          ${id ? `<button type="button" class="btn-wl-inspect" data-id="${id}" data-type="${type}" title="View Details in Title Inspector">Details</button>` : ''}
          <button type="button" class="btn-wl-remove" data-title="${escapeHtml(title)}" title="Remove from Watchlist" aria-label="Remove">${renderIcon('close', 16)}</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind status switch
  dom.watchlistList.querySelectorAll('.wl-status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const t = e.target.dataset.title;
      const newStatus = e.target.value;
      const target = state.watchlist.find((w) => (typeof w === 'object' && w !== null ? w.title === t : w === t));
      if (target && typeof target === 'object') {
        target.status = newStatus;
        localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
        if (watchlistFilter === 'watched') renderWatchlistItems();
      }
    });
  });

  // Bind Inspect button
  dom.watchlistList.querySelectorAll('.btn-wl-inspect').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const type = btn.dataset.type || 'movie';
      if (id) {
        closeWatchlistModal();
        openTitleInspector(id, type, true);
      }
    });
  });

  // Bind Remove button with undo
  dom.watchlistList.querySelectorAll('.btn-wl-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.title;
      const target = state.watchlist.find((w) => (typeof w === 'object' && w !== null ? w.title === t : w === t));
      if (target) {
        removeFromWatchlist(target, true);
      }
    });
  });
}

// ========================================================
// 11.1 TITLE INSPECTOR (Opens on Demand & Draggable on Mobile)
// ========================================================
function showMobileInspectorPill(data) {
  if (!dom.mobileInspectorPill || !data || !data.title) return;
  if (window.innerWidth > 768) return;
  if (dom.inspectorPanel && !dom.inspectorPanel.classList.contains('collapsed')) return;
  if (dom.mobileInspectorPillText) {
    dom.mobileInspectorPillText.textContent = `${data.title} Details`;
  }
  dom.mobileInspectorPill.classList.remove('hidden');
}

function hideMobileInspectorPill() {
  if (dom.mobileInspectorPill) {
    dom.mobileInspectorPill.classList.add('hidden');
  }
}

async function prepareTitleInspectorContent(mediaDataOrId, type = 'movie') {
  const placeholderEl = document.getElementById('inspector-placeholder');
  const skeletonEl = document.getElementById('inspector-skeleton');
  const cardActiveEl = document.getElementById('inspector-card-active');

  if (placeholderEl) placeholderEl.classList.add('hidden');
  if (cardActiveEl) cardActiveEl.classList.add('hidden');
  if (skeletonEl) skeletonEl.classList.remove('hidden');

  let data = null;
  if (
    typeof mediaDataOrId === 'object' &&
    mediaDataOrId !== null &&
    mediaDataOrId.title &&
    (mediaDataOrId.overview || mediaDataOrId.cast || mediaDataOrId.genres?.length)
  ) {
    data = mediaDataOrId;
  } else {
    const idToFetch = typeof mediaDataOrId === 'object' ? (mediaDataOrId.id || mediaDataOrId.tmdbId) : mediaDataOrId;
    const typeToFetch = typeof mediaDataOrId === 'object' ? (mediaDataOrId.media_type || mediaDataOrId.type || type) : type;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(`/api/media/details?id=${encodeURIComponent(idToFetch)}&type=${encodeURIComponent(typeToFetch)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      data = await res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('Failed to fetch title inspector details:', e);
    }
  }

  if (skeletonEl) skeletonEl.classList.add('hidden');

  if (!data || data.error) {
    if (placeholderEl) placeholderEl.classList.remove('hidden');
    return null;
  }

  state.activeTitleInspectorData = data;

  if (cardActiveEl) {
    cardActiveEl.classList.remove('hidden');

    const posterHtml = data.poster_url
      ? `<div class="inspector-poster-container"><img class="inspector-poster" src="${escapeHtml(data.poster_url)}" alt="${escapeHtml(data.title)}" /></div>`
      : `<div class="inspector-poster-container"><div class="inspector-poster-placeholder">${renderIcon('film')}</div></div>`;

    const genresHtml = (data.genres || [])
      .map((g) => `<span class="genre-pill">${escapeHtml(typeof g === 'string' ? g : g.name)}</span>`)
      .join('');

    const inProviders = data.watch_providers_in?.flatrate || [];
    const providersHtml = inProviders.length > 0
      ? inProviders.map((p) => `<span class="watch-badge">${renderIcon('tv')} ${escapeHtml(p)}</span>`).join('')
      : `<span style="font-size:12px;color:var(--text-muted)">Not currently streaming in India</span>`;

    const castHtml = (data.cast || []).slice(0, 6)
      .map((c) => `<span class="cast-chip">${escapeHtml(c.name)}</span>`)
      .join('');

    cardActiveEl.innerHTML = `
      ${posterHtml}
      <div class="inspector-card-title">${escapeHtml(data.title)} <span class="inspector-year">(${escapeHtml(data.year || '')})</span></div>

      <div class="inspector-ratings-row">
        ${data.imdb_rating ? `<span class="badge-rating imdb"><span class="star-icon-wrap">${renderIcon('star')}</span> IMDb ${escapeHtml(String(data.imdb_rating))}</span>` : ''}
        ${data.tmdb_rating ? `<span class="badge-rating tmdb"><span class="film-icon-wrap">${renderIcon('film')}</span> TMDB ${escapeHtml(String(data.tmdb_rating))}</span>` : ''}
        ${data.duration ? `<span class="badge-rating duration"><span class="clock-icon-wrap">${renderIcon('clock')}</span> ${escapeHtml(data.duration)}</span>` : ''}
      </div>

      ${genresHtml ? `<div class="inspector-genres">${genresHtml}</div>` : ''}

      ${data.overview ? `<div class="inspector-overview">${escapeHtml(data.overview)}</div>` : ''}

      <div class="inspector-section">
        <strong>Where to Watch (India)</strong>
        <div class="watch-badges">${providersHtml}</div>
      </div>

      ${castHtml ? `
        <div class="inspector-section">
          <strong>Key Cast</strong>
          <div class="cast-chips">${castHtml}</div>
        </div>
      ` : ''}

      <div class="inspector-actions-row">
        <button type="button" class="btn-inspector-watchlist ${isItemInWatchlist(data) ? 'saved' : ''}" id="btn-inspector-watchlist">
          ${isItemInWatchlist(data) ? `${renderIcon('check', 14)} <span>In Watchlist</span>` : `${renderIcon('bookmark', 14)} <span>Add to Watchlist</span>`}
        </button>
        ${data.trailer_url ? `
          <a href="${escapeHtml(data.trailer_url)}" target="_blank" rel="noopener noreferrer" class="btn-trailer">
            ${renderIcon('play', 14)} Watch Trailer
          </a>
        ` : ''}
      </div>
    `;

    const btnInspectorWl = cardActiveEl.querySelector('#btn-inspector-watchlist');
    if (btnInspectorWl) {
      btnInspectorWl.addEventListener('click', () => {
        toggleWatchlist(data);
      });
    }
  }

  return data;
}

async function openTitleInspector(mediaDataOrId, type = 'movie', forceOpen = false) {
  if (!dom.inspectorPanel) return;

  const isMobile = window.innerWidth <= 768;
  const isManualClosed = localStorage.getItem(STORAGE_KEYS.INSPECTOR_MANUAL_CLOSED) === 'true';

  // If user closed inspector manually, do NOT auto-open on streamed / automatic title detections
  if (!forceOpen && isManualClosed) {
    const data = await prepareTitleInspectorContent(mediaDataOrId, type);
    if (isMobile && data && data.title) {
      showMobileInspectorPill(data);
    }
    return;
  }

  // On mobile: if NOT explicitly requested by user tap (forceOpen),
  // prepare data in background and show floating trigger pill
  if (isMobile && !forceOpen) {
    const data = await prepareTitleInspectorContent(mediaDataOrId, type);
    if (data && data.title) {
      showMobileInspectorPill(data);
    }
    return;
  }

  // User explicitly opened it or auto-opened
  if (forceOpen) {
    localStorage.removeItem(STORAGE_KEYS.INSPECTOR_MANUAL_CLOSED);
    localStorage.setItem(STORAGE_KEYS.INSPECTOR_OPEN, 'true');
  } else {
    localStorage.setItem(STORAGE_KEYS.INSPECTOR_OPEN, 'true');
  }

  dom.inspectorPanel.classList.remove('collapsed');
  dom.inspectorPanel.style.transform = '';
  dom.btnToggleInspector?.classList.add('active');

  if (isMobile && dom.inspectorOverlay) {
    dom.inspectorOverlay.classList.add('active');
  }

  hideMobileInspectorPill();
  await prepareTitleInspectorContent(mediaDataOrId, type);
}

function closeInspectorPanel(userInitiated = true) {
  if (!dom.inspectorPanel) return;

  if (userInitiated) {
    localStorage.setItem(STORAGE_KEYS.INSPECTOR_MANUAL_CLOSED, 'true');
    localStorage.setItem(STORAGE_KEYS.INSPECTOR_OPEN, 'false');
  }

  dom.inspectorPanel.classList.add('collapsed');
  dom.inspectorPanel.style.transform = '';
  dom.btnToggleInspector?.classList.remove('active');

  if (dom.inspectorOverlay) {
    dom.inspectorOverlay.classList.remove('active');
    dom.inspectorOverlay.style.opacity = '';
  }

  if (window.innerWidth <= 768 && state.activeTitleInspectorData) {
    showMobileInspectorPill(state.activeTitleInspectorData);
  }
}

function toggleTitleInspector() {
  if (!dom.inspectorPanel) return;
  const isCollapsed = dom.inspectorPanel.classList.contains('collapsed');
  if (isCollapsed) {
    openTitleInspector(
      state.activeTitleInspectorData,
      state.activeTitleInspectorData?.media_type || state.activeTitleInspectorData?.type || 'movie',
      true
    );
  } else {
    closeInspectorPanel(true);
  }
}

function setupInspectorTouchGestures() {
  if (!dom.inspectorPanel) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let startTime = 0;
  let isDragging = false;
  let direction = null;

  dom.inspectorPanel.addEventListener(
    'touchstart',
    (e) => {
      if (dom.inspectorPanel.classList.contains('collapsed')) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      currentY = startY;
      startTime = Date.now();
      isDragging = false;
      direction = null;
    },
    { passive: true }
  );

  dom.inspectorPanel.addEventListener(
    'touchmove',
    (e) => {
      if (dom.inspectorPanel.classList.contains('collapsed')) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      currentX = touch.clientX;
      currentY = touch.clientY;
      const diffX = currentX - startX;
      const diffY = currentY - startY;

      if (!direction) {
        const absX = Math.abs(diffX);
        const absY = Math.abs(diffY);
        if (absX > 8 || absY > 8) {
          const startedOnHeader = e.target.closest('.inspector-header') || e.target.closest('.inspector-drag-handle');
          if (diffX > 6 && absX >= absY) {
            direction = 'horizontal';
            isDragging = true;
          } else if (startedOnHeader && diffY > 6 && absY > absX) {
            direction = 'vertical';
            isDragging = true;
          } else {
            direction = 'scroll';
          }
        }
      }

      if (isDragging) {
        if (e.cancelable) e.preventDefault();
        dom.inspectorPanel.style.transition = 'none';

        if (direction === 'horizontal') {
          const dragX = Math.max(0, diffX);
          dom.inspectorPanel.style.transform = `translateX(${dragX}px)`;
          if (dom.inspectorOverlay) {
            const ratio = Math.max(0, 1 - dragX / (dom.inspectorPanel.offsetWidth || 320));
            dom.inspectorOverlay.style.opacity = String(ratio);
          }
        } else if (direction === 'vertical') {
          const dragY = Math.max(0, diffY);
          dom.inspectorPanel.style.transform = `translateY(${dragY}px)`;
          if (dom.inspectorOverlay) {
            const ratio = Math.max(0, 1 - dragY / 300);
            dom.inspectorOverlay.style.opacity = String(ratio);
          }
        }
      }
    },
    { passive: false }
  );

  const handleTouchEnd = () => {
    if (!isDragging) return;

    const dt = Math.max(1, Date.now() - startTime);
    const diffX = currentX - startX;
    const diffY = currentY - startY;
    const panelWidth = dom.inspectorPanel.offsetWidth || 320;
    const velX = diffX / dt;
    const velY = diffY / dt;

    const shouldCloseHoriz = direction === 'horizontal' && (diffX > panelWidth * 0.28 || (diffX > 35 && velX > 0.35));
    const shouldCloseVert = direction === 'vertical' && (diffY > 80 || (diffY > 35 && velY > 0.35));

    if (shouldCloseHoriz || shouldCloseVert) {
      closeInspectorPanel(true);
    } else {
      // Snap back smoothly
      dom.inspectorPanel.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      dom.inspectorPanel.style.transform = 'translateX(0)';
      if (dom.inspectorOverlay) {
        dom.inspectorOverlay.style.transition = 'opacity 0.25s ease';
        dom.inspectorOverlay.style.opacity = '1';
      }
      setTimeout(() => {
        dom.inspectorPanel.style.transition = '';
      }, 260);
    }

    isDragging = false;
    direction = null;
  };

  dom.inspectorPanel.addEventListener('touchend', handleTouchEnd, { passive: true });
  dom.inspectorPanel.addEventListener('touchcancel', handleTouchEnd, { passive: true });
}

// ========================================================
// 12. SPOILER SHIELD (SINGLE SOURCE OF TRUTH & MULTI-SHOW)
// ========================================================
let shieldSearchDebounceTimer = null;
let currentSeriesSeasonsData = null;
let undoToastTimer = null;

function onShieldsChanged() {
  const allShields = ShieldsStore.getAll();
  const activeShield = ShieldsStore.getActive();

  state.savedShields = allShields;
  state.spoilerShield = activeShield ? { ...activeShield } : { active: false };

  renderTopbarShieldChips();
  renderPopupShieldCards();

  if (state.currentMode === 'spoiler-safe') {
    updateWelcomeViewForMode('spoiler-safe');
  }
}

// Compatibility alias
function updateSpoilerShieldUI() {
  onShieldsChanged();
}

// -------------------------------------------------------------
// Topbar Shield Chips
// -------------------------------------------------------------
function renderTopbarShieldChips() {
  if (!dom.topbarChipsList) return;
  const shields = ShieldsStore.getAll();
  const activeShield = ShieldsStore.getActive();
  const activeKey = activeShield ? String(activeShield.tmdbId || activeShield.title) : null;

  const visibleLimit = 3;
  const directChips = shields.slice(0, visibleLimit);
  const overflowChips = shields.slice(visibleLimit);

  dom.topbarChipsList.innerHTML = directChips
    .map((s) => {
      const isAct = activeKey && String(s.tmdbId || s.title) === activeKey;
      const posterSrc = s.poster || s.poster_path;
      return `
        <div class="shield-chip ${isAct ? 'active' : ''}" data-shield-id="${escapeHtml(String(s.tmdbId || s.title))}" title="${escapeHtml(s.title)} (${escapeHtml(s.progress || 'S1 E1')})">
          ${posterSrc ? `<img class="chip-poster" src="${escapeHtml(posterSrc)}" alt="" />` : `<span class="chip-icon">${renderIcon('shield')}</span>`}
          <span class="chip-title">${escapeHtml(s.title)}</span>
          <span class="chip-progress">${escapeHtml(s.progress || 'S1 E1')}</span>
        </div>
      `;
    })
    .join('');

  dom.topbarChipsList.querySelectorAll('.shield-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const shieldId = chip.dataset.shieldId;
      ShieldsStore.setActive(shieldId);
    });
  });

  if (dom.shieldOverflowWrapper && dom.btnOverflowChip && dom.shieldOverflowDropdown) {
    if (overflowChips.length > 0) {
      dom.shieldOverflowWrapper.classList.remove('hidden');
      dom.btnOverflowChip.textContent = `+${overflowChips.length}`;
      dom.shieldOverflowDropdown.innerHTML = overflowChips
        .map((s) => {
          const isAct = activeKey && String(s.tmdbId || s.title) === activeKey;
          const posterSrc = s.poster || s.poster_path;
          return `
            <div class="shield-chip overflow-item ${isAct ? 'active' : ''}" data-shield-id="${escapeHtml(String(s.tmdbId || s.title))}">
              ${posterSrc ? `<img class="chip-poster" src="${escapeHtml(posterSrc)}" alt="" />` : `<span class="chip-icon">${renderIcon('shield')}</span>`}
              <span class="chip-title">${escapeHtml(s.title)}</span>
              <span class="chip-progress">${escapeHtml(s.progress || 'S1 E1')}</span>
            </div>
          `;
        })
        .join('');

      dom.shieldOverflowDropdown.querySelectorAll('.shield-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const shieldId = chip.dataset.shieldId;
          ShieldsStore.setActive(shieldId);
          dom.shieldOverflowDropdown.classList.add('hidden');
        });
      });
    } else {
      dom.shieldOverflowWrapper.classList.add('hidden');
      dom.shieldOverflowDropdown.classList.add('hidden');
    }
  }
}

// -------------------------------------------------------------
// Spoiler Modal Management (Redesigned)
// Modes: 'list' (default), 'add' (with search), 'edit' (season/ep form)
// -------------------------------------------------------------
function openSpoilerModal(viewMode = 'list', targetMedia = null) {
  if (state.isGenerating) return;

  if (dom.shieldSearchInput) dom.shieldSearchInput.value = '';
  if (dom.shieldResultsList) {
    dom.shieldResultsList.innerHTML = '';
    dom.shieldResultsList.classList.add('hidden');
  }

  if (viewMode === 'add') {
    if (dom.shieldSearchSection) dom.shieldSearchSection.classList.remove('hidden');
    if (dom.shieldsListSection) dom.shieldsListSection.classList.remove('hidden');
    if (dom.shieldSetupCard) dom.shieldSetupCard.classList.add('hidden');
    renderPopupShieldCards();
    if (dom.shieldSearchInput) {
      setTimeout(() => dom.shieldSearchInput.focus(), 100);
    }
  } else if (viewMode === 'edit') {
    if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
    if (dom.shieldsListSection) dom.shieldsListSection.classList.add('hidden');
    if (dom.shieldSetupCard) dom.shieldSetupCard.classList.remove('hidden');
    if (targetMedia) {
      selectMediaForSetup(targetMedia, false);
    } else {
      const active = ShieldsStore.getActive();
      if (active) selectMediaForSetup(active, false);
    }
  } else {
    // 'list' mode
    if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
    if (dom.shieldSetupCard) dom.shieldSetupCard.classList.add('hidden');
    if (dom.shieldsListSection) dom.shieldsListSection.classList.remove('hidden');
    renderPopupShieldCards();
  }

  dom.spoilerModal.classList.remove('hidden');
}

function closeSpoilerModal() {
  dom.spoilerModal.classList.add('hidden');
  if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
  if (dom.shieldResultsList) dom.shieldResultsList.classList.add('hidden');
}

function showShieldSearchSection() {
  state.currentSetupMedia = null;
  if (dom.shieldSearchSection) dom.shieldSearchSection.classList.remove('hidden');
  if (dom.shieldSetupCard) dom.shieldSetupCard.classList.add('hidden');
  if (dom.shieldsListSection) dom.shieldsListSection.classList.remove('hidden');
  if (dom.shieldSearchInput) {
    dom.shieldSearchInput.value = '';
    setTimeout(() => dom.shieldSearchInput.focus(), 100);
  }
}

// -------------------------------------------------------------
// Popup Shield Cards List
// -------------------------------------------------------------
function renderPopupShieldCards() {
  if (!dom.shieldSavedList) return;
  const shields = ShieldsStore.getAll();
  const activeShield = ShieldsStore.getActive();
  const activeKey = activeShield ? String(activeShield.tmdbId || activeShield.title) : null;

  if (dom.shieldSavedCount) {
    dom.shieldSavedCount.textContent = `${shields.length} protected`;
  }

  if (shields.length === 0) {
    dom.shieldSavedList.innerHTML = `
      <div style="font-size: 13px; color: var(--text-muted); padding: 18px; text-align: center; font-style: italic;">
        No protected shows yet. Click "+ Add another show" above to protect your first show.
      </div>
    `;
    return;
  }

  dom.shieldSavedList.innerHTML = shields
    .map((item) => {
      const isAct = activeKey && String(item.tmdbId || item.title) === activeKey;
      const posterSrc = item.poster || item.poster_path;
      const itemKey = escapeHtml(String(item.tmdbId || item.title));
      return `
        <div class="shield-card ${isAct ? 'is-active' : ''}" data-shield-id="${itemKey}">
          <div class="shield-card-left">
            ${posterSrc ? `<img class="shield-card-thumb" src="${escapeHtml(posterSrc)}" alt="" />` : `<div class="shield-card-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
            <div class="shield-card-meta">
              <div class="shield-card-title-row">
                <span class="shield-card-title">${escapeHtml(item.title)}</span>
                ${isAct ? '<span class="badge-active-tag">ACTIVE</span>' : ''}
              </div>
              <span class="shield-card-progress">${escapeHtml(item.progress || 'S1 E1')}</span>
            </div>
          </div>
          <div class="shield-card-actions">
            ${!isAct ? `<button type="button" class="btn-card-switch" data-id="${itemKey}">Switch</button>` : ''}
            <button type="button" class="btn-card-edit" data-id="${itemKey}">Edit</button>
            <button type="button" class="btn-trash-shield" data-id="${itemKey}" title="Remove" aria-label="Remove shield">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Switch button handlers
  dom.shieldSavedList.querySelectorAll('.btn-card-switch').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.id;
      ShieldsStore.setActive(id);
    });
  });

  // Edit button handlers
  dom.shieldSavedList.querySelectorAll('.btn-card-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.id;
      const target = shields.find((s) => String(s.tmdbId || s.title) === id);
      if (target) {
        openSpoilerModal('edit', target);
      }
    });
  });

  // Remove / Trash button handlers (large hit area, stopPropagation, 5s undo toast)
  dom.shieldSavedList.querySelectorAll('.btn-trash-shield').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.id;
      const removed = ShieldsStore.remove(id);
      if (removed) {
        showUndoToast(`Removed ${removed.title} - Undo`, () => {
          ShieldsStore.undoRemove(removed);
        });
      }
    });
  });
}

// -------------------------------------------------------------
// Undo Toast Notification (5 Seconds)
// -------------------------------------------------------------
function showUndoToast(message, onUndo) {
  if (!dom.toastUndo || !dom.toastUndoMsg || !dom.btnUndoAction) return;
  clearTimeout(undoToastTimer);

  dom.toastUndoMsg.textContent = message;
  dom.toastUndo.classList.remove('hidden');

  const handleUndo = () => {
    clearTimeout(undoToastTimer);
    dom.toastUndo.classList.add('hidden');
    dom.btnUndoAction.onclick = null;
    if (typeof onUndo === 'function') onUndo();
  };

  dom.btnUndoAction.onclick = handleUndo;

  undoToastTimer = setTimeout(() => {
    dom.toastUndo.classList.add('hidden');
    dom.btnUndoAction.onclick = null;
  }, 5000);
}

// -------------------------------------------------------------
// TMDB Title Search
// -------------------------------------------------------------
async function searchMediaTitles(query) {
  const q = (query || '').trim();
  if (!q) {
    if (dom.shieldResultsList) {
      dom.shieldResultsList.innerHTML = '';
      dom.shieldResultsList.classList.add('hidden');
    }
    return;
  }

  if (dom.shieldSearchSpinner) dom.shieldSearchSpinner.classList.remove('hidden');

  try {
    const res = await fetch(`/api/media/search?query=${encodeURIComponent(q)}`);
    const data = await res.json();
    const results = data && data.results ? data.results : [];
    renderMediaSearchResults(results);
  } catch (err) {
    console.warn('Shield media search error:', err);
  } finally {
    if (dom.shieldSearchSpinner) dom.shieldSearchSpinner.classList.add('hidden');
  }
}

function renderMediaSearchResults(results) {
  if (!dom.shieldResultsList) return;

  if (!results || results.length === 0) {
    dom.shieldResultsList.innerHTML = '<div style="padding: 10px; font-size: 12.5px; color: var(--text-muted); text-align: center;">No titles found on TMDB. Check the spelling.</div>';
    dom.shieldResultsList.classList.remove('hidden');
    return;
  }

  dom.shieldResultsList.innerHTML = results
    .slice(0, 6)
    .map((item) => {
      const isMovie = item.media_type === 'movie';
      const typeBadge = isMovie ? '<span class="badge-type movie">Movie</span>' : '<span class="badge-type">TV Series</span>';
      const poster = item.poster_path || '';
      const year = item.year || '';
      return `
        <div class="shield-result-item" data-media-id="${item.id}" data-media-type="${escapeHtml(item.media_type || 'tv')}">
          ${poster ? `<img class="shield-result-thumb" src="${escapeHtml(poster)}" alt="" />` : `<div class="shield-result-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
          <div class="shield-result-info">
            <div class="shield-result-title">${escapeHtml(item.title)}</div>
            <div class="shield-result-meta">
              ${typeBadge}
              ${year ? `<span>• ${escapeHtml(year)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  dom.shieldResultsList.classList.remove('hidden');

  dom.shieldResultsList.querySelectorAll('.shield-result-item').forEach((row) => {
    row.addEventListener('click', () => {
      const id = parseInt(row.dataset.mediaId, 10);
      const matched = results.find((r) => r.id === id);
      if (matched) {
        if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
        if (dom.shieldsListSection) dom.shieldsListSection.classList.add('hidden');
        if (dom.shieldSetupCard) dom.shieldSetupCard.classList.remove('hidden');
        selectMediaForSetup(matched, true);
      }
    });
  });
}

// -------------------------------------------------------------
// Media Configuration & Season/Episode Loading
// -------------------------------------------------------------
async function selectMediaForSetup(media, isNewSelection = true) {
  state.currentSetupMedia = media;

  if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
  if (dom.shieldsListSection) dom.shieldsListSection.classList.add('hidden');
  if (dom.shieldSetupCard) dom.shieldSetupCard.classList.remove('hidden');

  const title = media.title || media.showTitle;
  if (dom.shieldPreviewTitle) dom.shieldPreviewTitle.textContent = title;
  if (dom.shieldPreviewYear) dom.shieldPreviewYear.textContent = media.year ? `Released: ${media.year}` : '';

  const isMovie = media.media_type === 'movie' || media.type === 'movie';
  if (dom.shieldPreviewType) {
    dom.shieldPreviewType.textContent = isMovie ? 'Movie' : 'TV Series';
    dom.shieldPreviewType.className = isMovie ? 'badge-type movie' : 'badge-type';
  }

  const posterSrc = media.poster || media.poster_path || media.poster_url;
  if (dom.shieldPreviewPoster) {
    if (posterSrc) {
      dom.shieldPreviewPoster.src = posterSrc;
      dom.shieldPreviewPoster.classList.remove('hidden');
    } else {
      dom.shieldPreviewPoster.src = '';
      dom.shieldPreviewPoster.classList.add('hidden');
    }
  }

  if (isMovie) {
    if (dom.shieldTvProgress) dom.shieldTvProgress.classList.add('hidden');
    if (dom.shieldMovieProgress) dom.shieldMovieProgress.classList.remove('hidden');

    if (dom.movieWatchedYes && dom.movieWatchedNo) {
      if (!isNewSelection && media.movieWatched) {
        dom.movieWatchedYes.checked = true;
      } else {
        dom.movieWatchedNo.checked = true;
      }
    }
  } else {
    // TV Series
    if (dom.shieldMovieProgress) dom.shieldMovieProgress.classList.add('hidden');
    if (dom.shieldTvProgress) dom.shieldTvProgress.classList.remove('hidden');

    if (isNewSelection) {
      if (dom.shieldEpOnlyToggle) dom.shieldEpOnlyToggle.checked = false;
      if (dom.shieldNotStartedToggle) dom.shieldNotStartedToggle.checked = false;
      if (dom.shieldSeasonEpRow) dom.shieldSeasonEpRow.classList.remove('hidden');
      if (dom.shieldAbsEpRow) dom.shieldAbsEpRow.classList.add('hidden');
    } else {
      if (dom.shieldEpOnlyToggle) dom.shieldEpOnlyToggle.checked = Boolean(media.absoluteEpisode);
      if (dom.shieldNotStartedToggle) dom.shieldNotStartedToggle.checked = Boolean(media.havenNotStarted);
      if (dom.shieldAbsEpInput && media.absoluteEpisode) {
        dom.shieldAbsEpInput.value = media.absoluteEpisode;
      }
      if (dom.shieldSeasonEpRow) {
        dom.shieldSeasonEpRow.classList.toggle('hidden', Boolean(media.absoluteEpisode || media.havenNotStarted));
      }
      if (dom.shieldAbsEpRow) {
        dom.shieldAbsEpRow.classList.toggle('hidden', !media.absoluteEpisode);
      }
    }

    await populateSeriesSeasons(media.id || media.tmdbId, isNewSelection);
  }
}

async function populateSeriesSeasons(seriesId, isNewSelection) {
  if (!dom.shieldSeasonSelect || !dom.shieldEpisodeSelect) return;

  dom.shieldSeasonSelect.innerHTML = '<option value="1">Loading seasons...</option>';
  dom.shieldEpisodeSelect.innerHTML = '<option value="1">Loading episodes...</option>';

  try {
    if (seriesId) {
      const res = await fetch(`/api/media/seasons?id=${seriesId}`);
      if (res.ok) {
        currentSeriesSeasonsData = await res.json();
      }
    }
  } catch (err) {
    console.warn('Could not load seasons:', err);
  }

  const seasonsList =
    currentSeriesSeasonsData && currentSeriesSeasonsData.seasons && currentSeriesSeasonsData.seasons.length > 0
      ? currentSeriesSeasonsData.seasons
      : [{ season_number: 1, name: 'Season 1', episode_count: 10 }];

  dom.shieldSeasonSelect.innerHTML = seasonsList
    .map((s) => `<option value="${s.season_number}">${escapeHtml(s.name || `Season ${s.season_number}`)}</option>`)
    .join('');

  const targetMedia = state.currentSetupMedia || {};
  const targetSeason = !isNewSelection && targetMedia.season ? targetMedia.season : 1;
  dom.shieldSeasonSelect.value = String(targetSeason);

  updateEpisodeDropdownForSeason(targetSeason, isNewSelection);
}

function updateEpisodeDropdownForSeason(seasonNum, isNewSelection = true) {
  if (!dom.shieldEpisodeSelect) return;

  const seasonsList = currentSeriesSeasonsData && currentSeriesSeasonsData.seasons ? currentSeriesSeasonsData.seasons : [];
  const currentSeasonObj = seasonsList.find((s) => s.season_number === parseInt(seasonNum, 10)) || { episode_count: 10 };
  const epCount = currentSeasonObj.episode_count || 10;

  const epOptions = [];
  for (let i = 1; i <= epCount; i++) {
    epOptions.push(`<option value="${i}">Episode ${i}</option>`);
  }
  dom.shieldEpisodeSelect.innerHTML = epOptions.join('');

  const targetMedia = state.currentSetupMedia || {};
  if (!isNewSelection && targetMedia.episode && targetMedia.season === parseInt(seasonNum, 10)) {
    dom.shieldEpisodeSelect.value = String(targetMedia.episode);
  } else {
    dom.shieldEpisodeSelect.value = '1';
  }
}

// -------------------------------------------------------------
// Save / Unlock Actions
// -------------------------------------------------------------
function saveSpoilerShield() {
  const target = state.currentSetupMedia || ShieldsStore.getActive();
  if (!target || (!target.title && !target.showTitle)) {
    alert('Please search and select a title first.');
    return;
  }

  const title = target.title || target.showTitle;
  const isMovie = target.media_type === 'movie' || target.type === 'movie';
  let type = isMovie ? 'movie' : 'tv';
  let season = 1;
  let episode = 1;
  let absoluteEpisode = null;
  let havenNotStarted = false;
  let movieWatched = false;
  let progressStr = '';

  if (isMovie) {
    movieWatched = Boolean(dom.movieWatchedYes && dom.movieWatchedYes.checked);
    progressStr = movieWatched ? 'Watched' : 'Not Watched';
  } else {
    havenNotStarted = Boolean(dom.shieldNotStartedToggle && dom.shieldNotStartedToggle.checked);
    const epOnly = Boolean(dom.shieldEpOnlyToggle && dom.shieldEpOnlyToggle.checked);

    if (havenNotStarted) {
      season = 0;
      episode = 0;
      progressStr = "Haven't started";
    } else if (epOnly) {
      absoluteEpisode = parseInt(dom.shieldAbsEpInput ? dom.shieldAbsEpInput.value : 1, 10) || 1;
      progressStr = `Ep ${absoluteEpisode}`;
    } else {
      season = parseInt(dom.shieldSeasonSelect ? dom.shieldSeasonSelect.value : 1, 10) || 1;
      episode = parseInt(dom.shieldEpisodeSelect ? dom.shieldEpisodeSelect.value : 1, 10) || 1;
      progressStr = `S${season} E${episode}`;
    }
  }

  ShieldsStore.upsert(
    {
      tmdbId: target.id || target.tmdbId,
      title,
      showTitle: title,
      type,
      season,
      episode,
      absoluteEpisode,
      havenNotStarted,
      movieWatched,
      poster: target.poster || target.poster_path || target.poster_url || null,
      year: target.year || '',
      progress: progressStr,
    },
    true
  );

  closeSpoilerModal();
}

function unlockSpoilerShield() {
  const confirmed = confirm('This turns off protection for this title. Are you sure you want to unlock spoilers?');
  if (!confirmed) return;

  const target = state.currentSetupMedia || ShieldsStore.getActive();
  if (target) {
    ShieldsStore.remove(target.tmdbId || target.title);
  }
  closeSpoilerModal();
}

// "I finished the next episode" quick action
function advanceNextEpisode() {
  const active = ShieldsStore.getActive();
  if (!active || !active.title) {
    openSpoilerModal('add');
    return;
  }

  let newSeason = active.season || 1;
  let newEpisode = active.episode || 1;
  let newAbs = active.absoluteEpisode;
  let newProgress = '';

  if (active.type === 'movie') {
    active.movieWatched = true;
    newProgress = 'Watched';
  } else if (active.havenNotStarted) {
    active.havenNotStarted = false;
    newSeason = 1;
    newEpisode = 1;
    newProgress = 'S1 E1';
  } else if (active.absoluteEpisode) {
    newAbs = (parseInt(active.absoluteEpisode, 10) || 1) + 1;
    newProgress = `Ep ${newAbs}`;
  } else {
    newEpisode = (parseInt(active.episode, 10) || 1) + 1;
    newProgress = `S${newSeason} E${newEpisode}`;
  }

  const updated = ShieldsStore.upsert(
    {
      ...active,
      season: newSeason,
      episode: newEpisode,
      absoluteEpisode: newAbs,
      progress: newProgress,
    },
    true
  );

  const session = getActiveSession();
  if (session && session.messages.length > 0) {
    const notice = `Nice! Progress updated to **${updated.title} ${updated.progress}**. Spoiler Shield is locked.`;
    session.messages.push({ role: 'model', content: notice });
    appendMessageToDOM('model', notice, false);
    saveSessionsToStorage();
  }
}

// -------------------------------------------------------------
// Natural Language Progress Parser
// -------------------------------------------------------------
function parseNaturalLanguageProgress(text) {
  if (!text) return null;
  const str = text.trim();

  // Pattern 1: Title followed by S/E: e.g. "Carrie S1 E2", "Dexter season 8 episode 7"
  const titleFirstRegex = /^(?:i(?:'m| am)|currently)?\s*(?:on|at|watching)?\s*([a-zA-Z0-9\s:'-]+?)\s+(?:s(\d+)\s*e(\d+)|season\s*(\d+)\s*(?:episode|ep|e)\s*(\d+))\b/i;
  const titleFirstMatch = str.match(titleFirstRegex);
  if (titleFirstMatch) {
    const title = titleFirstMatch[1].trim();
    if (!title.match(/^(?:i|i'm|i am|we|currently)$/i)) {
      const season = parseInt(titleFirstMatch[2] || titleFirstMatch[4], 10);
      const episode = parseInt(titleFirstMatch[3] || titleFirstMatch[5], 10);
      return {
        season,
        episode,
        title,
        isPureUpdate: isPureProgressStatement(str),
      };
    }
  }

  // Pattern 2: Season X Episode Y (with optional title at end: "of Carrie")
  const sEpRegex = /(?:i(?:'m| am)|currently)?\s*(?:on|at|just finished|finished|watched)?\s*season\s*(\d+)\s*(?:episode|ep|e)\s*(\d+)(?:\s+(?:of|in)\s+([a-zA-Z0-9\s:'-]+))?/i;
  const sEpMatch = str.match(sEpRegex);
  if (sEpMatch) {
    return {
      season: parseInt(sEpMatch[1], 10),
      episode: parseInt(sEpMatch[2], 10),
      title: sEpMatch[3] ? sEpMatch[3].trim() : null,
      isPureUpdate: isPureProgressStatement(str),
    };
  }

  // Pattern 3: S1 E4 or S01E04 (with optional title at end: "of Dexter")
  const shortRegex = /(?:i(?:'m| am)|currently)?\s*(?:on|at|finished)?\s*s(\d+)\s*e(\d+)(?:\s+(?:of|in)\s+([a-zA-Z0-9\s:'-]+))?/i;
  const shortMatch = str.match(shortRegex);
  if (shortMatch) {
    return {
      season: parseInt(shortMatch[1], 10),
      episode: parseInt(shortMatch[2], 10),
      title: shortMatch[3] ? shortMatch[3].trim() : null,
      isPureUpdate: isPureProgressStatement(str),
    };
  }

  // Pattern 4: Episode only: "I'm on episode 4", "just finished episode 3"
  const epOnlyRegex = /(?:i(?:'m| am)|currently)?\s*(?:on|at|just finished|finished|watched|completed)?\s*(?:episode|ep)\s*(\d+)(?:\s+(?:of|in)\s+([a-zA-Z0-9\s:'-]+))?/i;
  const epOnlyMatch = str.match(epOnlyRegex);
  if (epOnlyMatch) {
    return {
      season: null,
      episode: parseInt(epOnlyMatch[1], 10),
      title: epOnlyMatch[2] ? epOnlyMatch[2].trim() : null,
      isPureUpdate: isPureProgressStatement(str),
    };
  }

  return null;
}

function isPureProgressStatement(str) {
  const lower = str.toLowerCase();
  const hasQuestion = /\?|who|what|why|how|explain|recap|tell me|think|theory/i.test(lower);
  return !hasQuestion && str.length < 80;
}

// ========================================================
// 13. THEME MANAGEMENT
// ========================================================
function applyTheme(theme, save = true) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  if (save) {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }

  if (dom.themeIconMoon && dom.themeIconSun) {
    if (theme === 'light') {
      dom.themeIconMoon.classList.add('hidden');
      dom.themeIconSun.classList.remove('hidden');
    } else {
      dom.themeIconMoon.classList.remove('hidden');
      dom.themeIconSun.classList.add('hidden');
    }
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark', true);
}

// Listen to system preference changes when user hasn't explicitly set a preference
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(STORAGE_KEYS.THEME)) {
      applyTheme(e.matches ? 'dark' : 'light', false);
    }
  });
}

// ========================================================
// 14. VOICE INPUT
// ========================================================
function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dom.btnVoiceInput.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';

  dom.btnVoiceInput.addEventListener('click', () => {
    if (state.isGenerating) return;
    if (state.isListening) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      state.isListening = true;
      dom.btnVoiceInput.classList.add('listening-active');
    } catch (err) {
      console.warn('Speech recognition error:', err);
    }
  });

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    dom.chatInput.value = dom.chatInput.value ? `${dom.chatInput.value} ${transcript}` : transcript;
    dom.chatInput.focus();
  };

  recognition.onend = () => {
    state.isListening = false;
    dom.btnVoiceInput.classList.remove('listening-active');
  };
}

// ========================================================
// 15. MOBILE DRAWER & INSPECTOR
// ========================================================
function toggleMobileSidebar() {
  dom.sidebar.classList.toggle('open');
  dom.mobileOverlay.classList.toggle('active');
}

function closeMobileSidebar() {
  dom.sidebar.classList.remove('open');
  dom.mobileOverlay.classList.remove('active');
}

// ========================================================
// 16. EVENT BINDINGS
// ========================================================
function bindEvents() {
  // Form submit: if generating, abort; otherwise send message
  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.isGenerating) {
      abortGenerating();
    } else {
      handleChatSubmit();
    }
  });

  // Send / Stop button click handler
  dom.btnSend.addEventListener('click', (e) => {
    if (state.isGenerating) {
      e.preventDefault();
      abortGenerating();
    }
  });

  // Auto-resize textarea & Enter key submission (disabled while generating)
  dom.chatInput.addEventListener('input', () => {
    dom.chatInput.style.height = 'auto';
    dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 140) + 'px';
  });

  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.isGenerating) return;
      handleChatSubmit();
    }
  });

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!state.isGenerating) createNewChat();
    }
  });

  // Brand Logo & Title Link: smoothly return to home / new chat on direct click
  if (dom.brandHomeLink) {
    dom.brandHomeLink.addEventListener('click', (e) => {
      // Allow user to Ctrl+Click or Cmd+Click to open the external URL in a new tab
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (state.isGenerating) return;
        setMode('general');
        createNewChat();
      }
    });
  }

  // New Chat button
  dom.btnNewChat.addEventListener('click', () => {
    if (!state.isGenerating) createNewChat();
  });

  // Clear History (Dustbin Button): Reliable, popup-free, mobile-friendly with 5s Undo Toast
  dom.btnClearHistory.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.isGenerating) return;

    if (!state.sessions || state.sessions.length === 0) {
      showUndoToast('No conversations to clear', null);
      return;
    }

    const previousSessions = [...state.sessions];
    const previousSessionId = state.currentSessionId;

    // Clear state & storage
    state.sessions = [];
    state.currentSessionId = null;
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSIONS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
    } catch (err) {
      console.warn('Storage clear error:', err);
    }

    // Reset UI to clean welcome
    createNewChat();
    renderHistory();
    closeMobileSidebar();

    // 5-second Undo Toast
    showUndoToast('Chat history cleared • Undo', () => {
      state.sessions = previousSessions;
      state.currentSessionId = previousSessionId;
      saveSessionsToStorage();
      renderHistory();
      renderActiveSession();
    });
  });

  // Mode Selection: ONLY switches mode and shows welcome view, DOES NOT send message!
  dom.modeNav.addEventListener('click', (e) => {
    if (state.isGenerating) return;
    const modeBtn = e.target.closest('.mode-item');
    if (!modeBtn) return;
    setMode(modeBtn.dataset.mode);
    closeMobileSidebar();
  });

  // Suggestion Chip Clicks: Populate input and submit prompt
  document.addEventListener('click', (e) => {
    if (state.isGenerating) return;

    // Special chip: "I finished the next episode"
    const advanceChip = e.target.closest('#btn-advance-ep-chip');
    if (advanceChip) {
      advanceNextEpisode();
      return;
    }

    // Special chip: "Set Up Your Show"
    const setupChip = e.target.closest('#btn-setup-shield-chip');
    if (setupChip) {
      openSpoilerModal('add');
      return;
    }

    const chip = e.target.closest('.hero-chip-btn');
    if (chip && chip.dataset.prompt) {
      dom.chatInput.value = chip.dataset.prompt;
      handleChatSubmit();
    }
  });

  // Watchlist Modal: ONLY opens modal, DOES NOT send message or change mode!
  dom.btnOpenWatchlist.addEventListener('click', () => {
    if (!state.isGenerating) openWatchlistModal();
  });
  dom.btnCloseWatchlistModal.addEventListener('click', closeWatchlistModal);

  // Watchlist Search & Autocomplete
  if (dom.watchlistAddInput) {
    dom.watchlistAddInput.addEventListener('input', handleWatchlistSearchInput);
    dom.watchlistAddInput.addEventListener('keydown', handleWatchlistSearchKeydown);
  }
  if (dom.watchlistSearchClear) {
    dom.watchlistSearchClear.addEventListener('click', clearWatchlistSearch);
  }

  // Watchlist Filter tabs
  if (dom.watchlistFilterTabs) {
    dom.watchlistFilterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.wl-tab-btn');
      if (!tab) return;
      dom.watchlistFilterTabs.querySelectorAll('.wl-tab-btn').forEach((b) => b.classList.remove('active'));
      tab.classList.add('active');
      watchlistFilter = tab.dataset.filter || 'all';
      renderWatchlistItems();
    });
  }

  // Watchlist Sort select
  if (dom.watchlistSortSelect) {
    dom.watchlistSortSelect.addEventListener('change', (e) => {
      watchlistSort = e.target.value || 'recent';
      renderWatchlistItems();
    });
  }

  // Close search dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#watchlist-search-wrapper')) {
      if (dom.watchlistSearchResults) dom.watchlistSearchResults.classList.add('hidden');
    }
  });

  // Mobile drawer controls
  dom.btnToggleSidebar.addEventListener('click', toggleMobileSidebar);
  dom.mobileOverlay.addEventListener('click', closeMobileSidebar);

  // Inspector close button, overlay, mobile trigger pill, and touch gestures
  dom.btnCloseInspector.addEventListener('click', () => closeInspectorPanel(true));
  if (dom.inspectorOverlay) {
    dom.inspectorOverlay.addEventListener('click', () => closeInspectorPanel(true));
  }
  if (dom.mobileInspectorPill) {
    dom.mobileInspectorPill.addEventListener('click', () => {
      if (state.activeTitleInspectorData) {
        openTitleInspector(state.activeTitleInspectorData, state.activeTitleInspectorData.media_type || state.activeTitleInspectorData.type || 'movie', true);
      }
    });
  }
  setupInspectorTouchGestures();

  // Inspector toggle in topbar
  if (dom.btnToggleInspector) {
    dom.btnToggleInspector.addEventListener('click', toggleTitleInspector);
  }

  // Mobile + Add Shield button in topbar
  if (dom.btnMobileAddShield) {
    dom.btnMobileAddShield.addEventListener('click', () => {
      if (!state.isGenerating) openSpoilerModal('add');
    });
  }

  // Theme toggle
  dom.btnToggleTheme.addEventListener('click', toggleTheme);

  // Topbar + Add Shield button
  if (dom.btnAddShieldTopbar) {
    dom.btnAddShieldTopbar.addEventListener('click', () => {
      if (!state.isGenerating) openSpoilerModal('add');
    });
  }

  // Topbar Overflow +N button & dropdown toggle
  if (dom.btnOverflowChip && dom.shieldOverflowDropdown) {
    dom.btnOverflowChip.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.shieldOverflowDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#shield-overflow-wrapper')) {
        dom.shieldOverflowDropdown.classList.add('hidden');
      }
    });
  }

  // Spoiler Shield modal controls
  dom.btnCloseSpoilerModal.addEventListener('click', closeSpoilerModal);

  // Modal: Big "+ Add another show" button
  if (dom.btnOpenAddShow) {
    dom.btnOpenAddShow.addEventListener('click', () => {
      if (dom.shieldSearchSection) {
        dom.shieldSearchSection.classList.toggle('hidden');
        if (!dom.shieldSearchSection.classList.contains('hidden')) {
          dom.shieldSearchInput.value = '';
          dom.shieldSearchInput.focus();
        }
      }
    });
  }

  // Modal: Cancel / Close search button
  if (dom.btnCancelSearch) {
    dom.btnCancelSearch.addEventListener('click', () => {
      if (dom.shieldSearchSection) dom.shieldSearchSection.classList.add('hidden');
    });
  }

  // Modal: Back to list button inside editor
  if (dom.btnBackToList) {
    dom.btnBackToList.addEventListener('click', () => {
      openSpoilerModal('list');
    });
  }

  if (dom.shieldSearchInput) {
    dom.shieldSearchInput.addEventListener('input', (e) => {
      clearTimeout(shieldSearchDebounceTimer);
      const val = e.target.value;
      shieldSearchDebounceTimer = setTimeout(() => searchMediaTitles(val), 250);
    });
  }

  if (dom.btnChangeTitle) {
    dom.btnChangeTitle.addEventListener('click', showShieldSearchSection);
  }

  if (dom.shieldSeasonSelect) {
    dom.shieldSeasonSelect.addEventListener('change', (e) => {
      updateEpisodeDropdownForSeason(e.target.value, false);
    });
  }

  if (dom.shieldEpOnlyToggle) {
    dom.shieldEpOnlyToggle.addEventListener('change', (e) => {
      const isEpOnly = e.target.checked;
      if (dom.shieldSeasonEpRow) dom.shieldSeasonEpRow.classList.toggle('hidden', isEpOnly);
      if (dom.shieldAbsEpRow) dom.shieldAbsEpRow.classList.toggle('hidden', !isEpOnly);
      if (isEpOnly && dom.shieldNotStartedToggle) dom.shieldNotStartedToggle.checked = false;
    });
  }

  if (dom.shieldNotStartedToggle) {
    dom.shieldNotStartedToggle.addEventListener('change', (e) => {
      const isNotStarted = e.target.checked;
      if (dom.shieldSeasonEpRow) dom.shieldSeasonEpRow.classList.toggle('hidden', isNotStarted);
      if (dom.shieldAbsEpRow) dom.shieldAbsEpRow.classList.add('hidden');
      if (isNotStarted && dom.shieldEpOnlyToggle) dom.shieldEpOnlyToggle.checked = false;
    });
  }

  if (dom.btnSaveShield) {
    dom.btnSaveShield.addEventListener('click', saveSpoilerShield);
  }

  if (dom.btnUnlockShield) {
    dom.btnUnlockShield.addEventListener('click', unlockSpoilerShield);
  }

  // Voice Input
  setupVoiceInput();

  // Phase 4: Mood Picks event bindings
  setupMoodPicksEvents();
}

// ========================================================
// 17. PHASE 4: MOOD PICKS APPLICATION LOGIC
// ========================================================
const moodState = {
  selectedMood: 'Cozy',
  mediaType: 'any',
  timeLimit: 'any',
  language: 'Any',
  platforms: [],
  rankingStyle: 'popular', // 'popular' | 'mix' | 'hidden-gems'
  cachedPool: [],
  displayedPicks: [],
  displayedCount: 0,
  dismissedIds: [],
  prefetching: false,
  nextPageOffset: 2,
};

function initMoodPicksState() {
  try {
    const saved = localStorage.getItem('kinora_platforms');
    if (saved) {
      moodState.platforms = JSON.parse(saved);
      if (!Array.isArray(moodState.platforms)) moodState.platforms = [];
    } else {
      moodState.platforms = [];
    }
  } catch {
    moodState.platforms = [];
  }
  syncPlatformChipsUI();
  syncPlatformBanner();
  syncRankingStyleUI();
}

function syncPlatformChipsUI() {
  const chips = document.querySelectorAll('.platform-chip');
  chips.forEach((c) => {
    const p = c.dataset.platform;
    c.classList.toggle('selected', moodState.platforms.includes(p));
  });
}

function syncPlatformBanner() {
  if (!dom.platformFilterBanner) return;
  if (moodState.platforms.length > 0) {
    dom.platformFilterBanner.classList.remove('hidden');
    if (dom.platformBannerText) {
      dom.platformBannerText.textContent = `Filtered to: ${moodState.platforms.join(', ')}`;
    }
  } else {
    dom.platformFilterBanner.classList.add('hidden');
  }
}

function syncRankingStyleUI() {
  if (!dom.filterRankingChips) return;
  dom.filterRankingChips.querySelectorAll('.chip-filter').forEach((c) => {
    c.classList.toggle('active', c.dataset.ranking === moodState.rankingStyle);
  });
}

function getOrderedPoolForStyle(pool, style) {
  if (!Array.isArray(pool)) return [];

  // Filter out dismissed titles or already saved
  const dismissedSet = new Set(moodState.dismissedIds.map(String));
  const available = pool.filter((p) => p && p.id && !dismissedSet.has(String(p.id)));

  if (style === 'hidden-gems') {
    // Hidden gems: prefers vote_count 300-2500 with rating >= 7.5
    const gems = available.filter(
      (p) =>
        p.is_hidden_gem ||
        (p.vote_count >= 300 && p.vote_count <= 2500 && (p.tmdb_rating >= 7.5 || p.vote_average >= 7.5))
    );
    const others = available.filter((p) => !gems.includes(p));

    gems.sort((a, b) => (b.tmdb_rating || b.vote_average || 0) - (a.tmdb_rating || a.vote_average || 0));
    others.sort((a, b) => (b.score || 0) - (a.score || 0));
    return [...gems, ...others];
  }

  if (style === 'mix') {
    // Mix puts 2 hidden gems among every 6 picks (slots 3 and 6)
    const gems = available.filter(
      (p) =>
        p.is_hidden_gem ||
        (p.vote_count >= 300 && p.vote_count <= 2500 && (p.tmdb_rating >= 7.5 || p.vote_average >= 7.5))
    );
    const popular = available.filter((p) => !gems.includes(p));

    gems.sort((a, b) => (b.tmdb_rating || b.vote_average || 0) - (a.tmdb_rating || a.vote_average || 0));
    popular.sort((a, b) => (b.score || 0) - (a.score || 0));

    const mixed = [];
    let pIdx = 0;
    let gIdx = 0;

    while (pIdx < popular.length || gIdx < gems.length) {
      if (pIdx < popular.length) mixed.push(popular[pIdx++]);
      if (pIdx < popular.length) mixed.push(popular[pIdx++]);
      if (gIdx < gems.length) mixed.push(gems[gIdx++]);
      else if (pIdx < popular.length) mixed.push(popular[pIdx++]);

      if (pIdx < popular.length) mixed.push(popular[pIdx++]);
      if (pIdx < popular.length) mixed.push(popular[pIdx++]);
      if (gIdx < gems.length) mixed.push(gems[gIdx++]);
      else if (pIdx < popular.length) mixed.push(popular[pIdx++]);
    }
    return mixed;
  }

  // Default: Popular (weighted score descending)
  return [...available].sort((a, b) => (b.score || 0) - (a.score || 0));
}

function getLabelClass(label) {
  const clean = String(label || '').toLowerCase();
  if (clean.includes('critically')) return 'critically-acclaimed';
  if (clean.includes('gem')) return 'hidden-gem';
  return 'fan-favourite';
}

function setupMoodPicksEvents() {
  // Mood cards grid
  if (dom.moodCardsGrid) {
    dom.moodCardsGrid.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const card = e.target.closest('.mood-card');
      if (!card) return;
      dom.moodCardsGrid.querySelectorAll('.mood-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      moodState.selectedMood = card.dataset.mood || 'Cozy';
      fetchMoodPicks(false);
    });
  }

  // Filter chips: Media
  if (dom.filterMediaChips) {
    dom.filterMediaChips.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const chip = e.target.closest('.chip-filter');
      if (!chip) return;
      dom.filterMediaChips.querySelectorAll('.chip-filter').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      moodState.mediaType = chip.dataset.val || 'any';
      fetchMoodPicks(false);
    });
  }

  // Filter chips: Time
  if (dom.filterTimeChips) {
    dom.filterTimeChips.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const chip = e.target.closest('.chip-filter');
      if (!chip) return;
      dom.filterTimeChips.querySelectorAll('.chip-filter').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      moodState.timeLimit = chip.dataset.val || 'any';
      fetchMoodPicks(false);
    });
  }

  // Filter chips: Language
  if (dom.filterLangChips) {
    dom.filterLangChips.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const chip = e.target.closest('.chip-filter');
      if (!chip) return;
      dom.filterLangChips.querySelectorAll('.chip-filter').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      moodState.language = chip.dataset.val || 'Any';
      fetchMoodPicks(false);
    });
  }

  // Ranking Style Toggle: Popular / Mix / Hidden gems
  if (dom.filterRankingChips) {
    dom.filterRankingChips.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const chip = e.target.closest('.chip-filter');
      if (!chip) return;
      dom.filterRankingChips.querySelectorAll('.chip-filter').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      moodState.rankingStyle = chip.dataset.ranking || 'popular';

      // If pool is already in memory, re-order and re-render instantly!
      if (moodState.cachedPool.length > 0) {
        const ordered = getOrderedPoolForStyle(moodState.cachedPool, moodState.rankingStyle);
        const count = Math.max(6, moodState.displayedCount);
        moodState.displayedPicks = ordered.slice(0, count);
        moodState.displayedCount = moodState.displayedPicks.length;
        renderMoodPicksCards(moodState.displayedPicks, false);
        fetchBlurbsForVisibleCards(moodState.displayedPicks);
      } else {
        fetchMoodPicks(false);
      }
    });
  }

  // Filter chips: Platforms multi-select
  if (dom.filterPlatformChips) {
    dom.filterPlatformChips.addEventListener('click', (e) => {
      if (state.isGenerating) return;
      const chip = e.target.closest('.platform-chip');
      if (!chip) return;
      const platformName = chip.dataset.platform;
      const idx = moodState.platforms.indexOf(platformName);
      if (idx >= 0) {
        moodState.platforms.splice(idx, 1);
        chip.classList.remove('selected');
      } else {
        moodState.platforms.push(platformName);
        chip.classList.add('selected');
      }
      localStorage.setItem('kinora_platforms', JSON.stringify(moodState.platforms));
      syncPlatformBanner();
      fetchMoodPicks(false);
    });
  }

  // Clear platforms button
  if (dom.btnClearPlatforms) {
    dom.btnClearPlatforms.addEventListener('click', (e) => {
      e.stopPropagation();
      moodState.platforms = [];
      localStorage.removeItem('kinora_platforms');
      syncPlatformChipsUI();
      syncPlatformBanner();
      fetchMoodPicks(false);
    });
  }

  // Natural language custom mood input
  if (dom.btnFindMoodPicks) {
    dom.btnFindMoodPicks.addEventListener('click', () => {
      if (!state.isGenerating) fetchMoodPicks(false);
    });
  }
  if (dom.moodCustomInput) {
    dom.moodCustomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!state.isGenerating) fetchMoodPicks(false);
      }
    });
  }

  // Change / Edit filters button
  if (dom.btnChangeMoodFilters) {
    dom.btnChangeMoodFilters.addEventListener('click', () => {
      if (dom.moodEntrySection) {
        dom.moodEntrySection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Loosen filters button
  if (dom.btnLoosenFilters) {
    dom.btnLoosenFilters.addEventListener('click', () => {
      moodState.language = 'Any';
      moodState.timeLimit = 'any';
      if (dom.filterLangChips) {
        dom.filterLangChips.querySelectorAll('.chip-filter').forEach((c) => {
          c.classList.toggle('active', c.dataset.val === 'Any');
        });
      }
      if (dom.filterTimeChips) {
        dom.filterTimeChips.querySelectorAll('.chip-filter').forEach((c) => {
          c.classList.toggle('active', c.dataset.val === 'any');
        });
      }
      fetchMoodPicks(false);
    });
  }

  // "Show 6 more" button (instant from cached pool)
  if (dom.btnMoodMore) {
    dom.btnMoodMore.addEventListener('click', () => {
      showMoreMoodPicks();
    });
  }
}

async function fetchMoodPicks(isMore = false) {
  if (state.isGenerating) return;

  const resultsSec = dom.moodResultsSection;
  const loadingSec = dom.moodCardsLoading;
  const cardsList = dom.moodCardsList;
  const fallbackBox = dom.moodFallbackBox;
  const introEl = dom.moodBotIntro;
  const platformNoteEl = dom.moodPlatformNote;
  const customMood = dom.moodCustomInput ? dom.moodCustomInput.value.trim() : '';

  if (!isMore) {
    moodState.dismissedIds = [];
    moodState.cachedPool = [];
    moodState.displayedPicks = [];
    moodState.displayedCount = 0;
    moodState.nextPageOffset = 2;
    if (cardsList) cardsList.innerHTML = '';
  }

  if (resultsSec) resultsSec.classList.remove('hidden');
  if (fallbackBox) fallbackBox.classList.add('hidden');
  if (platformNoteEl) platformNoteEl.classList.add('hidden');
  if (loadingSec) loadingSec.classList.remove('hidden');

  setControlsLocked(true);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/mood-picks/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood: moodState.selectedMood,
        mediaType: moodState.mediaType,
        timeLimit: moodState.timeLimit,
        language: moodState.language,
        platforms: moodState.platforms,
        customMood,
        excludeIds: moodState.dismissedIds,
        savedIds: state.watchlist.map((w) => w.id).filter(Boolean),
        pageOffset: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (loadingSec) loadingSec.classList.add('hidden');

    if (data.fallbackMessage && (!data.pool || data.pool.length === 0)) {
      if (fallbackBox) {
        fallbackBox.classList.remove('hidden');
        if (dom.moodFallbackMsg) dom.moodFallbackMsg.textContent = data.fallbackMessage;
      }
      return;
    }

    if (introEl && data.intro) {
      introEl.textContent = data.intro;
    }

    // Platform auto-expansion note
    if (platformNoteEl) {
      if (data.platformNote) {
        platformNoteEl.textContent = data.platformNote;
        platformNoteEl.classList.remove('hidden');
      } else {
        platformNoteEl.classList.add('hidden');
      }
    }

    const pool = Array.isArray(data.pool) ? data.pool : [];
    moodState.cachedPool = pool;

    // Apply ranking style ordering
    const ordered = getOrderedPoolForStyle(pool, moodState.rankingStyle);

    // Initial 6 picks rendered immediately
    const firstSix = ordered.slice(0, 6);
    moodState.displayedPicks = firstSix;
    moodState.displayedCount = firstSix.length;

    renderMoodPicksCards(firstSix, false);

    if (resultsSec) {
      resultsSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Background Gemini blurbs fetch for visible cards (never blocks initial render!)
    fetchBlurbsForVisibleCards(firstSix);
  } catch (err) {
    if (loadingSec) loadingSec.classList.add('hidden');
    console.error('Mood picks error:', err);
    if (fallbackBox) {
      fallbackBox.classList.remove('hidden');
      if (dom.moodFallbackMsg) {
        dom.moodFallbackMsg.textContent = 'Kinora had trouble fetching picks. Please check your connection and try again.';
      }
    }
  } finally {
    setControlsLocked(false);
  }
}

function showMoreMoodPicks() {
  if (moodState.cachedPool.length === 0) return;

  const ordered = getOrderedPoolForStyle(moodState.cachedPool, moodState.rankingStyle);
  const nextBatch = ordered.slice(moodState.displayedCount, moodState.displayedCount + 6);

  if (nextBatch.length === 0) {
    if (dom.btnMoodMore) {
      dom.btnMoodMore.textContent = 'No more titles found for this vibe';
      setTimeout(() => {
        if (dom.btnMoodMore) dom.btnMoodMore.textContent = 'Show 6 more';
      }, 3000);
    }
    return;
  }

  // Append next 6 instantly without any loading delay!
  moodState.displayedPicks.push(...nextBatch);
  moodState.displayedCount = moodState.displayedPicks.length;

  renderMoodPicksCards(nextBatch, true);

  // Background Gemini blurbs for the newly appended 6 cards
  fetchBlurbsForVisibleCards(nextBatch);

  // Quietly prefetch more items when remaining unshown titles in pool run low (< 8)
  const remainingInPool = ordered.length - moodState.displayedCount;
  if (remainingInPool < 8 && !moodState.prefetching) {
    prefetchMorePool();
  }
}

async function prefetchMorePool() {
  if (moodState.prefetching) return;
  moodState.prefetching = true;
  try {
    const customMood = dom.moodCustomInput ? dom.moodCustomInput.value.trim() : '';
    const res = await fetch('/api/mood-picks/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood: moodState.selectedMood,
        mediaType: moodState.mediaType,
        timeLimit: moodState.timeLimit,
        language: moodState.language,
        platforms: moodState.platforms,
        customMood,
        excludeIds: [
          ...moodState.dismissedIds,
          ...moodState.cachedPool.map((p) => p.id),
        ],
        savedIds: state.watchlist.map((w) => w.id).filter(Boolean),
        pageOffset: moodState.nextPageOffset++,
      }),
    });
    const data = await res.json();
    if (data && Array.isArray(data.pool) && data.pool.length > 0) {
      const existingIds = new Set(moodState.cachedPool.map((p) => p.id));
      const freshItems = data.pool.filter((p) => !existingIds.has(p.id));
      moodState.cachedPool.push(...freshItems);
    }
  } catch (err) {
    console.warn('Quiet prefetch error:', err.message);
  } finally {
    moodState.prefetching = false;
  }
}

async function fetchBlurbsForVisibleCards(picks) {
  if (!Array.isArray(picks) || picks.length === 0) return;
  try {
    const customMood = dom.moodCustomInput ? dom.moodCustomInput.value.trim() : '';
    const res = await fetch('/api/mood-picks/blurbs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titles: picks.map((p) => ({
          id: p.id,
          title: p.title,
          year: p.year,
          type: p.media_type || p.type,
          tagline: p.tagline || '',
          overview: p.overview || '',
        })),
        mood: moodState.selectedMood,
        customMood,
        shields: ShieldsStore.getAll(),
      }),
    });

    const data = await res.json();
    if (data && Array.isArray(data.blurbs)) {
      data.blurbs.forEach((b) => {
        if (!b || !b.id || !b.why) return;
        const targetPick = moodState.displayedPicks.find((p) => p.id === b.id);
        if (targetPick) {
          targetPick.why_fits = b.why;
        }

        const blurbEl = document.querySelector(`.pick-blurb[data-pick-id="${b.id}"]`);
        if (blurbEl) {
          blurbEl.style.opacity = '0.35';
          setTimeout(() => {
            blurbEl.textContent = b.why;
            blurbEl.style.opacity = '1';
          }, 140);
        }
      });

      if (data.intro && dom.moodBotIntro) {
        dom.moodBotIntro.textContent = data.intro;
      }
    }
  } catch (err) {
    console.warn('Background blurbs fetch error:', err.message);
  }
}

function createMoodCardHtml(p, idx) {
  const inWl = isItemInWatchlist(p);
  const inProviders = p.watch_providers_in?.flatrate_details || [];
  const providerTags =
    inProviders.length > 0
      ? inProviders
          .slice(0, 3)
          .map(
            (pr) => `
          <span class="provider-tag">
            ${pr.logo ? `<img class="provider-logo-img" src="${escapeHtml(pr.logo)}" alt="" />` : ''}
            ${escapeHtml(pr.name)}
          </span>
        `
          )
          .join('')
      : `<span style="font-size:11px;color:var(--text-muted)">Streaming info in Details</span>`;

  const labelClass = getLabelClass(p.card_label);
  const blurbText = p.why_fits || p.initial_blurb || `${p.title} (${p.year})`;

  return `
    <div class="mood-pick-card" id="mood-card-${p.id}" data-pick-id="${p.id}">
      <div class="pick-poster-wrap">
        ${p.poster_url ? `<img class="pick-poster" src="${escapeHtml(p.poster_url)}" alt="${escapeHtml(p.title)}" loading="lazy" />` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">${renderIcon('film')}</div>`}
      </div>
      <div class="pick-details">
        <div>
          <div class="pick-title-row">
            <span class="pick-title">${escapeHtml(p.title)}</span>
            <span class="pick-year">(${escapeHtml(p.year || '')})</span>
            <span class="card-badge-label ${labelClass}">${escapeHtml(p.card_label || 'Fan favourite')}</span>
          </div>
          <div class="pick-meta-row" style="margin-top:4px;">
            ${p.imdb_rating ? `<span class="badge-rating imdb"><span class="star-icon-wrap">${renderIcon('star')}</span> IMDb ${escapeHtml(String(p.imdb_rating))}</span>` : ''}
            ${p.tmdb_rating ? `<span class="badge-rating tmdb"><span class="film-icon-wrap">${renderIcon('film')}</span> TMDB ${escapeHtml(String(p.tmdb_rating))}</span>` : ''}
            ${p.duration ? `<span class="badge-rating duration"><span class="clock-icon-wrap">${renderIcon('clock')}</span> ${escapeHtml(p.duration)}</span>` : ''}
          </div>
          <div class="pick-blurb" data-pick-id="${p.id}">${escapeHtml(blurbText)}</div>
          <div class="pick-providers-row">
            <span>Where to watch in India:</span>
            <div class="provider-logos-list">${providerTags}</div>
          </div>
        </div>
        <div class="pick-actions-row">
          <button type="button" class="btn-pick-action btn-add-wl ${inWl ? 'saved' : ''}" data-pick-id="${p.id}">
            ${inWl ? `${renderIcon('check')} Saved` : `${renderIcon('plus')} Add to Watchlist`}
          </button>
          <button type="button" class="btn-pick-action btn-pick-details" data-pick-id="${p.id}">
            Details
          </button>
          <button type="button" class="btn-pick-action btn-not-for-me" data-pick-id="${p.id}">
            Not for me
          </button>
        </div>
      </div>
    </div>
  `;
}

function bindMoodCardEvents(cardEl, pick) {
  if (!cardEl || !pick) return;

  const btnWl = cardEl.querySelector('.btn-add-wl');
  if (btnWl) {
    btnWl.addEventListener('click', () => {
      const isSaved = toggleWatchlist(pick);
      btnWl.classList.toggle('saved', isSaved);
      btnWl.innerHTML = isSaved ? `${renderIcon('check')} Saved` : `${renderIcon('plus')} Add to Watchlist`;
    });
  }

  const btnDetails = cardEl.querySelector('.btn-pick-details');
  if (btnDetails) {
    btnDetails.addEventListener('click', () => {
      openTitleInspector(pick);
    });
  }

  const btnNot = cardEl.querySelector('.btn-not-for-me');
  if (btnNot) {
    btnNot.addEventListener('click', () => {
      handleNotForMe(pick.id, cardEl);
    });
  }
}

function renderMoodPicksCards(picks, append = false) {
  const cardsList = dom.moodCardsList;
  if (!cardsList) return;

  if (!append) {
    cardsList.innerHTML = picks.map((p, idx) => createMoodCardHtml(p, idx)).join('');
    picks.forEach((p) => {
      const cardEl = document.getElementById(`mood-card-${p.id}`);
      bindMoodCardEvents(cardEl, p);
    });
  } else {
    // Append cards below existing ones without removing anything
    picks.forEach((p, idx) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = createMoodCardHtml(p, idx);
      const cardEl = tempDiv.firstElementChild;
      cardsList.appendChild(cardEl);
      bindMoodCardEvents(cardEl, p);
    });
  }
}

function updateMoodCardWatchlistButtons() {
  const cardsList = dom.moodCardsList;
  if (!cardsList) return;
  cardsList.querySelectorAll('.btn-add-wl').forEach((btn) => {
    const pickId = parseInt(btn.dataset.pickId, 10);
    const pick = moodState.displayedPicks.find((p) => p.id === pickId);
    if (pick) {
      const inWl = isItemInWatchlist(pick);
      btn.classList.toggle('saved', inWl);
      btn.innerHTML = inWl ? `${renderIcon('check')} Saved` : `${renderIcon('plus')} Add to Watchlist`;
    }
  });
}

function handleNotForMe(pickId, cardElement) {
  if (!pickId) return;
  moodState.dismissedIds.push(pickId);

  // Quick exit animation
  if (cardElement) {
    cardElement.classList.add('card-dismiss-anim');
  }

  setTimeout(() => {
    // Fill gap instantly from next unshown candidate in pool
    const ordered = getOrderedPoolForStyle(moodState.cachedPool, moodState.rankingStyle);
    const displayedIds = new Set(moodState.displayedPicks.map((p) => p.id));
    const nextPick = ordered.find(
      (p) => !displayedIds.has(p.id) && !moodState.dismissedIds.includes(p.id)
    );

    if (nextPick && cardElement && cardElement.parentNode) {
      const curIdx = moodState.displayedPicks.findIndex((p) => p.id === pickId);
      if (curIdx >= 0) moodState.displayedPicks[curIdx] = nextPick;

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = createMoodCardHtml(nextPick, curIdx);
      const newCard = tempDiv.firstElementChild;
      cardElement.replaceWith(newCard);
      bindMoodCardEvents(newCard, nextPick);

      // Fetch Gemini blurb for replacement card
      fetchBlurbsForVisibleCards([nextPick]);
    } else if (cardElement && cardElement.parentNode) {
      cardElement.remove();
      moodState.displayedPicks = moodState.displayedPicks.filter((p) => p.id !== pickId);
    }
  }, 180);
}

// ========================================================
// 18. PHASE 4: COMPARE & DEBATE APPLICATION LOGIC
// ========================================================
const compareState = {
  selectedA: null,
  selectedB: null,
  currentComparison: null,
  isLoading: false,
  debate: {
    active: false,
    userChoice: null,
    history: [],
  },
};

let compareSearchTimerA = null;
let compareSearchTimerB = null;

function setupComparePickers() {
  const inputA = document.getElementById('compare-search-a');
  const inputB = document.getElementById('compare-search-b');

  if (inputA) {
    inputA.addEventListener('input', (e) => {
      clearTimeout(compareSearchTimerA);
      const val = e.target.value.trim();
      compareSearchTimerA = setTimeout(() => searchCompareTitles(val, 'a'), 250);
    });
  }

  if (inputB) {
    inputB.addEventListener('input', (e) => {
      clearTimeout(compareSearchTimerB);
      const val = e.target.value.trim();
      compareSearchTimerB = setTimeout(() => searchCompareTitles(val, 'b'), 250);
    });
  }

  const btnClearA = document.getElementById('btn-clear-title-a');
  const btnClearB = document.getElementById('btn-clear-title-b');
  if (btnClearA) {
    btnClearA.addEventListener('click', () => resetCompareSide('a'));
  }
  if (btnClearB) {
    btnClearB.addEventListener('click', () => resetCompareSide('b'));
  }

  if (dom.btnLaunchCompare) {
    dom.btnLaunchCompare.addEventListener('click', () => {
      if (compareState.selectedA && compareState.selectedB && !compareState.isLoading) {
        launchComparison();
      }
    });
  }

  if (dom.btnCompareReset) {
    dom.btnCompareReset.addEventListener('click', resetCompareView);
  }

  if (dom.btnCompareSwap) {
    dom.btnCompareSwap.addEventListener('click', swapCompareSides);
  }

  if (dom.btnCompareDebateToggle) {
    dom.btnCompareDebateToggle.addEventListener('click', toggleDebateSection);
  }

  if (dom.btnEndDebate) {
    dom.btnEndDebate.addEventListener('click', endDebateSession);
  }

  const btnChooseA = document.getElementById('btn-choose-a');
  const btnChooseB = document.getElementById('btn-choose-b');
  if (btnChooseA) {
    btnChooseA.addEventListener('click', () => startDebateWithChoice('A'));
  }
  if (btnChooseB) {
    btnChooseB.addEventListener('click', () => startDebateWithChoice('B'));
  }

  if (dom.debateReplyForm) {
    dom.debateReplyForm.addEventListener('submit', handleDebateReply);
  }

  const btnRetryData = document.getElementById('btn-compare-data-retry');
  if (btnRetryData) {
    btnRetryData.addEventListener('click', () => {
      if (!compareState.isLoading) {
        launchComparison(compareState.selectedA, compareState.selectedB);
      }
    });
  }

  const btnRetryVerdict = document.getElementById('btn-verdict-retry');
  if (btnRetryVerdict) {
    btnRetryVerdict.addEventListener('click', () => {
      if (!compareState.isLoading && compareState.currentComparison?.itemA && compareState.currentComparison?.itemB) {
        fetchAndRenderVerdict(compareState.currentComparison.itemA, compareState.currentComparison.itemB);
      }
    });
  }
}

async function searchCompareTitles(query, side) {
  const dropdown = document.getElementById(`compare-results-${side}`);
  if (!dropdown) return;

  if (!query || query.length < 2) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/media/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    const results = (data && Array.isArray(data.results)) ? data.results.slice(0, 5) : [];

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted)">No titles found</div>';
      dropdown.classList.remove('hidden');
      return;
    }

    dropdown.innerHTML = results
      .map(
        (r, i) => `
        <div class="compare-result-item" data-index="${i}">
          ${r.poster_path ? `<img class="compare-result-poster" src="${escapeHtml(r.poster_path)}" alt="" />` : `<div class="compare-result-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
          <div>
            <div class="compare-result-title">${escapeHtml(r.title)}</div>
            <div class="compare-result-year">${escapeHtml(r.year || '')} • ${escapeHtml(r.media_type || 'movie')}</div>
          </div>
        </div>
      `
      )
      .join('');

    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.compare-result-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        selectCompareTitle(results[idx], side);
      });
    });
  } catch (err) {
    console.warn('Search compare error:', err);
  }
}

function selectCompareTitle(mediaItem, side) {
  const dropdown = document.getElementById(`compare-results-${side}`);
  if (dropdown) dropdown.classList.add('hidden');

  const searchBox = document.getElementById(`picker-search-box-${side}`);
  const preview = document.getElementById(`picker-preview-${side}`);
  const poster = document.getElementById(`preview-poster-${side}`);
  const titleEl = document.getElementById(`preview-title-${side}`);
  const yearEl = document.getElementById(`preview-year-${side}`);
  const btnClear = document.getElementById(`btn-clear-title-${side}`);

  if (side === 'a') compareState.selectedA = mediaItem;
  else compareState.selectedB = mediaItem;

  if (searchBox) searchBox.classList.add('hidden');
  if (preview) preview.classList.remove('hidden');
  if (btnClear) btnClear.classList.remove('hidden');

  if (poster) poster.src = mediaItem.poster_path || '';
  if (titleEl) titleEl.textContent = mediaItem.title;
  if (yearEl) yearEl.textContent = `${mediaItem.year || ''} • ${(mediaItem.media_type || 'movie').toUpperCase()}`;

  checkLaunchButtonState();
}

function resetCompareSide(side) {
  if (side === 'a') compareState.selectedA = null;
  else compareState.selectedB = null;

  const searchBox = document.getElementById(`picker-search-box-${side}`);
  const preview = document.getElementById(`picker-preview-${side}`);
  const btnClear = document.getElementById(`btn-clear-title-${side}`);
  const input = document.getElementById(`compare-search-${side}`);

  if (searchBox) searchBox.classList.remove('hidden');
  if (preview) preview.classList.add('hidden');
  if (btnClear) btnClear.classList.add('hidden');
  if (input) {
    input.value = '';
    input.focus();
  }

  checkLaunchButtonState();
}

function checkLaunchButtonState() {
  if (dom.btnLaunchCompare) {
    dom.btnLaunchCompare.disabled = !(compareState.selectedA && compareState.selectedB) || compareState.isLoading;
  }
}

function setCompareInputsDisabled(disabled) {
  const inputA = document.getElementById('compare-search-a');
  const inputB = document.getElementById('compare-search-b');
  const btnClearA = document.getElementById('btn-clear-title-a');
  const btnClearB = document.getElementById('btn-clear-title-b');
  if (inputA) inputA.disabled = disabled;
  if (inputB) inputB.disabled = disabled;
  if (btnClearA) btnClearA.disabled = disabled;
  if (btnClearB) btnClearB.disabled = disabled;
}

let verdictStatusInterval = null;

function startRotatingVerdictStatus() {
  const statusEl = document.getElementById('verdict-status-text');
  if (!statusEl) return;
  const phrases = [
    'Reading the reviews...',
    'Weighing story and acting...',
    'Settling the score...',
  ];
  let idx = 0;
  statusEl.textContent = phrases[0];
  if (verdictStatusInterval) clearInterval(verdictStatusInterval);
  verdictStatusInterval = setInterval(() => {
    idx = (idx + 1) % phrases.length;
    statusEl.textContent = phrases[idx];
  }, 1500);
}

function stopRotatingVerdictStatus() {
  if (verdictStatusInterval) {
    clearInterval(verdictStatusInterval);
    verdictStatusInterval = null;
  }
}

function resetCompareView() {
  stopRotatingVerdictStatus();
  const entrySec = dom.compareEntrySection;
  const resultsSec = dom.compareResultsSection;
  const debateSec = dom.debateContainer;

  if (entrySec) entrySec.classList.remove('hidden');
  if (resultsSec) resultsSec.classList.add('hidden');
  if (debateSec) debateSec.classList.add('hidden');

  compareState.currentComparison = null;
  compareState.isLoading = false;
  compareState.debate = { active: false, userChoice: null, history: [] };

  if (dom.btnLaunchCompare) {
    dom.btnLaunchCompare.innerHTML = 'Compare';
    checkLaunchButtonState();
  }
  setCompareInputsDisabled(false);
}

function renderInitialComparisonSkeleton(itemA, itemB) {
  // 1. Instant Heroes Header with both posters, titles, years & VS badge
  const heroesContainer = document.getElementById('compare-heroes-container');
  if (heroesContainer) {
    const posterA = itemA.poster_url || (itemA.poster_path ? (itemA.poster_path.startsWith('http') ? itemA.poster_path : `https://image.tmdb.org/t/p/w500${itemA.poster_path}`) : '');
    const posterB = itemB.poster_url || (itemB.poster_path ? (itemB.poster_path.startsWith('http') ? itemB.poster_path : `https://image.tmdb.org/t/p/w500${itemB.poster_path}`) : '');
    const yearA = itemA.year || (itemA.release_date || itemA.first_air_date ? String(itemA.release_date || itemA.first_air_date).slice(0, 4) : '');
    const yearB = itemB.year || (itemB.release_date || itemB.first_air_date ? String(itemB.release_date || itemB.first_air_date).slice(0, 4) : '');
    const typeA = (itemA.type || itemA.media_type || 'movie').toUpperCase();
    const typeB = (itemB.type || itemB.media_type || 'movie').toUpperCase();

    heroesContainer.innerHTML = `
      <div class="compare-hero-card">
        ${posterA ? `<img class="hero-poster" src="${escapeHtml(posterA)}" alt="${escapeHtml(itemA.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
        <div class="hero-info">
          <span class="picker-badge">A</span>
          <h3 class="hero-title">${escapeHtml(itemA.title)}</h3>
          <span class="hero-year-badge">${escapeHtml(yearA)} • ${typeA}</span>
        </div>
      </div>
      <div class="compare-hero-vs-badge">
        <span class="vs-circle-sm">VS</span>
      </div>
      <div class="compare-hero-card">
        ${posterB ? `<img class="hero-poster" src="${escapeHtml(posterB)}" alt="${escapeHtml(itemB.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
        <div class="hero-info">
          <span class="picker-badge" style="color:#EC4899;background:rgba(236,72,153,0.1)">B</span>
          <h3 class="hero-title">${escapeHtml(itemB.title)}</h3>
          <span class="hero-year-badge">${escapeHtml(yearB)} • ${typeB}</span>
        </div>
      </div>
    `;
  }

  // 2. Table Column Titles
  const thA = document.getElementById('th-title-a');
  const thB = document.getElementById('th-title-b');
  if (thA) thA.textContent = itemA.title;
  if (thB) thB.textContent = itemB.title;

  // 3. Stage 1 Skeleton Rows for Table
  const tbody = document.getElementById('compare-table-body');
  const dataError = document.getElementById('compare-data-error');
  const dataTable = document.getElementById('compare-data-table');
  if (dataError) dataError.classList.add('hidden');
  if (dataTable) dataTable.classList.remove('hidden');

  if (tbody) {
    const metrics = ['IMDb', 'Votes', 'TMDB', 'Runtime', 'Genres', 'Status', 'Where to watch'];
    tbody.innerHTML = metrics
      .map(
        () => `
        <tr class="table-skeleton-row">
          <td class="col-metric"><div class="sk-table-line metric"></div></td>
          <td><div class="sk-table-line val"></div></td>
          <td><div class="sk-table-line val"></div></td>
        </tr>
      `
      )
      .join('');
  }

  // 4. Stage 2 Skeleton for Verdict Block
  const verdictLoading = document.getElementById('verdict-loading-state');
  const verdictContent = document.getElementById('verdict-content');
  const verdictError = document.getElementById('verdict-error-state');
  if (verdictError) verdictError.classList.add('hidden');
  if (verdictContent) verdictContent.classList.add('hidden');
  if (verdictLoading) verdictLoading.classList.remove('hidden');

  startRotatingVerdictStatus();

  // 5. Update Debate side names
  const btnNameA = document.getElementById('btn-name-a');
  const btnNameB = document.getElementById('btn-name-b');
  if (btnNameA) btnNameA.textContent = itemA.title;
  if (btnNameB) btnNameB.textContent = itemB.title;
}

function renderComparisonTable(itemA, itemB) {
  const thA = document.getElementById('th-title-a');
  const thB = document.getElementById('th-title-b');
  if (thA) thA.textContent = itemA.title;
  if (thB) thB.textContent = itemB.title;

  const tbody = document.getElementById('compare-table-body');
  const dataTable = document.getElementById('compare-data-table');
  const dataError = document.getElementById('compare-data-error');
  if (dataError) dataError.classList.add('hidden');
  if (dataTable) dataTable.classList.remove('hidden');

  if (tbody) {
    const imdbA = parseFloat(itemA.imdb_rating) || 0;
    const imdbB = parseFloat(itemB.imdb_rating) || 0;
    const votesA = parseInt(String(itemA.imdb_votes || '0').replace(/,/g, ''), 10) || 0;
    const votesB = parseInt(String(itemB.imdb_votes || '0').replace(/,/g, ''), 10) || 0;
    const tmdbA = parseFloat(itemA.tmdb_rating) || 0;
    const tmdbB = parseFloat(itemB.tmdb_rating) || 0;

    const streamA = itemA.watch_providers_in?.flatrate?.join(', ') || 'Rent/Buy or unlisted';
    const streamB = itemB.watch_providers_in?.flatrate?.join(', ') || 'Rent/Buy or unlisted';
    const genresA = (itemA.genres || []).join(', ');
    const genresB = (itemB.genres || []).join(', ');

    tbody.innerHTML = `
      <tr>
        <td class="col-metric">IMDb</td>
        <td><span class="${imdbA > imdbB ? 'better-val' : ''}"><span class="star-icon-wrap">${renderIcon('star', 14)}</span> ${itemA.imdb_rating || 'N/A'}</span></td>
        <td><span class="${imdbB > imdbA ? 'better-val' : ''}"><span class="star-icon-wrap">${renderIcon('star', 14)}</span> ${itemB.imdb_rating || 'N/A'}</span></td>
      </tr>
      <tr>
        <td class="col-metric">Votes</td>
        <td><span class="${votesA > votesB ? 'better-val' : ''}">${itemA.imdb_votes || 'N/A'}</span></td>
        <td><span class="${votesB > votesA ? 'better-val' : ''}">${itemB.imdb_votes || 'N/A'}</span></td>
      </tr>
      <tr>
        <td class="col-metric">TMDB</td>
        <td><span class="${tmdbA > tmdbB ? 'better-val' : ''}"><span class="film-icon-wrap">${renderIcon('film', 14)}</span> ${itemA.tmdb_rating ? itemA.tmdb_rating.toFixed(1) : 'N/A'}</span></td>
        <td><span class="${tmdbB > tmdbA ? 'better-val' : ''}"><span class="film-icon-wrap">${renderIcon('film', 14)}</span> ${itemB.tmdb_rating ? itemB.tmdb_rating.toFixed(1) : 'N/A'}</span></td>
      </tr>
      <tr>
        <td class="col-metric">Runtime</td>
        <td>${escapeHtml(itemA.duration || 'N/A')}</td>
        <td>${escapeHtml(itemB.duration || 'N/A')}</td>
      </tr>
      <tr>
        <td class="col-metric">Genres</td>
        <td>${escapeHtml(genresA)}</td>
        <td>${escapeHtml(genresB)}</td>
      </tr>
      <tr>
        <td class="col-metric">Status</td>
        <td>${escapeHtml(itemA.status || 'Released')}</td>
        <td>${escapeHtml(itemB.status || 'Released')}</td>
      </tr>
      <tr>
        <td class="col-metric">Where to watch</td>
        <td><span style="font-size:12.5px;color:var(--text-secondary);">${escapeHtml(streamA)}</span></td>
        <td><span style="font-size:12.5px;color:var(--text-secondary);">${escapeHtml(streamB)}</span></td>
      </tr>
    `;
  }
}

function renderVerdictBlock(verdict, itemA, itemB) {
  const catGrid = document.getElementById('verdict-categories-grid');
  if (catGrid && verdict?.categories) {
    const cats = [
      { key: 'story', label: 'Story' },
      { key: 'acting', label: 'Acting' },
      { key: 'pacing', label: 'Pacing' },
      { key: 'rewatch_value', label: 'Rewatch value' },
      { key: 'cultural_impact', label: 'Cultural impact' },
    ];

    catGrid.innerHTML = cats
      .map(({ key, label }) => {
        const catData = verdict.categories[key] || { winner: 'Tie', reason: 'Balanced craft.' };
        const win = catData.winner || 'Tie';
        let winClass = 'winner-tie';
        let winLabel = 'Tie';
        let winIcon = renderIcon('scale');
        if (win === 'A') {
          winClass = 'winner-a';
          winLabel = itemA.title;
          winIcon = renderIcon('trophy');
        } else if (win === 'B') {
          winClass = 'winner-b';
          winLabel = itemB.title;
          winIcon = renderIcon('trophy');
        }

        return `
          <div class="verdict-cat-card">
            <span class="cat-label">${label}</span>
            <span class="cat-winner ${winClass}">${winIcon} <span>${escapeHtml(winLabel)}</span></span>
            <span class="cat-reason">${escapeHtml(catData.reason || '')}</span>
          </div>
        `;
      })
      .join('');
  }

  const overallEl = document.getElementById('verdict-overall');
  if (overallEl) {
    overallEl.textContent = verdict?.overall || `${itemA.title} and ${itemB.title} are landmark works in cinema and television.`;
  }

  const watchIfGrid = document.getElementById('verdict-watch-if-grid');
  if (watchIfGrid) {
    watchIfGrid.innerHTML = `
      <div class="watch-if-card">
        <strong>${escapeHtml(itemA.title)}</strong>
        ${escapeHtml(verdict?.watch_a_if || `Watch if you want compelling thrills and iconic moments.`)}
      </div>
      <div class="watch-if-card">
        <strong>${escapeHtml(itemB.title)}</strong>
        ${escapeHtml(verdict?.watch_b_if || `Watch if you appreciate detailed pacing and character nuance.`)}
      </div>
    `;
  }
}

async function fetchAndRenderVerdict(itemA, itemB) {
  const verdictLoading = document.getElementById('verdict-loading-state');
  const verdictContent = document.getElementById('verdict-content');
  const verdictError = document.getElementById('verdict-error-state');

  if (verdictError) verdictError.classList.add('hidden');
  if (verdictContent) verdictContent.classList.add('hidden');
  if (verdictLoading) verdictLoading.classList.remove('hidden');
  startRotatingVerdictStatus();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/compare/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemA,
        itemB,
        shields: ShieldsStore.getAll(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json();

    if (!data || data.error || !data.verdict) {
      throw new Error(data?.error || 'Verdict generation failed');
    }

    stopRotatingVerdictStatus();
    if (compareState.currentComparison) {
      compareState.currentComparison.verdict = data.verdict;
    }

    renderVerdictBlock(data.verdict, itemA, itemB);

    if (verdictLoading) verdictLoading.classList.add('hidden');
    if (verdictContent) {
      verdictContent.classList.remove('hidden');
      verdictContent.classList.remove('fade-in');
      void verdictContent.offsetWidth; // Trigger reflow for smooth animation
      verdictContent.classList.add('fade-in');
    }
    if (dom.btnCompareDebateToggle) dom.btnCompareDebateToggle.disabled = false;
  } catch (err) {
    clearTimeout(timeoutId);
    stopRotatingVerdictStatus();
    console.warn('Stage 2 verdict error:', err);
    if (verdictLoading) verdictLoading.classList.add('hidden');
    if (verdictError) verdictError.classList.remove('hidden');
  }
}

function showCompareDataError(msg) {
  const dataTable = document.getElementById('compare-data-table');
  const dataError = document.getElementById('compare-data-error');
  if (dataTable) dataTable.classList.add('hidden');
  if (dataError) {
    dataError.classList.remove('hidden');
    const msgEl = dataError.querySelector('.error-msg');
    if (msgEl) msgEl.textContent = msg || "Couldn't load this comparison. Try again";
  }
  const verdictLoading = document.getElementById('verdict-loading-state');
  if (verdictLoading) verdictLoading.classList.add('hidden');
  stopRotatingVerdictStatus();
}

async function launchComparison(titleAObj = null, titleBObj = null) {
  if (compareState.isLoading) return;

  const itemA = titleAObj || compareState.selectedA;
  const itemB = titleBObj || compareState.selectedB;
  if (!itemA || !itemB) return;

  compareState.isLoading = true;

  const entrySec = dom.compareEntrySection;
  const resultsSec = dom.compareResultsSection;

  // 1. Instant feedback on click: switch immediately to comparison view
  if (entrySec) entrySec.classList.add('hidden');
  if (resultsSec) resultsSec.classList.remove('hidden');

  renderInitialComparisonSkeleton(itemA, itemB);

  // Compare button disabled with small spinner and "Comparing..." text
  if (dom.btnLaunchCompare) {
    dom.btnLaunchCompare.disabled = true;
    dom.btnLaunchCompare.innerHTML = '<span class="btn-spinner"></span> Comparing...';
  }
  setCompareInputsDisabled(true);

  if (dom.btnCompareReset) dom.btnCompareReset.disabled = true;
  if (dom.btnCompareSwap) dom.btnCompareSwap.disabled = true;
  if (dom.btnCompareDebateToggle) dom.btnCompareDebateToggle.disabled = true;

  try {
    // Stage 1: Fetch TMDB and OMDb data in parallel with 20s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    let stage1Data = null;
    try {
      const res = await fetch('/api/compare/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleA: itemA.title,
          idA: itemA.id,
          typeA: itemA.media_type || itemA.type || 'movie',
          titleB: itemB.title,
          idB: itemB.id,
          typeB: itemB.media_type || itemB.type || 'movie',
          shields: ShieldsStore.getAll(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      stage1Data = await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('Stage 1 comparison data fetch error:', err);
    }

    if (!stage1Data || stage1Data.error || !stage1Data.itemA || !stage1Data.itemB) {
      showCompareDataError(stage1Data?.error || "Couldn't load this comparison. Try again");
      return;
    }

    const resolvedA = stage1Data.itemA;
    const resolvedB = stage1Data.itemB;

    compareState.currentComparison = { itemA: resolvedA, itemB: resolvedB, verdict: null };

    // Update heroes with fully resolved metadata & high-res posters
    const heroesContainer = document.getElementById('compare-heroes-container');
    if (heroesContainer) {
      const inWlA = isItemInWatchlist(resolvedA);
      const inWlB = isItemInWatchlist(resolvedB);
      heroesContainer.innerHTML = `
        <div class="compare-hero-card">
          ${resolvedA.poster_url ? `<img class="hero-poster" src="${escapeHtml(resolvedA.poster_url)}" alt="${escapeHtml(resolvedA.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
          <div class="hero-info">
            <span class="picker-badge">A</span>
            <h3 class="hero-title">${escapeHtml(resolvedA.title)}</h3>
            <span class="hero-year-badge">${escapeHtml(resolvedA.year || '')} • ${(resolvedA.type || 'movie').toUpperCase()}</span>
            <button type="button" class="btn-compare-watchlist ${inWlA ? 'saved' : ''}" data-side="a" data-title="${escapeHtml(resolvedA.title)}">
              ${renderIcon(inWlA ? 'check' : 'bookmark', 12)} <span>${inWlA ? 'Saved' : 'Watchlist'}</span>
            </button>
          </div>
        </div>
        <div class="compare-hero-vs-badge">
          <span class="vs-circle-sm">VS</span>
        </div>
        <div class="compare-hero-card">
          ${resolvedB.poster_url ? `<img class="hero-poster" src="${escapeHtml(resolvedB.poster_url)}" alt="${escapeHtml(resolvedB.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
          <div class="hero-info">
            <span class="picker-badge" style="color:#EC4899;background:rgba(236,72,153,0.1)">B</span>
            <h3 class="hero-title">${escapeHtml(resolvedB.title)}</h3>
            <span class="hero-year-badge">${escapeHtml(resolvedB.year || '')} • ${(resolvedB.type || 'movie').toUpperCase()}</span>
            <button type="button" class="btn-compare-watchlist ${inWlB ? 'saved' : ''}" data-side="b" data-title="${escapeHtml(resolvedB.title)}">
              ${renderIcon(inWlB ? 'check' : 'bookmark', 12)} <span>${inWlB ? 'Saved' : 'Watchlist'}</span>
            </button>
          </div>
        </div>
      `;

      heroesContainer.querySelectorAll('.btn-compare-watchlist').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const side = btn.dataset.side;
          const target = side === 'a' ? resolvedA : resolvedB;
          if (target) toggleWatchlist(target);
        });
      });
    }

    // Render table immediately (does not wait for verdict!)
    renderComparisonTable(resolvedA, resolvedB);

    if (dom.btnCompareReset) dom.btnCompareReset.disabled = false;
    if (dom.btnCompareSwap) dom.btnCompareSwap.disabled = false;

    // Stage 2: Request AI verdict separately
    await fetchAndRenderVerdict(resolvedA, resolvedB);
  } catch (err) {
    console.error('Launch comparison error:', err);
    showCompareDataError("Couldn't load this comparison. Try again");
  } finally {
    compareState.isLoading = false;
    setCompareInputsDisabled(false);
    if (dom.btnLaunchCompare) {
      dom.btnLaunchCompare.innerHTML = 'Compare';
      checkLaunchButtonState();
    }
  }
}

function swapCompareSides() {
  if (!compareState.currentComparison || !compareState.currentComparison.itemA || !compareState.currentComparison.itemB) return;
  const { itemA, itemB, verdict } = compareState.currentComparison;

  let newVerdict = null;
  if (verdict && verdict.categories) {
    newVerdict = {
      ...verdict,
      categories: {
        story: flipCategoryWinner(verdict.categories.story),
        acting: flipCategoryWinner(verdict.categories.acting),
        pacing: flipCategoryWinner(verdict.categories.pacing),
        rewatch_value: flipCategoryWinner(verdict.categories.rewatch_value),
        cultural_impact: flipCategoryWinner(verdict.categories.cultural_impact),
      },
      watch_a_if: verdict.watch_b_if,
      watch_b_if: verdict.watch_a_if,
    };
  }

  const prevA = compareState.selectedA;
  compareState.selectedA = compareState.selectedB;
  compareState.selectedB = prevA;

  compareState.currentComparison = {
    itemA: itemB,
    itemB: itemA,
    verdict: newVerdict,
  };

  const heroesContainer = document.getElementById('compare-heroes-container');
  if (heroesContainer) {
    const inWlA = isItemInWatchlist(itemB);
    const inWlB = isItemInWatchlist(itemA);
    heroesContainer.innerHTML = `
      <div class="compare-hero-card">
        ${itemB.poster_url ? `<img class="hero-poster" src="${escapeHtml(itemB.poster_url)}" alt="${escapeHtml(itemB.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
        <div class="hero-info">
          <span class="picker-badge">A</span>
          <h3 class="hero-title">${escapeHtml(itemB.title)}</h3>
          <span class="hero-year-badge">${escapeHtml(itemB.year || '')} • ${(itemB.type || 'movie').toUpperCase()}</span>
          <button type="button" class="btn-compare-watchlist ${inWlA ? 'saved' : ''}" data-side="a" data-title="${escapeHtml(itemB.title)}">
            ${renderIcon(inWlA ? 'check' : 'bookmark', 12)} <span>${inWlA ? 'Saved' : 'Watchlist'}</span>
          </button>
        </div>
      </div>
      <div class="compare-hero-vs-badge">
        <span class="vs-circle-sm">VS</span>
      </div>
      <div class="compare-hero-card">
        ${itemA.poster_url ? `<img class="hero-poster" src="${escapeHtml(itemA.poster_url)}" alt="${escapeHtml(itemA.title)}" />` : `<div class="hero-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">${renderIcon('film')}</div>`}
        <div class="hero-info">
          <span class="picker-badge" style="color:#EC4899;background:rgba(236,72,153,0.1)">B</span>
          <h3 class="hero-title">${escapeHtml(itemA.title)}</h3>
          <span class="hero-year-badge">${escapeHtml(itemA.year || '')} • ${(itemA.type || 'movie').toUpperCase()}</span>
          <button type="button" class="btn-compare-watchlist ${inWlB ? 'saved' : ''}" data-side="b" data-title="${escapeHtml(itemA.title)}">
            ${renderIcon(inWlB ? 'check' : 'bookmark', 12)} <span>${inWlB ? 'Saved' : 'Watchlist'}</span>
          </button>
        </div>
      </div>
    `;

    heroesContainer.querySelectorAll('.btn-compare-watchlist').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const side = btn.dataset.side;
        const target = side === 'a' ? itemB : itemA;
        if (target) toggleWatchlist(target);
      });
    });
  }

  renderComparisonTable(itemB, itemA);

  if (newVerdict) {
    renderVerdictBlock(newVerdict, itemB, itemA);
  }

  const btnNameA = document.getElementById('btn-name-a');
  const btnNameB = document.getElementById('btn-name-b');
  if (btnNameA) btnNameA.textContent = itemB.title;
  if (btnNameB) btnNameB.textContent = itemA.title;
}

function flipCategoryWinner(catObj) {
  if (!catObj) return { winner: 'Tie', reason: '' };
  let win = catObj.winner;
  if (win === 'A') win = 'B';
  else if (win === 'B') win = 'A';
  return { ...catObj, winner: win };
}

function toggleDebateSection() {
  const debateContainer = dom.debateContainer;
  if (!debateContainer) return;

  const isHidden = debateContainer.classList.contains('hidden');
  debateContainer.classList.toggle('hidden', !isHidden);
  if (isHidden) {
    debateContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function showDebateTypingIndicator() {
  const thread = dom.debateThread;
  if (!thread || document.getElementById('debate-typing-turn')) return;
  const typingEl = document.createElement('div');
  typingEl.className = 'debate-turn bot typing';
  typingEl.id = 'debate-typing-turn';
  typingEl.innerHTML = `
    <span class="debate-turn-author">Kinora</span>
    <div class="typing-indicator">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
  thread.appendChild(typingEl);
  thread.scrollTop = thread.scrollHeight;
}

function removeDebateTypingIndicator() {
  const el = document.getElementById('debate-typing-turn');
  if (el) el.remove();
}

async function startDebateWithChoice(side) {
  if (!compareState.currentComparison) return;
  const { itemA, itemB } = compareState.currentComparison;

  compareState.debate.active = true;
  compareState.debate.userChoice = side;
  compareState.debate.history = [];

  const sidePrompt = document.getElementById('debate-side-prompt');
  const replyForm = dom.debateReplyForm;
  const thread = dom.debateThread;

  if (sidePrompt) sidePrompt.classList.add('hidden');
  if (replyForm) replyForm.classList.remove('hidden');
  if (thread) thread.innerHTML = '';

  const chosenTitle = side === 'A' ? itemA.title : itemB.title;
  const userText = `I definitely think ${chosenTitle} is better!`;
  appendDebateTurn('user', userText);

  await fetchDebateCounterTurn(userText);
}

async function handleDebateReply(e) {
  if (e) e.preventDefault();
  const input = dom.debateReplyInput;
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  appendDebateTurn('user', text);
  await fetchDebateCounterTurn(text);
}

async function fetchDebateCounterTurn(userMsg) {
  if (!compareState.currentComparison) return;
  const { itemA, itemB } = compareState.currentComparison;

  // Show typing indicator immediately before fetching
  showDebateTypingIndicator();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titleA: itemA.title,
        titleB: itemB.title,
        userChoice: compareState.debate.userChoice,
        userMessage: userMsg,
        history: compareState.debate.history,
        isEnding: false,
        shields: ShieldsStore.getAll(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    removeDebateTypingIndicator();

    const data = await res.json();
    appendDebateTurn('bot', data.message, data.points || []);
  } catch (err) {
    clearTimeout(timeoutId);
    removeDebateTypingIndicator();
    console.error('Debate error:', err);
    appendDebateTurn('bot', 'A spirited argument! Both titles push cinematic storytelling to highest peaks.', []);
  }
}

function appendDebateTurn(role, text, points = []) {
  const thread = dom.debateThread;
  if (!thread) return;

  const turnEl = document.createElement('div');
  turnEl.className = `debate-turn ${role}`;

  const authorName = role === 'user' ? 'You' : 'Kinora';
  let pointsHtml = '';
  if (Array.isArray(points) && points.length > 0) {
    pointsHtml = `
      <ul class="debate-points-list">
        ${points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
      </ul>
    `;
  }

  turnEl.innerHTML = `
    <span class="debate-turn-author">${authorName}</span>
    <div>${escapeHtml(text)}</div>
    ${pointsHtml}
  `;

  thread.appendChild(turnEl);
  thread.scrollTop = thread.scrollHeight;

  compareState.debate.history.push({ role, text, points });
}

async function endDebateSession() {
  if (!compareState.currentComparison) return;
  const { itemA, itemB } = compareState.currentComparison;

  const replyForm = dom.debateReplyForm;
  if (replyForm) replyForm.classList.add('hidden');

  showDebateTypingIndicator();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titleA: itemA.title,
        titleB: itemB.title,
        userChoice: compareState.debate.userChoice,
        history: compareState.debate.history,
        isEnding: true,
        shields: ShieldsStore.getAll(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    removeDebateTypingIndicator();
    const data = await res.json();
    appendDebateTurn('bot', data.message || `Touché! Both ${itemA.title} and ${itemB.title} are true masterpieces. Let's call it a draw!`, []);
  } catch {
    clearTimeout(timeoutId);
    removeDebateTypingIndicator();
    appendDebateTurn('bot', `Touché! Both ${itemA.title} and ${itemB.title} are masterpieces. Let's call it a cinephile draw!`, []);
  }
}

// -------------------------------------------------------------
// Natural Language "vs" Parser for Chat Input
// -------------------------------------------------------------
function detectComparisonQuery(text) {
  if (!text) return null;
  const str = text.trim();

  const vsRegex = /^(.+?)\s+(?:vs\.?|versus|compared to)\s+(.+)$/i;
  const m1 = str.match(vsRegex);
  if (m1) {
    const tA = m1[1].replace(/^(?:compare|can you compare|what is better|which is better|debate)\s+/i, '').trim();
    const tB = m1[2].replace(/\?.*$/, '').trim();
    if (tA && tB && tA.length > 1 && tB.length > 1) {
      return { titleA: tA, titleB: tB };
    }
  }

  const compRegex = /^(?:compare|debate)\s+(.+?)\s+(?:and|with|to)\s+(.+)$/i;
  const m2 = str.match(compRegex);
  if (m2) {
    const tA = m2[1].trim();
    const tB = m2[2].replace(/\?.*$/, '').trim();
    if (tA && tB && tA.length > 1 && tB.length > 1) {
      return { titleA: tA, titleB: tB };
    }
  }

  return null;
}

async function loadComparisonByTitles(titleA, titleB) {
  setMode('compare');
  compareState.selectedA = { title: titleA };
  compareState.selectedB = { title: titleB };
  await launchComparison(compareState.selectedA, compareState.selectedB);
}

document.addEventListener('DOMContentLoaded', init);

