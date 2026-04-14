"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "./shell";

const STEPS = [
  {
    number: "01",
    title: "Prep",
    desc: "Upload a supporting PDF if you want grounded questions.",
  },
  {
    number: "02",
    title: "Rehearse",
    desc: "Enter a Meet-style rehearsal room, grant mic access once, and let the avatar begin the conversation.",
  },
  {
    number: "03",
    title: "Review",
    desc: "End the session and return to evaluation cards with scores, improvement resources, and session comparisons.",
  },
];

export function LandingPage() {
  const [showLimits, setShowLimits] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem("pitchmirror-demo-limits-dismissed");
    if (!dismissed) {
      setShowLimits(true);
    }
  }, []);

  function dismissLimits() {
    setShowLimits(false);
    window.localStorage.setItem("pitchmirror-demo-limits-dismissed", "1");
  }

  return (
    <AppShell>
      {showLimits ? (
        <div className="landing-modal-backdrop" role="presentation">
          <div className="landing-modal" role="dialog" aria-modal="true" aria-labelledby="demo-limits-title">
            <div className="eyebrow">Public demo</div>
            <h2 id="demo-limits-title" style={{ margin: "14px 0 8px", fontSize: "1.4rem" }}>
              Demo limits before you start
            </h2>
            <p className="muted-copy" style={{ margin: 0 }}>
              This public build allows up to 2 live sessions per browser per day, with a 2-minute cap per session.
              Investor and Coding are the best agents to try first.
            </p>
            <div className="button-row" style={{ marginTop: 18 }}>
              <button type="button" className="btn btn-primary" onClick={dismissLimits}>
                Got it
              </button>
              <Link href="/agents" className="btn btn-secondary" onClick={dismissLimits}>
                View agents
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hero — centered */}
      <div className="hero-centered">
        <h1 className="hero-title">
          Rehearse the room before you ever walk into it.
        </h1>
        <p className="hero-copy">
          PitchMirror pairs with role-specific coaching
          surfaces so you can practice interviews, project presentations, startup pitches,
          and high-pressure Q&amp;A in one calm workspace.
        </p>
        <div className="hero-cta-centered">
          <Link href="/agents" className="btn btn-primary" style={{ minWidth: 180, fontSize: "1.05rem" }}>
            View Agents
          </Link>
        </div>
      </div>

      {/* How a session feels — horizontal 3-step card */}
      <div className="steps-panel">
        <div className="steps-panel-label">How a session feels</div>
        <div className="steps-row">
          {STEPS.map((step) => (
            <div className="step-card" key={step.number}>
              <span className="step-number">{step.number}</span>
              <p className="step-title">{step.title}</p>
              <p className="step-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
