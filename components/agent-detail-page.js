"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

function UploadStatus({ upload }) {
  if (upload.status === "uploading") {
    return (
      <div className="status-chip status-warning" style={{ marginTop: 10 }}>
        <span className="status-dot" />
        Uploading document…
      </div>
    );
  }
  if (upload.status === "success") {
    return (
      <div className="status-chip status-success" style={{ marginTop: 10 }}>
        <span className="status-dot" />
        {upload.fileName} ready
      </div>
    );
  }
  if (upload.status === "error") {
    return (
      <div className="status-chip status-danger" style={{ marginTop: 10 }}>
        <span className="status-dot" />
        {upload.error || "Upload failed."}
      </div>
    );
  }
  return null;
}

function CollapsibleList({ items, initialMax = 3 }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialMax);
  const hasMore = items.length > initialMax;
  return (
    <div>
      <div className="collapsible-list">
        {visible.map((item, i) => (
          <div className="collapsible-list-item" key={i}>{item}</div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          className="toggle-btn"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "▲ Show less" : `▼ Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export function AgentDetailPage({ slug }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, patchAgent, clearAgentSessions } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const [localError, setLocalError] = useState("");
  const [criteriaExpanded, setCriteriaExpanded] = useState(false);
  const justEnded = searchParams.get("ended") === "1";

  const agentState = state.agents[slug];
  const upload = agentState?.upload;
  const pastSessions = state.sessions?.[slug] || [];

  const canStart = useMemo(() => {
    return (
      upload.status !== "uploading" &&
      agentState.session.status !== "starting" &&
      Boolean(agentState.sessionName?.trim())
    );
  }, [agentState.session.status, agentState.sessionName, upload.status]);

  if (!agent || !agentState) {
    return (
      <AppShell>
        <div className="empty-state">
          Agent not found. <Link href="/agents">Back to agents.</Link>
        </div>
      </AppShell>
    );
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setLocalError("");
    if (!file) return;
    if (agentState.session.status === "active" || agentState.session.status === "starting") {
      setLocalError("Cannot change document while a session is active.");
      return;
    }
    if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    const previewUrl = file.type === "application/pdf" ? URL.createObjectURL(file) : "";
    patchAgent(slug, (current) => ({
      ...current,
      upload: { ...current.upload, status: "uploading", fileName: file.name, previewUrl, previewOpen: false, contextPreview: "", error: "" },
    }));
    try {
      const formData = new FormData();
      formData.append("deck", file);
      const response = await fetch("/api/upload-deck", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      patchAgent(slug, (current) => ({
        ...current,
        upload: { ...current.upload, status: "success", fileName: data.fileName || file.name, previewUrl, previewOpen: false, contextPreview: data.contextPreview || "", contextText: data.contextText || "", error: "" },
      }));
    } catch (error) {
      patchAgent(slug, (current) => ({
        ...current,
        upload: { ...current.upload, status: "error", error: error.message || "Upload failed." },
      }));
    }
  }

  function startSession() {
    if (!agentState.sessionName?.trim()) {
      setLocalError("Session name is required.");
      return;
    }
    if (!canStart) return;
    setLocalError("");
    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, status: "starting" },
    }));
    router.push(`/session/${slug}`);
  }

  const criteria = agent.evaluationCriteria || [];
  const visibleCriteria = criteriaExpanded ? criteria : criteria.slice(0, 4);

  return (
    <AppShell>
      <div className="page-single">

        {/* Nav + agent header */}
        <div>
          <div className="nav-row">
            <Link href="/agents" className="btn btn-secondary">
              ← Back
            </Link>
            <div className="eyebrow">{agent.role}</div>
          </div>
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", margin: "0 0 12px" }}>
            {agent.name}
          </h1>
          <p className="muted-copy" style={{ margin: "0 0 16px", maxWidth: 620 }}>
            {agent.longDescription}
          </p>
          <div className="pill-row">
            {agent.focus.map((item) => (
              <span className="pill" key={item}>{item}</span>
            ))}
          </div>
        </div>

        {/* Scenario card */}
        <div className="metric-card">
          <div className="section-title">Scenario</div>
          <p className="muted-copy" style={{ margin: 0 }}>{agent.scenario}</p>
        </div>

        {/* Eval criteria card */}
        <div className="metric-card">
          <div className="section-title">Eval Criteria</div>
          <p className="muted-copy" style={{ marginBottom: 0 }}>
            Your session will be scored on the following dimensions.
          </p>
          <div className="criteria-grid">
            {visibleCriteria.map((criterion) => (
              <div className="subtle-card" key={criterion.label}>
                <span className="metric-label">{criterion.label}</span>
                <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>
                  {criterion.description}
                </p>
              </div>
            ))}
          </div>
          {criteria.length > 4 && (
            <button
              type="button"
              className="toggle-btn"
              onClick={() => setCriteriaExpanded((e) => !e)}
            >
              {criteriaExpanded ? "▲ Show fewer" : `▼ Show all ${criteria.length} criteria`}
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="section-divider">Create a new session</div>

        {/* Session name card */}
        <div className="metric-card">
          <div className="section-title">Session Name</div>
          <input
            id="session-name"
            className="context-textarea"
            type="text"
            value={agentState.sessionName || ""}
            onChange={(event) => {
              setLocalError("");
              patchAgent(slug, (current) => ({ ...current, sessionName: event.target.value }));
            }}
            placeholder={`e.g. ${agent.name} practice #1`}
            disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
            style={{ minHeight: 50, resize: "none", marginTop: 10 }}
          />
          {!agentState.sessionName?.trim() && (
            <p className="muted-copy" style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--danger)" }}>
              Required to start a session.
            </p>
          )}
        </div>

        {/* Context card */}
        <div className="metric-card">
          <div className="section-title">Context</div>
          <p className="muted-copy" style={{ marginBottom: 14 }}>
            {agent.contextFieldLabel || "Optional context"} and a supporting document to ground your session.
          </p>
          <div className="context-cols">
            {/* Left: text context */}
            <div className="subtle-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="metric-label" style={{ marginBottom: 0 }}>
                {agent.contextFieldLabel || "Optional role context"}
              </span>
              <textarea
                id="agent-context"
                className="context-textarea"
                value={agentState.customContextText || ""}
                onChange={(event) =>
                  patchAgent(slug, (current) => ({ ...current, customContextText: event.target.value }))
                }
                placeholder={agent.contextFieldDescription || "Paste role notes, priorities, or custom instructions…"}
                disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
                style={{ minHeight: 120, flex: 1 }}
              />
            </div>

            {/* Right: file upload */}
            <div className="subtle-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="metric-label" style={{ marginBottom: 0 }}>Supporting document</span>
              <label className="file-dropzone" htmlFor="deck-upload">
                <span className="file-dropzone-icon">
                  {upload.status === "success" ? "📄" : "⬆"}
                </span>
                <span>
                  {upload.status === "success"
                    ? upload.fileName
                    : "Click to upload PDF"}
                </span>
                <span style={{ fontSize: "0.8rem" }}>Optional · PDF only</span>
              </label>
              <input
                id="deck-upload"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
                style={{ display: "none" }}
              />
              <UploadStatus upload={upload} />
            </div>
          </div>

          {upload.status === "success" && upload.contextPreview ? (
            <div className="subtle-card" style={{ marginTop: 14 }}>
              <span className="metric-label">Prepared context preview</span>
              <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>
                {upload.contextPreview}
              </p>
            </div>
          ) : null}
        </div>

        {/* Start session */}
        <div>
          {localError && (
            <p className="muted-copy" style={{ color: "var(--danger)", marginBottom: 10 }}>
              {localError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-start"
            disabled={!canStart}
            onClick={startSession}
          >
            {upload.status === "uploading"
              ? "Preparing upload…"
              : agentState.session.status === "starting"
              ? "Starting…"
              : "Start Session"}
          </button>
        </div>

        {/* Past sessions */}
        <div className="section-divider">Past sessions</div>

        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="section-title" style={{ margin: 0 }}>
              {justEnded ? "Sessions · updated" : "Sessions"}
            </div>
            {pastSessions.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: 38, padding: "0 14px", fontSize: "0.85rem" }}
                onClick={() => clearAgentSessions(slug)}
              >
                Clear history
              </button>
            )}
          </div>

          {pastSessions.length === 0 ? (
            <div className="empty-state">
              No saved sessions yet. End a session and it will appear here.
            </div>
          ) : (
            <div className="sidebar-stack">
              {pastSessions.map((session) => (
                <Link
                  href={`/agents/${slug}/sessions/${session.id}`}
                  className="session-list-item"
                  key={session.id}
                >
                  <div className="session-list-top">
                    <strong>{session.sessionName || "Untitled session"}</strong>
                    <span className="pill">{session.durationLabel}</span>
                  </div>
                  <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                    {new Date(session.endedAt).toLocaleString()}
                  </p>
                  <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                    {session.upload?.fileName || "No supporting file"}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    {session.evaluation?.status === "processing" ? (
                      <div className="status-chip status-warning">
                        <span className="status-dot" />
                        Evaluating…
                      </div>
                    ) : session.evaluation?.status === "failed" ? (
                      <div className="status-chip status-danger">
                        <span className="status-dot" />
                        Evaluation failed
                      </div>
                    ) : (
                      <div className="status-chip status-success">
                        <span className="status-dot" />
                        Eval ready
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
