# 🎬 Kinora — Cinematic AI Pop-Culture & Movie Companion

<p align="center">
  <strong>Every story, zero spoilers.</strong><br>
  A premium, cinematic AI web companion for movies, TV series, anime, and pop culture — engineered with <strong>Spoiler Shield™</strong> protection, live streaming cinema data, and deep lore.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.21-000000?style=flat-square&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Google%20Gemini-GenAI%20SDK-4285F4?style=flat-square&logo=google&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/TMDB-API%20v3-01B4E4?style=flat-square&logo=themoviedatabase&logoColor=white" alt="TMDB" />
  <img src="https://img.shields.io/badge/OMDb-IMDb%20Ratings-F5C518?style=flat-square&logo=imdb&logoColor=black" alt="OMDb" />
  <img src="https://img.shields.io/badge/Deployment-Vercel%20Ready-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel" />
</p>

---

## ✨ Overview

**Kinora** is an intelligent, cinephile-grade web application designed for film buffs and casual binge-watchers alike. Unlike generic chatbots, Kinora combines Google Gemini's reasoning with live TMDB and OMDb data pipelines, wrapped in an immersive, spoiler-safe experience that adapts to your exact watch progress.

---

## 🌟 Key Features

### 🛡️ 1. Multi-Show Spoiler Shield™
- **Episode & Progress Enforcement**: Lock your exact progress (e.g. *Season 2, Episode 4*). Kinora strictly prevents any plot revelations, character twists, or character deaths past that point.
- **Multi-Show Manager**: Track and protect multiple active series simultaneously. Switch active shields instantly from topbar chips.
- **Natural Language Progress Detection**: Type statements like *"I'm on season 2 episode 4 of Dexter"* or *"Carrie S1 E2"*, and Kinora automatically updates your shield.
- **Smart Toggles**:
  - **+1 Quick Advance**: Bump your progress with one tap when finishing an episode.
  - **Anime / Continuous Mode**: Track shows by absolute episode number (e.g. *Ep 42*).
  - **Strict Premise Mode**: For shows you haven't started yet (*"Haven't started yet"*).
  - **Movie Mode**: Toggle between premise-only and full post-watch discussion.
  - **Undo Toast**: 5-second recovery if a protected title is accidentally removed.

---

### 🔍 2. Live Title Inspector & Real-Time Cinema Data
- **Dual Ratings**: Real-time **IMDb** ratings (with vote counts) and **TMDB** scores.
- **Where to Watch (India)**: Live streaming provider lookup across Netflix, Amazon Prime Video, JioHotstar, Apple TV, SonyLIV, and more.
- **Comprehensive Metadata**: Runtime, episode count, release year, genres, plot overview, key cast chips, and direct trailer links.
- **Mobile-Optimized Drawer**:
  - **Non-Intrusive**: On mobile, queries prepare details in the background without covering the chat stream.
  - **On-Demand Access**: Open whenever you want via a floating `🎬 [Title] Details ➔` pill or an inline message button.
  - **Finger Touch Gestures**: Smooth horizontal drag-and-swipe to close with finger tracking, velocity thresholds, backdrop tap dismiss, or close button.

---

### 🍿 3. Mood Picks Discovery Engine
- **Vibe-Based Recommendations**: Find titles by mood (*Cozy, Mind-Bending, High Adrenaline, Tearjerker, Dark & Gritty, Light & Fun, Aesthetic, Romantic, Feel-Good*) or custom prompts (*"Cyberpunk under 100 minutes"*).
- **Smart Bayesian Ranking**:
  - Pulls a 40-title candidate pool in parallel from TMDB.
  - Filters by minimum vote thresholds ($v \ge 1500$ global, $v \ge 300$ regional) and score ($\ge 6.8$).
  - Weighted ranking: `0.5 × popularity + 0.3 × Bayesian IMDb rating + 0.2 × mood fit`.
- **3 Discovery Modes**:
  - 🌟 **Most Popular First**: Universally acclaimed blockbusters and hits.
  - ⚖️ **Balanced Mix**: Harmony of popular staples and critically praised picks.
  - 💎 **Hidden Gems**: Lesser-known masterpieces with outstanding ratings.
- **Deep Filtering & Infinite Batches**: Filter by media type (Movie / TV / Any), duration, language, and streaming platform. Tap *"Show 6 more"* to append fresh picks instantly.
- **"Not For Me" Memory**: Dismiss titles you dislike, persisting them to an exclusion list so they never appear again.

---

### ⚖️ 4. Compare & Debate
- **Head-to-Head Comparison**: Compare any two movies or series side-by-side with autocomplete search.
- **Two-Stage Instant Loading**:
  - **Stage 1**: Parallel TMDB/OMDb data fetches table metrics (ratings, runtime, seasons, streaming availability) with shimmer skeleton rows.
  - **Stage 2**: AI verdict analysis breaking down *Story*, *Acting*, *Pacing*, *Rewatch Value*, *Cultural Impact*, and tailored *"Watch X if..."* advice.
- **Swap Sides**: 1-click swap button inverts Title A and Title B and flips category winners instantly without refetching.
- **Interactive Cinephile Debate**: Choose a side and debate Kinora in real time. Kinora counters with evidence and delivers an objective final resolution.
- **Natural Language Shortcut**: Mention comparisons directly in chat (e.g., *"Interstellar vs Oppenheimer"* or *"Breaking Bad vs Better Call Saul"*).

---

### 🏆 5. Quiz & Trivia
- Dynamic pop-culture trivia with questions generated across films, TV, anime, and directors.
- Multiple-choice questions with instant score tracking and cinephile commentary.

---

### 🎙️ 6. Character Chat
- Converse directly with iconic cinematic figures (e.g. *Tony Soprano, Walter White, Sherlock Holmes, Michael Scott*).
- System prompts maintain distinct character voices, vocabulary, and mannerisms.

---

### 🔖 7. Taste Profile & Watchlist
- Persistent client-side watchlist stored in `localStorage`.
- Rich cards featuring poster thumbnails, release year, IMDb ratings, direct Inspector links, and removal actions.

---

### 📱 8. Mobile-First Experience & UX Polish
- **Dynamic Viewport Height**: Dynamic `--app-height` and `100dvh` CSS ensuring the chat bar never gets pushed offscreen by mobile browser bars or keyboards.
- **Rotating Mode-Aware Placeholders**: Input placeholder rotates every 3 seconds with short, mode-specific query suggestions and smooth fade/slide transitions.
- **Voice Input**: Integrated Web Speech API microphone button for hands-free dictation.
- **Streaming Response Controls**: Live SSE token rendering, copy button, retry prompt, and generation cancel button with an `AbortController` 60-second safety timeout.
- **Cinematic Dark & Light Modes**: High-contrast, accessibility-tested themes.

---

## 🛠️ Architecture & Tech Stack

```
Kinora/
├── public/                 # Client assets (No bundler required)
│   ├── index.html          # Semantic HTML5 single-page application
│   ├── styles.css          # Vanilla CSS3 design system & glassmorphism
│   └── app.js              # State management, SSE parser, gesture engine
├── services/
│   └── mediaData.js        # TMDB & OMDb data orchestration & Gemini scoring
├── server.js               # Node.js Express backend & SSE streaming endpoint
├── .env.example            # Environment variables template
└── package.json            # Node.js dependencies
```

- **Frontend**: Zero-build Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Backend**: Node.js + Express with Server-Sent Events (SSE) streaming.
- **AI SDK**: Google GenAI official SDK (`@google/genai`) running `gemini-2.5-flash` with graceful model fallback.
- **Cinema Data APIs**:
  - [The Movie Database (TMDB)](https://www.themoviedb.org/) (Metadata, credits, streaming providers, discovery).
  - [Open Movie Database (OMDb)](https://www.omdbapi.com/) (IMDb ratings & global vote counts).
- **Deployment**: Configured for Vercel Serverless Functions and standalone Node.js servers.

---

## 🔌 API Endpoints Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/chat` | `POST` | SSE stream for AI chat with mode and Spoiler Shield enforcement |
| `/api/media/search` | `GET` | Autocomplete search across movies and TV series |
| `/api/media/details` | `GET` | Deep title details (ratings, providers, cast, trailer) |
| `/api/media/seasons` | `GET` | Season and episode counts for series |
| `/api/mood-picks/pool` | `POST` | Discovers and ranks candidate pool for Mood Picks |
| `/api/mood-picks/blurbs` | `POST` | Generates short personalized AI blurbs for mood cards |
| `/api/compare/data` | `POST` | Stage 1 comparison metrics (TMDB & OMDb stats) |
| `/api/compare/verdict` | `POST` | Stage 2 AI verdict & category breakdown |
| `/api/debate` | `POST` | Interactive counter-argument debate turn generator |
| `/api/health` | `GET` | API configuration & system health check |

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **npm** (v9 or higher)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Yashhsurve/Kinora.git
cd Kinora
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your API keys:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here
```

| Key | Purpose | Where to Get |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Powers AI chat, debate, and verdicts | [Google AI Studio](https://aistudio.google.com/app/apikey) (Free) |
| `TMDB_API_KEY` | Cinema database, discovery, streaming | [TMDB Settings](https://www.themoviedb.org/settings/api) (Free) |
| `OMDB_API_KEY` | Verified IMDb ratings & vote counts | [OMDb API](https://www.omdbapi.com/apikey.aspx) (Free) |

### 4. Run Locally
```bash
# Production start
npm start

# Development with automatic restart
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🚢 Deployment (Vercel)

Kinora is ready to deploy on **Vercel**:

1. Push your code to GitHub.
2. Import the repository into your **Vercel Dashboard**.
3. Under **Project Settings → Environment Variables**, add:
   - `GEMINI_API_KEY`
   - `TMDB_API_KEY`
   - `OMDB_API_KEY`
4. Click **Deploy**. Vercel will build and serve your app.

---

## 📋 Roadmap & Progress

- [x] **Phase 1: Cinematic Shell & Core Chat**: Streaming chat UI, SSE backend, dark space aesthetic, glassmorphic layout.
- [x] **Phase 2: Live Data & Title Inspector**: TMDB & OMDb integrations, Indian OTT provider mapping, trailer links, dual rating cards.
- [x] **Phase 3: Multi-Show Spoiler Shield™**: Natural language progress tracking, episode locking, strict prompt guardrails, and quick updates.
- [x] **Phase 4: Mood Picks & Compare/Debate**: Bayesian candidate pool ranking, 3 ranking styles, 2-stage comparison loading, and interactive debate engine.
- [x] **Phase 5: Quiz & Character Chat**: Trivia mode with scores and immersive conversational roleplay.
- [x] **Phase 6: Watchlist & Taste Profiles**: LocalStorage persistence, item inspection, and library management.
- [x] **Phase 7: Mobile Optimization & Gestures**: Dynamic viewport height (`dvh`), draggable slide-to-close drawer, floating trigger pills, rotating placeholders.
- [x] **Phase 8: Polish & Production**: Error handling, timeout recovery, speech-to-text, clean deployment setup.

---

## 📄 License & Attribution

- Released under the [ISC License](LICENSE).
- *This product uses the TMDB API but is not endorsed or certified by TMDB.*
- *IMDb data provided via OMDb API.*
