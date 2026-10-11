# 🎬 Kinora — Cinematic AI Pop-Culture & Movie Companion

> **Every story, zero spoilers.**  
> A premium, cinematic AI chatbot web application that is an expert on movies, TV series, anime, and pop culture, featuring **Spoiler-Safe** intelligence, real-time streaming, and deep cinema lore.

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** (comes bundled with Node.js)

### 2. Installation
Open your terminal in the project directory and install the dependencies:
```bash
npm install
```

### 3. Configure API Keys
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` in your editor and add your keys:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here
```

> **Where to get keys:**
> - **Gemini API Key (Required for AI Chat):** Get free at [Google AI Studio](https://aistudio.google.com/app/apikey)
> - **TMDB API Key (For Phase 2 movie data):** Get free at [The Movie Database](https://www.themoviedb.org/settings/api)
> - **OMDb API Key (For Phase 2 IMDb ratings):** Get free at [OMDb API](https://www.omdbapi.com/apikey.aspx)

### 4. Start the Application
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🏗️ Architecture & Tech Stack (Phase 1)

- **Frontend**: Plain HTML5, Vanilla CSS3, and modern Vanilla JavaScript (no React, zero bundlers). Served directly from `public/`.
- **Backend**: Node.js + Express (`server.js`). Handles streaming chat via Server-Sent Events (SSE) and serves the client app.
- **AI Engine**: Google Gemini API via `@google/generative-ai` streaming (`gemini-3.8-flash` with graceful fallback).
- **Design System**:
  - Deep space cinematic theme (`#0B0B12`) with electric violet, hot pink, and amber accents.
  - Glassmorphic panels with backdrop blur and custom animations.
  - Google Fonts typography: `Space Grotesk` (display headings) + `Inter` (body).
  - 3-panel layout: Left Sidebar (navigation & history), Center Chat Stage (welcome hero & live stream), and Right Context Inspector.
- **Client Storage**: Browser `localStorage` for conversation sessions, mode preferences, theme state, and spoiler shield configurations.

---

## 📋 Build Plan Progress

- [x] **Phase 1: Project setup, server, .env, and a basic chat UI streaming from Gemini with the cinematic design shell.** *(Completed)*
- [ ] **Phase 2: TMDB and OMDb tools with function calling, plus the Title Explorer card.**
- [ ] **Phase 3: Spoiler-safe mode with backend enforcement.**
- [ ] **Phase 4: Mood picks, Compare/Debate.**
- [ ] **Phase 5: Quiz mode, Character chat.**
- [ ] **Phase 6: Taste profile, watchlist, For You recommendations.**
- [ ] **Phase 7: Extra features (Wrapped, Watch Order, Movie Night Planner, voice input), polish animations, and mobile responsiveness.**
- [ ] **Phase 8: Error handling, rate-limit handling, README, and deployment instructions.**

---

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
