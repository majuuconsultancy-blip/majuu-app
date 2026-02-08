import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* -------- Minimal icon -------- */
function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 7h16a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M2 12h20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLink(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10.2 13.8a4 4 0 0 1 0-5.6l2.1-2.1a4 4 0 0 1 5.6 5.6l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M13.8 10.2a4 4 0 0 1 0 5.6l-2.1 2.1a4 4 0 0 1-5.6-5.6l1.2-1.2"
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
        d="M6 12.5 10 16.5 18 7.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function LinkRow({ item, visitedMap }) {
  const visited = Boolean(visitedMap[item.url]);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      onClick={() => markVisited(item.url)}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-white"
      title={item.url}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/60 text-emerald-700">
            <IconLink className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">
              {item.title}
            </div>
            {item.note ? (
              <div className="mt-0.5 truncate text-xs text-zinc-500">
                {item.note}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {visited ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            <IconCheck className="h-3.5 w-3.5" />
            Visited
          </span>
        ) : (
          <span className="rounded-full border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] font-semibold text-zinc-700">
            Open
          </span>
        )}
      </div>
    </a>
  );
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs text-zinc-500">{subtitle}</p> : null}
      <div className="mt-4 grid gap-3">{children}</div>
    </div>
  );
}

export default function WorkSelfHelp() {
  const navigate = useNavigate();
  const location = useLocation();
  const country = new URLSearchParams(location.search).get("country") || "";

  const [visitedMap, setVisitedMap] = useState({});

  useEffect(() => {
    setVisitedMap(loadVisited());
    const onStorage = (e) => {
      if (e.key === VISITED_KEY) setVisitedMap(loadVisited());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const goBackToChoice = () => {
    navigate(`/app/work?country=${encodeURIComponent(country || "")}&from=choice`);
  };

  const qs = encodeURIComponent(country || "destination country");

  const sections = useMemo(() => {
    return [
      {
        title: "Job search platforms",
        subtitle: "Start applying + build your shortlist.",
        links: [
          { title: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs/", note: "Strong for professional roles" },
          { title: "Indeed", url: "https://www.indeed.com/", note: "Big job board (varies by country)" },
          { title: "Glassdoor", url: "https://www.glassdoor.com/Job/index.htm", note: "Jobs + company reviews" },
          {
            title: `Search: “government job portal ${country || "your destination"}”`,
            url: `https://www.google.com/search?q=government+job+portal+${qs}`,
            note: "Try to use the official government portal if available",
          },
        ],
      },
      {
        title: "Work visa / permit guidance",
        subtitle: "Always confirm requirements on official sites.",
        links: [
          {
            title: `Search: “${country || "destination"} work visa official government site”`,
            url: `https://www.google.com/search?q=${qs}+work+visa+official+government+site`,
            note: "Use the top government result",
          },
          {
            title: "EmbassyPages — embassies & consulates directory",
            url: "https://www.embassypages.com/",
            note: "Find your destination embassy in Kenya",
          },
          {
            title: "VFS Global (if destination uses it)",
            url: "https://www.vfsglobal.com/",
            note: "Visa application center (varies)",
          },
        ],
      },
      {
        title: "CV / Resume & interviews",
        subtitle: "Polish your documents before applying.",
        links: [
          { title: "Canva Resume Templates", url: "https://www.canva.com/resumes/templates/", note: "Fast and clean CV templates" },
          { title: "Europass CV (EU style)", url: "https://europa.eu/europass/en/create-europass-cv", note: "Useful for many EU jobs" },
          { title: "Interview tips (Google search)", url: "https://www.google.com/search?q=job+interview+prep+checklist", note: "Pick reputable sources" },
        ],
      },
      {
        title: "Relocation basics",
        subtitle: "Budgeting, housing, and cost of living.",
        links: [
          { title: "Numbeo — cost of living", url: "https://www.numbeo.com/cost-of-living/", note: "Compare cities and costs" },
          { title: "Booking.com", url: "https://www.booking.com/", note: "Short stays for arrival week" },
          { title: "Airbnb", url: "https://www.airbnb.com/", note: "Short/medium stays" },
        ],
      },
    ];
  }, [country, qs]);

  return (
    <div className="min-h-screen">
      <div className="px-5 py-6">
        {/* Back */}
        <button
          onClick={goBackToChoice}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          ← Back
        </button>

        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <IconBriefcase className="h-4 w-4 text-emerald-700" />
              </span>
              Work · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Work abroad, step by step
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Tap links below — we’ll remember what you visited.
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Country card */}
        <div className="mt-5 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold text-zinc-500">Selected country</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {country || "Not selected"}
          </p>
        </div>

        {/* Sections */}
        <div className="mt-6 grid gap-4">
          {sections.map((sec) => (
            <SectionCard key={sec.title} title={sec.title} subtitle={sec.subtitle}>
              {sec.links.map((l) => (
                <LinkRow key={l.url} item={l} visitedMap={visitedMap} />
              ))}
            </SectionCard>
          ))}

          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 p-5 text-sm text-zinc-600">
            Tip: if a website asks for money upfront, always cross-check with the
            <b> official embassy / government</b> source.
          </div>
        </div>
      </div>
    </div>
  );
}