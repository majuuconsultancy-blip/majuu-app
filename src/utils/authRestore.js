import { auth, authPersistenceReady } from "../firebase";

const DEFAULT_TIMEOUT_MS = 8000;

export async function waitForAuthRestore(timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    await authPersistenceReady;
  } catch (error) {
    void error;
  }

  if (typeof auth?.authStateReady === "function") {
    try {
      await Promise.race([
        auth.authStateReady(),
        new Promise((resolve) =>
          window.setTimeout(resolve, Math.max(300, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
        ),
      ]);
    } catch (error) {
      void error;
    }
    return auth.currentUser;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let unsubscribe = () => {};

    const finish = (user) => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      try {
        unsubscribe?.();
      } catch (error) {
        void error;
      }
      resolve(user || null);
    };

    try {
      unsubscribe = auth.onAuthStateChanged((user) => finish(user));
    } catch (error) {
      void error;
      finish(auth.currentUser);
      return;
    }

    timeoutId = window.setTimeout(
      () => finish(auth.currentUser),
      Math.max(300, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
    );
  });
}
