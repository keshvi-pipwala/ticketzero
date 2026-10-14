import { handleTicket, AUTO_THRESHOLD } from "../src/agent.js";
import { INTENTS } from "../src/intents.js";
import { verifyWebhook, triageWebhookLogs, signPayload } from "../src/webhooks.js";
import { REVIEWS, THEMES, themeCounts } from "../src/patterns.js";
import { TICKETS, NOW, SECRET, PRETTY_BODY } from "../evals/tickets.js";
import { prepareState, runEvals } from "../evals/score.js";
import h10 from "../evals/history/v1.0-round1-blind.json";
import h11 from "../evals/history/v1.1-round2-blind.json";
import h12 from "../evals/history/v1.2-round3-blind.json";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (x) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
const QUEUE = { payments: "Payments", trust_safety: "Trust & Safety", engineering: "Engineering", customer_success: "Customer Success", disputes: "Disputes", billing: "Billing", privacy: "Privacy", founders_cs: "Founders + CS", support: "Support" };
const SIDE = { creator: "Creator", brand: "Brand", integrator: "Developer", any: "Any" };

// ---------------- tabs ----------------
const tabs = [...document.querySelectorAll("[role=tab]")];
function showTab(id) {
  for (const t of tabs) {
    const on = t.dataset.tab === id;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    $(`#panel-${t.dataset.tab}`).hidden = !on;
  }
  try { localStorage.setItem("tz-tab", id); } catch {}
}
tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
document.querySelector("[role=tablist]").addEventListener("keydown", (e) => {
  const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    showTab(n.dataset.tab); n.focus();
  }
});
const hashTab = location.hash.replace("#", "");
let saved = null; try { saved = localStorage.getItem("tz-tab"); } catch {}
showTab(tabs.some((t) => t.dataset.tab === hashTab) ? hashTab : saved && tabs.some((t) => t.dataset.tab === saved) ? saved : "desk");

// ---------------- ticket desk ----------------
const FEATURED = ["d01", "d02", "d06", "d09", "e03", "d14", "h07", "d16", "d18", "b15", "d23", "d27", "d26", "c03"];
let showAll = false;
let filter = "all";
let current = TICKETS.find((t) => t.id === "d09");

function sideOf(t) { return INTENTS[t.gold.intent]?.side || "any"; }

function renderList() {
  const list = $("#ticket-list");
  const pool = (showAll ? TICKETS : FEATURED.map((id) => TICKETS.find((t) => t.id === id))).filter((t) => filter === "all" || sideOf(t) === filter);
  list.innerHTML = pool.map((t) => `
    <li><button class="ticket ${t.id === current?.id ? "is-active" : ""}" data-id="${t.id}">
      <span class="ticket-meta"><span class="who">${esc(t.state.user?.name || "")}</span><span class="side side-${sideOf(t)}">${SIDE[sideOf(t)]}</span><span class="tid">${t.id}</span></span>
      <span class="ticket-text">${esc(t.text)}</span>
    </button></li>`).join("");
  $("#list-count").textContent = `${pool.length} of ${TICKETS.length}`;
  $("#toggle-all").textContent = showAll ? "Show featured" : `Show all ${TICKETS.length}`;
}
$("#ticket-list").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  current = TICKETS.find((t) => t.id === b.dataset.id);
  loadTicket(current);
  renderList();
  run();
  if (window.matchMedia("(max-width: 860px)").matches) $("#workbench").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#toggle-all").addEventListener("click", () => { showAll = !showAll; renderList(); });
document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
  filter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  renderList();
}));

function loadTicket(t) {
  $("#ticket-text").value = t.text;
  const st = { ...t.state };
  delete st.sig;
  $("#state-json").value = JSON.stringify(st, null, 2);
  $("#state-error").hidden = true;
}

async function run() {
  let state;
  try {
    state = JSON.parse($("#state-json").value || "{}");
    $("#state-error").hidden = true;
  } catch (e) {
    $("#state-error").hidden = false;
    $("#state-error").textContent = `Account data isn't valid JSON: ${e.message}`;
    return;
  }
  // Signature tickets carry a fixture; recompute the check so the trace is real.
  if (current?.state?.sig && !state.signatureCheck) state.signatureCheck = (await prepareState(current)).signatureCheck;
  const out = handleTicket($("#ticket-text").value, { now: NOW, ...state });
  renderOutput(out);
}
$("#run").addEventListener("click", run);
$("#ticket-text").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); });

function renderOutput(o) {
  const auto = o.decision === "auto";
  const conf = Math.round((o.confidence || 0) * 100);
  const why = o.guardrail?.length ? `<p class="guard"><strong>Held for a person:</strong> ${esc(o.guardrail.join("; "))}.</p>` : "";
  $("#output").innerHTML = `
    <div class="verdict ${auto ? "is-auto" : "is-human"}">
      <div>
        <p class="eyebrow">${esc(o.label)}${o.tier === "vocabulary" ? " · suggested" : ""}</p>
        <p class="verdict-title">${auto ? "Resolved by the agent" : `Routed to ${esc(QUEUE[o.queue] || o.queue)}`}${!auto && o.priority && o.priority !== "normal" ? ` <span class="prio prio-${o.priority}">${o.priority}</span>` : ""}</p>
      </div>
      <div class="conf" title="Classifier confidence. Below ${AUTO_THRESHOLD * 100}% the agent never answers alone.">
        <span class="conf-num">${conf}%</span>
        <span class="conf-bar"><span style="width:${conf}%"></span><i style="left:${AUTO_THRESHOLD * 100}%"></i></span>
        <span class="conf-lbl">confidence</span>
      </div>
    </div>
    ${why}
    <section class="block">
      <h3>What it checked</h3>
      ${o.checks?.length ? `<ol class="trace">${o.checks.map((c) => `<li><code>${esc(c.tool)}</code><span>${esc(c.result)}</span></li>`).join("")}</ol>` : `<p class="muted">No account lookups for this intent.</p>`}
    </section>
    <section class="block">
      <h3>Diagnosis <code class="rc">${esc(o.rootCause)}</code></h3>
      <p>${esc(o.summary)}</p>
    </section>
    <section class="block reply">
      <div class="reply-head"><h3>${auto ? "Reply sent to the customer" : "Draft for the person who takes it"}</h3><button class="btn-quiet" id="copy-reply">Copy</button></div>
      <pre id="reply-text">${esc(o.reply)}</pre>
    </section>
    ${o.internalNote ? `<section class="block"><h3>Internal note</h3><p class="note">${esc(o.internalNote)}</p></section>` : ""}
    ${o.productFix ? `<section class="block fix"><h3>Remove this ticket for good</h3><p>${esc(o.productFix)}</p></section>` : ""}
    ${o.sources?.length ? `<section class="block"><h3>Grounded in</h3><ul class="sources">${o.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>` : ""}`;
  $("#copy-reply").addEventListener("click", async (e) => {
    const txt = $("#reply-text").textContent;
    try { await navigator.clipboard.writeText(txt); e.target.textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents($("#reply-text")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.target.textContent = "Selected"; }
    setTimeout(() => (e.target.textContent = "Copy"), 1600);
  });
}

// ---------------- webhook debugger ----------------
const TS = "1760259600";
async function loadSigExample(kind) {
  $("#wh-secret").value = SECRET;
  $("#wh-ts").value = TS;
  $("#wh-body").value = PRETTY_BODY;
  const enc = new TextEncoder();
  const hmac = async (k, m) => { const key = await crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(m)))].map((b) => b.toString(16).padStart(2, "0")).join(""); };
  const sig = kind === "ok" ? await signPayload(SECRET, TS, PRETTY_BODY)
    : kind === "reserialized" ? await hmac(SECRET, `${TS}.${JSON.stringify(JSON.parse(PRETTY_BODY))}`)
    : kind === "prefix" ? await hmac(SECRET.slice(6), `${TS}.${PRETTY_BODY}`)
    : await hmac(SECRET, PRETTY_BODY);
  $("#wh-sig").value = sig;
  verifyNow();
}
async function verifyNow() {
  const r = await verifyWebhook({ secret: $("#wh-secret").value, timestamp: $("#wh-ts").value, rawBody: $("#wh-body").value, signature: $("#wh-sig").value });
  $("#wh-result").className = `result ${r.valid ? "is-ok" : "is-bad"}`;
  $("#wh-result").innerHTML = `<p class="result-title">${r.valid ? "Signature matches what SideShift sends" : r.matchedVariant ? `Found the bug: ${esc(r.matchedVariant.replace(/-/g, " "))}` : "Signature does not match"}</p>${r.reasons.length ? `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
}
document.querySelectorAll("[data-sig]").forEach((b) => b.addEventListener("click", () => loadSigExample(b.dataset.sig)));
$("#wh-verify").addEventListener("click", verifyNow);

const SAMPLE_LOGS = { data: [
  { id: "log_31", eventId: "evt_9f2", eventType: "withdrawal.completed", success: false, statusCode: 503, error: "Service Unavailable", attemptNumber: 1, createdAt: "2026-10-13T10:00:00Z" },
  { id: "log_32", eventId: "evt_9f2", eventType: "withdrawal.completed", success: false, statusCode: 503, error: "Service Unavailable", attemptNumber: 2, createdAt: "2026-10-13T10:00:01Z" },
  { id: "log_33", eventId: "evt_9f2", eventType: "withdrawal.completed", success: false, statusCode: 503, error: "Service Unavailable", attemptNumber: 3, createdAt: "2026-10-13T10:00:03Z" },
  { id: "log_34", eventId: "evt_a10", eventType: "deposit.confirmed", success: false, statusCode: 500, attemptNumber: 1, createdAt: "2026-10-13T11:00:00Z" },
  { id: "log_35", eventId: "evt_a10", eventType: "deposit.confirmed", success: true, statusCode: 200, attemptNumber: 2, createdAt: "2026-10-13T11:00:01Z" },
  { id: "log_36", eventId: "evt_b44", eventType: "transfer.completed", success: false, statusCode: 401, error: "invalid signature", attemptNumber: 1, createdAt: "2026-10-13T12:00:00Z" },
  { id: "log_37", eventId: "evt_c08", eventType: "withdrawal.updated", success: true, statusCode: 200, attemptNumber: 1, createdAt: "2026-10-13T12:10:00Z" },
  { id: "log_38", eventId: "evt_c08", eventType: "withdrawal.updated", success: true, statusCode: 200, attemptNumber: 1, createdAt: "2026-10-13T14:00:00Z" },
] };
$("#logs").value = JSON.stringify(SAMPLE_LOGS, null, 2);
function triageNow() {
  let data;
  try { data = JSON.parse($("#logs").value); } catch (e) { $("#logs-result").innerHTML = `<p class="err">That isn't valid JSON: ${esc(e.message)}. Paste the response body of GET /api/embed/webhook-logs.</p>`; return; }
  const t = triageWebhookLogs(data);
  $("#logs-result").innerHTML = `
    <dl class="kv">
      <div><dt>Events</dt><dd>${t.events}</dd></div>
      <div><dt>Never delivered</dt><dd class="${t.lost.length ? "bad" : ""}">${t.lost.length}</dd></div>
      <div><dt>Recovered by retry</dt><dd>${t.recoveredAfterRetry}</dd></div>
      <div><dt>Delivered twice</dt><dd>${t.duplicates.length}</dd></div>
    </dl>
    <ul class="findings">${t.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    ${t.lost.length ? `<h4>Replay the lost events</h4><pre class="cmd">${esc(t.replayCommands.join("\n"))}</pre>` : ""}`;
}
$("#logs-run").addEventListener("click", triageNow);

// ---------------- evals ----------------
const LABEL = { dev: "Written with the rules", round1: "Round 1", round2: "Round 2", round3: "Round 3", all: "All tickets" };
async function renderEvals() {
  const { summary } = await runEvals();
  const all = summary.find((s) => s.split === "all");
  $("#stat-tickets").textContent = all.n;
  $("#stat-unsafe").textContent = summary.reduce((m, s) => Math.max(m, s.unsafeAutoResolutions), 0);
  $("#stat-auto").textContent = all.autoResolved;
  $("#eval-table tbody").innerHTML = summary.map((s) => `<tr class="${s.split === "all" ? "total" : ""}"><th scope="row">${LABEL[s.split]}</th><td>${s.n}</td><td>${pct(s.intentAccuracy)}</td><td>${pct(s.decisionAccuracy)}</td><td>${s.autoResolved}</td><td>${pct(s.autoPrecision)}</td><td class="${s.unsafeAutoResolutions ? "bad" : "good"}">${s.unsafeAutoResolutions}</td></tr>`).join("");
  const hist = [["v1.0", "Round 1", h10], ["v1.1", "Round 2", h11], ["v1.2", "Round 3", h12]];
  $("#history").innerHTML = hist.map(([v, r, h]) => { const s = h.summary[0]; return `
    <li>
      <div class="hist-head"><span class="ver">${v}</span><span>${r}: ${s.n} new tickets, written after ${v} was frozen</span></div>
      <div class="hist-bars">
        <div><span class="hb-lbl">Routed to the right intent</span><span class="hb"><span style="width:${s.intentAccuracy * 100}%"></span></span><span class="hb-num">${pct(s.intentAccuracy)}</span></div>
        <div><span class="hb-lbl">Auto-replies that were right</span><span class="hb"><span style="width:${s.autoPrecision * 100}%"></span></span><span class="hb-num">${pct(s.autoPrecision)}</span></div>
      </div>
      <p class="hist-note">${h.misses.length} misses went to a person instead of getting a wrong answer. Each one became a rule or test for the next version.</p>
    </li>`; }).join("");
}

// ---------------- patterns ----------------
function renderPatterns() {
  const counts = themeCounts();
  const max = counts[0][1];
  $("#themes").innerHTML = counts.map(([k, n]) => {
    const quotes = REVIEWS.filter((r) => r.theme === k || r.alsoTheme === k).slice(0, 2);
    return `<li class="theme">
      <div class="theme-head"><span class="theme-n">${n}</span><span class="theme-bar"><span style="width:${(n / max) * 100}%"></span></span><h3>${esc(THEMES[k].label)}</h3></div>
      <div class="theme-body">
        <p class="quotes">${quotes.map((q) => `“${esc(q.quote)}”`).join(" · ")}</p>
        <p><strong>Fix:</strong> ${esc(THEMES[k].fix)}</p>
        ${THEMES[k].intents.length && THEMES[k].intents[0] !== "every intent" ? `<p class="muted small">Handled today by: ${THEMES[k].intents.map((i) => `<code>${i}</code>`).join(" ")}</p>` : ""}
      </div></li>`;
  }).join("");
}

// ---------------- boot ----------------
renderList();
loadTicket(current);
run();
renderEvals();
renderPatterns();
loadSigExample("reserialized");
triageNow();
