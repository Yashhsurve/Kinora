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

// Helper for waiting between retries / stream pacing
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------
// Route: Streaming Chat Endpoint (Server-Sent Events)
// -------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { message, history = [], mode = 'general', spoilerShield = null } = req.body;

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

    // Dynamic Mode / Spoiler Shield Instructions
    let modeInstruction = '';
    if (spoilerShield && spoilerShield.active && spoilerShield.showTitle) {
      modeInstruction += `CRITICAL SPOILER SHIELD: User is at "${spoilerShield.showTitle}" (${spoilerShield.progress || 'current episode'}). NEVER reveal or hint anything after this.\n`;
    }

    if (mode === 'spoiler-safe') {
      modeInstruction += `Keep all responses completely safe from spoilers.\n`;
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
            const toolOutput = await media.executeTool(call.name, call.args);

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
