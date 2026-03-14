import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { smartBack } from "../utils/navBack";
import {
  buildLegalDocRoute,
  getPublicLegalDocuments,
  LEGAL_DOC_KEYS,
} from "../legal/legalRegistry";

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

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9.5 5.5 16 12l-6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDocument(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.5 3.5h6.6l3.4 3.4v12.6a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19.5V5a1.5 1.5 0 0 1 1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 3.8V7h3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 11h6M9 14h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const DOC_NOTE_BY_KEY = {
  [LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS]: "Core terms for using MAJUU services.",
  [LEGAL_DOC_KEYS.PRIVACY_POLICY]: "How personal data is collected and used.",
  [LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY]: "Rules for safe and lawful platform use.",
  [LEGAL_DOC_KEYS.REFUND_POLICY]: "How refunds are requested and processed.",
  [LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY]: "How disputes and escalations are handled.",
  [LEGAL_DOC_KEYS.ESCROW_POLICY]: "How payment release and safeguards work.",
};

export default function LegalPortalScreen({ mode = "public" }) {
  const navigate = useNavigate();
  const docs = useMemo(() => getPublicLegalDocuments(), []);

  const scope = mode === "app" ? "app" : "public";
  const fallback = scope === "app" ? "/app/profile" : "/login";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-8">
        <div className="max-w-xl mx-auto px-5 py-6">
          <button
            type="button"
            onClick={() => smartBack(navigate, fallback)}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back
          </button>

          <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Legal & Policies
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Review the latest legal and policy documents used across MAJUU.
          </p>

          <div className="mt-5 grid gap-2">
            {docs.map((doc) => (
              <button
                key={doc.key}
                type="button"
                onClick={() => navigate(buildLegalDocRoute(doc.key, { scope }))}
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                      <IconDocument className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{doc.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {DOC_NOTE_BY_KEY[doc.key] || "View full document"}
                      </div>
                    </div>
                  </div>
                  <IconChevronRight className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
