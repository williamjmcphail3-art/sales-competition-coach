// app.js — leaderboard, manual score entry, and AI-assisted transcript scoring.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
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
    refreshOpenDetail();
  });
  onValue(ref(db, "scores"), (snap) => {
    latestScores = snap.val() || {};
    renderBoard();
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
  const entries = Object.values(latestScores)
    .filter((s) => s && s.contestantId === id)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

  const name = latestContestants[id]?.name || entries[0]?.contestantName || "Contestant";
  detailTitle.textContent = name;

  if (entries.length === 0) {
    detailBody.innerHTML = '<p class="entry-empty">No scores saved for this contestant yet.</p>';
    return;
  }

  detailBody.innerHTML = entries.map(renderEntry).join("");
}

function renderEntry(s) {
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

  return `<div class="entry">
    <div class="entry-head">
      <strong>${escapeHtml(s.judge || "Unknown judge")}</strong>
      · <span class="entry-total">${Number(s.total) || 0}/${MAX_TOTAL}</span>
      ${date ? `· <span class="muted">${escapeHtml(date)}</span>` : ""}
    </div>
    ${s.notes ? `<div class="entry-notes">Notes: ${escapeHtml(s.notes)}</div>` : ""}
    ${cats}
  </div>`;
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
  setStatus(saveStatus, "Saving…", "");
  try {
    await push(ref(db, "scores"), {
      contestantId,
      contestantName: contestants[contestantId]?.name || "",
      judge,
      items,
      justifications,
      total,
      notes: document.getElementById("score-notes").value.trim(),
      createdAt: serverTimestamp(),
    });
    setStatus(saveStatus, `Saved — ${total}/${MAX_TOTAL}. Now on the leaderboard.`, "ok");
  } catch (err) {
    setStatus(saveStatus, "Save failed: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
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
