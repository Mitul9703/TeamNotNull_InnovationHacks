"use client";

import Link from "next/link";
import { AGENTS } from "../lib/agents";
import { AppShell } from "./shell";

export function LandingPage() {
  return (
    <AppShell>
      <section className="hero">
        <div className="panel panel-padded">
          <div className="eyebrow">Claude-coded rehearsal flow</div>
          <h1 className="hero-title">
            Rehearse the room before you ever walk into it.
          </h1>
          <p className="hero-copy">
            PitchMirror pairs live Simli avatars with role-specific coaching
            surfaces so you can practice interviews, lectures, startup pitches,
            and high-pressure Q and A in one calm workspace.
          </p>
          <div className="cta-row">
            <Link href="#agents" className="btn btn-primary">
              Choose an agent
            </Link>
            <a href="#workflow" className="btn btn-secondary">
              View rehearsal flow
            </a>
          </div>
        </div>

        <div className="panel panel-padded">
          <div className="section-title">How a session feels</div>
          <div className="sidebar-stack">
            <div className="subtle-card">
              <div className="agent-badge">1. Prep</div>
              <p className="muted-copy">
                Upload a supporting PDF if you want grounded questions. The
                deck uploads instantly when selected, and the session button
                stays locked until processing finishes.
              </p>
            </div>
            <div className="subtle-card">
              <div className="agent-badge">2. Rehearse</div>
              <p className="muted-copy">
                Enter a Meet-style rehearsal room, grant mic access once, and
                let the avatar begin the conversation in the same tab.
              </p>
            </div>
            <div className="subtle-card">
              <div className="agent-badge">3. Review</div>
              <p className="muted-copy">
                End the session and return to static evaluation cards with a
                rating prompt and summary metrics.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="agents" className="grid-4">
        {AGENTS.map((agent) => (
          <Link
            href={`/agents/${agent.slug}`}
            className="agent-card"
            key={agent.slug}
          >
            <div className="agent-title-row">
              <div>
                <div className="agent-badge">{agent.role}</div>
                <h2 className="agent-title">{agent.name}</h2>
              </div>
              <div className="eyebrow">{agent.duration}</div>
            </div>
            <p className="agent-blurb">{agent.description}</p>
            <div className="pill-row">
              {agent.focus.map((item) => (
                <span className="pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <div className="metrics-mini">
              {agent.previewMetrics.map((metric) => (
                <div className="metric-mini" key={metric.label}>
                  <span className="metric-label">{metric.label}</span>
                  <div className="metric-value">{metric.value}</div>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </section>

      <section id="workflow" className="grid-2" style={{ marginTop: 24 }}>
        <div className="stat-card">
          <div className="section-title">Scenario-specific rooms</div>
          <p className="muted-copy">
            Each room is framed around a different audience style, with
            tailored goals, sample pressure points, and evaluation emphasis so
            users can quickly pick the rehearsal context that fits the moment.
          </p>
        </div>
        <div className="stat-card">
          <div className="section-title">Minimal, responsive, same-tab flow</div>
          <p className="muted-copy">
            No popup windows. No exposed keys. No extra upload button. The
            entire journey stays inside one responsive interface from landing to
            live session to post-call review.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
