"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AGENTS } from "../lib/agents";
import { getApiUrl } from "../lib/client-config";

const AppContext = createContext(null);
const STORAGE_KEY = "pitchmirror-state-v1";

function buildDefaultComparison() {
  return {
    status: "idle",
    baselineSessionId: "",
    result: null,
    error: "",
  };
}

function buildDefaultEvaluation(agent) {
  return {
    score: 0,
    metrics: (agent.evaluationCriteria || []).map((criterion) => ({
      label: criterion.label,
      value: 0,
    })),
  };
}

function buildInitialAgentState() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = {
      upload: {
        status: "idle",
        fileName: "",
        previewUrl: "",
        previewOpen: false,
        contextPreview: "",
        contextText: "",
        error: "",
      },
      sessionName: "",
      customContextText: "",
      session: {
        status: "idle",
        muted: false,
        lastEndedAt: "",
        lastDurationLabel: "00:00",
      },
      evaluation: buildDefaultEvaluation(agent),
      rating: 0,
    };
    return acc;
  }, {});
}

function buildPersistedAgents(agents) {
  const initial = buildInitialAgentState();
  return AGENTS.reduce((acc, agent) => {
    const current = agents?.[agent.slug] || initial[agent.slug];
    acc[agent.slug] = {
      session: {
        status: "idle",
        muted: false,
        lastEndedAt: current.session?.lastEndedAt || "",
        lastDurationLabel: current.session?.lastDurationLabel || "00:00",
      },
      evaluation: {
        ...current.evaluation,
      },
      rating: current.rating || 0,
    };
    return acc;
  }, {});
}

function buildInitialSessions() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = [];
    return acc;
  }, {});
}

function sanitizeState(state) {
  const initial = buildInitialAgentState();
  const sessions = buildInitialSessions();

  if (!state || typeof state !== "object") {
    return {
      theme: "dark",
      agents: initial,
      sessions,
    };
  }

  for (const agent of AGENTS) {
    const saved = state.agents?.[agent.slug];
    if (!saved) continue;

    initial[agent.slug] = {
      upload: {
        ...initial[agent.slug].upload,
      },
      session: {
        ...initial[agent.slug].session,
        ...saved.session,
      },
      evaluation: {
        ...initial[agent.slug].evaluation,
        ...saved.evaluation,
      },
      rating: saved.rating || 0,
    };
  }

  for (const agent of AGENTS) {
    const savedSessions = Array.isArray(state.sessions?.[agent.slug])
      ? state.sessions[agent.slug]
      : [];
    sessions[agent.slug] = savedSessions.map((session) => ({
      ...session,
      sessionName: typeof session.sessionName === "string" ? session.sessionName : "",
      transcript: Array.isArray(session.transcript) ? session.transcript : [],
      upload: session.upload || null,
      evaluation: session.evaluation || {
        status: "processing",
        startedAt: new Date().toISOString(),
      },
      resources: session.resources || {
        status: "idle",
        briefs: [],
        topics: [],
        error: "",
      },
      comparison: session.comparison || buildDefaultComparison(),
    }));
  }

  return {
    theme: state.theme === "light" ? "light" : "dark",
    agents: initial,
    sessions,
  };
}

function deriveResourceBriefs(agentSlug, evaluation) {
  const briefs = Array.isArray(evaluation?.resourceBriefs)
    ? evaluation.resourceBriefs.filter(Boolean)
    : [];

  if (briefs.length) {
    return briefs.slice(0, 2);
  }

  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  const sortedMetrics = [...metrics]
    .filter((metric) => typeof metric?.value === "number")
    .sort((a, b) => a.value - b.value);
  const improvements = Array.isArray(evaluation?.improvements)
    ? evaluation.improvements.filter(Boolean)
    : [];

  const fallback = [];

  if (improvements[0]) {
    fallback.push({
      id: "fallback-1",
      topic: sortedMetrics[0]?.label || "Primary improvement area",
      improvement: improvements[0],
      whyThisMatters:
        sortedMetrics[0]?.justification ||
        "This was one of the clearest opportunities for improvement in the evaluation.",
      searchPhrases: [
        `${agentSlug} interview ${improvements[0]}`,
        `${sortedMetrics[0]?.label || "communication"} improvement practice`,
      ],
      resourceTypes: agentSlug === "coding"
        ? ["youtube", "leetcode", "website"]
        : ["youtube", "article", "website"],
    });
  }

  if (improvements[1]) {
    fallback.push({
      id: "fallback-2",
      topic: sortedMetrics[1]?.label || "Secondary improvement area",
      improvement: improvements[1],
      whyThisMatters:
        sortedMetrics[1]?.justification ||
        "This was another important skill to strengthen based on the evaluation.",
      searchPhrases: [
        `${agentSlug} interview ${improvements[1]}`,
        `${sortedMetrics[1]?.label || "practice"} examples`,
      ],
      resourceTypes: agentSlug === "coding"
        ? ["youtube", "leetcode", "website"]
        : ["youtube", "article", "website"],
    });
  }

  return fallback;
}

export function AppProvider({ children }) {
  const [state, setState] = useState(() =>
    sanitizeState({
      theme: "dark",
      agents: buildInitialAgentState(),
      sessions: buildInitialSessions(),
    }),
  );
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState([]);
  const evaluationJobsRef = useRef(new Map());
  const resourceJobsRef = useRef(new Map());
  const comparisonJobsRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(sanitizeState(JSON.parse(raw)));
      }
    } catch (_error) {}
    setMounted(true);
  }, []);

  const setTheme = useCallback((theme) => {
    setState((current) => ({
      ...current,
      theme,
    }));
  }, []);

  const patchAgent = useCallback((slug, updater) => {
    setState((current) => {
      const previous = current.agents[slug];
      return {
        ...current,
        agents: {
          ...current.agents,
          [slug]: typeof updater === "function" ? updater(previous) : previous,
        },
      };
    });
  }, []);

  const patchSession = useCallback((slug, sessionId, updater) => {
    setState((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [slug]: (current.sessions[slug] || []).map((session) =>
          session.id === sessionId ? updater(session) : session,
        ),
      },
    }));
  }, []);

  const clearAgentSessions = useCallback(
    (slug) => {
      const sessionsToClear = state.sessions?.[slug] || [];

      sessionsToClear.forEach((session) => {
        const key = `${slug}:${session.id}`;
        const evaluationController = evaluationJobsRef.current.get(key);
        if (evaluationController) {
          evaluationController.abort();
          evaluationJobsRef.current.delete(key);
        }

        const resourceController = resourceJobsRef.current.get(key);
        if (resourceController) {
          resourceController.abort();
          resourceJobsRef.current.delete(key);
        }

        const comparisonController = comparisonJobsRef.current.get(key);
        if (comparisonController) {
          comparisonController.abort();
          comparisonJobsRef.current.delete(key);
        }
      });

      setState((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [slug]: [],
        },
      }));
    },
    [state.sessions],
  );

  const runResourceJob = useCallback(
    async (session) => {
      const jobKey = `${session.agentSlug}:${session.id}`;
      if (resourceJobsRef.current.has(jobKey)) {
        return;
      }

      const briefs = session.resources?.briefs || [];
      if (!briefs.length) {
        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          resources: {
            ...currentSession.resources,
            status: "completed",
            completedAt: new Date().toISOString(),
            error: "",
          },
        }));
        return;
      }

      const abortController = new AbortController();
      resourceJobsRef.current.set(jobKey, abortController);

      patchSession(session.agentSlug, session.id, (currentSession) => ({
        ...currentSession,
        resources: {
          ...currentSession.resources,
          status: "processing",
          startedAt:
            currentSession.resources?.startedAt || new Date().toISOString(),
          error: "",
        },
      }));

      try {
        const response = await fetch(getApiUrl("/api/session-resources"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentSlug: session.agentSlug,
            sessionId: session.id,
            resourceBriefs: briefs,
          }),
          signal: abortController.signal,
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to fetch resources.");
        }

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          resources: {
            ...currentSession.resources,
            status: "completed",
            completedAt: new Date().toISOString(),
            topics: payload.topics || [],
            error: "",
          },
        }));

        pushToast(`${session.agentName || "Session"} resources are ready.`);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          resources: {
            ...currentSession.resources,
            status: "failed",
            failedAt: new Date().toISOString(),
            error: error.message || "Resource search failed.",
          },
        }));
      } finally {
        resourceJobsRef.current.delete(jobKey);
      }
    },
    [patchSession, pushToast],
  );

  const runEvaluationJob = useCallback(
    async (session) => {
      const jobKey = `${session.agentSlug}:${session.id}`;
      if (evaluationJobsRef.current.has(jobKey)) {
        return;
      }

      const abortController = new AbortController();
      evaluationJobsRef.current.set(jobKey, abortController);

      patchSession(session.agentSlug, session.id, (currentSession) => ({
        ...currentSession,
        evaluation: {
          ...currentSession.evaluation,
          status: "processing",
          startedAt:
            currentSession.evaluation?.startedAt ||
            currentSession.endedAt ||
            new Date().toISOString(),
          error: "",
        },
      }));

      try {
        const response = await fetch(getApiUrl("/api/evaluate-session"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentSlug: session.agentSlug,
            sessionId: session.id,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationLabel: session.durationLabel,
            transcript: session.transcript || [],
            upload: session.upload || null,
            coding: session.coding || null,
            customContext: session.customContext || "",
          }),
          signal: abortController.signal,
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to evaluate session.");
        }

        const derivedBriefs = deriveResourceBriefs(
          session.agentSlug,
          payload.evaluation,
        );

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          evaluation: {
            status: "completed",
            startedAt:
              currentSession.evaluation?.startedAt ||
              session.evaluation?.startedAt ||
              new Date().toISOString(),
            completedAt: new Date().toISOString(),
            result: payload.evaluation,
            error: "",
          },
          resources: {
            status: derivedBriefs.length ? "idle" : "completed",
            startedAt: "",
            completedAt: derivedBriefs.length ? "" : new Date().toISOString(),
            briefs: derivedBriefs,
            topics: [],
            error: "",
          },
        }));

        pushToast(`${session.agentName || "Session"} evaluation is ready.`);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          evaluation: {
            ...currentSession.evaluation,
            status: "failed",
            failedAt: new Date().toISOString(),
            error: error.message || "Evaluation failed.",
          },
        }));

        pushToast(
          `${session.agentName || "Session"} evaluation could not be completed.`,
        );
      } finally {
        evaluationJobsRef.current.delete(jobKey);
      }
    },
    [patchSession, pushToast, runResourceJob],
  );

  const requestResourceFetch = useCallback(
    (slug, sessionId) => {
      const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);
      if (!session || !session.resources?.briefs?.length) {
        return;
      }

      void runResourceJob(session);
    },
    [runResourceJob, state.sessions],
  );

  const runComparisonJob = useCallback(
    async (session, baselineSessionId) => {
      const jobKey = `${session.agentSlug}:${session.id}`;
      if (comparisonJobsRef.current.has(jobKey)) {
        return;
      }

      const baselineSession = (state.sessions?.[session.agentSlug] || []).find(
        (item) => item.id === baselineSessionId,
      );

      if (
        !baselineSession ||
        session.evaluation?.status !== "completed" ||
        baselineSession.evaluation?.status !== "completed"
      ) {
        return;
      }

      const abortController = new AbortController();
      comparisonJobsRef.current.set(jobKey, abortController);

      patchSession(session.agentSlug, session.id, (currentSession) => ({
        ...currentSession,
        comparison: {
          ...currentSession.comparison,
          status: "processing",
          baselineSessionId,
          startedAt: new Date().toISOString(),
          error: "",
        },
      }));

      try {
        const response = await fetch(getApiUrl("/api/compare-sessions"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentSlug: session.agentSlug,
            currentSession: {
              id: session.id,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              durationLabel: session.durationLabel,
              evaluation: session.evaluation.result,
            },
            baselineSession: {
              id: baselineSession.id,
              startedAt: baselineSession.startedAt,
              endedAt: baselineSession.endedAt,
              durationLabel: baselineSession.durationLabel,
              evaluation: baselineSession.evaluation.result,
            },
          }),
          signal: abortController.signal,
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to compare sessions.");
        }

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          comparison: {
            status: "completed",
            baselineSessionId,
            completedAt: new Date().toISOString(),
            result: payload.comparison,
            error: "",
          },
        }));

        pushToast(`${session.agentName || "Session"} comparison is ready.`);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        patchSession(session.agentSlug, session.id, (currentSession) => ({
          ...currentSession,
          comparison: {
            ...currentSession.comparison,
            status: "failed",
            baselineSessionId,
            failedAt: new Date().toISOString(),
            error: error.message || "Comparison failed.",
          },
        }));
      } finally {
        comparisonJobsRef.current.delete(jobKey);
      }
    },
    [patchSession, pushToast, state.sessions],
  );

  const requestSessionComparison = useCallback(
    (slug, sessionId, baselineSessionId) => {
      const session = (state.sessions?.[slug] || []).find((item) => item.id === sessionId);
      if (!session || !baselineSessionId) {
        return;
      }

      void runComparisonJob(session, baselineSessionId);
    },
    [runComparisonJob, state.sessions],
  );

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        agents: buildPersistedAgents(state.agents),
        sessions: state.sessions,
      }),
    );
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state.theme]);

  useEffect(() => {
    if (!mounted) return;

    AGENTS.forEach((agent) => {
      (state.sessions[agent.slug] || []).forEach((session) => {
        if (session.evaluation?.status === "processing") {
          void runEvaluationJob(session);
          return;
        }

        if (session.resources?.status === "processing") {
          void runResourceJob(session);
        }

        if (session.comparison?.status === "processing" && session.comparison?.baselineSessionId) {
          void runComparisonJob(session, session.comparison.baselineSessionId);
        }
      });
    });
  }, [mounted, runComparisonJob, runEvaluationJob, runResourceJob, state.sessions]);

  useEffect(() => {
    return () => {
      for (const controller of evaluationJobsRef.current.values()) {
        controller.abort();
      }
      evaluationJobsRef.current.clear();
      for (const controller of resourceJobsRef.current.values()) {
        controller.abort();
      }
      resourceJobsRef.current.clear();
      for (const controller of comparisonJobsRef.current.values()) {
        controller.abort();
      }
      comparisonJobsRef.current.clear();
    };
  }, []);

  const createSessionRecord = useCallback(
    (session) => {
      const startedAt = new Date().toISOString();
      const sessionRecord = {
        ...session,
        evaluation: {
          status: "processing",
          startedAt,
          error: "",
        },
        resources: {
          status: "idle",
          briefs: [],
          topics: [],
          error: "",
        },
        comparison: buildDefaultComparison(),
      };

      setState((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [session.agentSlug]: [sessionRecord, ...(current.sessions[session.agentSlug] || [])],
        },
      }));

      void runEvaluationJob(sessionRecord);
      return sessionRecord;
    },
    [runEvaluationJob],
  );

  const value = useMemo(
    () => ({
      mounted,
      state,
      setTheme,
      patchAgent,
      patchSession,
      clearAgentSessions,
      requestResourceFetch,
      requestSessionComparison,
      createSessionRecord,
      dismissToast,
      toasts,
    }),
    [
      createSessionRecord,
      dismissToast,
      mounted,
      patchAgent,
      patchSession,
      clearAgentSessions,
      requestResourceFetch,
      requestSessionComparison,
      setTheme,
      state,
      toasts,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}
