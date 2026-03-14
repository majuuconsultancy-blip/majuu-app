import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { smartBack } from "../utils/navBack";
import {
  buildLegalPortalRoute,
  getLegalDocument,
  LEGAL_MOUNT_LOCATIONS,
} from "../legal/legalRegistry";
import { getLegalDocumentContent } from "../legal/legalContent";

function IconChevronLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function resolveFallbackPath(pathname = "", state = {}) {
  const stateBackTo = String(state?.backTo || "").trim();
  if (stateBackTo) return stateBackTo;

  if (pathname.startsWith("/staff/onboarding/")) return "/staff/onboarding";
  if (pathname.startsWith("/app/service-partner/onboarding/")) return "/app/service-partner/onboarding";
  if (pathname.startsWith("/app/")) return buildLegalPortalRoute("app");
  return buildLegalPortalRoute("public");
}

export default function LegalDocumentScreen() {
  const { docKey = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = String(location.pathname || "");

  const doc = useMemo(() => getLegalDocument(docKey), [docKey]);
  const isDocAllowed = useMemo(() => {
    if (!doc) return false;

    if (pathname.startsWith("/staff/onboarding/")) {
      return Array.isArray(doc.mountLocations)
        ? doc.mountLocations.includes(LEGAL_MOUNT_LOCATIONS.STAFF_ONBOARDING)
        : false;
    }

    if (pathname.startsWith("/app/service-partner/onboarding/")) {
      return Array.isArray(doc.mountLocations)
        ? doc.mountLocations.includes(LEGAL_MOUNT_LOCATIONS.SERVICE_PARTNER_ONBOARDING)
        : false;
    }

    if (pathname.startsWith("/legal/") || pathname.startsWith("/app/legal/")) {
      return doc.publicPortal === true;
    }

    return false;
  }, [doc, pathname]);

  const content = useMemo(() => {
    if (!doc || !isDocAllowed) return null;
    return getLegalDocumentContent(doc.key);
  }, [doc, isDocAllowed]);

  const fallbackPath = resolveFallbackPath(location.pathname, location.state || {});

  if (!doc || !content || !isDocAllowed) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-8">
          <div className="max-w-xl mx-auto px-5 py-6">
            <button
              type="button"
              onClick={() => smartBack(navigate, fallbackPath)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            >
              <IconChevronLeft className="h-4 w-4" />
              Back
            </button>

            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-700 dark:text-zinc-300">
              Legal document not found.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-10">
        <div className="max-w-xl mx-auto px-5 py-6">
          <button
            type="button"
            onClick={() => smartBack(navigate, fallbackPath)}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/65 p-5 shadow-sm">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {doc.title}
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Last updated: {content.lastUpdated}
            </p>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{content.summary}</p>
          </div>

          <div className="mt-4 grid gap-3">
            {content.sections.map((section) => (
              <section
                key={section.title}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</h2>
                <div className="mt-2 grid gap-2">
                  {section.paragraphs.map((paragraph, idx) => (
                    <p key={`${section.title}-${idx}`} className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
