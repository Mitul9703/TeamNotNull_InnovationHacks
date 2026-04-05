"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AGENT_LOOKUP } from "../lib/agents";
import { getApiUrl } from "../lib/client-config";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

// All criteria labels use the accent orange
const CRITERIA_COLOR = "criteria-label-accent";

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

function ContextPreviewToggle({ preview }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="subtle-card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="metric-label" style={{ marginBottom: 0 }}>Prepared context preview</span>
        <button
          type="button"
          className="toggle-btn"
          style={{ marginTop: 0 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "▲ Hide preview" : "▼ Show preview"}
        </button>
      </div>
      {open && (
        <p className="muted-copy" style={{ margin: "10px 0 0", fontSize: "0.88rem" }}>
          {preview}
        </p>
      )}
    </div>
  );
}

export function AgentDetailPage({ slug }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, patchAgent, clearAgentSessions, createThread, selectThread } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const [localError, setLocalError] = useState("");
  const [criteriaExpanded, setCriteriaExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const justEnded = searchParams.get("ended") === "1";

  const agentState = state.agents[slug];
  const upload = agentState?.upload;
  const researchPrep = agentState?.researchPrep || { status: "idle", result: null, error: "" };
  const threads = state.threads?.[slug] || [];
  const selectedThread = threads.find((thread) => thread.id === agentState.selectedThreadId) || null;
  const pastSessions = state.sessions?.[slug] || [];

  const canStart = useMemo(() => {
    return (
      upload.status !== "uploading" &&
      agentState.session.status !== "starting" &&
      Boolean(agentState.selectedThreadId) &&
      Boolean(agentState.sessionName?.trim())
    );
  }, [agentState.selectedThreadId, agentState.session.status, agentState.sessionName, upload.status]);

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
    setPreviewOpen(false);
    try {
      const formData = new FormData();
      formData.append("deck", file);
      const response = await fetch(getApiUrl("/api/upload-deck"), { method: "POST", body: formData });
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

  async function startSession() {
    if (!agentState.sessionName?.trim()) {
      setLocalError("Session name is required.");
      return;
    }
    if (!agentState.selectedThreadId) {
      setLocalError("Create a new thread or continue an existing one first.");
      return;
    }
    if (!canStart) return;
    setLocalError("");
    patchAgent(slug, (current) => ({
      ...current,
      session: { ...current.session, status: "starting" },
      researchPrep: ["coding", "investor", "custom"].includes(slug)
        ? { status: "idle", result: null, error: "" }
        : current.researchPrep,
    }));

    if (["coding", "investor", "custom"].includes(slug)) {
      const companyUrl = (agentState.companyUrl || "").trim();

      if (companyUrl) {
        patchAgent(slug, (current) => ({
          ...current,
          researchPrep: {
            status: "loading",
            result: null,
            error: "",
          },
        }));

        try {
          const response = await fetch(getApiUrl("/api/agent-external-context"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agentSlug: slug,
              companyUrl,
              customContext: agentState.customContextText || "",
              upload: upload?.contextText
                ? {
                    fileName: upload.fileName || "",
                    contextText: upload.contextText,
                  }
                : null,
            }),
          });

          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Failed to fetch a company-specific coding question.");
          }

          patchAgent(slug, (current) => ({
            ...current,
            researchPrep: {
              status: payload.research ? "ready" : "idle",
              result: payload.research || null,
              error: payload.research ? "" : payload.message || "",
            },
          }));
        } catch (error) {
          patchAgent(slug, (current) => ({
            ...current,
            researchPrep: {
              status: "failed",
              result: null,
              error: error.message || "Could not fetch the company-specific prep context.",
            },
          }));
        }
      }
    }

    router.push(`/session/${slug}`);
  }

  const criteria = agent.evaluationCriteria || [];
  const visibleCriteria = criteriaExpanded ? criteria : criteria.slice(0, 4);

  function handleCreateThread() {
    if (!agentState.threadName?.trim()) {
      setLocalError("Thread name is required.");
      return null;
    }
    const thread = createThread(slug, agentState.threadName);
    setLocalError("");
    return thread;
  }

  return (
    <AppShell>
      <div className="page-single">

        {/* Navigation + agent header */}
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

        {/* Evaluation criteria card */}
        <div className="metric-card">
          <div className="section-title">Evaluation Criteria</div>
          <p className="muted-copy" style={{ marginBottom: 0 }}>
            Your session will be scored on the following dimensions.
          </p>
          <div className="criteria-grid">
            {visibleCriteria.map((criterion, index) => (
              <div className="subtle-card" key={criterion.label}>
                <span className={`metric-label criteria-label ${CRITERIA_COLOR}`}>
                  {criterion.label}
                </span>
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

        <div className="section-divider">Choose a thread</div>

        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 4 }}>Threads</div>
              <p className="muted-copy" style={{ margin: 0 }}>
                Start a new thread or continue an existing one. Sessions inside a thread build on prior performance internally.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCreateThread}>
              New thread
            </button>
          </div>

          <div className="subtle-card" style={{ marginBottom: 14 }}>
            <span className="metric-label" style={{ marginBottom: 8 }}>New thread name</span>
            <input
              className="context-textarea"
              type="text"
              value={agentState.threadName || ""}
              onChange={(event) => {
                setLocalError("");
                patchAgent(slug, (current) => ({ ...current, threadName: event.target.value }));
              }}
              placeholder={`e.g. ${agent.name} weekly practice`}
              style={{ minHeight: 50, resize: "none" }}
            />
            {!agentState.threadName?.trim() && (
              <p className="muted-copy" style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--danger)" }}>
                Required to create a new thread.
              </p>
            )}
          </div>

          {selectedThread ? (
            <div className="subtle-card" style={{ marginBottom: 14 }}>
              <div className="metric-label">Selected thread</div>
              <div style={{ fontWeight: 600 }}>{selectedThread.title}</div>
              <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.86rem" }}>
                {selectedThread.sessionIds?.length || 0} session{(selectedThread.sessionIds?.length || 0) === 1 ? "" : "s"} in this thread
              </p>
            </div>
          ) : null}

          {threads.length === 0 ? (
            <div className="empty-state">
              No threads yet. Create a new one to begin.
            </div>
          ) : (
            <div className="sidebar-stack">
              {threads.map((thread) => (
                <div className="session-list-item" key={thread.id}>
                  <div className="session-list-top">
                    <strong>{thread.title}</strong>
                    <span className="pill">{thread.sessionIds?.length || 0} sessions</span>
                  </div>
                  <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                    Updated {new Date(thread.updatedAt).toLocaleString()}
                  </p>
                  {thread.evaluation?.status === "completed" && thread.evaluation?.result?.summary ? (
                    <p className="muted-copy" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                      {thread.evaluation.result.summary}
                    </p>
                  ) : null}
                  <div className="button-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className={thread.id === agentState.selectedThreadId ? "btn btn-primary" : "btn btn-secondary"}
                      onClick={() => {
                        setLocalError("");
                        selectThread(slug, thread.id);
                        patchAgent(slug, (current) => ({ ...current, threadName: "" }));
                      }}
                    >
                      {thread.id === agentState.selectedThreadId ? "Selected" : "Continue thread"}
                    </button>
                    <Link href={`/agents/${slug}/threads/${thread.id}`} className="btn btn-secondary">
                      Open thread
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="section-divider">Start a session in this thread</div>

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
          {!agentState.selectedThreadId && (
            <p className="muted-copy" style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--danger)" }}>
              Select or create a thread before starting.
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

              {slug === "coding" && (
                <div style={{ display: "grid", gap: 8 }}>
                  <span className="metric-label" style={{ marginBottom: 0 }}>
                    Company URL
                  </span>
                  <input
                    className="context-textarea"
                    type="text"
                    value={agentState.companyUrl || ""}
                    onChange={(event) =>
                      patchAgent(slug, (current) => ({
                        ...current,
                        companyUrl: event.target.value,
                        researchPrep: current.researchPrep?.status === "loading"
                          ? current.researchPrep
                          : { status: "idle", result: null, error: "" },
                      }))
                    }
                    placeholder="Optional · e.g. https://www.google.com or https://careers.airbnb.com"
                    disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
                    style={{ minHeight: 52, resize: "none" }}
                  />
                  <p className="muted-copy" style={{ margin: 0, fontSize: "0.84rem" }}>
                    If provided, PitchMirror will fetch one grounded company-style coding question before the session starts.
                  </p>

                  {researchPrep.status === "failed" && researchPrep.error ? (
                    <div className="status-chip status-warning">
                      <span className="status-dot" />
                      {researchPrep.error} The session can still continue with the default coding flow.
                    </div>
                  ) : null}
                </div>
              )}
              {["investor", "custom"].includes(slug) && (
                <div style={{ display: "grid", gap: 8 }}>
                  <span className="metric-label" style={{ marginBottom: 0 }}>
                    Company URL
                  </span>
                  <input
                    className="context-textarea"
                    type="text"
                    value={agentState.companyUrl || ""}
                    onChange={(event) =>
                      patchAgent(slug, (current) => ({
                        ...current,
                        companyUrl: event.target.value,
                        researchPrep: current.researchPrep?.status === "loading"
                          ? current.researchPrep
                          : { status: "idle", result: null, error: "" },
                      }))
                    }
                    placeholder={
                      slug === "investor"
                        ? "Optional · company or product URL to research before the pitch"
                        : "Optional · URL to research for richer generic context"
                    }
                    disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
                    style={{ minHeight: 52, resize: "none" }}
                  />
                  <p className="muted-copy" style={{ margin: 0, fontSize: "0.84rem" }}>
                    {slug === "investor"
                      ? "If provided, PitchMirror will gather investor-style external context such as news, company signals, and other public research before the session starts."
                      : "If provided, PitchMirror will gather relevant public context for this scenario before the session starts."}
                  </p>

                  {researchPrep.status === "failed" && researchPrep.error ? (
                    <div className="status-chip status-warning">
                      <span className="status-dot" />
                      {researchPrep.error} The session can still continue without external research.
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Right: file upload */}
            <div className="subtle-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="metric-label" style={{ marginBottom: 0 }}>Supporting document</span>

              {upload.status === "uploading" ? (
                <div className="file-dropzone file-dropzone-loading">
                  <div className="spinner spinner-sm" style={{ margin: "0 auto 8px" }} />
                  <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>Uploading…</span>
                </div>
              ) : (
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
              )}

              <input
                id="deck-upload"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                disabled={
                  agentState.session.status === "active" ||
                  agentState.session.status === "starting" ||
                  upload.status === "uploading"
                }
                style={{ display: "none" }}
              />

              {upload.status === "success" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="status-chip status-success">
                    <span className="status-dot" />
                    {upload.fileName} ready
                  </div>
                  {upload.previewUrl && (
                    <button
                      type="button"
                      className="toggle-btn"
                      style={{ marginTop: 0 }}
                      onClick={() => setPreviewOpen((o) => !o)}
                    >
                      {previewOpen ? "▲ Hide preview" : "▼ Preview document"}
                    </button>
                  )}
                </div>
              )}

              {upload.status === "error" && (
                <div className="status-chip status-danger">
                  <span className="status-dot" />
                  {upload.error || "Upload failed."}
                </div>
              )}
            </div>
          </div>

          {/* PDF preview panel */}
          {upload.status === "success" && upload.previewUrl && previewOpen && (
            <div style={{ marginTop: 14 }}>
              <iframe
                src={upload.previewUrl}
                className="preview-frame"
                title="Document preview"
                style={{ height: 480 }}
              />
            </div>
          )}

          {upload.status === "success" && upload.contextPreview ? (
            <ContextPreviewToggle preview={upload.contextPreview} />
          ) : null}
        </div>

        {/* Start session button */}
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
            {upload.status === "uploading" ? (
              <><div className="spinner spinner-sm spinner-inline" />Preparing upload…</>
            ) : ["coding", "investor", "custom"].includes(slug) && researchPrep.status === "loading" ? (
              <><div className="spinner spinner-sm spinner-inline" />Fetching company context…</>
            ) : agentState.session.status === "starting" ? (
              <><div className="spinner spinner-sm spinner-inline" />Starting session…</>
            ) : (
              "Start Session"
            )}
          </button>

          {["coding", "investor", "custom"].includes(slug) && researchPrep.status === "loading" ? (
            <div className="status-chip status-warning" style={{ marginTop: 12, width: "fit-content" }}>
              <div className="spinner spinner-xs" style={{ margin: 0 }} />
              {slug === "coding"
                ? "Finding a company-specific coding question…"
                : slug === "investor"
                  ? "Researching public company context for the investor room…"
                  : "Researching public context for this session…"}
            </div>
          ) : null}
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
                        <div className="spinner spinner-xs" style={{ margin: 0 }} />
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
                        Evaluation ready
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
