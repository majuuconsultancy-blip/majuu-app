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

function IconChat(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.8 18.8 4.4 20V7.2A2.8 2.8 0 0 1 7.2 4.4h9.6a2.8 2.8 0 0 1 2.8 2.8v6.6a2.8 2.8 0 0 1-2.8 2.8H9.8L6.8 18.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 9.2h8M8 12.6h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.5 4.6h2.4a1.6 1.6 0 0 1 1.5 1.2l.6 2.7a1.6 1.6 0 0 1-.4 1.4l-1.2 1.2a12.7 12.7 0 0 0 4.5 4.5l1.2-1.2a1.6 1.6 0 0 1 1.4-.4l2.7.6a1.6 1.6 0 0 1 1.2 1.5v2.4a1.7 1.7 0 0 1-1.7 1.7h-1.1C10.4 20.2 3.8 13.6 3.8 5.8V4.7A1.7 1.7 0 0 1 5.5 3h2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPin(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 20.2s5.4-5.1 5.4-9a5.4 5.4 0 1 0-10.8 0c0 3.9 5.4 9 5.4 9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11.2" r="1.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconHelp(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9.6 9.3a2.5 2.5 0 1 1 4.8.9c-.5.8-1.5 1.3-2.1 1.8-.5.4-.8.9-.8 1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 17.5h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
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

const SUPPORT_PHONE = "+254799766626";
const SUPPORT_PHONE_DIGITS = "254799766626";
const SUPPORT_LOCATION = "Eldoret, Kenya";
const HELP_FAQS = [
  {
    question: "How do I know which request type to start?",
    answer: "Choose your track first, then pick the request that matches your goal. Progress keeps all active request updates in one place.",
  },
  {
    question: "Where can I ask for quick support?",
    answer: "Use WhatsApp Help or Call Support for direct assistance on account, payment, and request questions.",
  },
  {
    question: "Where do refund and escrow rules live?",
    answer: "Open the Refund Policy and Escrow Policy below for the latest payment, review, and release rules used in MAJUU.",
  },
];

export default function LegalPortalScreen({ mode = "public" }) {
  const navigate = useNavigate();
  const docs = useMemo(() => getPublicLegalDocuments(), []);

  const scope = mode === "app" ? "app" : "public";
  const fallback = scope === "app" ? "/app/profile" : "/login";
  const helpActions = [
    {
      title: "WhatsApp Help",
      subtitle: SUPPORT_PHONE,
      href: `https://wa.me/${SUPPORT_PHONE_DIGITS}`,
      Icon: IconChat,
      external: true,
    },
    {
      title: "Call Support",
      subtitle: SUPPORT_PHONE,
      href: `tel:${SUPPORT_PHONE}`,
      Icon: IconPhone,
      external: false,
    },
    {
      title: "Headquarters",
      subtitle: SUPPORT_LOCATION,
      Icon: IconPin,
    },
    {
      title: "FAQs",
      subtitle: `${HELP_FAQS.length} quick answers`,
      Icon: IconHelp,
    },
  ];

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

          <section className="mt-4 rounded-[28px] border border-emerald-100 bg-white/75 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <IconHelp className="h-4 w-4" />
              Support hub
            </div>

            <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Legal Policies Help Center
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              Get policy documents, support contacts, and quick answers in one place.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-950/40">
                Support: {SUPPORT_PHONE}
              </span>
              <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-950/40">
                Location: {SUPPORT_LOCATION}
              </span>
            </div>
          </section>

          <section className="mt-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Help center
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Reach support or find quick guidance fast.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {helpActions.map((item) => {
                const card = (
                  <div className="rounded-3xl border border-zinc-200/80 bg-white/75 p-4 shadow-sm transition hover:border-emerald-200 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/55 dark:hover:bg-zinc-900/70">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                        <item.Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                  </div>
                );

                if (!item.href) {
                  return <div key={item.title}>{card}</div>;
                }

                return (
                  <a
                    key={item.title}
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noreferrer" : undefined}
                    className="block"
                  >
                    {card}
                  </a>
                );
              })}
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Policies
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Review the current terms, privacy, payments, and dispute rules used in MAJUU.
                </p>
              </div>
              <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
                {docs.length} documents
              </span>
            </div>

            <div className="mt-3 grid gap-2">
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
          </section>

          <section className="mt-6 rounded-[28px] border border-zinc-200/80 bg-white/75 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                <IconHelp className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  FAQs
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  A few quick answers before you contact support.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {HELP_FAQS.map((item) => (
                <div
                  key={item.question}
                  className="rounded-2xl border border-zinc-200/80 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35"
                >
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.question}
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
