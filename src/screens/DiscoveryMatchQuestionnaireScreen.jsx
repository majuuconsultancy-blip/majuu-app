import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, Route, Sparkles } from "lucide-react";

import { motion as Motion } from "../utils/motionproxy";
import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import {
  createEmptyDiscoveryMatchAnswers,
  getDiscoveryMatchQuestions,
} from "../services/discoveryMatchService";

function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

export default function DiscoveryMatchQuestionnaireScreen({ track = "study" }) {
  const navigate = useNavigate();
  const safeTrack = normalizeTrackType(track || "study");
  const trackMeta = APP_TRACK_META[safeTrack] || APP_TRACK_META.study;
  const questions = useMemo(() => getDiscoveryMatchQuestions(safeTrack), [safeTrack]);

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState(() => createEmptyDiscoveryMatchAnswers(safeTrack));

  const currentQuestion = questions[stepIndex] || null;
  const selectedOption = safeString(answers?.[currentQuestion?.id], 40);
  const isLastStep = stepIndex >= questions.length - 1;
  const progressValue = questions.length ? (stepIndex + 1) / questions.length : 0;

  const goBack = () => {
    if (stepIndex <= 0) {
      navigate(`/app/${safeTrack}/discovery`);
      return;
    }
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const selectOption = (optionId) => {
    if (!currentQuestion?.id) return;
    const safeOption = safeString(optionId, 60);
    setAnswers((current) => ({
      ...(current || {}),
      [currentQuestion.id]: safeOption,
    }));
  };

  const continueFlow = () => {
    if (!currentQuestion?.id || !selectedOption) return;
    if (!isLastStep) {
      setStepIndex((current) => Math.min(questions.length - 1, current + 1));
      return;
    }
    navigate(`/app/${safeTrack}/discovery/match/results`, {
      state: {
        answers,
        completedAtMs: Date.now(),
      },
    });
  };

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white pb-10 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto max-w-3xl px-5 py-6">
        <section className="relative overflow-hidden rounded-[30px] border border-white/75 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-zinc-800 dark:bg-zinc-900/60">
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-700/20"
            animate={{ x: [0, -8, 0], y: [0, 7, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 left-[-54px] h-36 w-36 rounded-full bg-emerald-300/24 blur-3xl dark:bg-emerald-700/18"
            animate={{ x: [0, 7, 0], y: [0, -7, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/85 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Discovery
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon size={ICON_SM} icon={Compass} />
              {trackMeta.label} Match
            </div>
          </div>

          <h1 className="relative mt-4 text-[1.56rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Find My Best Match
          </h1>
          <p className="relative mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Quick, track-aware questions to recommend your strongest country options.
          </p>

          <div className="relative mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              <span>
                Step {stepIndex + 1}/{questions.length}
              </span>
              <span>{Math.round(progressValue * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
              <Motion.div
                className="h-full rounded-full bg-emerald-500"
                animate={{ width: `${Math.max(10, progressValue * 100)}%` }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            </div>
          </div>
        </section>

        <Motion.section
          key={currentQuestion.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="mt-5"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            Question {stepIndex + 1}
          </div>
          <h2 className="mt-2 text-[1.32rem] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">
            {currentQuestion.title}
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{currentQuestion.subtitle}</p>

          <div className="mt-4 grid gap-2.5">
            {(Array.isArray(currentQuestion.options) ? currentQuestion.options : []).map((option) => {
              const active = selectedOption === option.id;
              return (
                <button
                  key={`${currentQuestion.id}-${option.id}`}
                  type="button"
                  onClick={() => selectOption(option.id)}
                  className={`group flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                    active
                      ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                      : "border-zinc-200/80 bg-white/84 hover:border-emerald-200 hover:bg-emerald-50/45 dark:border-zinc-700 dark:bg-zinc-900/65"
                  }`}
                >
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{option.label}</div>
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                      active
                        ? "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                        : "border-zinc-200 bg-white/85 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                    }`}
                  >
                    <AppIcon size={ICON_SM} icon={active ? Sparkles : Route} />
                  </span>
                </button>
              );
            })}
          </div>
        </Motion.section>

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
          >
            <AppIcon size={ICON_SM} icon={ArrowLeft} />
            Back
          </button>
          <button
            type="button"
            onClick={continueFlow}
            disabled={!selectedOption}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/40"
          >
            {isLastStep ? "View Results" : "Next"}
            <AppIcon size={ICON_MD} icon={Route} />
          </button>
        </div>
      </div>
    </div>
  );
}
