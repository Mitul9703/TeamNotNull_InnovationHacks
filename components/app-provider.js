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
import {
  AGENTS,
  DEFAULT_METRICS,
  buildMockEvaluation,
} from "../lib/agents";

const AppContext = createContext(null);
const STORAGE_KEY = "pitchmirror-state-v1";
const EVALUATION_DELAY_MS = 10000;

function buildInitialAgentState() {
  return AGENTS.reduce((acc, agent) => {
    acc[agent.slug] = {
      upload: {
        status: "idle",
        fileName: "",
        previewUrl: "",
        previewOpen: false,
        contextPreview: "",
        error: "",
      },
      session: {
        status: "idle",
        muted: false,
        lastEndedAt: "",
        lastDurationLabel: "00:00",
      },
      evaluation: {
        score: DEFAULT_METRICS.score,
        metrics: DEFAULT_METRICS.metrics,
      },
      rating: 0,
    };
    return acc;
  }, {});
}

function buildPersistedAgents(agents) {
  return AGENTS.reduce((acc, agent) => {
    const current = agents?.[agent.slug] || buildInitialAgentState()[agent.slug];
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
  const evaluationTimersRef = useRef(new Map());

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

  const scheduleEvaluation = useCallback(
    (slug, sessionId, startedAt) => {
      const timerKey = `${slug}:${sessionId}`;
      if (evaluationTimersRef.current.has(timerKey)) {
        window.clearTimeout(evaluationTimersRef.current.get(timerKey));
      }

      const elapsed = Date.now() - new Date(startedAt).getTime();
      const remaining = Math.max(0, EVALUATION_DELAY_MS - elapsed);

      const timeoutId = window.setTimeout(() => {
        patchSession(slug, sessionId, (session) => ({
          ...session,
          evaluation: {
            status: "completed",
            startedAt: session.evaluation.startedAt,
            completedAt: new Date().toISOString(),
            result: buildMockEvaluation(slug),
          },
        }));
        evaluationTimersRef.current.delete(timerKey);
        pushToast(`${AGENTS.find((agent) => agent.slug === slug)?.name || "Session"} evaluation is ready.`);
      }, remaining);

      evaluationTimersRef.current.set(timerKey, timeoutId);
    },
    [patchSession, pushToast],
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

    for (const timerId of evaluationTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    evaluationTimersRef.current.clear();

    AGENTS.forEach((agent) => {
      (state.sessions[agent.slug] || []).forEach((session) => {
        if (session.evaluation?.status !== "processing") return;

        const startedAt = session.evaluation.startedAt || session.endedAt || new Date().toISOString();
        const elapsed = Date.now() - new Date(startedAt).getTime();

        if (elapsed >= EVALUATION_DELAY_MS) {
          patchSession(agent.slug, session.id, (currentSession) => ({
            ...currentSession,
            evaluation: {
              status: "completed",
              startedAt,
              completedAt: new Date().toISOString(),
              result: buildMockEvaluation(agent.slug),
            },
          }));
          return;
        }

        scheduleEvaluation(agent.slug, session.id, startedAt);
      });
    });

    return () => {
      for (const timerId of evaluationTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      evaluationTimersRef.current.clear();
    };
  }, [mounted, patchSession, scheduleEvaluation, state.sessions]);

  const createSessionRecord = useCallback(
    (session) => {
      const startedAt = new Date().toISOString();
      const sessionRecord = {
        ...session,
        evaluation: {
          status: "processing",
          startedAt,
        },
      };

      setState((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [session.agentSlug]: [sessionRecord, ...(current.sessions[session.agentSlug] || [])],
        },
      }));

      scheduleEvaluation(session.agentSlug, session.id, startedAt);
      return sessionRecord;
    },
    [scheduleEvaluation],
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
