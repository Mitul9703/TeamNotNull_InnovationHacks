"use client";

import Link from "next/link";
import { AGENTS } from "../lib/agents";
import { AppShell } from "./shell";

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
        {AGENTS.map((agent) => (
          <Link
            href={`/agents/${agent.slug}`}
            className="agent-card"
            key={agent.slug}
          >
            <div className="agent-title-row">
              <div className="agent-badge">{agent.role}</div>
              <span className="pill">{agent.duration}</span>
            </div>
            <h2 className="agent-title">{agent.name}</h2>
            <p className="agent-blurb">{agent.description}</p>
            <div className="pill-row" style={{ marginTop: "auto" }}>
              {agent.focus.map((item) => (
                <span className="pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
