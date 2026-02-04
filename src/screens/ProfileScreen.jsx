import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

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

/* -------- Minimal icons (no emojis) -------- */
function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 12.2a4.2 4.2 0 1 0-4.2-4.2 4.2 4.2 0 0 0 4.2 4.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 20.2a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m6.5 8.5 5.2 4a1 1 0 0 0 1.2 0l5.1-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.3 3.8 9.6 3c.6-.2 1.2.1 1.4.6l1.2 2.8c.2.5 0 1.1-.5 1.4l-1.6 1c.8 1.7 2.2 3.1 3.9 3.9l1-1.6c.3-.5.9-.7 1.4-.5l2.8 1.2c.6.3.8.9.6 1.4l-.8 2.3c-.2.6-.8 1-1.5 1C10.6 21.5 2.5 13.4 2.5 4.9c0-.6.4-1.2 1-1.5l2.8-1c.3-.1.7 0 1 .4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFlag(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 22V3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 4h10l-1.4 3L16 10H6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconEdit(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5 17.5 10.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m6 12.5 3.2 3.2L18 7.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 9.5 3 12l3.5 2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 19 6.7v6.5c0 4.3-3 8.2-7 9.3-4-1.1-7-5-7-9.3V6.7L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9.3 12.4 1.8 1.8 3.8-4.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FieldShell({ icon: Icon, label, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/60 text-emerald-700">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {label}
          </div>
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function ProfileScreen() {
  const navigate = useNavigate();
  const ADMIN_EMAIL = "brioneroo@gmail.com";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  // view fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");

  // edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftResidence, setDraftResidence] = useState("");

  const isAdmin = useMemo(() => {
    return (email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }, [email]);

  const initials = useMemo(() => {
    const base = (name || email || "U").trim();
    const parts = base.split(" ").filter(Boolean);
    const first = parts[0]?.[0] || base[0] || "U";
    const second = parts[1]?.[0] || "";
    return (first + second).toUpperCase();
  }, [name, email]);

  const completion = useMemo(() => {
    const checks = [
      Boolean((name || "").trim()),
      Boolean((phone || "").trim()),
      Boolean((countryOfResidence || "").trim()),
    ];
    const done = checks.filter(Boolean).length;
    const total = checks.length;
    const pct = Math.round((done / total) * 100);
    return { done, total, pct };
  }, [name, phone, countryOfResidence]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        const s = await getUserState(user.uid);

        const n = s?.name || "";
        const p = s?.phone || "";
        const c = s?.countryOfResidence || "";

        setName(n);
        setPhone(p);
        setCountryOfResidence(c);

        setDraftName(n);
        setDraftPhone(p);
        setDraftResidence(c);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  const save = async () => {
    if (!uid) return;

    setErr("");

    if (!draftName.trim()) return setErr("Please enter your name.");
    if (!draftPhone.trim()) return setErr("Please enter your phone/WhatsApp.");
    if (!draftResidence.trim())
      return setErr("Please select your country of residence.");

    setSaving(true);
    try {
      await updateUserProfile(uid, {
        name: draftName.trim(),
        phone: draftPhone.trim(),
        countryOfResidence: draftResidence.trim(),
      });

      setName(draftName.trim());
      setPhone(draftPhone.trim());
      setCountryOfResidence(draftResidence.trim());

      setIsEditing(false);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  const cancelEdit = () => {
    setDraftName(name || "");
    setDraftPhone(phone || "");
    setDraftResidence(countryOfResidence || "");
    setIsEditing(false);
    setErr("");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="h-6 w-28 rounded bg-zinc-200" />
            <div className="mt-2 h-4 w-64 rounded bg-zinc-200" />
            <div className="mt-6 h-24 rounded-2xl bg-zinc-200" />
            <div className="mt-4 h-20 rounded-2xl bg-zinc-200" />
            <div className="mt-3 h-20 rounded-2xl bg-zinc-200" />
          </div>
        </div>
      </div>
    );
  }

  const topBg = "bg-gradient-to-b from-emerald-50 via-white to-zinc-50";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Keep your details updated so we can support you faster.
            </p>
          </div>

          
     {isAdmin ? (
      <button
      onClick={() => navigate("/app/admin")}
      className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
    >
      <IconShield className="h-5 w-5" />
      Admin tools
    </button>
  ) : null}

  <button
    onClick={logout}
    className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-white"
  >
    <IconLogout className="h-5 w-5" />
    Logout
  </button>
</div>
        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        {/* Hero card */}
        <div className="mt-6 rounded-3xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-lg font-bold text-emerald-800">
                  {initials}
                </div>
                {isAdmin ? (
                  <span className="absolute -bottom-2 -right-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Admin
                  </span>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-900">
                  {name?.trim() ? name : "Your name"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
                  <IconMail className="h-4 w-4 text-zinc-500" />
                  <span className="truncate">{email || "—"}</span>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-zinc-600">
                    <span>Profile completion</span>
                    <span className="font-semibold text-zinc-900">
                      {completion.pct}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${completion.pct}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">
                    {completion.done}/{completion.total} required fields completed
                  </div>
                </div>
              </div>
            </div>

            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
              >
                <IconEdit className="h-5 w-5" />
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {/* Fields */}
        <div className="mt-5 grid gap-3">
          <FieldShell icon={IconUser} label="Full name">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900">
                {name?.trim() ? name : "Not set"}
              </div>
            ) : (
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4"
              />
            )}
          </FieldShell>

          <FieldShell icon={IconPhone} label="Phone / WhatsApp">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900">
                {phone?.trim() ? phone : "Not set"}
              </div>
            ) : (
              <input
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
                placeholder="e.g. +2547..."
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4"
              />
            )}
          </FieldShell>

          <FieldShell icon={IconFlag} label="Country of residence">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900">
                {countryOfResidence?.trim() ? countryOfResidence : "Not set"}
              </div>
            ) : (
              <select
                value={draftResidence}
                onChange={(e) => setDraftResidence(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4"
              >
                <option value="">Select…</option>
                {RESIDENCE_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </FieldShell>
        </div>

        {/* Actions tile (scrolls normally) */}
        {isEditing ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex gap-3">
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
              >
                Cancel
              </button>

              <button
                onClick={save}
                disabled={saving}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <IconCheck className="h-5 w-5" />
                  {saving ? "Saving..." : "Save changes"}
                </span>
              </button>
            </div>

            <div className="mt-2 text-center text-xs text-zinc-500">
              Tip: keep your profile updated to automatically fill up your credentials.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}