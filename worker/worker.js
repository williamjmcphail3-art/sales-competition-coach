// worker.js — Cloudflare Worker: AI scoring + coaching for the Sales Competition site.
// Backend: Groq (free, fast; OpenAI-compatible API).
//
// Two POST modes (JSON body):
//   default:       { transcript, items:[{key,label,help}] }        -> { scores }
//   coach:         { mode:"coach", contestantName,
//                    items:[{label,score,justification,manual}] }  -> { narrative }
//
// Your Groq API key is a Worker SECRET (GROQ_API_KEY) — set it in the dashboard:
//   Worker → Settings → Variables and Secrets → add GROQ_API_KEY (as a Secret).
// Get a free key at https://console.groq.com/keys. It never reaches the browser.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Groq-hosted models, tried in order — first one this key/account supports is used.
const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const REQUEST_TIMEOUT_MS = 25000; // hard cap per call so it can never hang

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call Groq with model fallback, one retry on transient errors, and a hard
// per-request timeout. Returns { resp, model }; resp is null if every attempt
// failed to connect, or a Response (possibly !ok) for the caller to handle.
async function callGroq(env, { system, user, wantJson }) {
  const RETRYABLE = new Set([429, 500, 502, 503]);
  let last = null;
  let model = MODELS[0];
  for (const m of MODELS) {
    model = m;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let resp = null;
      try {
        resp = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: m,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: wantJson ? 0.2 : 0.4,
            ...(wantJson ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        resp = null; // network error or aborted (timeout)
      } finally {
        clearTimeout(timer);
      }

      if (resp && resp.ok) return { resp, model: m };
      if (resp) {
        last = resp;
        if (resp.status === 401 || resp.status === 403) return { resp, model: m }; // key problem — stop
        if (resp.status === 404 || resp.status === 400) break; // model unavailable — next model
        if (RETRYABLE.has(resp.status) && attempt < 1) {
          await sleep(700);
          continue;
        }
        break; // out of retries — try next model
      } else if (attempt < 1) {
        await sleep(700); // connect failure/timeout — one quick retry
        continue;
      } else {
        break; // give up on this model
      }
    }
  }
  return { resp: last, model };
}

// Turn a failed/absent Response into a friendly JSON error Response.
function backendError(resp, env) {
  if (!resp) {
    return json({ error: "The AI didn't respond in time — wait a few seconds and try again." }, 504, env);
  }
  if (resp.status === 429) {
    return json({ error: "The AI is busy right now — wait a few seconds and try again." }, 503, env);
  }
  if (resp.status === 401 || resp.status === 403) {
    return json({ error: "The AI key is missing or invalid — check the GROQ_API_KEY secret." }, 502, env);
  }
  return json({ error: `AI service error ${resp.status}.` }, 502, env);
}

// Pull the assistant text out of a Groq (OpenAI-shaped) chat completion.
async function groqText(resp) {
  const result = await resp.json();
  return (result.choices?.[0]?.message?.content || "").trim();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405, env);
    }
    if (!env.GROQ_API_KEY) {
      return json({ error: "Server is missing GROQ_API_KEY." }, 500, env);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400, env);
    }

    if (data && data.mode === "coach") return handleCoach(data, env);
    return handleScore(data, env);
  },
};

// ---- Mode: score a transcript ---------------------------------------------
async function handleScore(data, env) {
  const { transcript, items } = data || {};

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

  const rubricText = cleanItems
    .map((it, i) => `${i + 1}. key="${it.key}" — ${it.label}: ${it.help}`)
    .join("\n");

  const system =
    "You are an expert judge for a collegiate sales competition, scoring a recorded " +
    "sales pitch against the Sales Competition judging rubric. You are given ONLY a " +
    "written transcript. You cannot see or hear the pitch, so judge strictly from what " +
    "the words reveal.\n\n" +
    "For EACH rubric item you are given, assign an integer score from 0 to 10 and write " +
    "ONE sentence of justification grounded in the transcript. Do not award points for " +
    "behavior only implied but never actually said; if an item's behavior never appears in " +
    "the transcript, score it 0 and say it was not evidenced; score conservatively when " +
    "evidence is thin.\n\n" +
    'Return ONLY a JSON object of the form ' +
    '{"scores":[{"key":"<exact item key>","score":<integer 0-10>,"justification":"<one sentence>"}]} ' +
    "with one entry for every item you were given and no extra keys.";

  const user =
    `Rubric items to score:\n${rubricText}\n\n` +
    `=== TRANSCRIPT START ===\n${transcript}\n=== TRANSCRIPT END ===`;

  let parsed;
  try {
    const { resp } = await callGroq(env, { system, user, wantJson: true });
    if (!resp || !resp.ok) return backendError(resp, env);
    parsed = extractJson(await groqText(resp));
  } catch (err) {
    console.log("scoreTranscript failed:", err && err.stack ? err.stack : String(err));
    return json({ error: "Scoring failed. Try again." }, 500, env);
  }

  return json({ scores: normalizeScores(parsed, cleanItems) }, 200, env);
}

// ---- Mode: write a coaching narrative for one pitch -----------------------
async function handleCoach(data, env) {
  const name = typeof data.contestantName === "string" && data.contestantName ? data.contestantName : "the contestant";
  const items = Array.isArray(data.items) ? data.items.slice(0, MAX_ITEMS) : [];
  if (items.length === 0) {
    return json({ error: "No scored items provided." }, 400, env);
  }

  const lines = items
    .map((it) => {
      const label = typeof it.label === "string" ? it.label : "item";
      const score = Math.max(0, Math.min(10, Number(it.score) || 0));
      const manual = it.manual ? " (judged live)" : "";
      const note = typeof it.justification === "string" && it.justification ? ` — ${it.justification}` : "";
      return `- ${label}: ${score}/10${manual}${note}`;
    })
    .join("\n");

  const system =
    "You are a blunt, highly experienced sales coach reviewing ONE contestant's pitch in a " +
    "collegiate sales competition. You are given their rubric scores (0–10 each) and short notes. " +
    "Write a SHORT coaching report of 3–5 sentences: lead with the biggest, most costly weaknesses " +
    "and exactly how to fix each, then acknowledge one genuine strength only if it's real. Be direct " +
    "and critical — no praise padding, no hedging, and do not just restate the scores. Address the " +
    "contestant directly as 'you'. Return plain prose, no headings or bullet points.";

  const user = `Contestant: ${name}\n\nScored rubric:\n${lines}`;

  try {
    const { resp } = await callGroq(env, { system, user, wantJson: false });
    if (!resp || !resp.ok) return backendError(resp, env);
    const narrative = await groqText(resp);
    if (!narrative) return json({ error: "The model returned no coaching text." }, 502, env);
    return json({ narrative }, 200, env);
  } catch (err) {
    console.log("coach failed:", err && err.stack ? err.stack : String(err));
    return json({ error: "Coaching failed. Try again." }, 500, env);
  }
}

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
