// âœ… StudySelfHelp.jsx (FULL COPY-PASTE)
// CHANGE: Redo ALL icons using lucide-react (no custom SVG icon components)
// âœ… ADD: Android hardware back ALWAYS goes to TrackScreen (/app/study)
// - Uses history.pushState + popstate trap (PWA-safe)
// - On-screen Back also goes to /app/study
// Everything else (layout/logic/keys) unchanged.
// Keeps visited memory key: majuu_visited_links_v1

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "../utils/motionProxy";
import { smartBack } from "../utils/navBack";
import {
  BookOpen,
  Link2,
  ArrowLeft,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM } from "../constants/iconSizes";
import { setSnapshot } from "../resume/resumeEngine";

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

  const handleOpen = () => {
    markVisited(item.url);
    onRefreshVisited?.();
  };

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      onClick={handleOpen}
      className={[
        "group flex w-full items-start gap-3 rounded-xl border px-4 py-3 transition",
        visited
          ? "border-emerald-200/80 bg-emerald-50/50"
          : "border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 hover:border-emerald-200/80 hover:bg-white",
      ].join(" ")}
      title={item.url}
    >
      <AppIcon
        size={ICON_SM}
        icon={Link2}
        className={[
          "mt-0.5 shrink-0 transition-colors",
          visited ? "text-emerald-700" : "text-zinc-500 group-hover:text-emerald-700",
        ].join(" ")}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="truncate">{item.note || "Tap to open"}</span>
          {domain ? <span className="text-zinc-500 dark:text-zinc-400">• {domain}</span> : null}
          {visited ? <span className="text-emerald-700">Opened</span> : null}
        </div>
      </div>
    </a>
  );
}

function SectionCard({ title, subtitle, children, index }) {
  return (
    <motion.div
      variants={pageIn}
      initial="hidden"
      animate="show"
      transition={{ delay: Math.min(index * 0.04, 0.18) }}
      className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 p-4 sm:p-5"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{subtitle}</p> : null}
      </div>

      <div className="mt-3 grid gap-2.5">{children}</div>
    </motion.div>
  );
}

export default function StudySelfHelp() {
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

  useEffect(() => {
    setSnapshot({
      route: {
        path: location.pathname,
        search: location.search || "",
      },
      selfHelp: {
        track: "study",
        country,
        screenKey: `study:${country || "not-selected"}`,
      },
    });
  }, [country, location.pathname, location.search]);

  // âœ… Desired back destination (TrackScreen)
  const backUrl = `/app/study?country=${encodeURIComponent(country || "")}&from=choice`;

  // âœ… HARD FIX: Android hardware back ALWAYS goes to TrackScreen (/app/study)
  useEffect(() => {
    try {
      window.history.pushState(
        { __majuu_selfhelp_back_trap: true },
        "",
        window.location.href
      );
    } catch {}

    const onPopState = () => {
      navigate(backUrl, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, backUrl]);

  // âœ… On-screen Back
  const goBackToChoice = () => {
    smartBack(navigate, "/app/home");
  };

  const qs = encodeURIComponent(country || "selected country");

  const sections = useMemo(() => {
    return [
      {
        title: "Universities & programs",
        subtitle: "Find schools, compare programs, and shortlist options.",
        links: [
          { title: "Studyportals â€” Bachelor & Master programs", url: "https://www.studyportals.com/", note: "Search programs by country & subject" },
          { title: "QS Top Universities", url: "https://www.topuniversities.com/", note: "Rankings + university profiles" },
          { title: "Times Higher Education (THE) Rankings", url: "https://www.timeshighereducation.com/world-university-rankings", note: "Rankings and insights" },
          {
            title: `Search: â€œuniversities in ${country || "your country"} admissionsâ€`,
            url: `https://www.google.com/search?q=universities+in+${qs}+admissions`,
            note: "Quick way to find official university admissions pages",
          },
        ],
      },
      {
        title: "Scholarships & funding",
        subtitle: "Popular global scholarship sources (start here).",
        links: [
          { title: "DAAD Scholarships (Germany)", url: "https://www.daad.de/en/study-and-research-in-germany/scholarships/", note: "Official DAAD scholarships portal" },
          { title: "Chevening Scholarships (UK)", url: "https://www.chevening.org/", note: "UK government scholarship program" },
          { title: "Fulbright Program (US)", url: "https://foreign.fulbrightonline.org/", note: "Official Fulbright applications/info" },
          { title: "Erasmus+ (EU)", url: "https://erasmus-plus.ec.europa.eu/", note: "EU education program (official)" },
        ],
      },
      {
        title: "Visa, embassy & official guidance",
        subtitle: "Always prioritize official government/embassy pages for requirements.",
        links: [
          { title: "EmbassyPages â€” embassies & consulates directory", url: "https://www.embassypages.com/", note: "Find the correct embassy/consulate" },
          {
            title: `Search: â€œ${country || "your destination"} student visa official siteâ€`,
            url: `https://www.google.com/search?q=${qs}+student+visa+official+government+site`,
            note: "Use the top government result",
          },
          { title: "VFS Global (if your destination uses it)", url: "https://www.vfsglobal.com/", note: "Visa application center (varies by country)" },
        ],
      },
      {
        title: "English tests & credential evaluation",
        subtitle: "Common requirements for many study destinations.",
        links: [
          { title: "IELTS", url: "https://www.ielts.org/", note: "Official site" },
          { title: "TOEFL", url: "https://www.ets.org/toefl", note: "Official site" },
          { title: "WES (credential evaluation)", url: "https://www.wes.org/", note: "Often needed for US/Canada (varies)" },
        ],
      },
      {
        title: "Flights & accommodation",
        subtitle: "Use trusted platforms + compare prices.",
        links: [
          { title: "Google Flights", url: "https://www.google.com/travel/flights", note: "Compare flight options" },
          { title: "Skyscanner", url: "https://www.skyscanner.net/", note: "Flight search & alerts" },
          { title: "Booking.com", url: "https://www.booking.com/", note: "Hotels & stays" },
          { title: "Airbnb", url: "https://www.airbnb.com/", note: "Short/long stays" },
        ],
      },
    ];
  }, [country, qs]);

  const totalSites = useMemo(() => {
    const list = sections.flatMap((s) => s.links).map((x) => x.url);
    return new Set(list).size;
  }, [sections]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute top-44 -left-24 h-72 w-72 rounded-full bg-sky-200/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-100/25 blur-3xl" />
      </div>

      <motion.div variants={pageIn} initial="hidden" animate="show" className="px-5 py-6 max-w-2xl mx-auto">
        <button
          onClick={goBackToChoice}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white active:scale-[0.99]"
        >
          <AppIcon size={ICON_SM} icon={ArrowLeft} />
          Back
        </button>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-900/60 border border-emerald-100">
                <AppIcon size={ICON_SM} className="text-emerald-700" icon={BookOpen} />
              </span>
              Study self-help
            </div>

            <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Study links
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Tap any link to open in your browser.
            </p>
          </div>
        </div>

        <motion.div
          variants={cardFloat}
          initial="rest"
          whileHover="hover"
          whileTap="tap"
          className="mt-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-500">Country</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {country || "No country selected"}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-zinc-500">Links</p>
              <p className="mt-1 text-sm font-semibold text-emerald-800">{totalSites}</p>
            </div>
          </div>
        </motion.div>

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

          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Safety
            </p>
            <p className="mt-1">Always verify important details on official embassy or government websites.</p>
          </div>
        </div>

        <div className="h-10" />
      </motion.div>

    </div>
  );
}



