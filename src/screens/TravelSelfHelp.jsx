// ✅ TravelSelfHelp.jsx (FULL COPY-PASTE)
// CHANGE: Redo ALL icons using lucide-react (no custom SVG icon components)
// Everything else (layout/logic/keys) unchanged.
// Keeps visited memory key: majuu_visited_links_v1

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "../utils/motionProxy";
import {
  Compass,
  Link2,
  CheckCircle2,
  ArrowLeft,
  Copy,
  ExternalLink,
} from "lucide-react";

/* ---------- Visited links memory ---------- */
const VISITED_KEY = "majuu_visited_links_v1";

function loadVisited() {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function markVisited(url) {
  try {
    const v = loadVisited();
    v[url] = Date.now();
    localStorage.setItem(VISITED_KEY, JSON.stringify(v));
  } catch {}
}

/* ---------- tiny helpers ---------- */
function getDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getGoogleQueryFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("google.") && u.pathname === "/search") {
      return u.searchParams.get("q") || "";
    }
    return "";
  } catch {
    return "";
  }
}

async function copyText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------- Motion ---------- */
const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

const cardFloat = {
  rest: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.01, transition: { duration: 0.16 } },
  tap: { scale: 0.985 },
};

function LinkRow({ item, visitedMap, onRefreshVisited }) {
  const visited = Boolean(visitedMap[item.url]);
  const domain = getDomain(item.url);
  const googleQ = getGoogleQueryFromUrl(item.url);

  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(googleQ || item.title);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 900);
  };

  const handleOpen = () => {
    markVisited(item.url);
    onRefreshVisited?.();
  };

  return (
    <motion.a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      onClick={handleOpen}
      variants={cardFloat}
      initial="rest"
      whileHover="hover"
      whileTap="tap"
      className={[
        "group relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl transition",
        visited
          ? "border-emerald-200/70 bg-emerald-50/55"
          : "border-zinc-200/70 bg-white/70 hover:border-emerald-200 hover:bg-white/85",
        "shadow-[0_10px_30px_rgba(0,0,0,0.06)]",
      ].join(" ")}
      title={item.url}
    >
      <span className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition group-hover:opacity-100 bg-gradient-to-b from-white/55 via-white/10 to-transparent" />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-2xl border",
              visited
                ? "border-emerald-200 bg-white/60 text-emerald-800"
                : "border-emerald-100 bg-emerald-50/60 text-emerald-700",
            ].join(" ")}
          >
            <Link2 className="h-4 w-4" />
          </span>

          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">
              {item.title}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {item.note ? (
                <div className="truncate text-xs text-zinc-600">{item.note}</div>
              ) : (
                <div className="truncate text-xs text-zinc-500">Open resource</div>
              )}

              {domain ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
                  <ExternalLink className="h-3 w-3" />
                  {domain}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {googleQ ? (
          <button
            type="button"
            onClick={handleCopy}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.99]",
              copied
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white",
            ].join(" ")}
            aria-label="Copy search phrase"
            title="Copy search phrase"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}

        {visited ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Visited
          </span>
        ) : (
          <span className="rounded-full border border-zinc-200 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
            Open
          </span>
        )}
      </div>
    </motion.a>
  );
}

function SectionCard({ title, subtitle, children, index }) {
  return (
    <motion.div
      variants={pageIn}
      initial="hidden"
      animate="show"
      transition={{ delay: Math.min(index * 0.04, 0.18) }}
      className="rounded-3xl border border-zinc-200/70 bg-white/72 p-5 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-zinc-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-zinc-600">{subtitle}</p> : null}
        </div>

        <div className="hidden sm:block h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/60" />
      </div>

      <div className="mt-4 grid gap-3">{children}</div>
    </motion.div>
  );
}

export default function TravelSelfHelp() {
  const navigate = useNavigate();
  const location = useLocation();
  const country = new URLSearchParams(location.search).get("country") || "";

  const [visitedMap, setVisitedMap] = useState({});

  const refreshVisited = () => setVisitedMap(loadVisited());

  useEffect(() => {
    refreshVisited();
    const onStorage = (e) => {
      if (e.key === VISITED_KEY) refreshVisited();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const goBackToChoice = () => {
    navigate(`/app/travel?country=${encodeURIComponent(country)}&from=choice`);
  };

  const qs = encodeURIComponent(country || "destination country");

  const sections = useMemo(() => {
    return [
      {
        title: "Visa & entry rules",
        subtitle: "Always confirm from official sources.",
        links: [
          {
            title: `Search: “${country || "your destination"} tourist visa official government site”`,
            url: `https://www.google.com/search?q=${qs}+tourist+visa+official+government+site`,
            note: "Use the top government result",
          },
          {
            title: "EmbassyPages — embassies & consulates directory",
            url: "https://www.embassypages.com/",
            note: "Find the correct embassy/consulate",
          },
          {
            title: "VFS Global (if destination uses it)",
            url: "https://www.vfsglobal.com/",
            note: "Visa application center (varies)",
          },
        ],
      },
      {
        title: "Flights",
        subtitle: "Compare and set price alerts.",
        links: [
          {
            title: "Google Flights",
            url: "https://www.google.com/travel/flights",
            note: "Compare routes and prices",
          },
          { title: "Skyscanner", url: "https://www.skyscanner.net/", note: "Great for alerts" },
          { title: "Kayak", url: "https://www.kayak.com/", note: "Compare flight prices" },
        ],
      },
      {
        title: "Accommodation",
        subtitle: "Book safely and compare options.",
        links: [
          { title: "Booking.com", url: "https://www.booking.com/", note: "Hotels and stays" },
          { title: "Airbnb", url: "https://www.airbnb.com/", note: "Apartments and homes" },
          { title: "Hostelworld", url: "https://www.hostelworld.com/", note: "Budget travel stays" },
        ],
      },
      {
        title: "Travel insurance",
        subtitle: "Useful for medical coverage + visa requirements (varies).",
        links: [
          {
            title: "Search: “travel insurance for Kenya citizens”",
            url: "https://www.google.com/search?q=travel+insurance+for+Kenya+citizens",
            note: "Pick a reputable insurer",
          },
        ],
      },
      {
        title: "Trip planning & activities",
        subtitle: "Build an itinerary and save places.",
        links: [
          { title: "Google Maps", url: "https://www.google.com/maps", note: "Save places and routes" },
          { title: "Tripadvisor", url: "https://www.tripadvisor.com/", note: "Reviews and attractions" },
          { title: "Rome2rio", url: "https://www.rome2rio.com/", note: "Transport options between places" },
        ],
      },
    ];
  }, [country, qs]);

  const totalSites = useMemo(() => {
    const list = sections.flatMap((s) => s.links).map((x) => x.url);
    return new Set(list).size;
  }, [sections]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white">
      {/* soft background glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute top-44 -left-24 h-72 w-72 rounded-full bg-sky-200/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-100/25 blur-3xl" />
      </div>

      <motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className="px-5 py-6 max-w-xl mx-auto"
      >
        {/* Back */}
        <button
          onClick={goBackToChoice}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white active:scale-[0.99]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-extrabold text-emerald-900">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 border border-emerald-100">
                <Compass className="h-4 w-4 text-emerald-700" />
              </span>
              Travel · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-zinc-900">
              Plan your trip independently
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Tap resources below. We’ll mark what you already visited.
            </p>
          </div>

          <div className="shrink-0 h-12 w-12 rounded-3xl border border-emerald-100 bg-emerald-50/80 shadow-sm" />
        </div>

        {/* Country tile (ONLY country + total websites) */}
        <motion.div
          variants={cardFloat}
          initial="rest"
          whileHover="hover"
          whileTap="tap"
          className="mt-5 rounded-3xl border border-zinc-200/70 bg-white/72 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-zinc-500">Selected country</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-900">
                {country || "Not selected"}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-xs font-extrabold text-zinc-500">Websites</p>
              <p className="mt-1 text-sm font-extrabold text-emerald-800">{totalSites}</p>
            </div>
          </div>
        </motion.div>

        {/* Sections */}
        <div className="mt-6 grid gap-4">
          {sections.map((sec, i) => (
            <SectionCard key={sec.title} title={sec.title} subtitle={sec.subtitle} index={i}>
              {sec.links.map((l) => (
                <LinkRow
                  key={l.url}
                  item={l}
                  visitedMap={visitedMap}
                  onRefreshVisited={refreshVisited}
                />
              ))}
            </SectionCard>
          ))}

          {/* Safety tip */}
          <motion.div
            variants={cardFloat}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className="rounded-3xl border border-dashed border-zinc-300 bg-white/55 p-5 text-sm text-zinc-700 backdrop-blur"
          >
            <div className="font-extrabold text-zinc-900">Safety tip</div>
            <p className="mt-1">
              For visa rules, trust the <b>official government</b> site more than random websites.
            </p>
          </motion.div>
        </div>

        <div className="h-10" />
      </motion.div>
    </div>
  );
}