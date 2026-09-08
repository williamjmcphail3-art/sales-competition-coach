// worker.js — Cloudflare Worker: score a sales-pitch transcript with Google Gemini.
//
// The browser POSTs { transcript, items } here; the Worker calls Gemini's free tier
// and returns a 0–10 score + one-sentence justification per item.
//
// Your Gemini API key is stored as a Worker SECRET (GEMINI_API_KEY) — set with:
//   npx wrangler secret put GEMINI_API_KEY
// It lives only in the Worker runtime and is never sent to the browser.

// Gemini free-tier models, tried in order — the first one this API key supports is used
// (a 404 means "not available to this key", so we fall through to the next).
// See https://ai.google.dev/gemini-api/docs/models
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-1.5-flash"];

const MAX_TRANSCRIPT_CHARS = 120_000;
const MAX_ITEMS = 40;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405, env);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: "Server is missing GEMINI_API_KEY." }, 500, env);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400, env);
    }

    const { transcript, items } = data || {};

    // ---- Validate ----------------------------------------------------------
    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return json({ error: "Provide a transcript of at least 20 characters." }, 400, env);
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return json({ error: `Transcript too long (limit ${MAX_TRANSCRIPT_CHARS} chars).` }, 400, env);
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
      return json({ error: `Provide 1–${MAX_ITEMS} rubric items.` }, 400, env);
    }
    const cleanItems = items
      .filter((it) => it && typeof it.key === "string")
      .map((it) => ({
        key: String(it.key),
        label: typeof it.label === "string" ? it.label : it.key,
        help: typeof it.help === "string" ? it.help : "",
      }));
    if (cleanItems.length === 0) {
      return json({ error: "No valid rubric items provided." }, 400, env);
    }

    // ---- Build the prompt --------------------------------------------------
    const rubricText = cleanItems
      .map((it, i) => `${i + 1}. key="${it.key}" — ${it.label}: ${it.help}`)
      .join("\n");

    const system =
      "You are an expert judge for a collegiate sales competition, scoring a recorded " +
      "sales pitch against the Sales Competition judging rubric. You are given ONLY a " +
      "written transcript. You cannot see or hear the pitch, so judge strictly from what " +
      "the words reveal.\n\n" +
      "For EACH rubric item you are given, assign an integer score from 0 to 10 and write " +
      "ONE sentence of justification grounded in the transcript.\n\n" +
      "Rules: do not award points for behavior only implied but never actually said; if an " +
      "item's behavior never appears in the transcript, score it 0 and say it was not " +
      "evidenced; score conservatively when evidence is thin; score every item you are " +
      "given, and only those items. Use the exact key strings provided.";

    const userText =
      `Rubric items to score:\n${rubricText}\n\n` +
      `=== TRANSCRIPT START ===\n${transcript}\n=== TRANSCRIPT END ===`;

    const geminiBody = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            scores: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  key: { type: "STRING" },
                  score: { type: "INTEGER" },
                  justification: { type: "STRING" },
                },
                required: ["key", "score", "justification"],
              },
            },
          },
          required: ["scores"],
        },
      },
    };

    // ---- Call Gemini -------------------------------------------------------
    let parsed;
    let usedModel = MODELS[0];
    try {
      let resp;
      for (const m of MODELS) {
        usedModel = m;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(geminiBody),
        });
        if (resp.status !== 404) break; // model unavailable for this key — try the next
      }

      if (!resp.ok) {
        const detail = await resp.text();
        if (resp.status === 429) {
          return json({ error: "Gemini free-tier rate limit hit — wait a moment and retry." }, 429, env);
        }
        if (resp.status === 400 || resp.status === 403) {
          return json({ error: "Gemini rejected the request — check the GEMINI_API_KEY secret." }, 502, env);
        }
        console.log("Gemini error", resp.status, detail);
        return json({ error: `Gemini error ${resp.status}.` }, 502, env);
      }

      const result = await resp.json();
      const cand = result.candidates?.[0];
      if (!cand || cand.finishReason === "SAFETY") {
        return json({ error: "The model declined to score this transcript." }, 422, env);
      }
      const text = (cand.content?.parts || []).map((p) => p.text || "").join("").trim();
      parsed = extractJson(text);
    } catch (err) {
      console.log("scoreTranscript failed:", err && err.stack ? err.stack : String(err));
      return json({ error: "Scoring failed. Try again." }, 500, env);
    }

    const scores = normalizeScores(parsed, cleanItems);
    return json({ model: usedModel, scores }, 200, env);
  },
};

// Pull a JSON object out of the model text, tolerating fences or stray prose.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Could not parse JSON from model output.");
  }
}

// Map the model's array into { key: { score, justification } }, clamped and complete.
function normalizeScores(parsed, cleanItems) {
  const raw = Array.isArray(parsed?.scores) ? parsed.scores : [];
  const found = new Map();
  for (const row of raw) {
    if (!row || typeof row.key !== "string") continue;
    let score = Number(row.score);
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(10, Math.round(score)));
    found.set(row.key, {
      score,
      justification: typeof row.justification === "string" ? row.justification.trim() : "",
    });
  }
  const out = {};
  for (const it of cleanItems) {
    out[it.key] = found.get(it.key) ?? {
      score: 0,
      justification: "The model did not return a score for this item.",
    };
  }
  return out;
}
