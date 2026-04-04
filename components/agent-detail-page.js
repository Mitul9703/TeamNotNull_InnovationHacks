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
      <div className="status-chip status-warning">
        <span className="status-dot" />
        Uploading and preparing document context...
      </div>
    );
  }

  if (upload.status === "success") {
    return (
      <div className="status-chip status-success">
        <span className="status-dot" />
        {upload.fileName} is ready for this next session.
      </div>
    );
  }

  if (upload.status === "error") {
    return (
      <div className="status-chip status-danger">
        <span className="status-dot" />
        {upload.error || "Upload failed."}
      </div>
    );
  }

  return (
    <div className="status-chip">
      <span className="status-dot" />
      PDF support is optional. Sessions can start without a file.
    </div>
  );
}

export function AgentDetailPage({ slug }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, patchAgent } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const [localError, setLocalError] = useState("");
  const justEnded = searchParams.get("ended") === "1";

  const agentState = state.agents[slug];
  const upload = agentState?.upload;
  const evaluation = agentState?.evaluation;
  const rating = agentState?.rating || 0;

  const canStart = useMemo(() => {
    return upload.status !== "uploading" && agentState.session.status !== "starting";
  }, [agentState.session.status, upload.status]);

  if (!agent || !agentState) {
    return (
      <AppShell>
        <div className="empty-state">
          This agent was not found. Return to the <Link href="/">landing page</Link>.
        </div>
      </AppShell>
    );
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setLocalError("");

    if (!file) return;

    if (agentState.session.status === "active" || agentState.session.status === "starting") {
      setLocalError("You cannot change the document while a session is in progress.");
      return;
    }

    if (upload.previewUrl) {
      URL.revokeObjectURL(upload.previewUrl);
    }

    const previewUrl = file.type === "application/pdf" ? URL.createObjectURL(file) : "";

    patchAgent(slug, (current) => ({
      ...current,
      upload: {
        ...current.upload,
        status: "uploading",
        fileName: file.name,
        previewUrl,
        previewOpen: false,
        contextPreview: "",
        error: "",
      },
    }));

    try {
      const formData = new FormData();
      formData.append("deck", file);

      const response = await fetch(
        "/api/upload-deck",
        {
          method: "POST",
          body: formData,
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      patchAgent(slug, (current) => ({
        ...current,
        upload: {
          ...current.upload,
          status: "success",
          fileName: data.fileName || file.name,
          previewUrl,
          previewOpen: false,
          contextPreview: data.contextPreview || "",
          error: "",
        },
      }));
    } catch (error) {
      patchAgent(slug, (current) => ({
        ...current,
        upload: {
          ...current.upload,
          status: "error",
          error: error.message || "Upload failed.",
        },
      }));
    }
  }

  function togglePreview() {
    patchAgent(slug, (current) => ({
      ...current,
      upload: {
        ...current.upload,
        previewOpen: !current.upload.previewOpen,
      },
    }));
  }

  function startSession() {
    if (!canStart) return;
    patchAgent(slug, (current) => ({
      ...current,
      session: {
        ...current.session,
        status: "starting",
      },
    }));
    router.push(`/session/${slug}`);
  }

  function setRating(value) {
    patchAgent(slug, (current) => ({
      ...current,
      rating: value,
    }));
  }

  return (
    <AppShell>
      <div className="agent-layout">
        <div className="detail-stack">
          <div className="detail-block">
            <div className="button-row" style={{ marginBottom: 18 }}>
              <Link href="/" className="btn btn-secondary">
                Back to agents
              </Link>
              <div className="eyebrow">{agent.role}</div>
            </div>
            <h1 className="hero-title" style={{ fontSize: "clamp(2.2rem, 5vw, 3.8rem)", marginTop: 0 }}>
              {agent.name}
            </h1>
            <p className="hero-copy">{agent.longDescription}</p>
            <div className="pill-row">
              {agent.focus.map((item) => (
                <span className="pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="grid-2">
            <div className="detail-block">
              <div className="section-title">Scenario</div>
              <p className="muted-copy">{agent.scenario}</p>
            </div>
            <div className="detail-block">
              <div className="section-title">Session rhythm</div>
              <ul className="list">
                {agent.flow.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="upload-card">
            <div className="section-title">Supporting document</div>
            <p className="muted-copy">
              Upload a PDF deck or supporting brief and it will process
              automatically. The start button stays disabled while the upload is
              in progress, and no extra upload action is needed.
            </p>
            <label className="label" htmlFor="deck-upload">
              Optional PDF
            </label>
            <input
              id="deck-upload"
              className="file-input"
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              disabled={agentState.session.status === "active" || agentState.session.status === "starting"}
            />
            <div style={{ marginTop: 16 }}>
              <UploadStatus upload={upload} />
            </div>
            {localError ? <p className="muted-copy" style={{ color: "var(--danger)" }}>{localError}</p> : null}
            {upload.status === "success" ? (
              <>
                <div className="button-row" style={{ marginTop: 16 }}>
                  <button type="button" className="btn btn-secondary" onClick={togglePreview}>
                    {upload.previewOpen ? "Hide preview" : "Preview file"}
                  </button>
                </div>
                {upload.contextPreview ? (
                  <div className="subtle-card" style={{ marginTop: 16 }}>
                    <div className="section-title">Prepared context preview</div>
                    <p className="muted-copy" style={{ marginBottom: 0 }}>
                      {upload.contextPreview}
                    </p>
                  </div>
                ) : null}
                {upload.previewOpen && upload.previewUrl ? (
                  <iframe
                    className="preview-frame"
                    src={upload.previewUrl}
                    title={`${upload.fileName} preview`}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="sidebar-stack">
          <div className="metric-card">
            <div className="section-title">Evaluation dashboard</div>
            <div className="dashboard-score">{evaluation.score}/100</div>
            <p className="muted-copy">
              Static sample evaluation for now. This updates visually after a
              call ends without changing your backend pipeline.
            </p>
            <div className="metrics-grid">
              {evaluation.metrics.map((metric) => (
                <div className="subtle-card" key={metric.label}>
                  <span className="metric-label">{metric.label}</span>
                  <div className="metric-value">{metric.value}%</div>
                  <div className="progress" style={{ marginTop: 10 }}>
                    <span style={{ width: `${metric.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="metric-card">
            <div className="section-title">Before you start</div>
            <ul className="list">
              <li>Mic permission is required before the session begins.</li>
              <li>The avatar starts in the same tab, not a popup window.</li>
              <li>Once the room begins, document uploads are locked until the session ends.</li>
            </ul>
            <div className="agent-actions" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canStart}
                onClick={startSession}
              >
                {upload.status === "uploading" ? "Preparing upload..." : "Start session"}
              </button>
            </div>
          </div>

          {(justEnded || agentState.session.lastEndedAt) && (
            <div className="metric-card">
              <div className="section-title">Post-call review</div>
              <p className="muted-copy">
                Last ended {agentState.session.lastEndedAt || "just now"} with a
                sample duration of {agentState.session.lastDurationLabel}.
              </p>
              <div className="section-title" style={{ marginTop: 18 }}>
                Rate the conversation
              </div>
              <div className="rating-row">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={`rating-star ${rating >= value ? "active" : ""}`}
                    onClick={() => setRating(value)}
                    aria-label={`Rate ${value} star${value > 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
