"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AGENTS, DEFAULT_METRICS } from "../lib/agents";

const AppContext = createContext(null);
const STORAGE_KEY = "pitchmirror-state-v1";

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
        ...current.session,
      },
      evaluation: {
        ...current.evaluation,
      },
      rating: current.rating || 0,
    };
    return acc;
  }, {});
}

function sanitizeState(state) {
  const initial = buildInitialAgentState();

  if (!state || typeof state !== "object") {
    return {
      theme: "dark",
      agents: initial,
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

  return {
    theme: state.theme === "light" ? "light" : "dark",
    agents: initial,
  };
}

export function AppProvider({ children }) {
  const [state, setState] = useState(() =>
    sanitizeState({
      theme: "dark",
      agents: buildInitialAgentState(),
    }),
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(sanitizeState(JSON.parse(raw)));
      }
    } catch (_error) {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        agents: buildPersistedAgents(state.agents),
      }),
    );
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.theme = state.theme;
  }, [mounted, state.theme]);

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

  const value = useMemo(
    () => ({
      mounted,
      state,
      setTheme,
      patchAgent,
    }),
    [mounted, patchAgent, setTheme, state],
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
