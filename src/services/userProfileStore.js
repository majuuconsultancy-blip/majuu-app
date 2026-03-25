import { useSyncExternalStore } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import { createDefaultUserProfile, normalizeUserProfile } from "../utils/userProfile";

const initialState = {
  ready: false,
  uid: "",
  email: "",
  data: null,
  profile: createDefaultUserProfile({}),
};

let state = initialState;
const listeners = new Set();
let started = false;
let AUTH_STOP = null;
let stopUserDoc = null;

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("userProfileStore listener failed:", error);
    }
  });
}

function setState(nextState) {
  state = nextState;
  emit();
}

function cleanupUserDoc() {
  if (typeof stopUserDoc === "function") {
    stopUserDoc();
    stopUserDoc = null;
  }
}

function startStore() {
  if (started) return;
  started = true;

  AUTH_STOP = onAuthStateChanged(auth, (user) => {
    cleanupUserDoc();

    if (!user) {
      setState({
        ...initialState,
        ready: true,
      });
      return;
    }

    setState({
      ready: false,
      uid: String(user.uid || ""),
      email: String(user.email || ""),
      data: null,
      profile: createDefaultUserProfile({}),
    });

    stopUserDoc = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        setState({
          ready: true,
          uid: String(user.uid || ""),
          email: String(user.email || ""),
          data,
          profile: normalizeUserProfile(data),
        });
      },
      (error) => {
        console.error("userProfileStore snapshot failed:", error);
        setState({
          ready: true,
          uid: String(user.uid || ""),
          email: String(user.email || ""),
          data: null,
          profile: createDefaultUserProfile({}),
        });
      }
    );
  });
}

function subscribe(listener) {
  startStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState() {
  startStore();
  return state;
}

export const userProfileStore = {
  subscribe,
  getState,
};

export function useUserProfileStore(selector = (snapshot) => snapshot) {
  return useSyncExternalStore(
    userProfileStore.subscribe,
    () => selector(userProfileStore.getState()),
    () => selector(userProfileStore.getState())
  );
}
