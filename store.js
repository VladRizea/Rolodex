// ---------------------------------------------------------------------------
// Data access layer. This is the ONLY place that knows how contacts are stored.
// It now talks directly to Firebase Firestore (a free cloud NoSQL DB), so the
// app can be hosted as a plain static site with no backend server. The rest of
// the app only ever calls window.Store.{list,add,update,remove}.
//
// SETUP (one time): paste your Firebase web-app config into firebaseConfig
// below. See the deploy notes for exactly where to find these values.
// ---------------------------------------------------------------------------

const firebaseConfig = {

  apiKey: "AIzaSyB8jyYgbP8Pg6wH3SR1rnLs0uvAD1Prdzw",

  authDomain: "rolodex-87106.firebaseapp.com",

  projectId: "rolodex-87106",

  storageBucket: "rolodex-87106.firebasestorage.app",

  messagingSenderId: "849116729483",

  appId: "1:849116729483:web:9b9da41e434f284882c48e"

};



firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const contacts = () => db.collection("contacts");

// ---------------------------------------------------------------------------
// Password gate. There is a single account (yours); the UI only asks for a
// password, so the email is fixed here. Real security is enforced by the
// Firestore rules (allow ... if request.auth != null), not by this UI.
// ---------------------------------------------------------------------------
const ACCOUNT_EMAIL = "vlad.rizea.stefan@gmail.com";

let _authResolved;
const authReady = new Promise(resolve => { _authResolved = resolve; });

const gate = () => document.getElementById("authGate");
const errEl = () => document.getElementById("authError");
const btnEl = () => document.getElementById("authBtn");

function showGate() { const g = gate(); if (g) g.hidden = false; }
function hideGate() { const g = gate(); if (g) g.hidden = true; }

auth.onAuthStateChanged(user => {
  if (user) { hideGate(); _authResolved(); }
  else { showGate(); }
});

function wireGate() {
  const form = document.getElementById("authForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("authPassword").value;
    const err = errEl(), btn = btnEl();
    err.hidden = true;
    btn.disabled = true;
    try {
      await auth.signInWithEmailAndPassword(ACCOUNT_EMAIL, pw);
      // onAuthStateChanged hides the gate and unblocks the app.
    } catch (_) {
      err.textContent = "Wrong password. Try again.";
      err.hidden = false;
      document.getElementById("authPassword").select();
    } finally {
      btn.disabled = false;
    }
  });
}
wireGate();

// Firestore keeps the document id separate from the stored fields. We surface
// it as `id` so the rest of the app keeps working unchanged.
function withId(doc) {
  return { ...doc.data(), id: doc.id };
}

window.Store = {
  async list() {
    await authReady;                    // don't hit Firestore until logged in
    const snap = await contacts().get();
    return snap.docs.map(withId);
  },
  async add(contact) {
    const { id, ...data } = contact;          // let Firestore generate the id
    const ref = await contacts().add(data);
    return { ...contact, id: ref.id };
  },
  async update(id, contact) {
    const { id: _drop, ...data } = contact;
    await contacts().doc(id).set(data);
    return { ...contact, id };
  },
  async remove(id) {
    await contacts().doc(id).delete();
    return { ok: true, id };
  },

  // One-time helper: seed the DB from the bundled contacts.json.
  // Run once from the browser console:  await Store._seed()
  async _seed() {
    const seed = await fetch("contacts.json").then(r => r.json());
    for (const c of seed) {
      const { id, ...data } = c;
      await contacts().add(data);
    }
    console.log(`Seeded ${seed.length} contacts.`);
  },
};
