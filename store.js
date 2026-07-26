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
const contacts = () => db.collection("contacts");

// Firestore keeps the document id separate from the stored fields. We surface
// it as `id` so the rest of the app keeps working unchanged.
function withId(doc) {
  return { ...doc.data(), id: doc.id };
}

window.Store = {
  async list() {
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
