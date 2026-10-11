/**
 * Kinora - Frontend Application Logic
 * Clean, calm, fast vanilla JavaScript with "One request at a time" discipline.
 */

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
};

// ========================================================
// 2. MODE CONFIGURATION & WELCOME CONTENT
// ========================================================
const MODE_DATA = {
  general: {
    icon: '⚡',
    title: 'Kinora AI',
    tagline: 'Every story, zero spoilers.',
    chips: [
      { icon: '🌌', text: 'Mind-Bending Sci-Fi', prompt: 'Recommend 3 mind-bending sci-fi movies under 2 hours' },
      { icon: '🛡️', text: 'Dark S02E04 Safe Recap', prompt: 'I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap' },
      { icon: '⚖️', text: 'Breaking Bad vs BCS', prompt: 'Compare Breaking Bad vs Better Call Saul' },
      { icon: '☕', text: 'Comfort Movie Night', prompt: 'Give me a cozy comfort movie to unwind after a long day' },
    ],
  },
  'spoiler-safe': {
    icon: '🛡️',
    title: 'Spoiler Shield',
    tagline: 'Guaranteed safe up to your exact episode.',
    chips: [
      { icon: '⏳', text: 'Dark Progress Check', prompt: 'I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap' },
      { icon: '🏢', text: 'Severance S1 Recap', prompt: 'Give me a spoiler-safe recap of Severance Season 1 Episode 3' },
      { icon: '🐉', text: 'House of the Dragon', prompt: 'Where am I safe without spoilers in House of the Dragon Season 1?' },
      { icon: '👑', text: 'Succession Safe Recap', prompt: 'Succession Season 2 Episode 5 safe plot recap' },
    ],
  },
  'mood-picks': {
    icon: '🎭',
    title: 'Mood Picks',
    tagline: 'Tell me your vibe, get 3 tailored watches.',
    chips: [
      { icon: '☕', text: 'Cozy & Heartwarming', prompt: 'Give me 3 lighthearted cozy movies to cheer me up' },
      { icon: '🧠', text: 'Mind-Bending Mystery', prompt: 'Recommend 3 mind-bending mystery thrillers under 2 hours' },
      { icon: '⚡', text: 'Hyped High-Octane', prompt: '3 pulse-pounding action movies with great pacing' },
      { icon: '🌧️', text: 'Melancholic Drama', prompt: '3 beautifully bittersweet cinematic dramas' },
    ],
  },
  quiz: {
    icon: '🏆',
    title: 'Quiz & Trivia',
    tagline: 'Test your cinephile knowledge.',
    chips: [
      { icon: '🪐', text: 'Interstellar Trivia', prompt: 'Quiz me on Interstellar with 3 multiple choice questions' },
      { icon: '🧪', text: 'Breaking Bad Quiz', prompt: 'Quiz me on Breaking Bad with 3 trivia questions' },
      { icon: '🧙‍♂️', text: 'Lord of the Rings', prompt: 'Give me 3 tough Lord of the Rings trivia questions' },
      { icon: '🎬', text: 'Classic Cinema Quiz', prompt: 'Quiz me on classic 90s cinema trivia' },
    ],
  },
  character: {
    icon: '🎙️',
    title: 'Character Chat',
    tagline: 'Chat directly in iconic character voices.',
    chips: [
      { icon: '🦾', text: 'Tony Stark', prompt: 'Talk to Tony Stark about time travel and Jarvis' },
      { icon: '⚗️', text: 'Walter White', prompt: 'Speak as Walter White about chemistry and ambition' },
      { icon: '🔍', text: 'Sherlock Holmes', prompt: 'Speak as Sherlock Holmes and deduce my movie taste' },
      { icon: '👔', text: 'Michael Scott', prompt: 'Speak as Michael Scott recommending a movie for movie night' },
    ],
  },
  compare: {
    icon: '⚖️',
    title: 'Compare & Debate',
    tagline: 'Side-by-side breakdowns and honest verdicts.',
    chips: [
      { icon: '⚖️', text: 'Breaking Bad vs BCS', prompt: 'Compare Breaking Bad vs Better Call Saul across writing, pacing, acting' },
      { icon: '🚀', text: 'Interstellar vs Inception', prompt: 'Compare Interstellar vs Inception and give your verdict' },
      { icon: '🦇', text: 'The Dark Knight vs The Batman', prompt: 'Compare The Dark Knight vs The Batman (2022)' },
      { icon: '⚔️', text: 'House of Dragon vs Rings of Power', prompt: 'Compare House of the Dragon vs The Rings of Power' },
    ],
  },
  'for-you': {
    icon: '✨',
    title: 'Taste Profile',
    tagline: 'Personalized recommendations based on what you love.',
    chips: [
      { icon: '✨', text: 'Recommend Based on Sci-Fi', prompt: 'Based on my love for Dark and Inception, recommend 3 hidden gems' },
      { icon: '🍿', text: 'Weekend Watchlist Picks', prompt: 'Recommend 3 movies for my weekend watch' },
      { icon: '🇯🇵', text: 'Anime Recommendations', prompt: 'Recommend 3 gateway anime movies with deep philosophical themes' },
      { icon: '💎', text: 'Under-the-radar Gems', prompt: 'Recommend 3 highly-rated under-the-radar movies from 2023-2024' },
    ],
  },
};

// ========================================================
// 3. DOM ELEMENT REFERENCES
// ========================================================
const dom = {
  // Sidebar & Navigation
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
  chatInput: document.getElementById('chat-input'),
  inputModeTag: document.getElementById('input-mode-tag'),
  btnVoiceInput: document.getElementById('btn-voice-input'),
  btnSend: document.getElementById('btn-send'),

  // Inspector Panel (Collapsed by default)
  inspectorPanel: document.getElementById('inspector-panel'),
  btnCloseInspector: document.getElementById('btn-close-inspector'),

  // Watchlist Modal
  watchlistModal: document.getElementById('watchlist-modal'),
  btnCloseWatchlistModal: document.getElementById('btn-close-watchlist-modal'),
  watchlistForm: document.getElementById('watchlist-form'),
  watchlistAddInput: document.getElementById('watchlist-add-input'),
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
};

// ========================================================
// 4. INITIALIZATION
// ========================================================
function init() {
  loadFromStorage();
  applyTheme(state.theme);
  setMode(state.currentMode, false);
  onShieldsChanged();
  updateWatchlistBadge();
  renderHistory();
  renderActiveSession();
  bindEvents();
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
    state.watchlist = savedWatchlist ? JSON.parse(savedWatchlist) : [];

    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    if (savedTheme) state.theme = savedTheme;

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

  const newSession = {
    id: 'chat_' + Date.now(),
    title: 'New Chat',
    createdAt: new Date().toISOString(),
    mode: state.currentMode,
    messages: [],
  };

  state.sessions.unshift(newSession);
  state.currentSessionId = newSession.id;
  saveSessionsToStorage();
  renderHistory();
  renderActiveSession();
  closeMobileSidebar();
  dom.chatInput.focus();
}

function getActiveSession() {
  if (!state.currentSessionId) return null;
  return state.sessions.find((s) => s.id === state.currentSessionId) || null;
}

function renderActiveSession() {
  const session = getActiveSession();

  if (!session || !session.messages || session.messages.length === 0) {
    dom.heroWelcome.classList.remove('hidden');
    dom.messagesContainer.classList.add('hidden');
    dom.messagesContainer.innerHTML = '';
    updateWelcomeViewForMode(state.currentMode);
  } else {
    dom.heroWelcome.classList.add('hidden');
    dom.messagesContainer.classList.remove('hidden');
    dom.messagesContainer.innerHTML = '';

    session.messages.forEach((msg) => {
      appendMessageToDOM(msg.role, msg.content, false);
    });

    scrollToBottom();
  }

  if (session && session.mode) {
    setMode(session.mode, false);
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
            <span class="chip-icon">📝</span>
            <span class="chip-text">Recap so far</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Who is the main character in ${escapeHtml(title)}? Only tell me what is known up to ${escapeHtml(prog)}.">
            <span class="chip-icon">👤</span>
            <span class="chip-text">Who is [character]?</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Explain ${escapeHtml(title)} ${escapeHtml(prog)} without spoiling anything ahead.">
            <span class="chip-icon">🔍</span>
            <span class="chip-text">Explain this episode</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Theory time: what theories make sense for ${escapeHtml(title)} based only on clues up to ${escapeHtml(prog)}?">
            <span class="chip-icon">💡</span>
            <span class="chip-text">Theory time</span>
          </button>
          <button class="hero-chip-btn btn-advance-ep-chip ${state.isGenerating ? 'ui-locked-disabled' : ''}" id="btn-advance-ep-chip">
            <span class="chip-icon">⏩</span>
            <span class="chip-text">I finished the next episode</span>
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
            <span class="chip-icon">🛡️</span>
            <span class="chip-text">Set Up Your Show</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="I am on Season 2 Episode 4 of Dark. Give me a spoiler-safe recap">
            <span class="chip-icon">⏳</span>
            <span class="chip-text">Dark S02E04 Safe Recap</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Give me a spoiler-safe recap of Severance Season 1 Episode 3">
            <span class="chip-icon">🏢</span>
            <span class="chip-text">Severance S1 Safe Recap</span>
          </button>
          <button class="hero-chip-btn ${state.isGenerating ? 'ui-locked-disabled' : ''}" data-prompt="Succession Season 2 Episode 5 safe plot recap">
            <span class="chip-icon">👑</span>
            <span class="chip-text">Succession S2 Safe Recap</span>
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
          <span class="chip-icon">${chip.icon}</span>
          <span class="chip-text">${escapeHtml(chip.text)}</span>
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
      state.currentSessionId = s.id;
      saveSessionsToStorage();
      renderHistory();
      renderActiveSession();
      closeMobileSidebar();
    });

    dom.historyList.appendChild(item);
  });
}

function deleteSession(id) {
  if (state.isGenerating) return;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.currentSessionId === id) {
    state.currentSessionId = state.sessions[0] ? state.sessions[0].id : null;
  }
  saveSessionsToStorage();
  renderHistory();
  renderActiveSession();
}

// ========================================================
// 7. MESSAGE RENDERING & SPEED STREAMING
// ========================================================
function appendMessageToDOM(role, content, isStreaming = false) {
  dom.heroWelcome.classList.add('hidden');
  dom.messagesContainer.classList.remove('hidden');

  const row = document.createElement('div');
  row.className = `message-row ${role === 'user' ? 'user' : 'bot'}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'user' ? 'avatar-user' : 'avatar-bot'}`;
  avatar.innerHTML = role === 'user' ? '👤' : '🎬';

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
      addBubbleActions(bubble, content);
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  dom.messagesContainer.appendChild(row);

  scrollToBottom();
  return { row, bubble };
}

function addBubbleActions(bubble, content) {
  if (!content) return;
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `<button class="btn-bubble-action btn-copy" title="Copy text">Copy</button>`;
  actions.querySelector('.btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(content);
    const btn = actions.querySelector('.btn-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });
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
    dom.spoilerShieldPill,
    ...document.querySelectorAll('.mode-item'),
    ...document.querySelectorAll('.hero-chip-btn'),
    ...document.querySelectorAll('.history-item'),
    ...document.querySelectorAll('.btn-delete-session'),
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

  // Immediately lock to prevent duplicate user bubbles from double-clicks or rapid Enters
  state.isGenerating = true;
  setControlsLocked(true);

  state.lastUserPrompt = userText;
  dom.chatInput.value = '';
  dom.chatInput.style.height = 'auto';

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
          if (parsed.text) {
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
        addBubbleActions(bubble, accumulatedResponse);
        session.messages.push({ role: 'model', content: accumulatedResponse });
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
        addBubbleActions(bubble, accumulatedResponse);
        session.messages.push({ role: 'model', content: accumulatedResponse });
        saveSessionsToStorage();
      }
    } else {
      // Completed normally
      if (!accumulatedResponse.trim()) {
        botRow.remove();
      } else {
        bubble.innerHTML = renderMarkdown(accumulatedResponse);
        addBubbleActions(bubble, accumulatedResponse);
        session.messages.push({ role: 'model', content: accumulatedResponse });
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

  // Update active state in sidebar
  document.querySelectorAll('.mode-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.mode === modeKey);
  });

  // Update header title
  if (dom.currentModeTitle) {
    dom.currentModeTitle.textContent = data.title;
  }
  if (dom.inputModeTag) {
    dom.inputModeTag.textContent = `${data.icon} ${data.title}`;
  }

  // If in empty hero state, update welcome view
  const session = getActiveSession();
  if (!session || !session.messages || session.messages.length === 0) {
    updateWelcomeViewForMode(modeKey);
  }

  if (session && saveSession) {
    session.mode = modeKey;
    saveSessionsToStorage();
  }
}

// ========================================================
// 11. WATCHLIST MODAL MANAGEMENT
// ========================================================
function openWatchlistModal() {
  if (state.isGenerating) return;
  renderWatchlistItems();
  dom.watchlistModal.classList.remove('hidden');
}

function closeWatchlistModal() {
  dom.watchlistModal.classList.add('hidden');
}

function renderWatchlistItems() {
  if (state.watchlist.length === 0) {
    dom.watchlistList.innerHTML = '<div class="watchlist-empty">Nothing saved yet.</div>';
    return;
  }

  dom.watchlistList.innerHTML = state.watchlist
    .map(
      (item, index) => `
      <div class="watchlist-item">
        <span class="watchlist-item-title">${escapeHtml(item)}</span>
        <button class="watchlist-item-remove" data-index="${index}" title="Remove">✕</button>
      </div>
    `
    )
    .join('');

  dom.watchlistList.querySelectorAll('.watchlist-item-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      state.watchlist.splice(idx, 1);
      localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
      updateWatchlistBadge();
      renderWatchlistItems();
    });
  });
}

function updateWatchlistBadge() {
  if (dom.watchlistCount) {
    dom.watchlistCount.textContent = state.watchlist.length;
  }
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
          ${posterSrc ? `<img class="chip-poster" src="${escapeHtml(posterSrc)}" alt="" />` : `<span class="chip-icon">🛡️</span>`}
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
              ${posterSrc ? `<img class="chip-poster" src="${escapeHtml(posterSrc)}" alt="" />` : `<span class="chip-icon">🛡️</span>`}
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
            ${posterSrc ? `<img class="shield-card-thumb" src="${escapeHtml(posterSrc)}" alt="" />` : `<div class="shield-card-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">🎬</div>`}
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
          ${poster ? `<img class="shield-result-thumb" src="${escapeHtml(poster)}" alt="" />` : `<div class="shield-result-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">🎬</div>`}
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
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEYS.THEME, theme);

  if (theme === 'light') {
    dom.themeIconMoon.classList.add('hidden');
    dom.themeIconSun.classList.remove('hidden');
  } else {
    dom.themeIconMoon.classList.remove('hidden');
    dom.themeIconSun.classList.add('hidden');
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
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

function closeInspectorPanel() {
  dom.inspectorPanel.classList.add('collapsed');
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

  // New Chat button
  dom.btnNewChat.addEventListener('click', () => {
    if (!state.isGenerating) createNewChat();
  });

  // Clear History
  dom.btnClearHistory.addEventListener('click', () => {
    if (state.isGenerating) return;
    if (confirm('Clear all conversation history?')) {
      state.sessions = [];
      state.currentSessionId = null;
      saveSessionsToStorage();
      renderHistory();
      renderActiveSession();
    }
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

  dom.watchlistForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = dom.watchlistAddInput.value.trim();
    if (!val) return;
    state.watchlist.unshift(val);
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
    dom.watchlistAddInput.value = '';
    updateWatchlistBadge();
    renderWatchlistItems();
  });

  // Mobile drawer controls
  dom.btnToggleSidebar.addEventListener('click', toggleMobileSidebar);
  dom.mobileOverlay.addEventListener('click', closeMobileSidebar);

  // Inspector close button
  dom.btnCloseInspector.addEventListener('click', closeInspectorPanel);

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
}

document.addEventListener('DOMContentLoaded', init);
