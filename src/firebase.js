// ✅ firebase.js (FULL COPY-PASTE — PWA/Android auth persistence hard fix)

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  initializeFirestore,
  enableIndexedDbPersistence,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCcWaFmHj10rbJXDmOD-IBCzX6pGQAbtUQ",
  authDomain: "majuu-app.firebaseapp.com",
  projectId: "majuu-app",
  storageBucket: "majuu-app.firebasestorage.app",
  messagingSenderId: "7815638736",
  appId: "1:7815638736:web:3cda5edc7add402454f8d5",
};

// ✅ Prevent duplicate init (Vite/HMR safe)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * ✅ AUTH (CRITICAL)
 * Use web-safe auth init + explicit persistence with fallback:
 * 1) IndexedDB (best for PWA/Android)
 * 2) localStorage fallback
 */
export const auth = getAuth(app);

// Optional: export a promise you can await in gates if you want later
export const authPersistenceReady = (async () => {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch (e1) {
    console.warn("Auth IndexedDB persistence failed, falling back:", e1?.code || e1);
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e2) {
      console.warn("Auth localStorage persistence also failed:", e2?.code || e2);
      // If both fail, Firebase will fall back internally (usually in-memory/session).
    }
  }
})();

/**
 * ✅ FIRESTORE
 * Keep controlled init + unlimited cache.
 */
export const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED,
});

export const storage = getStorage(app);

// ✅ Offline-friendly Firestore persistence (IndexedDB)
enableIndexedDbPersistence(db).catch((err) => {
  // failed-precondition: multiple tabs open
  // unimplemented: browser doesn't support persistence
  console.warn("Firestore persistence not enabled:", err?.code || err);
});

// Google provider (export it)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
