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

const AppContext = createContext(null);
const STORAGE_KEY = "pitchmirror-state-v1";

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
    }));
  }

  return {
    theme: state.theme === "light" ? "light" : "dark",
    agents: initial,
    sessions,
  };
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
        const response = await fetch("/api/session-resources", {
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
        const response = await fetch("/api/evaluate-session", {
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
          }),
          signal: abortController.signal,
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to evaluate session.");
        }

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
            status: payload.evaluation.resourceBriefs?.length ? "processing" : "completed",
            startedAt: payload.evaluation.resourceBriefs?.length
              ? new Date().toISOString()
              : currentSession.resources?.startedAt || "",
            completedAt: payload.evaluation.resourceBriefs?.length ? "" : new Date().toISOString(),
            briefs: payload.evaluation.resourceBriefs || [],
            topics: [],
            error: "",
          },
        }));

        pushToast(`${session.agentName || "Session"} evaluation is ready.`);
        if (payload.evaluation.resourceBriefs?.length) {
          void runResourceJob({
            agentSlug: session.agentSlug,
            id: session.id,
            agentName: session.agentName,
            resources: {
              briefs: payload.evaluation.resourceBriefs,
            },
          });
        }
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

        if (
          session.evaluation?.status === "completed" &&
          session.resources?.status === "idle" &&
          session.evaluation?.result?.resourceBriefs?.length
        ) {
          void runResourceJob({
            ...session,
            resources: {
              ...session.resources,
              briefs: session.evaluation.result.resourceBriefs,
            },
          });
          return;
        }

        if (session.resources?.status === "processing") {
          void runResourceJob(session);
        }
      });
    });
  }, [mounted, runEvaluationJob, runResourceJob, state.sessions]);

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
