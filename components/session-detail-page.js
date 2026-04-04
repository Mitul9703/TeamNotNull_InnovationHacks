"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

function domainLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return url;
  }
}

export function SessionDetailPage({ slug, sessionId }) {
  const { state, requestResourceFetch, requestSessionComparison } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);

  if (!agent || !session) {
    return (
      <AppShell>
        <div className="empty-state">
          Session not found. Return to <Link href={`/agents/${slug}`}>the agent page</Link>.
        </div>
      </AppShell>
    );
  }

  const evaluation = session.evaluation;
  const resources = session.resources || { status: "idle", topics: [], briefs: [] };
  const comparison = session.comparison || {
    status: "idle",
    baselineSessionId: "",
    result: null,
    error: "",
  };
  const comparisonOptions = useMemo(
    () =>
      (state.sessions?.[slug] || []).filter(
        (item) =>
          item.id !== sessionId &&
          item.evaluation?.status === "completed" &&
          item.evaluation?.result,
      ),
    [slug, sessionId, state.sessions],
  );
  const [selectedComparisonId, setSelectedComparisonId] = useState(
    comparison.baselineSessionId || comparisonOptions[0]?.id || "",
  );

  useEffect(() => {
    const preferredId =
      comparison.baselineSessionId &&
      comparisonOptions.some((item) => item.id === comparison.baselineSessionId)
        ? comparison.baselineSessionId
        : comparisonOptions[0]?.id || "";
    setSelectedComparisonId(preferredId);
  }, [comparison.baselineSessionId, comparisonOptions]);

  return (
    <AppShell>
      <div className="agent-layout">
        <div className="detail-stack">
          <div className="detail-block">
            <div className="button-row" style={{ marginBottom: 18 }}>
              <Link href={`/agents/${slug}`} className="btn btn-secondary">
                Back to {agent.name}
              </Link>
              <div className="eyebrow">Saved session</div>
            </div>
            <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.4rem)", marginTop: 0 }}>
              {session.sessionName || `${agent.name} session`}
            </h1>
            <p className="hero-copy">
              Ended {new Date(session.endedAt).toLocaleString()} with a duration of {session.durationLabel}.
            </p>
          </div>

          {session.coding ? (
            <div className="detail-block">
              <div className="section-title">Coding workspace</div>
              <p className="muted-copy" style={{ marginTop: 0 }}>
                Final language selection: {session.coding.language || "Unspecified"}
              </p>
              <div className="subtle-card">
                <div className="section-title">Final code</div>
                <pre className="code-block">{session.coding.finalCode || "// No code was saved."}</pre>
              </div>
            </div>
          ) : null}

          <div className="detail-block">
            <div className="section-title">Transcript</div>
            <div className="transcript-list" style={{ maxHeight: "none" }}>
              {session.transcript.length ? (
                session.transcript.map((entry) => (
                  <div className="transcript-item" key={entry.id}>
                    <div className="transcript-role">{entry.role}</div>
                    <p className="transcript-text">{entry.text}</p>
                  </div>
                ))
              ) : (
                <div className="empty-state">No transcript was saved for this session.</div>
              )}
            </div>
          </div>
        </div>

        <div className="sidebar-stack">
          <div className="metric-card">
            <div className="section-title">Session information</div>
            <div className="sidebar-stack">
              <div className="subtle-card">
                <span className="metric-label">Session name</span>
                <div className="metric-value">{session.sessionName || "Untitled session"}</div>
              </div>
              <div className="subtle-card">
                <span className="metric-label">Agent</span>
                <div className="metric-value">{agent.name}</div>
              </div>
              <div className="subtle-card">
                <span className="metric-label">Uploaded file</span>
                <div className="metric-value">
                  {session.upload?.fileName || "No supporting file"}
                </div>
              </div>
            </div>
            {session.upload?.contextPreview ? (
              <div className="subtle-card" style={{ marginTop: 16 }}>
                <div className="section-title">Prepared file context</div>
                <p className="muted-copy" style={{ marginBottom: 0 }}>
                  {session.upload.contextPreview}
                </p>
              </div>
            ) : null}
            {session.customContext ? (
              <div className="subtle-card" style={{ marginTop: 16 }}>
                <div className="section-title">Extra session context</div>
                <p className="muted-copy" style={{ marginBottom: 0 }}>
                  {session.customContext}
                </p>
              </div>
            ) : null}
          </div>

          <div className="metric-card">
            <div className="section-title">Evaluation</div>
            {evaluation.status === "processing" ? (
              <div className="subtle-card">
                <div className="status-chip status-warning">
                  <span className="status-dot" />
                  Evaluation processing...
                </div>
                <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                  This evaluation job is analyzing the transcript and any uploaded
                  file context. Refresh is not required; it will update automatically
                  when ready.
                </p>
              </div>
            ) : evaluation.status === "failed" ? (
              <div className="subtle-card">
                <div className="status-chip status-danger">
                  <span className="status-dot" />
                  Evaluation failed
                </div>
                <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                  {evaluation.error || "The evaluation job could not be completed."}
                </p>
              </div>
            ) : (
              <>
                <div className="dashboard-score">
                  {evaluation.result.score}/100
                </div>
                <p className="muted-copy">{evaluation.result.summary}</p>
                <div className="metrics-grid">
                  {evaluation.result.metrics.map((metric) => (
                    <div className="subtle-card" key={metric.label}>
                      <span className="metric-label">{metric.label}</span>
                      <div className="metric-value">{metric.value}%</div>
                      <div className="progress" style={{ marginTop: 10 }}>
                        <span style={{ width: `${metric.value}%` }} />
                      </div>
                      {metric.justification ? (
                        <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                          {metric.justification}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="subtle-card" style={{ marginTop: 16 }}>
                  <div className="section-title">Strengths</div>
                  <ul className="list">
                    {evaluation.result.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="subtle-card" style={{ marginTop: 16 }}>
                  <div className="section-title">Improvements</div>
                  <ul className="list">
                    {evaluation.result.improvements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                {evaluation.result.recommendations?.length ? (
                  <div className="subtle-card" style={{ marginTop: 16 }}>
                    <div className="section-title">Recommended next reps</div>
                    <ul className="list">
                      {evaluation.result.recommendations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="metric-card">
            <div className="section-title">Session comparison</div>
            {evaluation.status !== "completed" ? (
              <div className="subtle-card">
                <p className="muted-copy" style={{ margin: 0 }}>
                  Finish the evaluation first, then compare this session with another saved {agent.name.toLowerCase()} session.
                </p>
              </div>
            ) : !comparisonOptions.length ? (
              <div className="subtle-card">
                <p className="muted-copy" style={{ margin: 0 }}>
                  Save at least one more completed {agent.name.toLowerCase()} session to compare progress here.
                </p>
              </div>
            ) : (
              <>
                <div className="subtle-card">
                  <div className="button-row compare-controls">
                    <select
                      className="language-select compare-select"
                      value={selectedComparisonId}
                      onChange={(event) => setSelectedComparisonId(event.target.value)}
                    >
                      {comparisonOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {(option.sessionName || "Untitled session")} · {new Date(option.endedAt).toLocaleString()} · {option.durationLabel}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!selectedComparisonId || comparison.status === "processing"}
                      onClick={() =>
                        requestSessionComparison(slug, sessionId, selectedComparisonId)
                      }
                    >
                      {comparison.status === "processing"
                        ? "Comparing..."
                        : "Compare with other session"}
                    </button>
                  </div>
                </div>

                {comparison.status === "processing" ? (
                  <div className="subtle-card" style={{ marginTop: 16 }}>
                    <div className="status-chip status-warning">
                      <span className="status-dot" />
                      Comparison processing...
                    </div>
                    <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                      We are checking whether this session moved the rubric in a better direction.
                    </p>
                  </div>
                ) : null}

                {comparison.status === "failed" ? (
                  <div className="subtle-card" style={{ marginTop: 16 }}>
                    <div className="status-chip status-danger">
                      <span className="status-dot" />
                      Comparison failed
                    </div>
                    <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                      {comparison.error || "The comparison could not be completed."}
                    </p>
                  </div>
                ) : null}

                {comparison.status === "completed" && comparison.result ? (
                  <div className="comparison-stack">
                    <div className="subtle-card comparison-summary-card">
                      <div className={`status-chip ${comparison.result.trend === "improved"
                        ? "status-success"
                        : comparison.result.trend === "declined"
                          ? "status-danger"
                          : "status-warning"}`}
                      >
                        <span className="status-dot" />
                        {comparison.result.trend}
                      </div>
                      <p className="muted-copy" style={{ margin: "12px 0 0" }}>
                        {comparison.result.summary}
                      </p>
                    </div>
                    <div className="comparison-grid">
                      {comparison.result.metrics.map((metric) => {
                        const deltaPrefix = metric.delta > 0 ? "+" : "";
                        const trendClass =
                          metric.trend === "improved"
                            ? "comparison-delta positive"
                            : metric.trend === "declined"
                              ? "comparison-delta negative"
                              : "comparison-delta neutral";

                        return (
                          <div className="subtle-card comparison-metric-card" key={metric.label}>
                            <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                              <span className="metric-label">{metric.label}</span>
                              <span className={trendClass}>{deltaPrefix}{metric.delta}</span>
                            </div>
                            <div className="comparison-scoreline">
                              <span>Now {metric.currentValue}</span>
                              <span>Earlier {metric.baselineValue}</span>
                            </div>
                            <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                              {metric.insight}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="metric-card">
            <div className="section-title">Improvement resources</div>
            {resources.status === "idle" ? (
              <div className="subtle-card">
                <p className="muted-copy" style={{ margin: 0 }}>
                  Evaluation found targeted improvement themes. Fetch resources only
                  if you want videos, articles, and practice links for this session.
                </p>
                {resources.briefs?.length ? (
                  <div className="button-row" style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => requestResourceFetch(slug, sessionId)}
                    >
                      Fetch resources
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {resources.status === "processing" ? (
              <div className="subtle-card">
                <div className="status-chip status-warning">
                  <span className="status-dot" />
                  Finding resources...
                </div>
                <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                  TinyFish is gathering videos, articles, and websites for the most
                  important improvement themes from this session.
                </p>
              </div>
            ) : null}
            {resources.status === "failed" ? (
              <div className="subtle-card">
                <div className="status-chip status-danger">
                  <span className="status-dot" />
                  Resource search failed
                </div>
                <p className="muted-copy" style={{ marginTop: 12, marginBottom: 0 }}>
                  {resources.error || "We finished the evaluation, but the web resource search did not complete."}
                </p>
                {resources.briefs?.length ? (
                  <div className="button-row" style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => requestResourceFetch(slug, sessionId)}
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {resources.status === "completed" && resources.topics?.length ? (
              <div className="resource-accordion">
                {resources.topics.map((topic, index) => (
                  <details
                    className="resource-group"
                    key={topic.id || topic.topic}
                    open={index === 0}
                  >
                    <summary className="resource-summary">
                      <div>
                        <div className="resource-topic">{topic.topic}</div>
                        <p className="muted-copy" style={{ margin: "6px 0 0" }}>
                          {topic.whyThisMatters}
                        </p>
                      </div>
                      <span className="pill">
                        {topic.items?.length || 0} resources
                      </span>
                    </summary>
                    <div className="resource-grid">
                      {(topic.items || []).map((item) => (
                        <a
                          key={`${topic.id}-${item.url}`}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="resource-card"
                        >
                          <div className="button-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                            <span className="resource-kind">{item.type || "resource"}</span>
                            <span className="metric-label">{item.source || domainLabel(item.url)}</span>
                          </div>
                          <div className="resource-title">{item.title}</div>
                          <p className="muted-copy" style={{ marginTop: 10, marginBottom: 12 }}>
                            {item.reason}
                          </p>
                          <span className="link-button">
                            Open {domainLabel(item.url)}
                          </span>
                        </a>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
            {resources.status === "completed" && !resources.topics?.length ? (
              <div className="subtle-card">
                <p className="muted-copy" style={{ margin: 0 }}>
                  No targeted resources were saved for this session.
                </p>
              </div>
            ) : null}
          </div>

          <div className="metric-card">
            <div className="section-title">Evaluation criteria</div>
            <div className="sidebar-stack">
              {(agent.evaluationCriteria || []).map((criterion) => (
                <div className="subtle-card" key={criterion.label}>
                  <span className="metric-label">{criterion.label}</span>
                  <p className="muted-copy" style={{ marginBottom: 0 }}>
                    {criterion.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
