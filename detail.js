// ---------------------------------------------------------------------------
// Person view: the full-screen card that expands out of the rolodex, plus the
// add / edit / delete flows. All persistence goes through window.Store.
// ---------------------------------------------------------------------------

(() => {
// Field definitions drive both the read view and the edit form.
const FIELDS = [
  { key: "lastContacted", label: "Last contacted", type: "date" },
  { key: "birthday", label: "Birthday", type: "date" },
  { key: "country", label: "Country", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "preferredChannel", label: "Preferred channel", type: "text" },
  { key: "relationship", label: "Relationship", type: "select", options: ["Business", "Friends", "Other"] },
  { key: "company", label: "Company", type: "text", businessOnly: true },
  { key: "jobRole", label: "Job role", type: "text", businessOnly: true },
  { key: "likes", label: "Likes", type: "textarea" },
  { key: "dislikes", label: "Dislikes", type: "textarea" },
];
const LONG = new Set(["likes", "dislikes"]);
// CARD_ACCENTS, DEFAULT_ACCENT and paletteAccent() come from script.js (loaded first)
const ACCENTS = CARD_ACCENTS;

// Fields (in save order) exposed to the AI import/bulk-update round trip, with a
// short human description so the AI knows what each key means.
const AI_FIELDS = [
  ["fullName", "Full name"],
  ["lastContacted", "Date we last spoke (YYYY-MM-DD)"],
  ["birthday", "Birthday (YYYY-MM-DD)"],
  ["country", "Country they're based in"],
  ["city", "City they're based in"],
  ["phone", "Phone number"],
  ["email", "Email address"],
  ["preferredChannel", "How they like to be contacted (Email, Phone, Slack, …)"],
  ["relationship", "One of exactly: Business, Friends, Other"],
  ["company", "Company (only for Business contacts)"],
  ["jobRole", "Job title (only for Business contacts)"],
  ["likes", "Things they like / enjoy"],
  ["dislikes", "Things they dislike"],
  ["tag", "Short one-word label shown on their card"],
];
const AI_KEYS = AI_FIELDS.map(f => f[0]);

const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initialsOf = name => (name || "").split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
const isBusiness = c => c.relationship === "Business";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Show a birthday as "14 Nov 1990" — day, month in letters, year only if we have it.
function formatBirthday(v) {
  if (!v) return "";
  const s = String(v).trim();
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);   // YYYY-MM-DD
  if (full) {
    const mon = MONTHS[+full[2] - 1];
    if (mon) return `${+full[3]} ${mon}${full[1] === "0000" ? "" : ` ${full[1]}`}`;
  }
  const md = s.match(/(\d{2})-(\d{2})$/);              // MM-DD or --MM-DD (no year)
  if (md) { const mon = MONTHS[+md[1] - 1]; if (mon) return `${+md[2]} ${mon}`; }
  return s;
}
function subtitleOf(c) {
  if (isBusiness(c)) return [c.jobRole, c.company].filter(Boolean).join(" · ");
  return c.relationship || "";
}

// ---------- cards ----------
const cardId = () => "cd" + Math.random().toString(36).slice(2, 9);
// Normalise a contact coming in from storage: ensure a cards array, and fold any
// legacy free-text "generalInfo" into a card so nothing is lost.
function normalize(c) {
  const out = { ...c };
  out.cards = Array.isArray(out.cards)
    ? out.cards.map(cd => ({ id: cd.id || cardId(), title: cd.title || "", text: cd.text || "" }))
    : [];
  if (out.generalInfo && out.generalInfo.trim() && !out.cards.length) {
    out.cards.push({ id: cardId(), title: "General info", text: out.generalInfo.trim() });
  }
  delete out.generalInfo;
  return out;
}

// ---------- DOM scaffold (built once) ----------
const root = document.createElement("div");
root.className = "detail-root";
root.hidden = true;
root.innerHTML = `
  <div class="detail-scrim"></div>
  <article class="detail-panel" role="dialog" aria-modal="true">
    <button class="detail-x" aria-label="Close">✕</button>
    <header class="detail-header">
      <div class="detail-avatar"></div>
      <div class="detail-heading">
        <h2 class="detail-name"></h2>
        <div class="detail-sub"></div>
      </div>
    </header>
    <div class="detail-content"></div>
    <footer class="detail-actions"></footer>
  </article>
  <div class="confirm" hidden>
    <div class="confirm-box">
      <p class="confirm-msg">Are you sure you want to delete?</p>
      <div class="confirm-actions">
        <button class="btn btn-cancel">Cancel</button>
        <button class="btn btn-danger">Delete</button>
      </div>
    </div>
  </div>
  <div class="bulk" hidden>
    <div class="bulk-box">
      <h3 class="bulk-title">Bulk update</h3>
      <p class="bulk-hint">Paste the AI's output block below, then Apply to update this contact.</p>
      <textarea class="bulk-input" rows="9" placeholder="Paste the \`\`\`rolodex block the AI gave you…"></textarea>
      <p class="bulk-msg" hidden></p>
      <div class="bulk-actions">
        <button class="btn btn-cancel bulk-cancel">Cancel</button>
        <button class="btn btn-save bulk-apply">Apply</button>
      </div>
    </div>
  </div>`;
document.body.appendChild(root);

const scrim = root.querySelector(".detail-scrim");
const panel = root.querySelector(".detail-panel");
const closeX = root.querySelector(".detail-x");
const avatarEl = root.querySelector(".detail-avatar");
const nameEl = root.querySelector(".detail-name");
const subEl = root.querySelector(".detail-sub");
const contentEl = root.querySelector(".detail-content");
const actionsEl = root.querySelector(".detail-actions");
const confirmEl = root.querySelector(".confirm");
const bulkEl = root.querySelector(".bulk");
const bulkInput = bulkEl.querySelector(".bulk-input");
const bulkMsg = bulkEl.querySelector(".bulk-msg");

let current = null;       // contact being shown/edited
let mode = "view";        // 'view' | 'edit'
let sourceRect = null;    // where the panel animates from / back to

// ---------- geometry helpers ----------
function setRect(r) {
  panel.style.left = r.left + "px";
  panel.style.top = r.top + "px";
  panel.style.width = r.width + "px";
  panel.style.height = r.height + "px";
}
function openRect() {
  const m = Math.max(16, Math.min(40, window.innerWidth * 0.04));
  return { left: m, top: m, width: window.innerWidth - 2 * m, height: window.innerHeight - 2 * m };
}
function centerRect(w, h) {
  return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
}

// ---------- header ----------
function paintHeader(c) {
  const accent = paletteAccent(c.accent);
  avatarEl.textContent = initialsOf(c.fullName) || "＋";
  avatarEl.style.background = accent;
  avatarEl.style.color = inkOn(accent);
  nameEl.textContent = c.fullName || "New contact";
  subEl.textContent = subtitleOf(c);
  panel.style.setProperty("--card-accent", accent);
}

// ---------- cards drawer (read view) ----------
function cardsDrawerHtml() {
  const cards = current.cards || [];
  const drawers = cards.map(cd => `
    <div class="drawer" data-card-id="${cd.id}">
      <button class="drawer-head" type="button">
        <span class="drawer-caret" aria-hidden="true">▸</span>
        <span class="drawer-title">${esc(cd.title) || "Untitled card"}</span>
      </button>
      <div class="drawer-body"><p>${cd.text ? esc(cd.text) : "<em>Empty</em>"}</p></div>
    </div>`).join("");
  return `
    <section class="cards-section">
      <div class="cards-head">
        <h4>Cards</h4>
        <button class="cards-add" type="button" aria-label="Add card" title="Add card">＋</button>
      </div>
      <div class="drawers">${drawers || `<p class="cards-empty">No cards yet. Tap ＋ to add one.</p>`}</div>
    </section>`;
}

// ---------- read view ----------
function renderView() {
  mode = "view";
  paintHeader(current);
  const facts = FIELDS.filter(f => !LONG.has(f.key))
    .filter(f => current[f.key] && (!f.businessOnly || isBusiness(current)))
    .map(f => {
      const val = f.key === "birthday" ? formatBirthday(current[f.key]) : current[f.key];
      return `<div class="fact"><span class="fact-label">${f.label}</span><span class="fact-value">${esc(val)}</span></div>`;
    })
    .join("");
  const blocks = FIELDS.filter(f => LONG.has(f.key))
    .filter(f => current[f.key])
    .map(f => `<section class="block"><h4>${f.label}</h4><p>${esc(current[f.key])}</p></section>`)
    .join("");
  const aiBar = `
    <div class="ai-bar">
      <button class="btn btn-ai" data-ai="import">📋 Import to AI</button>
      <button class="btn btn-ai" data-ai="bulk">⤵ Bulk update</button>
    </div>`;
  contentEl.innerHTML = `${aiBar}${facts ? `<div class="facts">${facts}</div>` : ""}${blocks}${cardsDrawerHtml()}`;
  actionsEl.innerHTML = `
    <button class="btn btn-delete">Delete</button>
    <button class="btn btn-edit">Edit</button>`;
  actionsEl.querySelector(".btn-edit").addEventListener("click", () => renderEdit());
  actionsEl.querySelector(".btn-delete").addEventListener("click", askDelete);

  // AI actions
  contentEl.querySelector('[data-ai="import"]').addEventListener("click", () => copyPrompt("refresh"));
  contentEl.querySelector('[data-ai="bulk"]').addEventListener("click", openBulk);
  // cards: tap a drawer head to slide it open, ＋ to add one (via edit form)
  contentEl.querySelectorAll(".drawer-head").forEach(h =>
    h.addEventListener("click", () => h.parentElement.classList.toggle("open")));
  contentEl.querySelector(".cards-add").addEventListener("click", addCardFromView);
}

// ＋ in the read view: drop in a blank card and jump straight into edit on it.
function addCardFromView() {
  current.cards = current.cards || [];
  current.cards.push({ id: cardId(), title: "", text: "" });
  renderEdit();
  const last = contentEl.querySelector(".card-edit:last-of-type .card-edit-title");
  if (last) { last.focus(); last.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

// ---------- edit form ----------
function fieldInput(f, val) {
  if (f.type === "select") {
    const opts = f.options.map(o => `<option value="${o}" ${o === val ? "selected" : ""}>${o}</option>`).join("");
    return `<select data-key="${f.key}">${opts}</select>`;
  }
  if (f.type === "textarea") {
    return `<textarea data-key="${f.key}" rows="2">${esc(val)}</textarea>`;
  }
  return `<input data-key="${f.key}" type="${f.type}" value="${esc(val)}" />`;
}
function cardsEditHtml() {
  const rows = (current.cards || []).map(cd => `
    <div class="card-edit" data-card-id="${cd.id}">
      <button type="button" class="card-edit-del" aria-label="Delete card" title="Delete card">✕</button>
      <input class="card-edit-title" type="text" value="${esc(cd.title)}" placeholder="Card title" />
      <textarea class="card-edit-text" rows="2" placeholder="What do you want to remember?">${esc(cd.text)}</textarea>
    </div>`).join("");
  return `
    <div class="cards-edit">
      <div class="cards-head"><span>Cards</span>
        <button type="button" class="cards-add-btn">＋ Add card</button></div>
      <div class="card-edit-list">${rows}</div>
    </div>`;
}

function renderEdit() {
  mode = "edit";
  paintHeader(current);
  const swatches = ACCENTS.map(a =>
    `<button type="button" class="swatch ${a === paletteAccent(current.accent) ? "on" : ""}" data-accent="${a}" style="background:${a}"></button>`).join("");
  const rows = FIELDS.map(f => {
    const hide = f.businessOnly && !isBusiness(current);
    return `<label class="field field-${f.key}" ${hide ? "hidden" : ""}>
      <span>${f.label}</span>${fieldInput(f, current[f.key] || "")}</label>`;
  }).join("");
  const aiBar = !current.id ? `
      <div class="ai-bar">
        <button type="button" class="btn btn-ai" data-ai="interview">🪄 Create with AI</button>
        <button type="button" class="btn btn-ai" data-ai="bulk" hidden>⤵ Paste from AI</button>
      </div>` : "";
  contentEl.innerHTML = `
    <form class="detail-form" autocomplete="off">
      ${aiBar}
      <label class="field"><span>Full name</span>
        <input data-key="fullName" type="text" value="${esc(current.fullName || "")}" placeholder="Jane Doe" /></label>
      <div class="form-grid">${rows}</div>
      <label class="field"><span>Tag (card label)</span>
        <input data-key="tag" type="text" value="${esc(current.tag || "")}" placeholder="e.g. Design" /></label>
      <div class="field"><span>Card colour</span><div class="swatches">${swatches}</div></div>
      ${cardsEditHtml()}
    </form>`;
  actionsEl.innerHTML = `
    <button class="btn btn-cancel-edit">Cancel</button>
    <button class="btn btn-save">Save</button>`;

  // live: relationship toggles the business-only fields
  const relSel = contentEl.querySelector('select[data-key="relationship"]');
  relSel.addEventListener("change", () => {
    const biz = relSel.value === "Business";
    contentEl.querySelectorAll(".field-company, .field-jobRole").forEach(el => { el.hidden = !biz; });
  });
  // colour swatches
  contentEl.querySelectorAll(".swatch").forEach(sw => sw.addEventListener("click", () => {
    contentEl.querySelectorAll(".swatch").forEach(s => s.classList.remove("on"));
    sw.classList.add("on");
    current.accent = sw.dataset.accent;
    panel.style.setProperty("--card-accent", current.accent);
    avatarEl.style.background = current.accent;
  }));
  // AI interview / paste (only shown when adding a brand-new person).
  // "Paste from AI" only appears once you've copied the prompt with "Create with AI".
  const interviewBtn = contentEl.querySelector('[data-ai="interview"]');
  if (interviewBtn) {
    const pasteBtn = contentEl.querySelector('[data-ai="bulk"]');
    interviewBtn.addEventListener("click", () => {
      copyPrompt("interview", interviewBtn);
      pasteBtn.hidden = false;
    });
    pasteBtn.addEventListener("click", openBulk);
  }
  // cards: add / delete (preserving unsaved edits in the rest of the form)
  contentEl.querySelector(".cards-add-btn").addEventListener("click", () => {
    readEditIntoCurrent();
    current.cards.push({ id: cardId(), title: "", text: "" });
    renderEdit();
    const last = contentEl.querySelector(".card-edit:last-of-type .card-edit-title");
    if (last) { last.focus(); last.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });
  contentEl.querySelectorAll(".card-edit-del").forEach(btn => btn.addEventListener("click", () => {
    readEditIntoCurrent();
    const id = btn.closest(".card-edit").dataset.cardId;
    current.cards = current.cards.filter(cd => cd.id !== id);
    renderEdit();
  }));
  actionsEl.querySelector(".btn-save").addEventListener("click", save);
  actionsEl.querySelector(".btn-cancel-edit").addEventListener("click", () => {
    if (current.id) { current = normalize(current); renderView(); } // existing → back to view (drop unsaved)
    else close();                                                    // brand-new → close
  });
}

// Read the visible card editors back into current.cards (used before re-rendering
// the edit form so add/delete never drops what's already typed).
function readCardInputs() {
  return [...contentEl.querySelectorAll(".card-edit")].map(row => ({
    id: row.dataset.cardId,
    title: row.querySelector(".card-edit-title").value,
    text: row.querySelector(".card-edit-text").value,
  }));
}
function readEditIntoCurrent() {
  contentEl.querySelectorAll("[data-key]").forEach(el => { current[el.dataset.key] = el.value; });
  current.cards = readCardInputs();
}

function collect() {
  const data = { ...current };
  contentEl.querySelectorAll("[data-key]").forEach(el => { data[el.dataset.key] = el.value.trim(); });
  data.cards = readCardInputs()
    .map(cd => ({ id: cd.id, title: cd.title.trim(), text: cd.text.trim() }))
    .filter(cd => cd.title || cd.text);
  if (data.relationship !== "Business") { data.company = ""; data.jobRole = ""; }
  delete data.generalInfo;
  return data;
}

async function save() {
  const data = collect();
  if (!data.fullName) { alert("Please enter a full name."); return; }
  const saved = data.id ? await window.Store.update(data.id, data) : await window.Store.add(data);
  current = normalize(saved);
  await window.RolodexApp.refresh(saved.id);
  renderView();
}

// ---------- delete + confirm ----------
function askDelete() { confirmEl.hidden = false; }
function hideConfirm() { confirmEl.hidden = true; }
confirmEl.querySelector(".btn-cancel").addEventListener("click", hideConfirm);
confirmEl.querySelector(".btn-danger").addEventListener("click", async () => {
  hideConfirm();
  const id = current && current.id;
  if (id) { await window.Store.remove(id); await window.RolodexApp.refresh(); }
  close();
});

// ---------- AI import / bulk update ----------
// The machine-readable payload: exactly the keys the AI is allowed to send back.
function contactPayload(c) {
  const out = {};
  AI_KEYS.forEach(k => { out[k] = c[k] || ""; });
  out.cards = (c.cards || []).map(cd => ({ title: cd.title || "", text: cd.text || "" }));
  return out;
}

function emptyPayload() {
  const out = {};
  AI_KEYS.forEach(k => { out[k] = ""; });
  out.cards = [];
  return out;
}
function fieldGuide() {
  return AI_FIELDS.map(([k, d]) => `- ${k}: ${d}`).join("\n") +
    `\n- cards: a list of little note cards, each { "title": "…", "text": "…" } — use these for anything memorable that isn't one of the plain fields`;
}

// Prompt for ADDING a new person: the AI interviews you, then hands back JSON.
function buildInterviewPrompt() {
  const template = JSON.stringify(emptyPayload(), null, 2);
  return `You are helping me add a NEW person to my personal contacts app, Rolodex.

STEP 1 — Interview me. Ask me about this new person a few questions at a time, in a natural, friendly way: who they are, how we know each other, where they're based, how best to reach them, what they're like, and anything worth remembering. Keep it conversational. Do NOT mention JSON, fields, keys, or anything technical while we talk.

STEP 2 — Keep asking until I tell you I don't know anything more / that's all.

STEP 3 — Only then, output ONE directly-copyable code block containing everything I told you, in exactly the shape below (same keys). Leave anything I didn't mention as an empty string "". Put memorable notes into "cards". Fence it exactly like this and put nothing else inside the block:

\`\`\`rolodex
{ ...the person's data... }
\`\`\`

Field guide:
${fieldGuide()}

Empty template to fill in:
\`\`\`rolodex
${template}
\`\`\``;
}

function buildAIPrompt(c) {
  const guide = fieldGuide();
  const data = JSON.stringify(contactPayload(c), null, 2);
  return `You are my memory assistant for a personal contacts app called Rolodex.

Below is everything I currently have saved about ONE person, in the exact shape my app stores it.

STEP 1 — First, in plain, natural language, give me a quick refresher about this person so my memory of them comes right back: who they are, how we're connected, and anything worth remembering before I reach out. Keep it warm and human. Do NOT mention JSON, fields, keys, "output", or anything technical in this part. Write it in the language I'm talking to you in.

STEP 2 — Then stop and wait. I'll tell you what has changed or what to add about them.

STEP 3 — Once I've told you the updates, output ONE directly-copyable code block containing ONLY the person's data in exactly the same shape shown below (same keys, same format). Carry over every value I didn't change, apply my updates, and add new notes as extra entries in "cards". Fence it exactly like this and put nothing else inside the block:

\`\`\`rolodex
{ ...updated data... }
\`\`\`

Field guide:
${guide}

Current saved data for this person:
\`\`\`rolodex
${data}
\`\`\``;
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (_) {}
  document.body.removeChild(ta);
}
async function copyPrompt(kind, btn) {
  const text = kind === "interview" ? buildInterviewPrompt() : buildAIPrompt(current);
  try { await navigator.clipboard.writeText(text); }
  catch (_) { fallbackCopy(text); }
  const b = btn || contentEl.querySelector('[data-ai="import"]');
  if (b) {
    const prev = b.textContent;
    b.textContent = "✓ Copied — paste into your AI";
    b.classList.add("ok");
    setTimeout(() => { b.textContent = prev; b.classList.remove("ok"); }, 1900);
  }
}

// Pull the JSON payload back out of whatever the AI (and the user) pasted.
function extractPayload(raw) {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:rolodex|json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== "{") {
    const i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  try { const o = JSON.parse(s); return o && typeof o === "object" ? o : null; }
  catch (_) { return null; }
}

function showBulkMsg(text, isError) {
  bulkMsg.textContent = text;
  bulkMsg.hidden = false;
  bulkMsg.classList.toggle("err", !!isError);
}
function openBulk() {
  bulkInput.value = "";
  bulkMsg.hidden = true;
  bulkEl.hidden = false;
  bulkInput.focus();
}
function closeBulk() { bulkEl.hidden = true; }

async function applyBulk() {
  const payload = extractPayload(bulkInput.value);
  if (!payload) { showBulkMsg("Couldn't find a valid update block in that paste.", true); return; }
  const data = { ...current };
  let changed = 0;
  AI_KEYS.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(payload, k) && payload[k] != null) {
      data[k] = String(payload[k]).trim(); changed++;
    }
  });
  if (Array.isArray(payload.cards)) {
    data.cards = payload.cards
      .filter(c => c && (c.title || c.text))
      .map(c => ({ id: cardId(), title: String(c.title || "").trim(), text: String(c.text || "").trim() }));
    changed++;
  }
  if (!changed) { showBulkMsg("That block had no recognisable fields to update.", true); return; }
  if (data.relationship !== "Business") { data.company = ""; data.jobRole = ""; }
  delete data.generalInfo;
  if (!data.fullName) { showBulkMsg("The update can't remove the full name.", true); return; }
  const saved = data.id ? await window.Store.update(data.id, data) : await window.Store.add(data);
  current = normalize(saved);
  await window.RolodexApp.refresh(saved.id);
  closeBulk();
  renderView();
}

bulkEl.querySelector(".bulk-cancel").addEventListener("click", closeBulk);
bulkEl.querySelector(".bulk-apply").addEventListener("click", applyBulk);
bulkEl.addEventListener("click", e => { if (e.target === bulkEl) closeBulk(); });

// ---------- open / close animation ----------
function afterExpand() { panel.classList.add("revealed"); }

function animateOpen() {
  root.hidden = false;
  scrim.classList.remove("show");
  panel.classList.remove("revealed");
  // start at the source rect with no transition...
  panel.style.transition = "none";
  setRect(sourceRect);
  void panel.offsetWidth;                 // commit the start rect
  panel.style.transition = "";            // ...restore the CSS transition
  void panel.offsetWidth;                 // ensure the transition prop is live
  // set the end rect in the same task — the reflow above guarantees it animates,
  // and the panel ends full-size even if timers/rAF are throttled.
  scrim.classList.add("show");
  setRect(openRect());
  setTimeout(afterExpand, 300);
}

function open(contact, sourceEl) {
  current = normalize(contact);
  sourceRect = sourceEl
    ? sourceEl.getBoundingClientRect()
    : centerRect(Math.min(320, window.innerWidth - 60), 220);
  renderView();
  animateOpen();
}

function openNew() {
  current = normalize({ relationship: "Business", accent: DEFAULT_ACCENT });
  sourceRect = centerRect(Math.min(320, window.innerWidth - 60), 240);
  renderEdit();
  animateOpen();
}

function close() {
  hideConfirm();
  panel.classList.remove("revealed");
  scrim.classList.remove("show");
  setRect(sourceRect || centerRect(280, 200));
  const done = () => { root.hidden = true; panel.removeEventListener("transitionend", done); };
  panel.addEventListener("transitionend", done);
  setTimeout(done, 520);
}

closeX.addEventListener("click", close);
scrim.addEventListener("click", close);
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && !root.hidden) {
    if (!confirmEl.hidden) hideConfirm();
    else if (!bulkEl.hidden) closeBulk();
    else close();
  }
});
window.addEventListener("resize", () => { if (!root.hidden && panel.classList.contains("revealed")) setRect(openRect()); });

// add button
const addBtn = document.getElementById("addBtn");
if (addBtn) addBtn.addEventListener("click", openNew);

window.Detail = { open, openNew };
})();
