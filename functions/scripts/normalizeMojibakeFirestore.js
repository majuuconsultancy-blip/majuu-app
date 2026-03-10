/* eslint-disable no-console */
/**
 * One-time Firestore mojibake cleanup script.
 *
 * Usage (from /functions):
 *   node scripts/normalizeMojibakeFirestore.js          # dry-run (no writes)
 *   node scripts/normalizeMojibakeFirestore.js --write  # apply updates
 *
 * Prereq:
 * - Run in an environment with Firebase Admin credentials configured.
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DOC_ID = admin.firestore.FieldPath.documentId();
const PAGE_SIZE = 250;

function normalizeText(text) {
  if (!text || typeof text !== "string") return text;

  const fixes = {
    "â€™": "’",
    "â€œ": "“",
    "â€": "”",
    "â€“": "–",
    "â€”": "—",
    "â€¢": "•",
    "Ã©": "é",
    "Ã¨": "è",
    "Ã¡": "á",
    "Ã ": "à",
    "Ã¶": "ö",
    "Ã¼": "ü",
    "Ã±": "ñ",
  };

  let cleaned = text;
  Object.keys(fixes).forEach((broken) => {
    cleaned = cleaned.split(broken).join(fixes[broken]);
  });

  return cleaned.normalize("NFC");
}

function normalizeDeep(value) {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDeep(item));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (value.constructor && value.constructor.name !== "Object") return value;

  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = normalizeDeep(value[key]);
  });
  return out;
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function normalizeQuery({ label, queryFactory, write }) {
  let cursor = null;
  let scanned = 0;
  let changed = 0;
  let written = 0;

  while (true) {
    let q = queryFactory().orderBy(DOC_ID).limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    scanned += snap.size;
    const batch = db.batch();
    let batchWrites = 0;

    for (const docSnap of snap.docs) {
      const before = docSnap.data() || {};
      const after = normalizeDeep(before);

      if (sameJSON(before, after)) continue;
      changed += 1;

      if (write) {
        batch.set(docSnap.ref, after, { merge: true });
        batchWrites += 1;
      }
    }

    if (write && batchWrites > 0) {
      await batch.commit();
      written += batchWrites;
    }

    cursor = snap.docs[snap.docs.length - 1];
    console.log(`[${label}] scanned=${scanned} changed=${changed} written=${written}`);
  }

  return { label, scanned, changed, written };
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "Running in WRITE mode." : "Running in DRY-RUN mode.");

  const jobs = [
    {
      label: "serviceRequests",
      queryFactory: () => db.collection("serviceRequests"),
    },
    {
      label: "messages(group)",
      queryFactory: () => db.collectionGroup("messages"),
    },
    {
      label: "pendingMessages(group)",
      queryFactory: () => db.collectionGroup("pendingMessages"),
    },
    {
      label: "notifications(group)",
      queryFactory: () => db.collectionGroup("notifications"),
    },
  ];

  const results = [];
  for (const job of jobs) {
    // Sequential by design to keep write/read load predictable.
    // eslint-disable-next-line no-await-in-loop
    const result = await normalizeQuery({ ...job, write });
    results.push(result);
  }

  const totals = results.reduce(
    (acc, row) => {
      acc.scanned += row.scanned;
      acc.changed += row.changed;
      acc.written += row.written;
      return acc;
    },
    { scanned: 0, changed: 0, written: 0 }
  );

  console.log("Done.");
  console.log(
    `Totals: scanned=${totals.scanned} changed=${totals.changed} written=${totals.written}`
  );
}

main().catch((error) => {
  console.error("Normalization script failed:", error);
  process.exitCode = 1;
});
