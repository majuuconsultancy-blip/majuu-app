import { Component } from "react";

function safeMessage(error) {
  const text = String(error?.message || "").trim();
  return text || "Something went wrong while opening this screen.";
}

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleGoBack = this.handleGoBack.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error("Unknown route error") };
  }

  componentDidCatch(error, info) {
    console.error("RouteErrorBoundary caught error:", error, info);
  }

  handleGoBack() {
    const fallbackPath = String(this.props.fallbackPath || "/dashboard");
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(fallbackPath);
    }
  }

  handleReload() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white px-5 py-8">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-rose-200 bg-white/90 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">
            Screen Error
          </div>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900">
            We could not open this page.
          </h1>
          <p className="mt-2 text-sm text-zinc-700">{safeMessage(this.state.error)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={this.handleGoBack}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:border-emerald-200 hover:bg-emerald-50/60"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
