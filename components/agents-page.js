"use client";

import Link from "next/link";
import { AGENTS } from "../lib/agents";
import { AppShell } from "./shell";

// Per-agent accent badge colours
const AGENT_BADGE_CLASS = {
  professor: "agent-badge-professor",
  recruiter: "agent-badge-recruiter",
  investor:  "agent-badge-investor",
  coding:    "agent-badge-coding",
  custom:    "agent-badge-custom",
};

// Per-agent card background class
const AGENT_BG_CLASS = {
  professor: "agent-bg-professor",
  recruiter: "agent-bg-recruiter",
  investor:  "agent-bg-investor",
  coding:    "agent-bg-coding",
  custom:    "agent-bg-custom",
};

// Rotating colourful pill palette — 6 distinct colours
const PILL_PALETTE = [
  "pill-amber",
  "pill-blue",
  "pill-green",
  "pill-purple",
  "pill-teal",
  "pill-rose",
];

export function AgentsPage() {
  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-heading">Choose your agent</h1>
        <p className="page-subheading">
          Select the rehearsal room that fits your session.
        </p>
      </div>

      <div className="agents-grid">
        {AGENTS.map((agent, agentIdx) => {
          const isCustom  = agent.slug === "custom";
          const isCoding  = agent.slug === "coding";
          const bgClass   = AGENT_BG_CLASS[agent.slug] || "";
          const badgeClass = AGENT_BADGE_CLASS[agent.slug] || "";

          return (
            <Link
              href={`/agents/${agent.slug}`}
              className={`agent-card ${bgClass}${isCustom ? " agent-card-custom" : ""}`}
              key={agent.slug}
            >
              {/* Header row: role badge + duration pill */}
              <div className="agent-title-row">
                <div className={`agent-badge ${badgeClass}`}>{agent.role}</div>
                <span className="pill">{agent.duration}</span>
              </div>

              {/* Agent name */}
              <h2 className="agent-title">{agent.name}</h2>

              {/* Short description */}
              <p className="agent-blurb">{agent.description}</p>

              {/* Focus chips — colourful, consistent contrast */}
              <div className="pill-row" style={{ marginTop: "auto" }}>
                {agent.focus.map((item, i) => (
                  <span
                    className={`pill ${PILL_PALETTE[(agentIdx * 3 + i) % PILL_PALETTE.length]}`}
                    key={item}
                  >
                    {item}
                  </span>
                ))}
                {isCoding && (
                  <span className="pill pill-emerald">Code editor plugin</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
