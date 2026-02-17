// ✅ firebase.js (FULL COPY-PASTE — ANDROID/PWA AUTH PERSISTENCE HARD FIX)

import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  CACHE_SIZE_UNLIMITED,
  initializeFirestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCcWaFmHj10rbJXDmOD-IBCzX6pGQAbtUQ",
  authDomain: "majuu-app.firebaseapp.com",
  projectId: "majuu-app",
  storageBucket: "majuu-app.firebasestorage.app",
  messagingSenderId: "7815638736",
  appId: "1:7815638736:web:3cda5edc7add402454f8d5",
};

const app = initializeApp(firebaseConfig);

/**
 * ✅ AUTH (CRITICAL)
 * Force persistence order:
 * 1) indexedDB (best for Android/PWA/Capacitor)
 * 2) localStorage fallback
 *
 * This prevents “random logout” / “session forgotten” behavior.
 */
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

/**
 * ✅ FIRESTORE
 * Use initializeFirestore so we can safely set cache settings.
 * (Still works like getFirestore, just more controlled.)
 */
export const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED,
});

// ✅ Offline-friendly Firestore persistence (IndexedDB)
enableIndexedDbPersistence(db).catch((err) => {
  // failed-precondition: multiple tabs open
  // unimplemented: browser doesn't support persistence
  console.warn("Firestore persistence not enabled:", err?.code || err);
});

// Google provider (export it)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });