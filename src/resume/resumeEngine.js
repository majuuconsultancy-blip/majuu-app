import {
  getStoredValue,
  removeStoredValue,
  setStoredValue,
} from "./resumeStorage";

/*
Resume Snapshot Checklist
- schemaVersion: number
- route: { path, search } // resumable route only
- trackSelect: { selectedTrack, destination, country, category, subStep, helpType }
- selfHelp: { track, country, screenKey, pendingExternalLink? }
- weHelp:
  - { track, country, activeRequestId, requestModal?, fullPackage? }
  - requestModal: { open, serviceName, requestType, step, formState? }
  - fullPackage: { screen, detailsOpen, diagnosticOpen, parentRequestId, selectedItem, requestModal? }
- meta: { invalidRoute } // set when an old/unknown route is detected
*/

const SNAPSHOT_KEY = "majuu_resume_snapshot_v1";
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 180;

const RESUMABLE_ROUTE_PATTERNS = [
  /^\/dashboard$/,
  /^\/app\/progress$/,
  /^\/app\/(study|work|travel)$/,
  /^\/app\/(study|work|travel)\/self-help$/,
  /^\/app\/(study|work|travel)\/we-help$/,
  /^\/app\/full-package\/(study|work|travel)$/,
  /^\/app\/request\/[^/]+$/,
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function safeBoolean(value) {
  return Boolean(value);
}

function safeSearch(value) {
  const text = safeString(value, 300);
  if (!text) return "";
  return text.startsWith("?") ? text : `?${text}`;
}

function isSelfHelpRoute(path) {
  return /^\/app\/(study|work|travel)\/self-help$/.test(path);
}

function isWeHelpRoute(path) {
  return /^\/app\/(study|work|travel)\/we-help$/.test(path);
}

function isFullPackageRoute(path) {
  return /^\/app\/full-package\/(study|work|travel)$/.test(path);
}

export function isResumableRoute(pathname) {
  const path = safeString(pathname, 240);
  if (!path) return false;
  return RESUMABLE_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}

function defaultSnapshot() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    route: {
      path: "/dashboard",
      search: "",
    },
    trackSelect: {
      selectedTrack: "",
      destination: "",
      country: "",
      category: "",
      subStep: "",
      helpType: "",
    },
    selfHelp: {
      track: "",
      country: "",
      screenKey: "",
      pendingExternalLink: null,
    },
    weHelp: {
      track: "",
      country: "",
      activeRequestId: "",
      requestModal: {
        open: false,
        serviceName: "",
        requestType: "",
        step: "",
        formState: null,
      },
      fullPackage: {
        screen: "",
        detailsOpen: false,
        diagnosticOpen: false,
        parentRequestId: "",
        selectedItem: "",
        requestModal: {
          open: false,
          step: "",
          formState: null,
          selectedItem: "",
        },
      },
    },
    meta: {
      invalidRoute: false,
    },
  };
}

function mergeDeep(base, patch) {
  if (!isObject(base)) return patch;
  if (!isObject(patch)) return patch;

  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = mergeDeep(current, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function sanitizeRoute(route) {
  if (!isObject(route)) {
    return { path: "/dashboard", search: "", invalidRoute: false };
  }

  const path = safeString(route.path, 240);
  if (!isResumableRoute(path)) {
    return {
      path: "/dashboard",
      search: "",
      invalidRoute: Boolean(path),
    };
  }

  return {
    path,
    search: safeSearch(route.search),
    invalidRoute: false,
  };
}

function sanitizeTrackSelect(trackSelect) {
  if (!isObject(trackSelect)) return defaultSnapshot().trackSelect;
  return {
    selectedTrack: safeString(trackSelect.selectedTrack, 20),
    destination: safeString(trackSelect.destination, 80),
    country: safeString(trackSelect.country, 80),
    category: safeString(trackSelect.category, 30),
    subStep: safeString(trackSelect.subStep, 80),
    helpType: safeString(trackSelect.helpType, 20),
  };
}

function sanitizePendingExternalLink(value) {
  if (!isObject(value)) return null;
  const url = safeString(value.url, 500);
  if (!url) return null;
  return {
    url,
    title: safeString(value.title, 180),
    tappedAt: Number(value.tappedAt || Date.now()) || Date.now(),
  };
}

function sanitizeRequestModal(value) {
  if (!isObject(value)) {
    return {
      open: false,
      serviceName: "",
      requestType: "",
      step: "",
      formState: null,
    };
  }

  return {
    open: safeBoolean(value.open),
    serviceName: safeString(value.serviceName, 120),
    requestType: safeString(value.requestType, 40),
    step: safeString(value.step, 40),
    formState: isObject(value.formState)
      ? {
          name: safeString(value.formState.name, 140),
          phone: safeString(value.formState.phone, 60),
          email: safeString(value.formState.email, 140),
          city: safeString(value.formState.city, 80),
          note: safeString(value.formState.note, 600),
          paid: safeBoolean(value.formState.paid),
        }
      : null,
  };
}

function sanitizeFullPackage(value) {
  if (!isObject(value)) {
    return {
      screen: "",
      detailsOpen: false,
      diagnosticOpen: false,
      parentRequestId: "",
      selectedItem: "",
      requestModal: {
        open: false,
        step: "",
        formState: null,
        selectedItem: "",
      },
    };
  }

  return {
    screen: safeString(value.screen, 30),
    detailsOpen: safeBoolean(value.detailsOpen),
    diagnosticOpen: safeBoolean(value.diagnosticOpen),
    parentRequestId: safeString(value.parentRequestId, 80),
    selectedItem: safeString(value.selectedItem, 140),
    requestModal: {
      ...sanitizeRequestModal(value.requestModal),
      selectedItem: safeString(value?.requestModal?.selectedItem, 140),
    },
  };
}

function sanitizeSelfHelp(selfHelp) {
  if (!isObject(selfHelp)) return defaultSnapshot().selfHelp;
  return {
    track: safeString(selfHelp.track, 20),
    country: safeString(selfHelp.country, 80),
    screenKey: safeString(selfHelp.screenKey, 120),
    pendingExternalLink: sanitizePendingExternalLink(selfHelp.pendingExternalLink),
  };
}

function sanitizeWeHelp(weHelp) {
  if (!isObject(weHelp)) return defaultSnapshot().weHelp;
  return {
    track: safeString(weHelp.track, 20),
    country: safeString(weHelp.country, 80),
    activeRequestId: safeString(weHelp.activeRequestId, 80),
    requestModal: sanitizeRequestModal(weHelp.requestModal),
    fullPackage: sanitizeFullPackage(weHelp.fullPackage),
  };
}

function sanitizeSnapshot(value) {
  const base = defaultSnapshot();
  if (!isObject(value)) return base;

  const route = sanitizeRoute(value.route);
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Number(value.updatedAt || Date.now()) || Date.now(),
    route: {
      path: route.path,
      search: route.search,
    },
    trackSelect: sanitizeTrackSelect(value.trackSelect),
    selfHelp: sanitizeSelfHelp(value.selfHelp),
    weHelp: sanitizeWeHelp(value.weHelp),
    meta: {
      invalidRoute: safeBoolean(route.invalidRoute),
    },
  };
}

function migrateSnapshot(raw) {
  if (!isObject(raw)) return defaultSnapshot();
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION) return defaultSnapshot();
  return sanitizeSnapshot(raw);
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

let cache = null;
let hydratePromise = null;
let operationChain = Promise.resolve();
let persistTimer = null;

async function hydrate() {
  if (cache) return cache;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const raw = await getStoredValue(SNAPSHOT_KEY);
      if (!raw) {
        cache = defaultSnapshot();
        return cache;
      }

      const parsed = JSON.parse(raw);
      cache = migrateSnapshot(parsed);
      return cache;
    } catch {
      cache = defaultSnapshot();
      return cache;
    }
  })();

  return hydratePromise;
}

async function persistNow() {
  if (!cache) return;
  const payload = cloneSnapshot(cache);
  await setStoredValue(SNAPSHOT_KEY, JSON.stringify(payload));
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow().catch(() => {});
  }, WRITE_DEBOUNCE_MS);
}

function enqueue(task) {
  operationChain = operationChain.then(task, task);
  return operationChain;
}

export function setSnapshot(partial) {
  return enqueue(async () => {
    const current = await hydrate();
    const patch = isObject(partial) ? partial : {};
    const merged = mergeDeep(current, patch);
    cache = sanitizeSnapshot({
      ...merged,
      updatedAt: Date.now(),
    });
    schedulePersist();
    return cloneSnapshot(cache);
  });
}

export function getSnapshot() {
  return enqueue(async () => {
    const snapshot = await hydrate();
    const normalized = sanitizeSnapshot(snapshot);
    cache = normalized;
    return cloneSnapshot(normalized);
  });
}

export function clearSnapshot() {
  return enqueue(async () => {
    cache = defaultSnapshot();
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await removeStoredValue(SNAPSHOT_KEY);
    return cloneSnapshot(cache);
  });
}

export function clearPendingExternalLink() {
  return setSnapshot({
    selfHelp: {
      pendingExternalLink: null,
    },
  });
}

export async function getResumeTarget() {
  const snapshot = await getSnapshot();
  if (snapshot?.meta?.invalidRoute) {
    await clearSnapshot();
    return {
      path: "/dashboard",
      search: "",
      state: { resumeFromSnapshot: true, resumeFallback: "invalid-route" },
    };
  }

  const path = safeString(snapshot?.route?.path, 240);
  if (!isResumableRoute(path)) {
    await clearSnapshot();
    return null;
  }

  if (path === "/dashboard" || path === "/app/progress") {
    return null;
  }

  const search = safeSearch(snapshot?.route?.search);
  const state = { resumeFromSnapshot: true };

  if (isSelfHelpRoute(path) && snapshot?.selfHelp?.pendingExternalLink?.url) {
    state.resumePendingExternalLink = snapshot.selfHelp.pendingExternalLink;
  }

  if (isWeHelpRoute(path)) {
    state.resumeWeHelp = snapshot.weHelp;
  }

  if (isFullPackageRoute(path)) {
    state.resumeFullPackage = snapshot?.weHelp?.fullPackage || null;
  }

  return {
    path,
    search,
    state,
  };
}
