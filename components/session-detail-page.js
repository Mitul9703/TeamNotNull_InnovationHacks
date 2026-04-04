"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

function domainLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch (_) { return url; }
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch (_) { return false; }
}

// YouTube SVG icon
function YouTubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-label="YouTube" style={{ color: "#ff0000", flexShrink: 0 }}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

// External link icon
function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function Spinner({ label }) {
  return (
    <div className="eval-loading-inner">
      <div className="spinner" />
      <p className="muted-copy" style={{ margin: 0 }}>{label}</p>
    </div>
  );
}

function CollapsibleList({ items, initialMax = 4, label }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialMax);
  const hasMore = items.length > initialMax;
  if (!items.length) return null;
  return (
    <div className="subtle-card" style={{ marginTop: 14 }}>
      <div className="section-title">{label}</div>
      <div className="collapsible-list">
        {visible.map((item, i) => (
          <div className="collapsible-list-item" key={i}>{item}</div>
        ))}
      </div>
      {hasMore && (
        <button type="button" className="toggle-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? "▲ Show less" : `▼ Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export function SessionDetailPage({ slug, sessionId }) {
  const { state, requestResourceFetch, requestSessionComparison } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);

  if (!agent || !session) {
    return (
      <AppShell>
        <div className="empty-state">
          Session not found. <Link href={`/agents/${slug}`}>Back to {agent?.name || "agent"}.</Link>
        </div>
      </AppShell>
    );
  }

  const evaluation = session.evaluation;
  const resources = session.resources || { status: "idle", topics: [], briefs: [] };
  const comparison = session.comparison || { status: "idle", baselineSessionId: "", result: null, error: "" };

  const comparisonOptions = useMemo(
    () => (state.sessions?.[slug] || []).filter(
      (item) => item.id !== sessionId && item.evaluation?.status === "completed" && item.evaluation?.result
    ),
    [slug, sessionId, state.sessions]
  );

  const [selectedComparisonId, setSelectedComparisonId] = useState(
    comparison.baselineSessionId || comparisonOptions[0]?.id || ""
  );
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  useEffect(() => {
    const preferredId =
      comparison.baselineSessionId && comparisonOptions.some((item) => item.id === comparison.baselineSessionId)
        ? comparison.baselineSessionId
        : comparisonOptions[0]?.id || "";
    setSelectedComparisonId(preferredId);
  }, [comparison.baselineSessionId, comparisonOptions]);

  return (
    <AppShell>
      <div className="page-single" style={{ maxWidth: 820 }}>

        {/* Header */}
        <div>
          <div className="nav-row">
            <Link href={`/agents/${slug}`} className="btn btn-secondary">← Back</Link>
            <div className="eyebrow">Saved session</div>
          </div>
          <h1 className="hero-title" style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", margin: "0 0 8px" }}>
            {session.sessionName || `${agent.name} session`}
          </h1>
          <div className="session-meta">
            <span className="session-meta-item">
              📅 {new Date(session.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <span className="session-meta-item">
              🕐 {new Date(session.endedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="session-meta-item">
              ⏱ {session.durationLabel}
            </span>
          </div>
        </div>

        {/* Session Info card */}
        <div className="metric-card">
          <div className="section-title">Session Info</div>
          <div className="session-info-grid">
            <div className="subtle-card">
              <span className="metric-label">Agent</span>
              <div style={{ fontWeight: 600 }}>{agent.name}</div>
            </div>
            <div className="subtle-card">
              <span className="metric-label">Supporting file</span>
              <div style={{ fontWeight: 600 }}>{session.upload?.fileName || "No file"}</div>
            </div>
          </div>
          {session.customContext && (
            <div className="subtle-card" style={{ marginTop: 12 }}>
              <span className="metric-label">Extra context</span>
              <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>{session.customContext}</p>
            </div>
          )}
        </div>

        {/* Coding workspace (coding agent only) */}
        {session.coding && (
          <div className="metric-card">
            <div className="section-title">Coding workspace</div>
            <p className="muted-copy" style={{ marginTop: 0, marginBottom: 12, fontSize: "0.9rem" }}>
              Language: {session.coding.language || "Unspecified"}
            </p>
            <div className="subtle-card">
              <div className="section-title" style={{ fontSize: "0.9rem" }}>Final code</div>
              <pre className="code-block">{session.coding.finalCode || "// No code was saved."}</pre>
            </div>
          </div>
        )}

        {/* Evaluation card */}
        <div className="metric-card">
          <div className="section-title">Evaluation</div>

          {evaluation.status === "processing" && (
            <>
              <div style={{ marginBottom: 4 }}>
                <Spinner label="Analysing your session…" />
                <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                  <div className="skeleton-score" />
                  <div className="skeleton-line" style={{ width: "80%" }} />
                  <div className="skeleton-line" style={{ width: "60%" }} />
                </div>
              </div>
              <p className="muted-copy" style={{ marginTop: 14, fontSize: "0.88rem" }}>
                The evaluation pipeline is scoring your transcript. It will update automatically — no refresh needed.
              </p>
            </>
          )}

          {evaluation.status === "failed" && (
            <div className="subtle-card">
              <div className="status-chip status-danger"><span className="status-dot" />Evaluation failed</div>
              <p className="muted-copy" style={{ marginTop: 10, marginBottom: 0, fontSize: "0.9rem" }}>
                {evaluation.error || "The evaluation could not be completed."}
              </p>
            </div>
          )}

          {evaluation.status === "completed" && evaluation.result && (
            <>
              <div className="dashboard-score" style={{ marginTop: 8 }}>
                {evaluation.result.score}<span style={{ fontSize: "1.4rem", opacity: 0.5 }}>/100</span>
              </div>
              <p className="muted-copy" style={{ marginTop: 0, marginBottom: 4 }}>
                {evaluation.result.summary}
              </p>

              <div className="metrics-grid-2">
                {evaluation.result.metrics.map((metric) => (
                  <MetricCard key={metric.label} metric={metric} />
                ))}
              </div>

              <CollapsibleList items={evaluation.result.strengths} label="Strengths" initialMax={4} />
              <CollapsibleList items={evaluation.result.improvements} label="Areas to improve" initialMax={4} />
              {evaluation.result.recommendations?.length > 0 && (
                <CollapsibleList items={evaluation.result.recommendations} label="Recommended next steps" initialMax={4} />
              )}
            </>
          )}
        </div>

        {/* Improvement Resources card */}
        <div className="metric-card">
          <div className="section-title">Improvement Resources</div>

          {resources.status === "idle" && (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: "0 0 14px" }}>
                Fetch targeted videos, articles, and practice links based on your evaluation themes.
              </p>
              {resources.briefs?.length ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => requestResourceFetch(slug, sessionId)}
                >
                  Fetch resources
                </button>
              ) : (
                <p className="muted-copy" style={{ margin: 0, fontSize: "0.88rem", opacity: 0.7 }}>
                  Complete the evaluation first to unlock resources.
                </p>
              )}
            </div>
          )}

          {resources.status === "processing" && (
            <div className="subtle-card">
              <Spinner label="Finding resources…" />
              <p className="muted-copy" style={{ textAlign: "center", marginTop: 8, fontSize: "0.88rem" }}>
                Gathering articles, videos, and practice links.
              </p>
            </div>
          )}

          {resources.status === "failed" && (
            <div className="subtle-card">
              <div className="status-chip status-danger"><span className="status-dot" />Resource search failed</div>
              <p className="muted-copy" style={{ marginTop: 10, marginBottom: 12, fontSize: "0.9rem" }}>
                {resources.error || "The resource search did not complete."}
              </p>
              {resources.briefs?.length ? (
                <button type="button" className="btn btn-secondary" onClick={() => requestResourceFetch(slug, sessionId)}>
                  Try again
                </button>
              ) : null}
            </div>
          )}

          {resources.status === "completed" && resources.topics?.length > 0 && (
            <div className="resource-accordion">
              {resources.topics.map((topic, index) => (
                <details className="resource-group" key={topic.id || topic.topic} open={index === 0}>
                  <summary className="resource-summary">
                    <div>
                      <div className="resource-topic">{topic.topic}</div>
                      <p className="muted-copy" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>{topic.whyThisMatters}</p>
                    </div>
                    <span className="pill">{topic.items?.length || 0} resources</span>
                  </summary>
                  <div className="resource-grid">
                    {(topic.items || []).map((item) => {
                      const isYT = isYouTubeUrl(item.url);
                      return (
                        <a key={`${topic.id}-${item.url}`} href={item.url} target="_blank" rel="noreferrer" className="resource-card">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {isYT ? (
                                <YouTubeIcon />
                              ) : (
                                <span className="resource-kind">{item.type || "resource"}</span>
                              )}
                            </div>
                            <span className="metric-label" style={{ marginBottom: 0 }}>{item.source || domainLabel(item.url)}</span>
                          </div>
                          <div className="resource-title">{item.title}</div>
                          <p className="muted-copy" style={{ marginTop: 8, marginBottom: 10, fontSize: "0.88rem" }}>{item.reason}</p>
                          <span className="link-button">
                            <ExternalLinkIcon />
                            Open
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          )}

          {resources.status === "completed" && !resources.topics?.length && (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: 0 }}>No targeted resources were found for this session.</p>
            </div>
          )}
        </div>

        {/* Session Comparison card */}
        <div className="metric-card">
          <div className="section-title">Session Comparison</div>

          {evaluation.status !== "completed" ? (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: 0, fontSize: "0.9rem" }}>
                Complete the evaluation first, then compare with another session.
              </p>
            </div>
          ) : !comparisonOptions.length ? (
            <div className="subtle-card">
              <p className="muted-copy" style={{ margin: 0, fontSize: "0.9rem" }}>
                Save at least one more completed session to compare progress.
              </p>
            </div>
          ) : (
            <>
              <div className="subtle-card">
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className="language-select compare-select"
                    value={selectedComparisonId}
                    onChange={(e) => setSelectedComparisonId(e.target.value)}
                    style={{ flex: "1 1 200px" }}
                  >
                    {comparisonOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.sessionName || "Untitled"} · {new Date(option.endedAt).toLocaleDateString()} · {option.durationLabel}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!selectedComparisonId || comparison.status === "processing"}
                    onClick={() => requestSessionComparison(slug, sessionId, selectedComparisonId)}
                  >
                    {comparison.status === "processing" ? (
                      <><div className="spinner spinner-sm spinner-inline" />Comparing…</>
                    ) : (
                      "Compare"
                    )}
                  </button>
                </div>
              </div>

              {comparison.status === "processing" && (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <Spinner label="Comparing sessions…" />
                </div>
              )}

              {comparison.status === "failed" && (
                <div className="subtle-card" style={{ marginTop: 14 }}>
                  <div className="status-chip status-danger"><span className="status-dot" />Comparison failed</div>
                  <p className="muted-copy" style={{ marginTop: 10, marginBottom: 0, fontSize: "0.9rem" }}>
                    {comparison.error || "The comparison could not be completed."}
                  </p>
                </div>
              )}

              {comparison.status === "completed" && comparison.result && (
                <div className="comparison-stack">
                  <div className="subtle-card comparison-summary-card">
                    <div className={`status-chip ${comparison.result.trend === "improved" ? "status-success" : comparison.result.trend === "declined" ? "status-danger" : "status-warning"}`}>
                      <span className="status-dot" />
                      {comparison.result.trend}
                    </div>
                    <p className="muted-copy" style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>{comparison.result.summary}</p>
                  </div>
                  <div className="comparison-grid">
                    {comparison.result.metrics.map((metric) => {
                      const deltaPrefix = metric.delta > 0 ? "+" : "";
                      const trendClass = metric.trend === "improved" ? "comparison-delta positive" : metric.trend === "declined" ? "comparison-delta negative" : "comparison-delta neutral";
                      return (
                        <div className="subtle-card comparison-metric-card" key={metric.label}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <span className="metric-label" style={{ marginBottom: 0 }}>{metric.label}</span>
                            <span className={trendClass}>{deltaPrefix}{metric.delta}</span>
                          </div>
                          <div className="comparison-scoreline">
                            <span>Now {metric.currentValue}</span>
                            <span>Earlier {metric.baselineValue}</span>
                          </div>
                          <p className="muted-copy" style={{ marginTop: 8, marginBottom: 0, fontSize: "0.88rem" }}>{metric.insight}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Transcript card */}
        <div className="metric-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="section-title" style={{ margin: 0 }}>Transcript</div>
            {session.transcript.length > 6 && (
              <button type="button" className="toggle-btn" style={{ marginTop: 0 }} onClick={() => setTranscriptExpanded(e => !e)}>
                {transcriptExpanded ? "▲ Collapse" : "▼ Expand all"}
              </button>
            )}
          </div>
          {session.transcript.length === 0 ? (
            <div className="empty-state">No transcript was saved for this session.</div>
          ) : (
            <div className={transcriptExpanded ? "transcript-scroll transcript-scroll-expanded" : "transcript-scroll"}>
              {session.transcript.map((entry) => (
                <div className="transcript-item" key={entry.id}>
                  <div className="transcript-role">{entry.role}</div>
                  <p className="transcript-text">{entry.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}

function MetricCard({ metric }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="subtle-card">
      <span className="metric-label">{metric.label}</span>
      <div className="metric-value" style={{ fontSize: "1.6rem" }}>{metric.value}<span style={{ fontSize: "1rem", opacity: 0.5 }}>%</span></div>
      <div className="progress" style={{ marginTop: 8 }}>
        <span style={{ width: `${metric.value}%` }} />
      </div>
      {metric.justification && (
        <>
          {showDetail && (
            <p className="muted-copy" style={{ marginTop: 10, marginBottom: 0, fontSize: "0.85rem" }}>{metric.justification}</p>
          )}
          <button type="button" className="toggle-btn" style={{ marginTop: 8 }} onClick={() => setShowDetail(d => !d)}>
            {showDetail ? "▲ Hide detail" : "▼ Show detail"}
          </button>
        </>
      )}
    </div>
  );
}
