import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { getUserState, updateUserProfile } from "../services/userservice";

const RESIDENCE_COUNTRIES = [
  "Kenya",
  "Uganda",
  "Tanzania",
  "Rwanda",
  "Burundi",
  "South Sudan",
  "Ethiopia",
  "Somalia",
  "DRC",
  "Other",
];

const DIAL_BY_COUNTRY = {
  Kenya: "+254",
  Uganda: "+256",
  Tanzania: "+255",
  Rwanda: "+250",
  Burundi: "+257",
  "South Sudan": "+211",
  Ethiopia: "+251",
  Somalia: "+252",
  DRC: "+243",
};

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

// ✅ Kenya normalization: accepts 0712..., 712..., +254712..., 254712...
function normalizeKenyaPhone(raw) {
  const digits = onlyDigits(raw);
  let local = digits;

  if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
  if (local.startsWith("0") && local.length >= 10) local = local.slice(1);

  local = local.slice(-9);

  if (!/^(7|1)\d{8}$/.test(local)) {
    throw new Error(
      "Kenya phone must be 9 digits starting with 7 or 1. Example: +254712345678"
    );
  }

  return `+254${local}`;
}

function validateNonKenyaPhone(raw) {
  const cleaned = String(raw || "").trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("Please enter your phone/WhatsApp.");
  if (onlyDigits(cleaned).length < 8) throw new Error("Phone number looks too short.");
  return cleaned;
}

export default function EditProfileScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [residence, setResidence] = useState("");
  const [phone, setPhone] = useState("");

  // originals (for "changed" detection + reset)
  const originalRef = useRef({ name: "", residence: "", phone: "" });

  const dial = useMemo(() => DIAL_BY_COUNTRY[residence] || "", [residence]);
  const isKenya = residence === "Kenya";

  const isDirty = useMemo(() => {
    const o = originalRef.current;
    return (
      normalizeName(name) !== normalizeName(o.name) ||
      String(residence || "") !== String(o.residence || "") ||
      String(phone || "").trim() !== String(o.phone || "").trim()
    );
  }, [name, residence, phone]);

  // ✅ Soft auth init (reduces “random logout feeling” on resume)
  useEffect(() => {
    let alive = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!alive) return;

      // Give it a moment on cold start/resume
      if (!user) {
        setTimeout(() => {
          if (!alive) return;
          if (!auth.currentUser) navigate("/login", { replace: true });
        }, 800);
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        const s = await getUserState(user.uid);
        if (!alive) return;

        const n = s?.name || "";
        const r = s?.countryOfResidence || "";
        const p = s?.phone || "";

        setName(n);
        setResidence(r);
        setPhone(p);

        originalRef.current = { name: n, residence: r, phone: p };
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load profile.");
      } finally {
        if (alive) setLoading(false);
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [navigate]);

  const reset = () => {
    const o = originalRef.current;
    setName(o.name || "");
    setResidence(o.residence || "");
    setPhone(o.phone || "");
    setErr("");
  };

  const save = async () => {
    if (!uid) return;
    if (saving) return;

    setErr("");

    try {
      const cleanName = normalizeName(name);
      if (cleanName.length < 3) throw new Error("Full name must be at least 3 characters.");
      if (!String(residence || "").trim()) throw new Error("Select country of residence.");

      let finalPhone = String(phone || "").trim();

      if (residence === "Kenya") {
        finalPhone = normalizeKenyaPhone(finalPhone);
      } else {
        finalPhone = validateNonKenyaPhone(finalPhone);
      }

      setSaving(true);

      await updateUserProfile(uid, {
        name: cleanName,
        phone: finalPhone,
        countryOfResidence: String(residence || "").trim(),
      });

      // update local originals
      originalRef.current = { name: cleanName, residence, phone: finalPhone };

      navigate("/app/profile", { replace: true });
    } catch (e) {
      setErr(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="rounded-3xl border border-zinc-200 bg-white/70 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
              Loading…
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Fetching your profile.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const topBg =
    "bg-gradient-to-b from-emerald-50/60 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const glass =
    "border border-white/40 bg-white/55 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.10)] dark:border-zinc-800/70 dark:bg-zinc-900/55";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm active:scale-[0.99]
                       dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
            type="button"
          >
            ← Back
          </button>

          <div className="text-right">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Signed in as</div>
            <div className="max-w-[220px] truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {email || "—"}
            </div>
          </div>
        </div>

        <div className={`mt-5 rounded-3xl ${glass} p-5`}>
          <h1 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">
            Edit profile
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Keep your details correct so requests don’t delay.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Form */}
          <div className="mt-5 grid gap-4">
            <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Full name
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
                autoCapitalize="words"
                autoCorrect="on"
                spellCheck={false}
                enterKeyHint="next"
                className="mt-2 w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                           dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Country of residence
              </div>
              <select
                value={residence}
                onChange={(e) => setResidence(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                           dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                <option value="">Select…</option>
                {RESIDENCE_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {residence ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Dial code:{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {dial || "—"}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Phone / WhatsApp
              </div>

              {isKenya ? (
                <>
                  <div className="mt-2 flex gap-2">
                    <div className="shrink-0 rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100">
                      +254
                    </div>
                    <input
                      value={phone}
                      onChange={(e) => {
                        // allow people to paste anything; we normalize on save.
                        setPhone(e.target.value);
                      }}
                      placeholder="712345678 (or paste +254712...)"
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="done"
                      className="w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                                 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Kenya: we accept{" "}
                    <span className="font-semibold">0712…</span>,{" "}
                    <span className="font-semibold">712…</span>,{" "}
                    <span className="font-semibold">+254712…</span>.
                  </div>
                </>
              ) : (
                <>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +2567..., +2557..., +1..."
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="done"
                    className="mt-2 w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                               dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Tip: include your country code (start with{" "}
                    <span className="font-semibold">+</span>).
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="mt-1 grid gap-3">
              <button
                onClick={save}
                disabled={saving || !isDirty}
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                type="button"
              >
                {saving ? "Saving…" : isDirty ? "Save changes" : "No changes"}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={reset}
                  disabled={saving || !isDirty}
                  className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm active:scale-[0.99] disabled:opacity-60
                             dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                  type="button"
                >
                  Reset
                </button>

                <button
                  onClick={() => navigate("/app/profile", { replace: true })}
                  disabled={saving}
                  className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm active:scale-[0.99] disabled:opacity-60
                             dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                  type="button"
                >
                  Cancel
                </button>
              </div>

              <div className="text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                Profile edits save to your account immediately.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
          EDIT PROFILE BUILD 2026-02-17
        </div>
      </div>
    </div>
  );
}