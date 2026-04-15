import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const DOC_ENGINE_MODE_KEY = "majuu_document_engine_mode";
const DOC_ENGINE_MODE_EVENT = "majuu:docs-engine-mode-updated";
const DOC_ENGINE_FLAGS_COLLECTION = "runtimeFlags";
const DOC_ENGINE_FLAGS_DOC_ID = "documentEngine";
const VALID_MODES = new Set(["merge", "canonical", "legacy"]);

let globalModeCache = "";
let globalModeMetaCache = null;
let globalModeErrorCache = "";
let globalModeUnsub = null;
const modeListeners = new Set();

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeMode(value) {
  const mode = safeStr(value, 24).toLowerCase();
  return VALID_MODES.has(mode) ? mode : "";
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function globalDocRef() {
  return doc(db, DOC_ENGINE_FLAGS_COLLECTION, DOC_ENGINE_FLAGS_DOC_ID);
}

function readModeFromUrl() {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search || "");
    return safeMode(params.get("docsMode"));
  } catch {
    return "";
  }
}

function readModeFromStorage() {
  if (typeof window === "undefined") return "";
  try {
    return safeMode(window.localStorage.getItem(DOC_ENGINE_MODE_KEY));
  } catch {
    return "";
  }
}

function readModeFromGlobalCache() {
  return safeMode(globalModeCache);
}

function emitModeState() {
  const snapshot = getDocumentEngineModeState();
  modeListeners.forEach((listener) => {
    try {
      listener?.onData?.(snapshot);
    } catch {
      // Keep listener errors isolated.
    }
  });
}

function emitModeError(error) {
  modeListeners.forEach((listener) => {
    try {
      listener?.onError?.(error);
    } catch {
      // Keep listener errors isolated.
    }
  });
}

function broadcastLocalModeChange() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(DOC_ENGINE_MODE_EVENT));
  } catch {
    // Ignore custom event failures.
  }
}

function ensureGlobalModeSubscription() {
  if (globalModeUnsub || typeof window === "undefined") return;
  globalModeUnsub = onSnapshot(
    globalDocRef(),
    (snapshot) => {
      const row = snapshot.data() || {};
      globalModeCache = safeMode(row?.readMode || row?.mode);
      globalModeMetaCache = {
        updatedAtMs: Number(row?.updatedAtMs || 0) || toMs(row?.updatedAt),
        updatedByUid: safeStr(row?.updatedByUid, 120),
        updatedByEmail: safeStr(row?.updatedByEmail, 200),
        note: safeStr(row?.note, 1200),
      };
      globalModeErrorCache = "";
      emitModeState();
    },
    (error) => {
      globalModeErrorCache = safeStr(error?.message || error, 600) || "Failed to load global mode";
      emitModeError(error);
      emitModeState();
    }
  );
}

function modeSourceLabel({ urlMode, localMode, globalMode }) {
  if (urlMode) return "url";
  if (localMode) return "local";
  if (globalMode) return "global";
  return "default";
}

function resolveReadMode({ urlMode, localMode, globalMode }) {
  return urlMode || localMode || globalMode || "merge";
}

export function getDocumentEngineReadMode() {
  return resolveReadMode({
    urlMode: readModeFromUrl(),
    localMode: readModeFromStorage(),
    globalMode: readModeFromGlobalCache(),
  });
}

export function getDocumentEngineModeState() {
  const urlMode = readModeFromUrl();
  const localMode = readModeFromStorage();
  const globalMode = readModeFromGlobalCache();
  return {
    effectiveMode: resolveReadMode({ urlMode, localMode, globalMode }),
    source: modeSourceLabel({ urlMode, localMode, globalMode }),
    urlMode,
    localMode,
    globalMode,
    globalError: globalModeErrorCache,
    globalMeta: globalModeMetaCache || null,
    storageKey: DOC_ENGINE_MODE_KEY,
    globalDocPath: `${DOC_ENGINE_FLAGS_COLLECTION}/${DOC_ENGINE_FLAGS_DOC_ID}`,
  };
}

export function subscribeDocumentEngineModeState({ onData, onError } = {}) {
  if (typeof onData !== "function") return () => {};

  ensureGlobalModeSubscription();
  const listener = { onData, onError };
  modeListeners.add(listener);

  onData(getDocumentEngineModeState());

  const canListenWindow = typeof window !== "undefined" && typeof window.addEventListener === "function";
  if (!canListenWindow) {
    return () => modeListeners.delete(listener);
  }

  const onStorage = (event) => {
    if (!event || !event.key || event.key === DOC_ENGINE_MODE_KEY) {
      onData(getDocumentEngineModeState());
    }
  };
  const onRouteSignal = () => onData(getDocumentEngineModeState());

  window.addEventListener("storage", onStorage);
  window.addEventListener(DOC_ENGINE_MODE_EVENT, onRouteSignal);
  window.addEventListener("popstate", onRouteSignal);
  window.addEventListener("hashchange", onRouteSignal);

  return () => {
    modeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DOC_ENGINE_MODE_EVENT, onRouteSignal);
    window.removeEventListener("popstate", onRouteSignal);
    window.removeEventListener("hashchange", onRouteSignal);
  };
}

export function setDocumentEngineReadMode(mode) {
  const clean = safeMode(mode);
  if (!clean || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(DOC_ENGINE_MODE_KEY, clean);
    broadcastLocalModeChange();
    emitModeState();
    return true;
  } catch {
    return false;
  }
}

export function clearDocumentEngineReadMode() {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(DOC_ENGINE_MODE_KEY);
    broadcastLocalModeChange();
    emitModeState();
    return true;
  } catch {
    return false;
  }
}

export async function setDocumentEngineGlobalMode({ mode, note = "" } = {}) {
  const clean = safeMode(mode);
  if (!clean) throw new Error("Invalid document engine mode.");
  const actorUid = safeStr(auth.currentUser?.uid, 120);
  const actorEmail = safeStr(auth.currentUser?.email, 200);

  await setDoc(
    globalDocRef(),
    {
      readMode: clean,
      note: safeStr(note, 1200),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedByUid: actorUid,
      updatedByEmail: actorEmail,
    },
    { merge: true }
  );
}

export function getDocumentEngineModeStorageKey() {
  return DOC_ENGINE_MODE_KEY;
}

export function getDocumentEngineGlobalDocPath() {
  return `${DOC_ENGINE_FLAGS_COLLECTION}/${DOC_ENGINE_FLAGS_DOC_ID}`;
}

export function getDocumentEngineValidModes() {
  return Array.from(VALID_MODES);
}
