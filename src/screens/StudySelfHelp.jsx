import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ---------- Minimal icons ---------- */
function IconBook(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 5.5h10a3 3 0 0 1 3 3v11H7.5a3 3 0 0 0-3 3v-17Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 19.5V8.5A3 3 0 0 1 10.5 5.5h9"
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </div>
  );
}

export default function StudySelfHelp() {
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
    navigate(`/app/study?country=${encodeURIComponent(country)}&from=choice`);
  };

  const qs = encodeURIComponent(country || "selected country");

  const sections = useMemo(() => {
    return [
      {
        title: "Universities & programs",
        subtitle: "Find schools, compare programs, and shortlist options.",
        links: [
          {
            title: "Studyportals — Bachelor & Master programs",
            url: "https://www.studyportals.com/",
            note: "Search programs by country & subject",
          },
          {
            title: "QS Top Universities",
            url: "https://www.topuniversities.com/",
            note: "Rankings + university profiles",
          },
          {
            title: "Times Higher Education (THE) Rankings",
            url: "https://www.timeshighereducation.com/world-university-rankings",
            note: "Rankings and insights",
          },
          {
            title: `Search: “universities in ${country || "your country"} admissions”`,
            url: `https://www.google.com/search?q=universities+in+${qs}+admissions`,
            note: "Quick way to find official university admissions pages",
          },
        ],
      },
      {
        title: "Scholarships & funding",
        subtitle: "Popular global scholarship sources (start here).",
        links: [
          {
            title: "DAAD Scholarships (Germany)",
            url: "https://www.daad.de/en/study-and-research-in-germany/scholarships/",
            note: "Official DAAD scholarships portal",
          },
          {
            title: "Chevening Scholarships (UK)",
            url: "https://www.chevening.org/",
            note: "UK government scholarship program",
          },
          {
            title: "Fulbright Program (US)",
            url: "https://foreign.fulbrightonline.org/",
            note: "Official Fulbright applications/info",
          },
          {
            title: "Erasmus+ (EU)",
            url: "https://erasmus-plus.ec.europa.eu/",
            note: "EU education program (official)",
          },
        ],
      },
      {
        title: "Visa, embassy & official guidance",
        subtitle:
          "Always prioritize official government/embassy pages for requirements.",
        links: [
          {
            title: "EmbassyPages — embassies & consulates directory",
            url: "https://www.embassypages.com/",
            note: "Find the correct embassy/consulate",
          },
          {
            title: `Search: “${country || "your destination"} student visa official site”`,
            url: `https://www.google.com/search?q=${qs}+student+visa+official+government+site`,
            note: "Use the top government result",
          },
          {
            title: "VFS Global (if your destination uses it)",
            url: "https://www.vfsglobal.com/",
            note: "Visa application center (varies by country)",
          },
        ],
      },
      {
        title: "English tests & credential evaluation",
        subtitle: "Common requirements for many study destinations.",
        links: [
          { title: "IELTS", url: "https://www.ielts.org/", note: "Official site" },
          { title: "TOEFL", url: "https://www.ets.org/toefl", note: "Official site" },
          {
            title: "WES (credential evaluation)",
            url: "https://www.wes.org/",
            note: "Often needed for US/Canada (varies)",
          },
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
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70 border border-emerald-100">
                <IconBook className="h-4 w-4 text-emerald-700" />
              </span>
              Study Abroad · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Do it yourself, step by step
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Tap resources below. We’ll mark what you already visited.
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Country */}
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
            Tip: the safest info is always the <b>official government/embassy</b>{" "}
            page for your destination.
            we are not responsible for any damage caused by malicious links.
          </div>
        </div>
      </div>
    </div>
  );
}