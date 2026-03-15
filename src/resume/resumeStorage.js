const hasWindow = typeof window !== "undefined";
let preferencesPluginPromise = null;
const STORAGE_TIMEOUT_MS = 1200;

function withTimeout(promise, timeoutMs = STORAGE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
      promise.finally?.(() => clearTimeout(timer));
    }),
  ]);
}

async function resolvePreferencesPlugin() {
  if (preferencesPluginPromise) return preferencesPluginPromise;

  preferencesPluginPromise = (async () => {
    try {
      const moduleName = "@capacitor/" + "preferences";
      const mod = await withTimeout(import(/* @vite-ignore */ moduleName));
      if (mod?.__timedOut) return null;
      const plugin = mod?.Preferences;
      if (plugin?.get && plugin?.set && plugin?.remove) return plugin;
    } catch {
      // fall through to other preference resolution paths
    }

    try {
      const plugin = globalThis?.Capacitor?.Plugins?.Preferences;
      if (plugin?.get && plugin?.set && plugin?.remove) return plugin;
    } catch {
      // ignore missing global Capacitor bridge
    }

    return null;
  })();

  return preferencesPluginPromise;
}

function webGet(key) {
  if (!hasWindow) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // ignore localStorage read issues
    return null;
  }
}

function webSet(key, value) {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore localStorage write issues
  }
}

function webRemove(key) {
  if (!hasWindow) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore localStorage remove issues
  }
}

export async function getStoredValue(key) {
  const webValue = webGet(key);
  if (webValue != null) {
    return webValue;
  }

  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      const result = await withTimeout(plugin.get({ key }));
      if (!result?.__timedOut) {
        return result?.value ?? null;
      }
    } catch {
      // fall back to web storage
    }
  }
  return webGet(key);
}

export async function setStoredValue(key, value) {
  webSet(key, value);
  void (async () => {
    const plugin = await resolvePreferencesPlugin();
    if (plugin) {
      try {
        await withTimeout(plugin.set({ key, value }).then(() => ({ ok: true })));
      } catch {
        // local storage is already updated
      }
    }
  })();
}

export async function setStoredValueDurable(key, value) {
  webSet(key, value);
  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      await withTimeout(plugin.set({ key, value }));
    } catch {
      // local storage is already updated
    }
  }
}

export async function removeStoredValue(key) {
  webRemove(key);
  void (async () => {
    const plugin = await resolvePreferencesPlugin();
    if (plugin) {
      try {
        await withTimeout(plugin.remove({ key }).then(() => ({ ok: true })));
      } catch {
        // local storage is already updated
      }
    }
  })();
}

export async function removeStoredValueDurable(key) {
  webRemove(key);
  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      await withTimeout(plugin.remove({ key }));
    } catch {
      // local storage is already updated
    }
  }
}
