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
const WINDOW = 3;        // cards shown each side of the front one
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

const LOGO_SVG = `<svg viewBox="0 0 48 40" width="40" height="34" aria-hidden="true">
  <rect x="3" y="12" width="42" height="22" rx="7" fill="#6ACBE5" stroke="#111" stroke-width="2.5"/>
  <line x1="12" y1="18" x2="36" y2="18" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="12" y1="24" x2="30" y2="24" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

// ---------- Contact helpers ----------
const lastName = c => (c.fullName || "").trim().split(/\s+/).slice(-1)[0] || "";
const initialsOf = name => (name || "").split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
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
let items = [];            // [{type:'divider'|'contact', letter, data?}]
let itemEls = [];
let N = 0;
let presentLetters = new Set();
const byId = {};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const alphaRail = document.getElementById("alphaRail");
const railEls = {};

function buildCardEl(it) {
  const el = document.createElement("article");
  if (it.type === "home") {
    el.className = "card home";
    el.innerHTML = `
      <div class="face front home-front">
        <div class="home-greeting">${pickGreeting()}</div>
        <div class="home-search">
          <span class="home-search-ico" aria-hidden="true">⌕</span>
          <input class="home-search-input" type="text" placeholder="Search contacts…" aria-label="Search contacts" />
        </div>
        <div class="home-time">${nowTime()}</div>
      </div>
      <div class="face back"><div class="back-badge">${LOGO_SVG}</div></div>`;
    // keep taps on the search field from spinning / opening the drum
    const si = el.querySelector(".home-search-input");
    ["pointerdown", "pointerup", "click"].forEach(t => si.addEventListener(t, e => e.stopPropagation()));
    return el;
  }
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
    el.style.setProperty("--card-accent", c.accent || "#6ACBE5");
    el.innerHTML = `
      <div class="face front">
        <span class="accent"></span>
        <div class="card-head">
          <div class="avatar">${initialsOf(c.fullName)}</div>
          <div class="who">
            <div class="name">${c.fullName || ""}</div>
            <div class="title">${cardSubtitle(c)}</div>
          </div>
        </div>
        <div class="card-body">
          ${c.phone ? `<div class="row"><span class="ico">✆</span><span class="val">${c.phone}</span></div>` : ""}
          ${c.email ? `<div class="row"><span class="ico">✉</span><span class="val">${c.email}</span></div>` : ""}
        </div>
        ${c.tag ? `<span class="card-tag">${c.tag}</span>` : ""}
      </div>
      <div class="face back"><div class="back-badge">${LOGO_SVG}</div></div>`;
  }
  return el;
}

function buildReel(contacts) {
  const sorted = [...contacts].sort((a, b) =>
    lastName(a).localeCompare(lastName(b)) || (a.fullName || "").localeCompare(b.fullName || ""));
  items = [];
  Object.keys(byId).forEach(k => delete byId[k]);
  let prev = null;
  for (const c of sorted) {
    byId[c.id] = c;
    const L = (lastName(c)[0] || "#").toUpperCase();
    if (L !== prev) { items.push({ type: "divider", letter: L }); prev = L; }
    items.push({ type: "contact", letter: L, data: c });
  }
  items.unshift({ type: "home" });   // greeting + search + clock, first on the drum
  N = items.length;
  presentLetters = new Set(items.filter(it => it.type === "divider").map(it => it.letter));
  ring.innerHTML = "";
  itemEls = items.map(it => { const el = buildCardEl(it); ring.appendChild(el); return el; });
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

const norm = a => { a %= 360; if (a > 180) a -= 360; if (a < -180) a += 360; return a; };

function render() {
  if (N === 0) return;
  const w = Math.min(WINDOW, Math.floor((N - 1) / 2));
  const cur = Math.round(-angle / ANGLE_STEP);
  itemEls.forEach(el => { el.style.display = "none"; });
  for (let o = -w; o <= w; o++) {
    const gi = cur + o;
    const idx = ((gi % N) + N) % N;
    const el = itemEls[idx];
    const raw = gi * ANGLE_STEP + angle;
    const pos = shape(raw);
    const eff = Math.abs(pos);
    el.style.display = "";
    el.style.transform = `rotateX(${pos}deg) translateY(${-HUB}px)`;
    el.style.setProperty("--shade", (Math.min(eff, 150) / 150 * 0.5).toFixed(3));
    el.style.zIndex = String(Math.round(400 - eff));
    el.style.pointerEvents = Math.abs(raw) < 20 ? "auto" : "none";
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
const DRAG_SENS = 0.4;

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
  angle += e.deltaY * 0.22;
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

// ---------- Public app API (used by detail.js) ----------
async function refresh(focusId) {
  const contacts = await window.Store.list();
  buildReel(contacts);
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
let lastTod = null;
function tick() {
  const tod = timeOfDay(new Date().getHours());
  if (tod !== lastTod) {
    lastTod = tod;
    document.body.dataset.tod = tod;
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
