import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch {
    const fallbackPath = path.join(process.cwd(), "functions", "node_modules", "firebase-admin");
    return require(fallbackPath);
  }
}

const adminModule = loadFirebaseAdmin();
const admin = adminModule?.default || adminModule;

function safeString(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function parseServiceAccountFromEnv() {
  const rawJson =
    safeString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 20000) ||
    safeString(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 20000);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fall through to split env vars below.
    }
  }

  const projectId =
    safeString(process.env.FIREBASE_PROJECT_ID, 400) ||
    safeString(process.env.GOOGLE_CLOUD_PROJECT, 400);
  const clientEmail = safeString(process.env.FIREBASE_CLIENT_EMAIL, 400);
  const privateKey = safeString(process.env.FIREBASE_PRIVATE_KEY, 12000).replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

function ensureAdmin() {
  if (admin.apps.length) {
    return admin.app();
  }

  const serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:
        safeString(serviceAccount.project_id, 400) ||
        safeString(process.env.FIREBASE_PROJECT_ID, 400) ||
        safeString(process.env.GOOGLE_CLOUD_PROJECT, 400),
    });
  }

  return admin.initializeApp();
}

const app = ensureAdmin();
const db = admin.firestore(app);
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

export { admin, app, db, FieldValue, Timestamp };
