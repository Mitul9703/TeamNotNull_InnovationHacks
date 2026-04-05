"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

export function ThreadDetailPage({ slug, threadId }) {
  const router = useRouter();
  const { state, selectThread } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const thread = (state.threads?.[slug] || []).find((item) => item.id === threadId);
  const sessions = (state.sessions?.[slug] || [])
    .filter((session) => session.threadId === threadId)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());

  if (!agent || !thread) {
    return (
      <AppShell>
        <div className="empty-state">
          Thread not found. <Link href={`/agents/${slug}`}>Back to {agent?.name || "agent"}.</Link>
        </div>
      </AppShell>
    );
  }

  const evaluation = thread.evaluation || { status: "idle" };
  const averageScore = sessions.length
    ? Math.round(
        sessions
          .filter((session) => session.evaluation?.result?.score)
          .reduce((sum, session) => sum + session.evaluation.result.score, 0) /
          Math.max(1, sessions.filter((session) => session.evaluation?.result?.score).length),
      )
    : 0;

  return (
    <AppShell>
      <div className="page-single" style={{ maxWidth: 860 }}>
        <div>
          <div className="nav-row">
            <Link href={`/agents/${slug}`} className="btn btn-secondary">← Back</Link>
            <div className="eyebrow">Thread</div>
          </div>
          <h1 className="hero-title" style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", margin: "0 0 8px" }}>
            {thread.title}
          </h1>
          <p className="muted-copy" style={{ margin: 0 }}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} in this thread · updated {new Date(thread.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 4 }}>Thread Overview</div>
              <p className="muted-copy" style={{ margin: 0 }}>
                Longitudinal progress and hidden-context-driven practice history for this {agent.name.toLowerCase()} thread.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                selectThread(slug, threadId);
                router.push(`/agents/${slug}`);
              }}
            >
              Start new session in thread
            </button>
          </div>
          <div className="session-info-grid" style={{ marginTop: 14 }}>
            <div className="subtle-card">
              <span className="metric-label">Sessions</span>
              <div className="metric-value" style={{ fontSize: "1.5rem" }}>{sessions.length}</div>
            </div>
            <div className="subtle-card">
              <span className="metric-label">Average score</span>
              <div className="metric-value" style={{ fontSize: "1.5rem" }}>{averageScore || "—"}</div>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="section-title">Thread Evaluation</div>
          {evaluation.status === "processing" || evaluation.status === "idle" ? (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: 0 }}>
                Building a thread-level evaluation from the sessions in this thread.
              </p>
            </div>
          ) : evaluation.status === "failed" ? (
            <div className="subtle-card">
              <div className="status-chip status-danger">
                <span className="status-dot" />
                Thread evaluation failed
              </div>
              <p className="muted-copy" style={{ margin: "10px 0 0" }}>
                {evaluation.error || "The thread evaluation could not be completed."}
              </p>
            </div>
          ) : (
            <>
              <p className="muted-copy" style={{ marginTop: 0 }}>{evaluation.result?.summary}</p>
              <div className="subtle-card">
                <div className="metric-label">Trajectory</div>
                <div style={{ fontWeight: 600 }}>{evaluation.result?.trajectory}</div>
              </div>

              {evaluation.result?.metricTrends?.length ? (
                <div className="metrics-grid-2" style={{ marginTop: 14 }}>
                  {evaluation.result.metricTrends.map((metric) => (
                    <div className="subtle-card" key={metric.label}>
                      <div className="metric-label">{metric.label}</div>
                      <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{metric.trend}</div>
                      <p className="muted-copy" style={{ margin: "8px 0 0", fontSize: "0.88rem" }}>
                        {metric.comment}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {evaluation.result?.strengths?.length ? (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <div className="section-title" style={{ fontSize: "1rem" }}>Recurring strengths</div>
                  <div className="collapsible-list">
                    {evaluation.result.strengths.map((item, index) => (
                      <div className="collapsible-list-item" key={index}>{item}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {evaluation.result?.focusAreas?.length ? (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <div className="section-title" style={{ fontSize: "1rem" }}>Thread-wide areas to improve</div>
                  <div className="collapsible-list">
                    {evaluation.result.focusAreas.map((item, index) => (
                      <div className="collapsible-list-item" key={index}>{item}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {evaluation.result?.nextSessionFocus ? (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <div className="section-title" style={{ fontSize: "1rem" }}>Next Session Focus</div>
                  <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                    {evaluation.result.nextSessionFocus}
                  </p>
                </div>
              ) : null}

              {evaluation.result?.comments?.length ? (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <div className="section-title" style={{ fontSize: "1rem" }}>Comments</div>
                  <div className="collapsible-list">
                    {evaluation.result.comments.map((item, index) => (
                      <div className="collapsible-list-item" key={index}>{item}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="metric-card">
          <div className="section-title">Sessions in this Thread</div>
          {sessions.length === 0 ? (
            <div className="empty-state">No sessions in this thread yet.</div>
          ) : (
            <div className="sidebar-stack">
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/agents/${slug}/sessions/${session.id}`}
                  className="session-list-item"
                >
                  <div className="session-list-top">
                    <strong>{session.sessionName || "Untitled session"}</strong>
                    <span className="pill">{session.durationLabel}</span>
                  </div>
                  <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                    {new Date(session.endedAt).toLocaleString()}
                  </p>
                  {session.evaluation?.result?.summary ? (
                    <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                      {session.evaluation.result.summary}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
