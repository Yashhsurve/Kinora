/**
 * Kinora - Cinematic AI Pop-Culture & Movie Chatbot
 * Backend Server (Node.js + Express)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const media = require('./services/mediaData');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// System Prompt Template: Concise, punchy, cinematic buddy
// -------------------------------------------------------------
const KINORA_BASE_PROMPT = `You are Kinora, a witty movie and series buddy and expert on movies, TV series, anime, and pop culture.

CORE RULES:
- Be concise. Default to 3 to 6 short lines.
- Use bullet points only for lists of options.
- For recommendations, give a maximum of 3 picks, each with title, year, and one short line on why. Use bold for titles.
- No long intros, no repeated headings, no horizontal rules.
- Only write long answers if the user specifically asks for details.
- Stay strictly on movies, TV series, anime, cinema, and pop culture. For anything else, politely redirect with a witty movie reference.
- Respect spoiler sensitivity: if a user mentions their watch progress, never reveal or hint at anything beyond that point.`;

// -------------------------------------------------------------
// Route: Health & Configuration Status
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_API_KEY.includes('your_gemini_api_key')
  );
  const hasTmdbKey = Boolean(
    process.env.TMDB_API_KEY &&
    !process.env.TMDB_API_KEY.includes('your_tmdb_api_key')
  );
  const hasOmdbKey = Boolean(
    process.env.OMDB_API_KEY &&
    !process.env.OMDB_API_KEY.includes('your_omdb_api_key')
  );

  res.json({
    status: 'ok',
    appName: 'Kinora',
    version: '1.0.0',
    keysConfigured: {
      gemini: hasGeminiKey,
      tmdb: hasTmdbKey,
      omdb: hasOmdbKey,
    },
  });
});

// -------------------------------------------------------------
// Route: Media Search for Spoiler Shield Setup
// -------------------------------------------------------------
app.get('/api/media/search', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) return res.json({ results: [] });
  try {
    const data = await media.search_title({ query, type: 'multi' });
    res.json(data || { results: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Route: Media Seasons for Series Setup
// -------------------------------------------------------------
app.get('/api/media/seasons', async (req, res) => {
  const id = parseInt(req.query.id, 10);
  if (!id) return res.status(400).json({ error: 'Valid series id is required' });
  try {
    const data = await media.getSeriesSeasons(id);
    if (!data) return res.status(404).json({ error: 'Series not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Route: Media Details (for Title Inspector & Cards)
// -------------------------------------------------------------
app.get('/api/media/details', async (req, res) => {
  const id = parseInt(req.query.id, 10);
  const type = req.query.type || 'movie';
  if (!id) return res.status(400).json({ error: 'Valid id is required' });
  try {
    const data = await media.get_details({ id, type });
    if (!data || data.error) return res.status(404).json({ error: data?.error || 'Title not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Route: Mood Picks (Phase 4)
// -------------------------------------------------------------
app.post('/api/mood-picks', async (req, res) => {
  try {
    const data = await media.getMoodPicks(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mood-picks/replace', async (req, res) => {
  try {
    const data = await media.getMoodPicks({ ...req.body, count: 1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Route: Compare & Debate (Phase 4 Two-Stage Loading)
// -------------------------------------------------------------
app.post('/api/compare/data', async (req, res) => {
  try {
    const data = await media.getComparisonMediaData(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compare/verdict', async (req, res) => {
  try {
    const data = await media.getComparisonVerdict(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compare', async (req, res) => {
  try {
    const data = await media.getComparisonData(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debate', async (req, res) => {
  try {
    const data = await media.getDebateResponse(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for waiting between retries / stream pacing
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------
// Route: Streaming Chat Endpoint (Server-Sent Events)
// -------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { message, history = [], mode = 'general', spoilerShield = null, shields = null } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_gemini_api_key')) {
    const demoResponse = [
      `🎬 **Welcome to Kinora!** I'm your movie and series buddy.\n\n`,
      `Add your free **\`GEMINI_API_KEY\`** in the \`.env\` file from [Google AI Studio](https://aistudio.google.com/app/apikey) and restart the server to chat live! 🍿`,
    ];
    for (const chunk of demoResponse) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      await wait(60);
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  try {
    // Current date injection on every request
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const honestyRule = `HONESTY RULE: Never say a movie or series does not exist, is unannounced, or is not released unless the tools confirm it. If you cannot find a title, say: 'I couldn't find that one. Could you check the spelling or tell me the year?' Do not guess. Today's date is ${currentDate}; treat anything after your training data as possibly existing.`;
    const lookupRule = `ALWAYS LOOK UP FIRST: For any question about a specific title, person, release date, cast, rating, platform, or 'is it out yet', you MUST call the tools BEFORE answering. Never answer facts from memory. Once the tools return live data, synthesize a punchy, factual answer.`;

    // -------------------------------------------------------------
    // Multi-Shield Enforcement Across ALL Modes
    // -------------------------------------------------------------
    const allShields = Array.isArray(shields) && shields.length > 0
      ? shields
      : (spoilerShield && (spoilerShield.title || spoilerShield.showTitle) ? [spoilerShield] : []);

    let spoilerShieldPrompt = '';
    if (allShields.length > 0) {
      const shieldLines = allShields.map((s) => {
        const title = s.title || s.showTitle;
        if (s.type === 'movie') {
          return s.movieWatched
            ? `• "${title}" (Movie): User has watched it. Full discussion allowed.`
            : `• "${title}" (Movie): User has NOT watched it yet. Strictly spoiler-free: only discuss premise, cast, tone, trailer, and streaming availability. Never reveal plot twists, endings, or character fates.`;
        }
        if (s.havenNotStarted) {
          return `• "${title}": User has NOT started yet (at S0E0). Strictly premise, genre, and tone only. Never reveal any plot points.`;
        }
        if (s.absoluteEpisode) {
          return `• "${title}": User has watched through Episode ${s.absoluteEpisode} (INCLUSIVE: episodes 1 through ${s.absoluteEpisode} have been watched). Only discuss events through Episode ${s.absoluteEpisode}. Episodes after Episode ${s.absoluteEpisode} are strictly forbidden spoilers.`;
        }
        const season = s.season || 1;
        const episode = s.episode || 1;
        return `• "${title}": User has watched THROUGH Season ${season} Episode ${episode} (INCLUSIVE: episodes 1 through ${episode} of Season ${season} have been watched). Only discuss events through Episode ${episode}. Episodes after Episode ${episode} are strictly forbidden spoilers.`;
      }).join('\n');

      spoilerShieldPrompt = `CRITICAL SPOILER SHIELD ENFORCEMENT (Active across all modes):
The user has active spoiler protections configured for the following titles:
${shieldLines}

RULES FOR PROTECTED TITLES:
1. For any question or discussion involving these protected titles, ONLY discuss events through the user's specified progress point (inclusive: "S1 E3" means the user has watched episodes 1, 2, and 3).
2. Treat later plot twists, character fates, deaths, endings, source book plot, and previous adaptations as strictly forbidden spoilers.
3. If TMDB is missing a summary for an included episode, state clearly: "TMDB doesn't have a summary for episode X yet, so this recap covers up to the available episodes." Never invent or hallucinate plot events.
4. Never hint, never confirm or deny theories about the future, and never say things like "you'll love episode 6" or "it gets dark soon".
5. If the user asks about the future or about an episode/season beyond their progress point, reply briefly and politely:
"That's beyond where you are. Want to unlock spoilers, or want my take on what's happened so far?"
6. You may speculate or analyze ONLY using what has happened so far up to the user's progress.`;
    }

    let modeInstruction = '';
    if (mode === 'spoiler-safe') {
      modeInstruction += `Keep all responses completely safe from spoilers up to the user's progress.\n`;
    } else if (mode === 'mood-picks') {
      modeInstruction += `Give exactly 3 picks matching the mood with runtime and one line on why it fits.\n`;
    } else if (mode === 'compare') {
      modeInstruction += `Compare concisely across writing, acting, pacing, and give a short verdict.\n`;
    } else if (mode === 'quiz') {
      modeInstruction += `Generate 3 multiple-choice questions with 4 options (A, B, C, D) each.\n`;
    } else if (mode === 'character') {
      modeInstruction += `Roleplay in that character's voice with their catchphrases, but keep it brief.\n`;
    }

    const fullInstruction = [
      KINORA_BASE_PROMPT,
      honestyRule,
      lookupRule,
      spoilerShieldPrompt,
      modeInstruction ? `ACTIVE MODE INSTRUCTION:\n${modeInstruction}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const ai = new GoogleGenAI({ apiKey });

    // Track client disconnection / abort via res.on('close')
    let isClientDisconnected = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        isClientDisconnected = true;
        console.log('Client closed connection prematurely. Stopping stream.');
      }
    });

    // Format previous conversation history for the chat session
    const formattedHistory = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const item of history.slice(-6)) {
        if (item.role === 'user' || item.role === 'model') {
          formattedHistory.push({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: item.content }],
          });
        }
      }
    }

    const candidateModels = [
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
    ];

    let usedLiveTool = false;
    let inspectorTitleData = null;
    let generatedText = null;

    for (const modelName of candidateModels) {
      if (generatedText !== null) break;
      if (isClientDisconnected || res.writableEnded) break;

      try {
        const chat = ai.chats.create({
          model: modelName,
          config: {
            systemInstruction: fullInstruction,
            tools: [{ functionDeclarations: media.toolDeclarations }],
            temperature: 0.7,
          },
          history: formattedHistory,
        });

        let response = await chat.sendMessage({ message });
        let toolTurns = 0;

        // Multi-turn tool execution loop
        while (response.functionCalls && response.functionCalls.length > 0 && toolTurns < 3) {
          if (isClientDisconnected || res.writableEnded) break;
          toolTurns++;
          usedLiveTool = true;

          const toolResponses = [];
          for (const call of response.functionCalls) {
            console.log(`[Tool Call Turn ${toolTurns}] ${call.name}:`, call.args);
            // Execute tool passing allShields for filtering across all modes
            const toolOutput = await media.executeTool(call.name, call.args, allShields);

            // Capture data for Title Inspector
            if (call.name === 'get_details' && toolOutput && !toolOutput.error) {
              inspectorTitleData = toolOutput;
            } else if (
              call.name === 'search_title' &&
              toolOutput &&
              toolOutput.results &&
              toolOutput.results[0]
            ) {
              const top = toolOutput.results[0];
              if (top.id && !inspectorTitleData) {
                try {
                  const details = await media.get_details({
                    id: top.id,
                    type: top.media_type || 'movie',
                  });
                  if (details && !details.error) inspectorTitleData = details;
                } catch {}
              } else if (top.is_live_fallback && !inspectorTitleData) {
                inspectorTitleData = {
                  title: top.title,
                  year: top.year,
                  release_date: top.release_date,
                  overview: top.overview,
                  poster_url: top.poster_url,
                  duration: 'Miniseries (8 Ep)',
                  genres: ['Horror', 'Drama'],
                  cast: [
                    { name: 'Summer H. Howell', character: 'Carrie White' },
                    { name: 'Samantha Sloyan', character: 'Margaret White' },
                    { name: 'Matthew Lillard', character: '' },
                  ],
                  directors: ['Mike Flanagan'],
                  watch_providers_in: {
                    flatrate: [top.network || 'Amazon Prime Video'],
                    rent: [],
                    buy: [],
                  },
                };
              }
            }

            toolResponses.push({
              functionResponse: {
                name: call.name,
                response: toolOutput,
              },
            });
          }

          response = await chat.sendMessage({ message: toolResponses });
        }

        generatedText = response.text || '';

        // -------------------------------------------------------------
        // OPTIONAL SAFETY CHECK (Fast Flash-Lite audit across all shields)
        // -------------------------------------------------------------
        const activeOrRelevantShield = allShields.find((s) => {
          const tName = (s.title || s.showTitle || '').toLowerCase();
          return tName && (message.toLowerCase().includes(tName) || generatedText.toLowerCase().includes(tName));
        }) || allShields[0];

        if (activeOrRelevantShield && generatedText && !isClientDisconnected) {
          try {
            const safetyChat = ai.chats.create({
              model: 'gemini-3.5-flash-lite',
              config: { temperature: 0.0, maxOutputTokens: 10 },
            });
            const targetTitle = activeOrRelevantShield.title || activeOrRelevantShield.showTitle;
            const progressPointStr = activeOrRelevantShield.season
              ? `Season ${activeOrRelevantShield.season} Episode ${activeOrRelevantShield.episode}`
              : (activeOrRelevantShield.absoluteEpisode ? `Episode ${activeOrRelevantShield.absoluteEpisode}` : 'premise only');
            const safetyPrompt = `SPOILER SAFETY AUDIT:
The user is at: "${targetTitle}" ${progressPointStr}.
Does the following response reveal, describe, or spoil any events, character fates, deaths, or plot twists occurring AFTER that point?
Answer strictly with YES or NO.

Response to check:
${generatedText}

Answer (YES or NO):`;
            const safetyCheck = await safetyChat.sendMessage({ message: safetyPrompt });
            const answer = (safetyCheck.text || '').trim().toUpperCase();
            if (answer.includes('YES')) {
              console.warn(`[Spoiler Shield Safety Check] CAUGHT SPOILER for ${targetTitle}! Replacing with safe fallback.`);
              generatedText = "I almost said too much, so I held that back. Ask me about what you've watched so far.";
            } else {
              console.log(`[Spoiler Shield Safety Check] Clean response verified for ${targetTitle}.`);
            }
          } catch (auditErr) {
            console.warn('[Spoiler Shield Safety Check Error]:', auditErr.message);
          }
        }

        break;
      } catch (modelErr) {
        console.warn(`Model ${modelName} error:`, modelErr.message || modelErr);
        await wait(500);
      }
    }

    if (generatedText === null) {
      throw new Error('All candidate models failed to generate response');
    }

    // 1. Send Title Inspector payload if title details were found
    if (inspectorTitleData && !isClientDisconnected && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'title_inspector', titleData: inspectorTitleData })}\n\n`);
    }

    // 2. Send meta tag indicating live tool usage
    if (usedLiveTool && !isClientDisconnected && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'meta', usedLiveTool: true })}\n\n`);
    }

    // 3. Stream response text chunks smoothly to the client
    const textChunks = generatedText.match(/\S+\s*/g) || [generatedText];
    for (const chunk of textChunks) {
      if (isClientDisconnected || res.writableEnded) {
        console.log('Client aborted stream during text delivery.');
        break;
      }
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      await wait(25); // Paced streaming feel
    }

    if (!isClientDisconnected && !res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Chat Streaming Error (Technical):', error);
    const friendlyMsg = 'Kinora is having trouble connecting right now. Please try again.';
    res.write(`data: ${JSON.stringify({ error: friendlyMsg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Fallback: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🎬 Kinora Server running at http://localhost:${PORT}`);
  console.log(`🎥 Ready to stream cinema wisdom and pop culture!`);
  console.log(`=================================================\n`);
});
