const hasWindow = typeof window !== "undefined";
let preferencesPluginPromise = null;

async function resolvePreferencesPlugin() {
  if (preferencesPluginPromise) return preferencesPluginPromise;

  preferencesPluginPromise = (async () => {
    try {
      const moduleName = "@capacitor/" + "preferences";
      const mod = await import(/* @vite-ignore */ moduleName);
      const plugin = mod?.Preferences;
      if (plugin?.get && plugin?.set && plugin?.remove) return plugin;
    } catch {}

    try {
      const plugin = globalThis?.Capacitor?.Plugins?.Preferences;
      if (plugin?.get && plugin?.set && plugin?.remove) return plugin;
    } catch {}

    return null;
  })();

  return preferencesPluginPromise;
}

function webGet(key) {
  if (!hasWindow) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function webSet(key, value) {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function webRemove(key) {
  if (!hasWindow) return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export async function getStoredValue(key) {
  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      const result = await plugin.get({ key });
      return result?.value ?? null;
    } catch {}
  }
  return webGet(key);
}

export async function setStoredValue(key, value) {
  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      await plugin.set({ key, value });
      return;
    } catch {}
  }
  webSet(key, value);
}

export async function removeStoredValue(key) {
  const plugin = await resolvePreferencesPlugin();
  if (plugin) {
    try {
      await plugin.remove({ key });
      return;
    } catch {}
  }
  webRemove(key);
}

