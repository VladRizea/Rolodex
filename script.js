// ---------- Element refs ----------
const ring = document.getElementById("ring");
const rolodex = document.getElementById("rolodex");
const counter = document.getElementById("counter");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const stage = document.querySelector(".stage");

// ---------- Drum geometry ----------
const ANGLE_STEP = 44;   // degrees between neighbouring cards on the drum (bigger = more fan)
const READ_GAP = 90;     // degrees between the top (reading) card and the one just below it
// Cards shown each side of the front one. Mobile renders two fewer total (2 vs 3
// per side) to keep the 3D drum smooth on phones. Read live each frame so a
// rotate / resize always uses the right count.
const mqMobile = window.matchMedia("(max-width: 640px)");
const cardsPerSide = () => (mqMobile.matches ? 2 : 3);
const HUB = 46;          // radius of the central drum (must match --hub in CSS)
const EXTRA = READ_GAP - ANGLE_STEP;   // extra angle opened just below the front card

// Remap a card's raw angle so there's a big clear gap below the front card, while
// every other gap stays ANGLE_STEP.
function shape(pos) {
  if (pos >= 0) return pos;
  const t = Math.min(1, -pos / ANGLE_STEP);
  const ease = t * t * (3 - 2 * t);
  return pos - EXTRA * ease;
}

const LOGO_SVG = `<span class="logo-r" aria-hidden="true">R</span>`;

// ---------- Contact helpers ----------
const lastName = c => (c.fullName || "").trim().split(/\s+/).slice(-1)[0] || "";
const initialsOf = name => (name || "").split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
// Readable text colour (ink or bone) for a given accent background — the palette
// mixes light and dark accents, so avatar initials must adapt.
function inkOn(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#0a0908";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0a0908" : "#f3ece1";
}

// The only card colours the app uses. Any legacy/other accent is coerced into
// this palette so no old pastel ever shows.
const CARD_ACCENTS = ["#af9164", "#f7f3e3", "#b3b6b7", "#6f1a07", "#2b2118"];
const DEFAULT_ACCENT = "#af9164";
const LEGACY_ACCENT_MAP = {
  "#eb6f63": "#6f1a07", "#f2c14e": "#af9164", "#6acbe5": "#b3b6b7",
  "#7bc96f": "#af9164", "#b692e0": "#2b2118",
  "#0a0908": "#2b2118", "#22333b": "#b3b6b7", "#eae0d5": "#f7f3e3",
  "#c6ac8f": "#af9164", "#5e503f": "#2b2118",
};
function paletteAccent(a) {
  const u = (a || "").toLowerCase();
  if (CARD_ACCENTS.includes(u)) return u;
  return LEGACY_ACCENT_MAP[u] || DEFAULT_ACCENT;
}
// what the small card shows as the subtitle line
function cardSubtitle(c) {
  if (c.relationship === "Business") {
    return [c.jobRole, c.company].filter(Boolean).join(" · ");
  }
  return c.relationship || "";
}

// ---------- Home / greeting card ----------
const USER_NAME = "Vlad";
const GREETINGS = {
  dawn:  ["Good morning, {n}", "Rise and shine, {n}", "Early start, {n}?", "Morning, {n}", "The day's yours, {n}"],
  day:   ["Hello, {n}", "Good afternoon, {n}", "Hey there, {n}", "Good to see you, {n}", "Hi, {n}"],
  dusk:  ["Good evening, {n}", "Golden hour, {n}", "Winding down, {n}?", "Evening, {n}", "Easy now, {n}"],
  night: ["Good evening, {n}", "Working late, {n}?", "Burning the midnight oil, {n}?", "Still up, {n}?", "Good night, {n}"],
};
// dawn / day / dusk / night — drives both the greeting and the page's ambiance.
function timeOfDay(h) {
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}
function pickGreeting() {
  const list = GREETINGS[timeOfDay(new Date().getHours())];
  return list[Math.floor(Math.random() * list.length)].replace("{n}", USER_NAME);
}
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------- Reel state ----------
let allContacts = [];      // every contact, unfiltered (the search filters this)
let items = [];            // [{type:'home'|'contact', letter, data?}]
let itemEls = [];          // sparse cache: index -> built element (built lazily, reused)
const mounted = new Map(); // index -> element currently attached to the ring
let N = 0;
let presentLetters = new Set();
const byId = {};

// ---------- Search / fuzzy matching ----------
let searchQuery = "";       // raw text in the search box
let searchOpen = false;     // is the search card docked on top? (stays open even when text is empty)
const searchDock = document.getElementById("searchDock");

// Lower-case + strip diacritics, so "Nicolae" matches "nicolae" and "Ștefan" ≈ "stefan".
function fold(s) {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// How well a single query token matches one word. Higher = better; -Infinity = no match.
// Handles: exact, prefix ("Mar" → "Marius"), substring, and loose subsequence typos.
function scoreTokenWord(tok, word) {
  if (word === tok) return 100;
  if (word.startsWith(tok)) return 85;
  const idx = word.indexOf(tok);
  if (idx >= 0) return 62 - Math.min(idx, 20);
  // subsequence fuzzy: every char of tok appears in order somewhere in word
  let ti = 0;
  for (let wi = 0; wi < word.length && ti < tok.length; wi++) {
    if (word[wi] === tok[ti]) ti++;
  }
  if (ti === tok.length) return Math.max(8, 30 - (word.length - tok.length));
  return -Infinity;
}

// Score a contact against the query tokens. Every token must match SOMETHING
// (AND), so "Marius Nicolae" needs both names; returns -Infinity to exclude.
// Name fields are weighted above company/role/etc. so a name hit ranks first.
function contactScore(c, tokens) {
  const nameWords = fold(c.fullName).split(/\s+/).filter(Boolean);
  const extra = [c.company, c.jobRole, c.email, c.city, c.country, c.relationship, c.tag]
    .filter(Boolean).map(fold).join(" ");
  const extraWords = extra.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const tok of tokens) {
    let best = -Infinity;
    for (const w of nameWords)  best = Math.max(best, scoreTokenWord(tok, w) + 25);  // name bonus
    for (const w of extraWords) best = Math.max(best, scoreTokenWord(tok, w));
    if (best === -Infinity) return -Infinity;   // this token matched no field → drop contact
    total += best;
  }
  return total;
}

function searchResults(query) {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return allContacts
    .map(c => ({ c, s: contactScore(c, tokens) }))
    .filter(o => o.s > -Infinity)
    .sort((a, b) => b.s - a.s || lastName(a.c).localeCompare(lastName(b.c)))
    .map(o => o.c);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const alphaRail = document.getElementById("alphaRail");
const railEls = {};

// The home card (greeting + search + clock) is built ONCE and kept alive for the
// life of the page. It hops between the drum (index 0) and the search dock, but
// it's always the same element — so the search input never loses focus mid-type.
let homeEl = null;
function getHomeEl() {
  if (homeEl) return homeEl;
  homeEl = document.createElement("article");
  homeEl.className = "card home";
  homeEl.innerHTML = `
    <div class="face front home-front">
      <div class="home-greeting">${pickGreeting()}</div>
      <div class="home-search">
        <span class="home-search-ico" aria-hidden="true">⌕</span>
        <input class="home-search-input" type="text" placeholder="Search contacts…" aria-label="Search contacts" />
        <button type="button" class="home-search-clear" aria-label="Clear search" tabindex="-1">×</button>
      </div>
      <div class="home-time">${nowTime()}</div>
    </div>
    <div class="face back"><div class="back-badge">${LOGO_SVG}</div></div>`;
  const si = homeEl.querySelector(".home-search-input");
  // keep taps on the search field from spinning / opening the drum
  ["pointerdown", "pointerup", "click"].forEach(t => si.addEventListener(t, e => e.stopPropagation()));
  si.addEventListener("input", () => onSearchInput(si.value));
  si.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
  const clr = homeEl.querySelector(".home-search-clear");
  ["pointerdown", "pointerup", "click"].forEach(t => clr.addEventListener(t, e => e.stopPropagation()));
  // The × only clears the text — it does NOT dismiss search (the card stays docked).
  clr.addEventListener("click", (e) => { e.preventDefault(); clearSearchText(); });
  return homeEl;
}

function buildCardEl(it) {
  if (it.type === "home") return getHomeEl();
  const el = document.createElement("article");
  if (it.type === "divider") {
    el.className = "card divider";
    el.innerHTML = `
      <div class="face front">
        <span class="tab">${it.letter}</span>
        <span class="big">${it.letter}</span>
      </div>
      <div class="face back"><div class="back-badge">${LOGO_SVG}</div></div>`;
  } else {
    const c = it.data;
    el.className = "card";
    el.dataset.id = c.id;
    const accent = paletteAccent(c.accent);
    el.style.setProperty("--card-accent", accent);
    el.innerHTML = `
      <div class="face front">
        <span class="accent"></span>
        <div class="card-head">
          <div class="avatar" style="color:${inkOn(accent)}">${initialsOf(c.fullName)}</div>
          <div class="who">
            <div class="name">${c.fullName || ""}</div>
            <div class="title">${cardSubtitle(c)}</div>
          </div>
        </div>
        <div class="card-body">
          ${c.phone ? `<div class="row"><span class="ico">✆</span><span class="val">${c.phone}</span></div>` : ""}
          ${c.email ? `<div class="row"><span class="ico">✉</span><span class="val">${c.email}</span></div>` : ""}
        </div>
      </div>
      <div class="face back"><div class="back-badge">${LOGO_SVG}</div></div>`;
  }
  return el;
}

// Rebuild the reel from `allContacts`, honouring the current search. While
// searching, the home card leaves the drum (it's docked on top) and only the
// matching contacts remain — best match first. With no search it's the full,
// alphabetically-reversed run with the home card at index 0.
function buildReel() {
  const q = searchQuery.trim();
  let ordered;
  if (q) {
    ordered = searchResults(searchQuery);   // filtered + ranked, best match first
  } else {
    ordered = [...allContacts].sort((a, b) =>
      lastName(a).localeCompare(lastName(b)) || (a.fullName || "").localeCompare(b.fullName || ""));
    ordered.reverse();   // reversed running order, per request
  }
  items = [];
  Object.keys(byId).forEach(k => delete byId[k]);
  for (const c of ordered) {
    byId[c.id] = c;
    const L = (lastName(c)[0] || "#").toUpperCase();
    items.push({ type: "contact", letter: L, data: c });
  }
  // The home card only lives in the drum when search is closed; while it's docked
  // on top the drum is pure contacts (all of them when the box is empty).
  if (!searchOpen) items.unshift({ type: "home" });
  N = items.length;
  presentLetters = new Set(items.filter(it => it.type === "contact").map(it => it.letter));
  ring.innerHTML = "";   // detaches old contact cards; the docked home card is untouched
  itemEls = new Array(N);   // built lazily as cards scroll into view
  mounted.clear();
}

// Build (once) and attach the card for a given index. Cached elements are reused,
// so a card re-entering the window costs nothing but an appendChild.
function mountCard(idx) {
  let el = mounted.get(idx);
  if (el) return el;
  el = itemEls[idx] || (itemEls[idx] = buildCardEl(items[idx]));
  ring.appendChild(el);
  mounted.set(idx, el);
  return el;
}

function buildRail() {
  alphaRail.innerHTML = "";
  ALPHABET.forEach(L => {
    const has = presentLetters.has(L);
    const el = document.createElement(has ? "button" : "span");
    el.className = "alpha" + (has ? "" : " empty");
    el.textContent = L;
    if (has) el.addEventListener("click", () => jumpToLetter(L));
    alphaRail.appendChild(el);
    railEls[L] = el;
  });
}

// ---------- Drum state ----------
let angle = 0;
let velocity = 0;
let target = null;
let dragging = false;
let lastTop = null;   // front-slot index last seen, for the per-card haptic tick

const norm = a => { a %= 360; if (a > 180) a -= 360; if (a < -180) a += 360; return a; };

// A tiny buzz each time a new card reaches the top. Android Chrome only —
// iOS Safari has no Vibration API, so this is silently ignored on iPhone.
function buzzTick() {
  if (navigator.vibrate) navigator.vibrate(8);
}

function render() {
  if (N === 0) { counter.textContent = searchQuery.trim() ? "∅" : "·"; return; }
  const w = Math.min(cardsPerSide(), Math.floor((N - 1) / 2));
  const cur = Math.round(-angle / ANGLE_STEP);
  if (lastTop !== null && cur !== lastTop) buzzTick();   // a card just clicked into the top slot
  lastTop = cur;
  // Only the window's cards (front ± WINDOW, which already includes the next card
  // about to appear) are ever in the DOM. Everything else stays unmounted.
  const wanted = new Set();
  for (let o = -w; o <= w; o++) {
    const gi = cur + o;
    const idx = ((gi % N) + N) % N;
    wanted.add(idx);
    const el = mountCard(idx);
    const raw = gi * ANGLE_STEP + angle;
    const pos = shape(raw);
    const eff = Math.abs(pos);
    el.style.transform = `rotateX(${pos}deg) translateY(${-HUB}px)`;
    el.style.setProperty("--shade", (Math.min(eff, 150) / 150 * 0.5).toFixed(3));
    el.style.zIndex = String(Math.round(400 - eff));
    el.style.pointerEvents = Math.abs(raw) < 20 ? "auto" : "none";
  }
  // Retire cards that scrolled out of the window so they cost nothing to paint.
  for (const [idx, el] of mounted) {
    if (!wanted.has(idx)) { el.remove(); mounted.delete(idx); }
  }
  updateStatus();
}

function currentIndex() { return N ? (((Math.round(-angle / ANGLE_STEP) % N) + N) % N) : 0; }
function currentLetter() { return items[currentIndex()]?.letter || ""; }

function updateStatus() {
  const L = currentLetter();
  counter.textContent = L;
  ALPHABET.forEach(x => {
    if (!railEls[x]) return;
    railEls[x].classList.toggle("active", x === L);
    railEls[x].classList.toggle("passed", presentLetters.has(x) && x < L);
  });
}

function jumpToLetter(L) {
  const j = items.findIndex(it => it.letter === L);
  if (j >= 0) jumpToItem(j);
}

// Which present letter sits closest to a given screen-y — lets a drag over the
// rail (including the empty gaps between letters) resolve to the nearest jump.
function railLetterAt(y) {
  let best = null, bestDist = Infinity;
  for (const L of presentLetters) {
    const el = railEls[L];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - y);
    if (d < bestDist) { bestDist = d; best = L; }
  }
  return best;
}
function jumpToItem(j) {
  const cur = Math.round(-angle / ANGLE_STEP);
  let delta = ((j - (((cur % N) + N) % N)) % N + N) % N;
  if (delta > N / 2) delta -= N;
  velocity = 0;
  target = -(cur + delta) * ANGLE_STEP;
}

// ---------- Animation loop ----------
function loop() {
  if (!dragging) {
    if (target !== null) {
      const diff = target - angle;
      angle += diff * 0.18;
      if (Math.abs(diff) < 0.05) { angle = target; target = null; }
      render();
    } else if (Math.abs(velocity) > 0.02) {
      angle += velocity;
      velocity *= 0.94;
      if (Math.abs(velocity) <= 0.6) snapToNearest();
      render();
    }
  }
  requestAnimationFrame(loop);
}

function snapToNearest() {
  velocity = 0;
  target = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
}

// ---------- Input: drag (pointer = mouse + touch) ----------
let lastY = 0;
let downX = 0, downY = 0, moved = false, downTarget = null;
// Drag is inverted so it feels like grabbing a card and pulling it: drag down
// and the card you're holding follows down. Applies to both touch and mouse.
const DRAG_SENS = -0.4;

rolodex.addEventListener("pointerdown", (e) => {
  dragging = true;
  moved = false;
  target = null;
  velocity = 0;
  lastY = e.clientY;
  downX = e.clientX; downY = e.clientY;
  downTarget = e.target;          // the real element (pointer capture changes click's target)
  rolodex.setPointerCapture(e.pointerId);
});
rolodex.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dy = e.clientY - lastY;
  lastY = e.clientY;
  if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) moved = true;
  const delta = dy * DRAG_SENS;
  angle += delta;
  velocity = delta;
  render();
});
function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  try { rolodex.releasePointerCapture(e.pointerId); } catch (_) {}
  if (Math.abs(velocity) < 0.6) snapToNearest();
}
rolodex.addEventListener("pointerup", (e) => {
  const wasTap = !moved;
  endDrag(e);
  // tap (not a drag) on the front card opens the detail view
  if (wasTap && downTarget && window.Detail) {
    const card = downTarget.closest && downTarget.closest(".card");
    if (card && card.dataset.id) window.Detail.open(byId[card.dataset.id], card);
  }
});
rolodex.addEventListener("pointercancel", endDrag);

// ---------- Input: wheel ----------
let wheelTimer = null;
rolodex.addEventListener("wheel", (e) => {
  e.preventDefault();
  target = null;
  angle -= e.deltaY * 0.22;   // scroll down advances forward (A → Z), matching the buttons
  velocity = 0;
  render();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(snapToNearest, 120);
}, { passive: false });

// ---------- Input: drag-scroll over the alphabet rail ----------
// Press-and-drag over the letters spins the rolodex to whatever letter is under
// the finger — on top of the plain click-to-jump on each letter.
let railDragging = false;
let railLast = null;
function railJump(y) {
  const L = railLetterAt(y);
  if (L && L !== railLast) { railLast = L; jumpToLetter(L); }
}
alphaRail.addEventListener("pointerdown", (e) => {
  railDragging = true;
  railLast = null;
  try { alphaRail.setPointerCapture(e.pointerId); } catch (_) {}
  railJump(e.clientY);
  e.preventDefault();
});
alphaRail.addEventListener("pointermove", (e) => {
  if (railDragging) railJump(e.clientY);
});
function endRailDrag(e) {
  if (!railDragging) return;
  railDragging = false;
  railLast = null;
  try { alphaRail.releasePointerCapture(e.pointerId); } catch (_) {}
}
alphaRail.addEventListener("pointerup", endRailDrag);
alphaRail.addEventListener("pointercancel", endRailDrag);

// ---------- Input: buttons + keyboard ----------
function go(dir) {
  velocity = 0;
  const base = target !== null ? target : Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  target = base - dir * ANGLE_STEP;
}
prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));
rolodex.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") { go(-1); e.preventDefault(); }
  if (e.key === "ArrowDown") { go(1); e.preventDefault(); }
});

// ---------- Search: enter/leave search mode ----------
// Rebuild the reel for the current search state and place the home card either on
// the dock (open) or back in the drum (closed). `keepCaret` restores focus/caret
// after the reparent so typing never stutters.
function renderSearch(keepCaret) {
  const input = homeEl && homeEl.querySelector(".home-search-input");
  const caret = input ? [input.selectionStart, input.selectionEnd] : null;

  document.body.classList.toggle("searching", searchOpen);
  homeEl.classList.toggle("search-active", searchOpen);

  buildReel();
  buildRail();

  if (searchOpen) {
    // shed the inline transform / z-index / pointer-events render() left on the card
    homeEl.style.transform = "";
    homeEl.style.zIndex = "";
    homeEl.style.pointerEvents = "";
    homeEl.style.removeProperty("--shade");
    if (homeEl.parentElement !== searchDock) searchDock.appendChild(homeEl);   // lift onto the dock
  }
  // Always show the top of the reel — best match / first card sits in the reading slot.
  angle = 0; target = null; velocity = 0; lastTop = null;
  render();   // when closing, mountCard(0) reparents the home card back into the drum

  if (input && searchOpen && keepCaret) {
    input.focus();
    if (caret) { try { input.setSelectionRange(caret[0], caret[1]); } catch (_) {} }
  }
}

// Typing in the box: the first non-empty keystroke opens search; deleting all the
// text keeps it open (drum just shows every contact) until it's dismissed.
function onSearchInput(value) {
  searchQuery = value;
  if (value.trim()) searchOpen = true;
  renderSearch(true);
}

// The × button: wipe the text but stay in search mode.
function clearSearchText() {
  const input = homeEl.querySelector(".home-search-input");
  if (input) input.value = "";
  searchQuery = "";
  renderSearch(true);
  if (input) input.focus();
}

// Fully dismiss search: clear the box, send the home card back to the drum and
// park on it. Safe to call when search isn't open (just returns to the home card).
function closeSearch() {
  const input = homeEl.querySelector(".home-search-input");
  if (input) input.value = "";
  searchQuery = "";
  searchOpen = false;
  renderSearch(false);
  if (input) input.blur();   // let the mobile keyboard drop
}

// Clicking the brand (logo + "Rolodex") always resets search and returns to the
// default home card — whether or not search is currently open.
const brand = document.querySelector(".brand");
if (brand) {
  brand.style.cursor = "pointer";
  brand.addEventListener("click", closeSearch);
}

// Re-render when the viewport crosses the phone/desktop breakpoint so the drum
// sheds (or regains) its outer cards immediately.
mqMobile.addEventListener?.("change", () => render());

// ---------- Public app API (used by detail.js) ----------
async function refresh(focusId) {
  allContacts = await window.Store.list();
  buildReel();
  buildRail();
  if (focusId != null) {
    const j = items.findIndex(it => it.type === "contact" && it.data.id === focusId);
    if (j >= 0) { angle = -j * ANGLE_STEP; target = null; velocity = 0; }
  }
  render();
}
window.RolodexApp = {
  refresh,
  getContact: id => byId[id],
};

// ---------- Time of day: live clock + page ambiance ----------
// Paints the sky for the current period: a moon + stars at night, a sun (with
// light rays at the golden hours) otherwise. The gradient itself lives in CSS.
const sky = document.getElementById("sky");
function renderSky(tod) {
  if (!sky) return;
  sky.innerHTML = "";
  sky.dataset.tod = tod;

  if (tod === "night") {
    const moon = document.createElement("div");
    moon.className = "orb moon";
    sky.appendChild(moon);

    const frag = document.createDocumentFragment();
    const count = window.matchMedia("(max-width: 640px)").matches ? 32 : 60;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "star";
      const size = (Math.random() * 1.8 + 0.8).toFixed(2);
      s.style.left = (Math.random() * 100).toFixed(2) + "%";
      s.style.top = (Math.random() * 72).toFixed(2) + "%";
      s.style.width = s.style.height = size + "px";
      s.style.setProperty("--tw", (Math.random() * 3 + 2).toFixed(2) + "s");
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + "s";
      frag.appendChild(s);
    }
    sky.appendChild(frag);
    return;
  }

  const sun = document.createElement("div");
  sun.className = "orb sun";
  sky.appendChild(sun);
  if (tod === "dawn" || tod === "dusk") {
    const rays = document.createElement("div");
    rays.className = "rays";
    sky.appendChild(rays);
  }
}

let lastTod = null;
function tick() {
  const tod = timeOfDay(new Date().getHours());
  if (tod !== lastTod) {
    lastTod = tod;
    document.body.dataset.tod = tod;
    renderSky(tod);                          // repaint the sky for the new period
    const g = document.querySelector(".home-greeting");
    if (g) g.textContent = pickGreeting();   // refresh the line when the period turns over
  }
  const t = document.querySelector(".home-time");
  if (t) t.textContent = nowTime();
}
tick();
setInterval(tick, 15000);

// ---------- Go ----------
refresh().catch(err => {
  console.error("Failed to load contacts", err);
  counter.textContent = "!";
});
loop();
