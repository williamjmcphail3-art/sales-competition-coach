// app.js — leaderboard, manual score entry, and AI-assisted transcript scoring.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  update,
  remove,
  onValue,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, aiEndpoint } from "./firebase-config.js";
import { RUBRIC, ALL_ITEMS, AI_ITEMS, MAX_TOTAL } from "./rubric.js";

// ---------------------------------------------------------------------------
// Guard against an unconfigured project so the page fails loudly, not silently.
// ---------------------------------------------------------------------------
const isConfigured =
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
if (!isConfigured) {
  document.getElementById("config-warning").hidden = false;
}

let db = null;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

// The AI backend (Cloudflare Worker) is configured separately from Firebase.
const aiConfigured = aiEndpoint && !aiEndpoint.includes("YOUR-WORKER");

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// Render the 29 rubric inputs, grouped by category
// ---------------------------------------------------------------------------
const container = document.getElementById("rubric-container");
document.getElementById("total-max").textContent = String(MAX_TOTAL);

for (const cat of RUBRIC) {
  const section = document.createElement("div");
  section.className = "rubric-category";
  section.innerHTML = `<h3>${cat.category}<span class="cat-max">${cat.maxPoints} pts</span></h3>`;

  for (const item of cat.items) {
    const row = document.createElement("div");
    row.className = "item" + (item.manualOnly ? " manual" : "") + (item.placeholder ? " placeholder" : "");

    const detail = item.manualOnly
      ? `<div class="manual-note">Can't be judged from a transcript — score manually. <em>${item.manualReason ?? ""}</em></div>`
      : `<div class="justification" id="just-${item.key}"></div>`;

    row.innerHTML = `
      <div class="item-label">${item.label}</div>
      <div class="item-help">${item.help}</div>
      <div class="item-score">
        <input type="number" min="0" max="10" step="1" inputmode="numeric"
               id="score-${item.key}" aria-label="${item.label} score" />
      </div>
      ${detail}`;
    section.appendChild(row);
  }
  container.appendChild(section);
}

const scoreInputs = ALL_ITEMS.map((it) => document.getElementById(`score-${it.key}`));

function clampScoreInput(input) {
  if (input.value === "") return;
  let v = Math.round(Number(input.value));
  if (!Number.isFinite(v)) v = 0;
  v = Math.max(0, Math.min(10, v));
  input.value = String(v);
}

function recomputeTotal() {
  let total = 0;
  for (const input of scoreInputs) {
    const v = Number(input.value);
    if (Number.isFinite(v)) total += v;
  }
  document.getElementById("total-live").textContent = String(total);
}

scoreInputs.forEach((input) => {
  input.addEventListener("input", recomputeTotal);
  input.addEventListener("change", () => {
    clampScoreInput(input);
    recomputeTotal();
  });
});

// ---------------------------------------------------------------------------
// Judge name (remembered locally)
// ---------------------------------------------------------------------------
const judgeInput = document.getElementById("judge-name");
try {
  judgeInput.value = localStorage.getItem("scc-judge") || "";
} catch {}
judgeInput.addEventListener("change", () => {
  try {
    localStorage.setItem("scc-judge", judgeInput.value.trim());
  } catch {}
});

// ---------------------------------------------------------------------------
// Contestants: live dropdown + add
// ---------------------------------------------------------------------------
const contestantSelect = document.getElementById("contestant-select");
let contestants = {}; // id -> { name }

if (db) {
  onValue(ref(db, "contestants"), (snap) => {
    contestants = snap.val() || {};
    const selected = contestantSelect.value;
    contestantSelect.innerHTML = '<option value="">— select —</option>';
    Object.entries(contestants)
      .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""))
      .forEach(([id, c]) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = c.name;
        contestantSelect.appendChild(opt);
      });
    if (contestants[selected]) contestantSelect.value = selected;
  });
}

document.getElementById("add-contestant").addEventListener("click", async () => {
  const nameInput = document.getElementById("new-contestant");
  const name = nameInput.value.trim();
  if (!name) return;
  if (!db) return alert("Firebase isn't configured yet.");
  try {
    const newRef = await push(ref(db, "contestants"), {
      name,
      createdAt: serverTimestamp(),
    });
    nameInput.value = "";
    // Select the contestant we just added.
    setTimeout(() => (contestantSelect.value = newRef.key), 200);
  } catch (err) {
    alert("Couldn't add contestant: " + err.message);
  }
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
const boardBody = document.getElementById("board-body");

// Latest snapshots, shared by the leaderboard and the contestant detail view.
let latestContestants = {};
let latestScores = {};

if (db) {
  onValue(ref(db, "contestants"), (snap) => {
    latestContestants = snap.val() || {};
    renderBoard();
    renderInsights();
    refreshOpenDetail();
  });
  onValue(ref(db, "scores"), (snap) => {
    latestScores = snap.val() || {};
    renderBoard();
    renderInsights();
    refreshOpenDetail();
  });
}

function renderBoard() {
  const agg = {}; // id -> { name, totals: [] }
  for (const [id, c] of Object.entries(latestContestants)) {
    agg[id] = { id, name: c.name, totals: [] };
  }
  for (const s of Object.values(latestScores)) {
    if (!s || !s.contestantId) continue;
    if (!agg[s.contestantId]) {
      agg[s.contestantId] = { id: s.contestantId, name: s.contestantName || "(removed)", totals: [] };
    }
    agg[s.contestantId].totals.push(Number(s.total) || 0);
  }

  const rows = Object.values(agg).map((a) => {
    const n = a.totals.length;
    const avg = n ? a.totals.reduce((x, y) => x + y, 0) / n : 0;
    const best = n ? Math.max(...a.totals) : 0;
    return { id: a.id, name: a.name, avg, best, count: n };
  });

  rows.sort((a, b) => b.avg - a.avg || b.best - a.best);

  if (rows.length === 0) {
    boardBody.innerHTML = '<tr><td colspan="6" class="muted center">No contestants yet. Add one on the “Score a pitch” tab.</td></tr>';
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  boardBody.innerHTML = rows
    .map((r, i) => {
      const rank = r.count ? (medals[i] || i + 1) : "—";
      return `<tr class="clickable" data-id="${escapeHtml(r.id)}" title="View saved scores">
        <td class="rank-medal">${rank}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="num">${r.count ? r.avg.toFixed(1) : "—"}</td>
        <td class="num muted">${MAX_TOTAL}</td>
        <td class="num">${r.count}</td>
        <td class="num">${r.count ? r.best : "—"}</td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Contestant detail modal (click a leaderboard row)
// ---------------------------------------------------------------------------
const modal = document.getElementById("detail-modal");
const detailTitle = document.getElementById("detail-title");
const detailBody = document.getElementById("detail-body");
let openContestantId = null;

const ITEM_BY_KEY = Object.fromEntries(ALL_ITEMS.map((it) => [it.key, it]));

boardBody.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (tr) openContestant(tr.dataset.id);
});

document.getElementById("detail-close").addEventListener("click", closeDetail);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeDetail();
});

// Per-entry actions inside the modal (edit / delete / generate coaching).
detailBody.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".edit-btn");
  const delBtn = e.target.closest(".delete-btn");
  const coachBtn = e.target.closest(".coach-btn");
  if (editBtn) startEditScore(editBtn.dataset.scoreId);
  else if (delBtn) deleteScore(delBtn.dataset.scoreId);
  else if (coachBtn) generateCoaching(coachBtn, coachBtn.dataset.scoreId);
});

function closeDetail() {
  modal.hidden = true;
  openContestantId = null;
}

function openContestant(id) {
  openContestantId = id;
  modal.hidden = false;
  renderDetail(id);
}

// Re-render the modal in place if its data changes while it's open.
function refreshOpenDetail() {
  if (openContestantId && !modal.hidden) renderDetail(openContestantId);
}

function renderDetail(id) {
  const entries = Object.entries(latestScores)
    .filter(([, s]) => s && s.contestantId === id)
    .sort((a, b) => (Number(b[1].createdAt) || 0) - (Number(a[1].createdAt) || 0));

  const name = latestContestants[id]?.name || entries[0]?.[1].contestantName || "Contestant";
  detailTitle.textContent = name;

  if (entries.length === 0) {
    detailBody.innerHTML = '<p class="entry-empty">No scores saved for this contestant yet.</p>';
    return;
  }

  detailBody.innerHTML = entries.map(([sid, s]) => renderEntry(sid, s)).join("");
}

function renderEntry(id, s) {
  const items = s.items || {};
  const justs = s.justifications || {};
  const when = Number(s.createdAt);
  const date = Number.isFinite(when) ? new Date(when).toLocaleString() : "";

  const cats = RUBRIC.map((cat) => {
    const rows = cat.items
      .map((it) => {
        const score = items[it.key];
        const scoreText = Number.isFinite(Number(score)) ? score : "—";
        const just = justs[it.key];
        let detail = "";
        if (just) detail = `<div class="ei-just">${escapeHtml(just)}</div>`;
        else if (it.manualOnly) detail = `<div class="ei-manual">Scored manually</div>`;
        return `<div class="entry-item">
          <span class="ei-score">${scoreText}</span>
          <span class="ei-label">${escapeHtml(it.label)}</span>
          ${detail}
        </div>`;
      })
      .join("");
    return `<div class="entry-cat"><h4>${escapeHtml(cat.category)}</h4>${rows}</div>`;
  }).join("");

  const coach = s.coaching
    ? `<div class="entry-coach">
         <div class="entry-coach-head">AI coaching</div>
         <div class="entry-coach-text">${escapeHtml(s.coaching)}</div>
         <button type="button" class="linklike coach-btn" data-score-id="${escapeHtml(id)}">Regenerate</button>
       </div>`
    : `<div class="entry-coach">
         <button type="button" class="secondary coach-btn" data-score-id="${escapeHtml(id)}">Generate AI coaching</button>
       </div>`;

  return `<div class="entry">
    <div class="entry-head">
      <strong>${escapeHtml(s.judge || "Unknown judge")}</strong>
      · <span class="entry-total">${Number(s.total) || 0}/${MAX_TOTAL}</span>
      ${date ? `· <span class="muted">${escapeHtml(date)}</span>` : ""}
      <span class="entry-actions">
        <button type="button" class="linklike edit-btn" data-score-id="${escapeHtml(id)}">Edit</button>
        <button type="button" class="linklike danger delete-btn" data-score-id="${escapeHtml(id)}">Delete</button>
      </span>
    </div>
    ${s.notes ? `<div class="entry-notes">Notes: ${escapeHtml(s.notes)}</div>` : ""}
    ${coach}
    ${cats}
  </div>`;
}

// ---- Edit / delete / AI coaching for a saved score -----------------------
let editingScoreId = null;

async function deleteScore(id) {
  if (!id || !db) return;
  const s = latestScores[id];
  const who = s?.contestantName ? ` for ${s.contestantName}` : "";
  if (!confirm(`Delete this saved score${who}? This can't be undone.`)) return;
  try {
    await remove(ref(db, "scores/" + id));
    // onValue listeners re-render the board, insights, and open modal automatically.
  } catch (err) {
    alert("Delete failed: " + (err.message || "unknown error"));
  }
}

async function generateCoaching(btn, id) {
  const s = latestScores[id];
  if (!s || !db) return;
  if (!aiConfigured) {
    alert("AI isn't set up yet (add your Worker URL in firebase-config.js).");
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";
  try {
    const items = ALL_ITEMS.map((it) => ({
      label: it.label,
      score: Number.isFinite(Number(s.items?.[it.key])) ? Number(s.items[it.key]) : 0,
      justification: (s.justifications && s.justifications[it.key]) || "",
      manual: !!it.manualOnly,
    }));
    const body = JSON.stringify({ mode: "coach", contestantName: s.contestantName || "", items });
    let resp, payload;
    for (let attempt = 1; attempt <= 4; attempt++) {
      resp = await fetch(aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      payload = await resp.json().catch(() => ({}));
      if (resp.ok) break;
      if (resp.status === 503 && attempt < 4) {
        btn.textContent = `AI busy — retrying (${attempt}/3)…`;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(payload.error || `Coaching service error ${resp.status}.`);
    }
    await update(ref(db, "scores/" + id), { coaching: payload.narrative || "" });
    // The scores listener re-renders the open modal with the narrative shown.
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    alert("Coaching failed: " + (err.message || "unknown error"));
  }
}

function startEditScore(id) {
  const s = latestScores[id];
  if (!s) return;
  editingScoreId = id;
  document.querySelector('.tab[data-tab="score"]').click();
  judgeInput.value = s.judge || "";
  if (latestContestants[s.contestantId] || contestants[s.contestantId]) {
    contestantSelect.value = s.contestantId;
  }
  for (const it of ALL_ITEMS) {
    const input = document.getElementById(`score-${it.key}`);
    if (input) input.value = Number.isFinite(Number(s.items?.[it.key])) ? String(s.items[it.key]) : "";
    const just = document.getElementById(`just-${it.key}`);
    if (just) just.textContent = (s.justifications && s.justifications[it.key]) || "";
  }
  document.getElementById("score-notes").value = s.notes || "";
  recomputeTotal();
  document.getElementById("save-score").textContent = "Update score";
  document.getElementById("edit-banner-name").textContent = s.contestantName || "this contestant";
  document.getElementById("edit-banner").hidden = false;
  closeDetail();
  setStatus(saveStatus, "", "");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetScoreForm() {
  editingScoreId = null;
  for (const it of ALL_ITEMS) {
    const input = document.getElementById(`score-${it.key}`);
    if (input) input.value = "";
    const just = document.getElementById(`just-${it.key}`);
    if (just) just.textContent = "";
  }
  document.getElementById("score-notes").value = "";
  document.getElementById("save-score").textContent = "Save score";
  document.getElementById("edit-banner").hidden = true;
  recomputeTotal();
}

// ---------------------------------------------------------------------------
// Insights: a per-competitor deep dive — what was said, and how to improve it.
// ---------------------------------------------------------------------------
const insightsContainer = document.getElementById("insights-container");

// One delegated handler (survives re-renders): coaching buttons + name clicks.
if (insightsContainer) {
  insightsContainer.addEventListener("click", (e) => {
    const coachBtn = e.target.closest(".coach-btn");
    if (coachBtn) {
      generateCoaching(coachBtn, coachBtn.dataset.scoreId);
      return;
    }
    const head = e.target.closest("[data-id]");
    if (head) openContestant(head.dataset.id);
  });
}

// Pull the evaluated items from one saved record (skips "left blank" zeros).
function evaluatedItems(record) {
  const items = record.items || {};
  const justs = record.justifications || {};
  return ALL_ITEMS.map((it) => {
    const raw = Number(items[it.key]);
    const hasJust = typeof justs[it.key] === "string" && justs[it.key].length > 0;
    const isEval = hasJust || (Number.isFinite(raw) && raw > 0);
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0;
    return { it, score, just: hasJust ? justs[it.key] : "", isEval };
  }).filter((x) => x.isEval);
}

function renderInsights() {
  if (!insightsContainer) return;
  const records = Object.values(latestScores || {}).filter((s) => s && s.contestantId);

  if (records.length === 0) {
    insightsContainer.innerHTML =
      '<p class="muted center" style="padding:24px">No pitches saved yet. Once you save some scores, this tab breaks each competitor down — exactly what was said, and how to improve it.</p>';
    return;
  }

  const totals = records.map((r) => Number(r.total) || 0);
  const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const avgPct = Math.round((avgTotal / MAX_TOTAL) * 100);

  let verdict;
  if (avgPct >= 85) verdict = "Strong field — but the gaps in each breakdown below still cost points.";
  else if (avgPct >= 70) verdict = "A competent field with clear, fixable holes.";
  else if (avgPct >= 55) verdict = "Middling — serious points are being left on the table.";
  else verdict = "Weak across the board — the fundamentals below are missing from most pitches.";

  // Group by contestant; the deep dive uses each competitor's most recent pitch.
  // Keep the score-record id (sid) so we can save AI coaching to that record.
  const byId = {};
  for (const [sid, s] of Object.entries(latestScores)) {
    if (!s || !s.contestantId) continue;
    (byId[s.contestantId] ||= []).push({ sid, s });
  }
  const competitors = Object.entries(byId)
    .map(([id, recs]) => {
      recs.sort((a, b) => (Number(b.s.createdAt) || 0) - (Number(a.s.createdAt) || 0));
      const latest = recs[0].s;
      return {
        id,
        latestId: recs[0].sid,
        name: latestContestants[id]?.name || latest.contestantName || "(unknown)",
        latest,
        count: recs.length,
        total: Number(latest.total) || 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const medals = ["🥇", "🥈", "🥉"];

  const sections = competitors
    .map((c, idx) => {
      const when = Number(c.latest.createdAt);
      const date = Number.isFinite(when) ? new Date(when).toLocaleDateString() : "";
      const evald = evaluatedItems(c.latest);
      const weakest = evald.slice().sort((a, b) => a.score - b.score).slice(0, 5);
      const strongest = evald.slice().sort((a, b) => b.score - a.score)[0];

      const weakHtml = weakest.length
        ? weakest
            .map((x) => {
              const cls = x.score <= 4 ? "bad" : x.score <= 6 ? "mid" : "ok";
              const said = x.just
                ? `<div class="ci-said"><span class="ci-tag">What was said</span> ${escapeHtml(x.just)}</div>`
                : `<div class="ci-said"><span class="ci-tag live">Judged live</span> <span class="muted">No transcript note — scored from the live pitch.</span></div>`;
              return `<div class="ci-item">
                <div class="ci-item-top">
                  <span class="ci-score ${cls}">${x.score}</span>
                  <span class="ci-label">${escapeHtml(x.it.label)}</span>
                  <span class="ci-cat">${escapeHtml(x.it.category)}</span>
                </div>
                ${said}
                <div class="ci-fix"><span class="ci-tag fix">How to improve</span> ${escapeHtml(x.it.improve || "")}</div>
              </div>`;
            })
            .join("")
        : '<p class="muted">No scored items on this pitch yet.</p>';

      const coachHtml = c.latest.coaching
        ? `<div class="ci-coach"><span class="ci-tag coach">Coach's take</span> ${escapeHtml(c.latest.coaching)}
             <button type="button" class="linklike coach-btn" data-score-id="${escapeHtml(c.latestId)}">Regenerate</button></div>`
        : `<div class="ci-coachrow"><button type="button" class="secondary coach-btn" data-score-id="${escapeHtml(c.latestId)}">Generate AI coaching</button></div>`;
      const strongHtml = strongest
        ? `<div class="ci-strong">Strongest: <strong>${escapeHtml(strongest.it.label)}</strong> (${strongest.score}/10)${strongest.just ? ` — ${escapeHtml(strongest.just)}` : ""}</div>`
        : "";

      return `<section class="ci">
        <div class="ci-head clickable" data-id="${escapeHtml(c.id)}" title="Open full scorecard">
          <span class="ci-rank">${medals[idx] || idx + 1}</span>
          <span class="ci-name">${escapeHtml(c.name)}</span>
          <span class="ci-total">${c.total}<span class="ci-total-max">/${MAX_TOTAL}</span></span>
          <span class="ci-meta">${escapeHtml(date)}${c.count > 1 ? ` · latest of ${c.count}` : ""}</span>
        </div>
        ${coachHtml}
        ${strongHtml}
        <div class="ci-weak-h">Where the points went — and how to fix it</div>
        ${weakHtml}
      </section>`;
    })
    .join("");

  insightsContainer.innerHTML = `
    <div class="ins-verdict">
      <div class="ins-verdict-stat"><strong>${competitors.length}</strong> competitors · <strong>${records.length}</strong> pitches · field avg <strong>${Math.round(avgTotal)}</strong>/${MAX_TOTAL} (${avgPct}%)</div>
      <p class="ins-verdict-text">${escapeHtml(verdict)}</p>
    </div>
    <p class="muted ins-sub">Each competitor below: their weakest criteria, exactly what was said (the AI's or judge's note), and how to improve. Click a name for the full scorecard.</p>
    ${sections}`;
}

// ---------------------------------------------------------------------------
// Transcript upload
// ---------------------------------------------------------------------------
const transcriptEl = document.getElementById("transcript");
document.getElementById("transcript-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    transcriptEl.value = reader.result;
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------------------------
// AI scoring
// ---------------------------------------------------------------------------
const runAiBtn = document.getElementById("run-ai");
const aiStatus = document.getElementById("ai-status");

runAiBtn.addEventListener("click", async () => {
  const transcript = transcriptEl.value.trim();
  if (transcript.length < 20) {
    setStatus(aiStatus, "Paste a transcript first (at least 20 characters).", "error");
    return;
  }
  if (!aiConfigured) {
    setStatus(aiStatus, "AI scoring isn't set up yet (add your Worker URL in firebase-config.js).", "error");
    return;
  }

  runAiBtn.disabled = true;
  setStatus(aiStatus, "Scoring… this asks the AI to grade the transcript.", "");

  try {
    const items = AI_ITEMS.map((it) => ({ key: it.key, label: it.label, help: it.help }));
    const body = JSON.stringify({ transcript, items });

    // The free AI tier occasionally returns 503 ("busy"); retry a few times so a
    // judge rarely has to click twice. (The Worker also retries server-side.)
    const MAX_TRIES = 4;
    let resp, payload;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      resp = await fetch(aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      payload = await resp.json().catch(() => ({}));
      if (resp.ok) break;
      if (resp.status === 503 && attempt < MAX_TRIES) {
        setStatus(aiStatus, `AI is busy — retrying (${attempt}/${MAX_TRIES - 1})…`, "");
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(payload.error || `Scoring service error ${resp.status}.`);
    }
    const scores = payload.scores || {};

    let filled = 0;
    for (const it of AI_ITEMS) {
      const result = scores[it.key];
      if (!result) continue;
      const input = document.getElementById(`score-${it.key}`);
      input.value = String(result.score);
      const just = document.getElementById(`just-${it.key}`);
      if (just) just.textContent = result.justification || "";
      filled++;
    }
    recomputeTotal();

    const manualCount = ALL_ITEMS.length - AI_ITEMS.length;
    setStatus(
      aiStatus,
      `Filled ${filled} AI-scored items. ${manualCount} non-verbal items left for you to score. Adjust anything, then Save.`,
      "ok",
    );
  } catch (err) {
    setStatus(aiStatus, "Scoring failed: " + (err.message || "unknown error"), "error");
  } finally {
    runAiBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Save score
// ---------------------------------------------------------------------------
const saveStatus = document.getElementById("save-status");

document.getElementById("rubric-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const judge = judgeInput.value.trim();
  const contestantId = contestantSelect.value;
  if (!judge) return setStatus(saveStatus, "Enter your name as the judge.", "error");
  if (!contestantId) return setStatus(saveStatus, "Select a contestant.", "error");
  if (!db) return setStatus(saveStatus, "Firebase isn't configured yet.", "error");

  const items = {};
  const justifications = {};
  let total = 0;
  for (const it of ALL_ITEMS) {
    const input = document.getElementById(`score-${it.key}`);
    let v = Math.round(Number(input.value));
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(10, v));
    items[it.key] = v;
    total += v;

    // Persist the AI's one-sentence justification if one is showing for this item.
    const just = document.getElementById(`just-${it.key}`);
    const text = just?.textContent?.trim();
    if (text) justifications[it.key] = text;
  }

  const saveBtn = document.getElementById("save-score");
  saveBtn.disabled = true;
  setStatus(saveStatus, editingScoreId ? "Updating…" : "Saving…", "");
  const contestantName =
    contestants[contestantId]?.name || latestContestants[contestantId]?.name || "";
  const notes = document.getElementById("score-notes").value.trim();
  try {
    if (editingScoreId) {
      // Update the existing record in place; drop stale AI coaching since scores changed.
      await update(ref(db, "scores/" + editingScoreId), {
        contestantId, contestantName, judge, items, justifications, total, notes,
        updatedAt: serverTimestamp(),
        coaching: null,
      });
      setStatus(saveStatus, `Updated — ${total}/${MAX_TOTAL}.`, "ok");
      resetScoreForm();
    } else {
      await push(ref(db, "scores"), {
        contestantId, contestantName, judge, items, justifications, total, notes,
        createdAt: serverTimestamp(),
      });
      setStatus(saveStatus, `Saved — ${total}/${MAX_TOTAL}. Now on the leaderboard.`, "ok");
    }
  } catch (err) {
    setStatus(saveStatus, (editingScoreId ? "Update" : "Save") + " failed: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById("cancel-edit").addEventListener("click", () => {
  resetScoreForm();
  setStatus(saveStatus, "Edit canceled.", "");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "ai-status" + (kind ? " " + kind : "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

recomputeTotal();
