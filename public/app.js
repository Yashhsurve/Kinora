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
  SPOILER_SHIELD: 'kinora_spoiler_shield_v1',
  WATCHLIST: 'kinora_watchlist_v1',
  THEME: 'kinora_theme_v1',
  MODE: 'kinora_mode_v1',
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
    showTitle: '',
    season: 1,
    episode: 1,
    progress: '',
  },
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

  // Header
  currentModeBadge: document.getElementById('current-mode-badge'),
  spoilerShieldPill: document.getElementById('spoiler-shield-pill'),
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

  // Spoiler Shield Modal
  spoilerModal: document.getElementById('spoiler-modal'),
  btnCloseSpoilerModal: document.getElementById('btn-close-spoiler-modal'),
  shieldShowInput: document.getElementById('shield-show-input'),
  shieldSeasonInput: document.getElementById('shield-season-input'),
  shieldEpisodeInput: document.getElementById('shield-episode-input'),
  btnDisableShield: document.getElementById('btn-disable-shield'),
  btnSaveShield: document.getElementById('btn-save-shield'),
};

// ========================================================
// 4. INITIALIZATION
// ========================================================
function init() {
  loadFromStorage();
  applyTheme(state.theme);
  updateSpoilerShieldUI();
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

    const savedShield = localStorage.getItem(STORAGE_KEYS.SPOILER_SHIELD);
    if (savedShield) state.spoilerShield = JSON.parse(savedShield);

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
        spoilerShield: state.spoilerShield,
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

  // Update header badges
  dom.currentModeBadge.innerHTML = `<span class="badge-icon">${data.icon}</span><span class="badge-text">${data.title}</span>`;
  dom.inputModeTag.textContent = `${data.icon} ${data.title}`;

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
// 12. SPOILER SHIELD
// ========================================================
function updateSpoilerShieldUI() {
  if (state.spoilerShield.active && state.spoilerShield.showTitle) {
    dom.spoilerShieldPill.classList.add('active');
    dom.spoilerShieldPill.innerHTML = `
      <span class="shield-dot"></span>
      <span class="shield-text">${escapeHtml(state.spoilerShield.showTitle)} S${state.spoilerShield.season}E${state.spoilerShield.episode}</span>
    `;
  } else {
    dom.spoilerShieldPill.classList.remove('active');
    dom.spoilerShieldPill.innerHTML = `
      <span class="shield-dot"></span>
      <span class="shield-text">Spoiler Shield: Off</span>
    `;
  }
}

function openSpoilerModal() {
  if (state.isGenerating) return;
  dom.shieldShowInput.value = state.spoilerShield.showTitle || '';
  dom.shieldSeasonInput.value = state.spoilerShield.season || 1;
  dom.shieldEpisodeInput.value = state.spoilerShield.episode || 1;
  dom.spoilerModal.classList.remove('hidden');
}

function closeSpoilerModal() {
  dom.spoilerModal.classList.add('hidden');
}

function saveSpoilerShield() {
  const title = dom.shieldShowInput.value.trim();
  const season = parseInt(dom.shieldSeasonInput.value, 10) || 1;
  const episode = parseInt(dom.shieldEpisodeInput.value, 10) || 1;

  if (!title) {
    alert('Please enter a series title.');
    return;
  }

  state.spoilerShield = {
    active: true,
    showTitle: title,
    season: season,
    episode: episode,
    progress: `Season ${season} Episode ${episode}`,
  };

  localStorage.setItem(STORAGE_KEYS.SPOILER_SHIELD, JSON.stringify(state.spoilerShield));
  updateSpoilerShieldUI();
  closeSpoilerModal();
}

function disableSpoilerShield() {
  state.spoilerShield = {
    active: false,
    showTitle: '',
    season: 1,
    episode: 1,
    progress: '',
  };
  localStorage.setItem(STORAGE_KEYS.SPOILER_SHIELD, JSON.stringify(state.spoilerShield));
  updateSpoilerShieldUI();
  closeSpoilerModal();
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

  // Spoiler Shield modal
  dom.spoilerShieldPill.addEventListener('click', () => {
    if (!state.isGenerating) openSpoilerModal();
  });
  dom.btnCloseSpoilerModal.addEventListener('click', closeSpoilerModal);
  dom.btnSaveShield.addEventListener('click', saveSpoilerShield);
  dom.btnDisableShield.addEventListener('click', disableSpoilerShield);

  // Voice Input
  setupVoiceInput();
}

document.addEventListener('DOMContentLoaded', init);
