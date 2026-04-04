"use client";

import Link from "next/link";
import { useAppState } from "./app-provider";

export function AppShell({ children, compact = false }) {
  const { state, setTheme, toasts, dismissToast } = useAppState();
  const isLight = state.theme === "light";

  return (
    <div className="app-shell">
      <div className="page-frame">
        <header className="topbar">
          <Link href="/" className="brand">
            <div className="brand-mark">PM</div>
            <div>
              <div className="brand-title">PitchMirror</div>
              <div className="brand-subtitle">
                {compact
                  ? "Live rehearsal room"
                  : "Scenario-specific rehearsal rooms with live avatar feedback"}
              </div>
            </div>
          </Link>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(isLight ? "dark" : "light")}
          >
            <span>{isLight ? "Dark mode" : "Light mode"}</span>
            <strong>{isLight ? "Moon" : "Sun"}</strong>
          </button>
        </header>
        {children}
        {toasts.length ? (
          <div className="toast-stack">
            {toasts.map((toast) => (
              <button
                type="button"
                key={toast.id}
                className="toast"
                onClick={() => dismissToast(toast.id)}
              >
                {toast.message}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
