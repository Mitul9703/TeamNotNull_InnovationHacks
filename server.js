import http from "node:http";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import next from "next";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { AssemblyAI } from "assemblyai";
import { AIMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { AGENT_LOOKUP } from "./lib/agents.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
const upload = multer({ dest: "uploads/" });

const GEMINI_ENV_BY_TASK = {
  live: ["GEMINI_LIVE_API_KEY", "GEMINI_API_KEY"],
  questionFinder: ["GEMINI_QUESTION_FINDER_API_KEY", "GEMINI_API_KEY"],
  evaluation: ["GEMINI_EVALUATION_API_KEY", "GEMINI_API_KEY"],
  resources: ["GEMINI_RESOURCE_CURATION_API_KEY", "GEMINI_API_KEY"],
  uploadPrep: ["GEMINI_UPLOAD_PREP_API_KEY", "GEMINI_API_KEY"],
};

function getGeminiApiKey(task) {
  const candidates = GEMINI_ENV_BY_TASK[task] || ["GEMINI_API_KEY"];
  for (const envName of candidates) {
    const value = (process.env[envName] || "").trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing Gemini API key for task "${task}". Checked: ${candidates.join(", ")}`);
}

const ANAM_AVATAR_PROFILES = [
  { name: "Kevin", avatarId: "ccf00c0e-7302-455b-ace2-057e0cf58127", gender: "Male" },
  { name: "Gabriel", avatarId: "6cc28442-cccd-42a8-b6e4-24b7210a09c5", gender: "Male" },
  { name: "Sophie", avatarId: "6dbc1e47-7768-403e-878a-94d7fcc3677b", gender: "Female" },
  { name: "Astrid", avatarId: "e717a556-2d44-4213-96ec-27d0b94dc198", gender: "Female" },
  { name: "Cara", avatarId: "d9ebe82e-2f34-4ff6-9632-16cb73e7de08", gender: "Female" },
  { name: "Mia", avatarId: "edf6fdcb-acab-44b8-b974-ded72665ee26", gender: "Female" },
  { name: "Leo", avatarId: "d73415e3-d624-45a6-a461-0df1580e73d6", gender: "Male" },
  { name: "Richard", avatarId: "19d18eb0-5346-4d50-a77f-26b3723ed79d", gender: "Male" },
];

const GEMINI_VOICE_BY_GENDER = {
  Male: ["Charon"],
  Female: ["Aoede", "Autonoe", "Despina", "Sulafat"],
};

function pickRandomItem(items) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)];
}

function pickRandomAnamProfile() {
  const profile = pickRandomItem(ANAM_AVATAR_PROFILES) || ANAM_AVATAR_PROFILES[0];
  const voicePool = GEMINI_VOICE_BY_GENDER[profile.gender] || GEMINI_VOICE_BY_GENDER.Female;
  return {
    ...profile,
    voiceName: pickRandomItem(voicePool) || "Aoede",
  };
}

const evaluationResponseSchema = {
  type: Type.OBJECT,
  required: [
    "score",
    "summary",
    "metrics",
    "strengths",
    "improvements",
    "recommendations",
    "resourceBriefs",
  ],
  properties: {
    score: {
      type: Type.INTEGER,
      description: "Overall evaluation score from 0 to 100.",
    },
    summary: {
      type: Type.STRING,
      description: "A concise overall summary of the session.",
    },
    metrics: {
      type: Type.ARRAY,
      description: "Rubric metrics for this agent.",
      items: {
        type: Type.OBJECT,
        required: ["label", "score", "justification"],
        properties: {
          label: {
            type: Type.STRING,
          },
          score: {
            type: Type.INTEGER,
          },
          justification: {
            type: Type.STRING,
          },
        },
      },
    },
    strengths: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    improvements: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    resourceBriefs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["topic", "improvement", "whyThisMatters", "searchPhrases", "resourceTypes"],
        properties: {
          topic: {
            type: Type.STRING,
          },
          improvement: {
            type: Type.STRING,
          },
          whyThisMatters: {
            type: Type.STRING,
          },
          searchPhrases: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
          resourceTypes: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
      },
    },
  },
};

const comparisonResponseSchema = {
  type: Type.OBJECT,
  required: ["trend", "summary", "metrics"],
  properties: {
    trend: {
      type: Type.STRING,
      description: "Overall direction of change. Use improved, mixed, similar, or declined.",
    },
    summary: {
      type: Type.STRING,
      description: "A short comparison inference with minimal wording.",
    },
    metrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["label", "delta", "trend", "insight"],
        properties: {
          label: {
            type: Type.STRING,
          },
          delta: {
            type: Type.INTEGER,
          },
          trend: {
            type: Type.STRING,
          },
          insight: {
            type: Type.STRING,
          },
        },
      },
    },
  },
};

const threadEvaluationResponseSchema = {
  type: Type.OBJECT,
  required: [
    "summary",
    "trajectory",
    "comments",
    "strengths",
    "focusAreas",
    "nextSessionFocus",
    "metricTrends",
    "hiddenGuidance",
  ],
  properties: {
    summary: { type: Type.STRING },
    trajectory: { type: Type.STRING },
    comments: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    focusAreas: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    nextSessionFocus: { type: Type.STRING },
    metricTrends: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["label", "trend", "comment"],
        properties: {
          label: { type: Type.STRING },
          trend: { type: Type.STRING },
          comment: { type: Type.STRING },
        },
      },
    },
    hiddenGuidance: {
      type: Type.STRING,
      description: "Internal-only hidden session guidance for the next live session. Never meant for direct user display.",
    },
  },
};

const tinyFishArticlesSchema = {
  type: Type.OBJECT,
  required: ["resources"],
  properties: {
    resources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["title", "url", "type", "source", "reason_relevant"],
        properties: {
          title: { type: Type.STRING },
          url: { type: Type.STRING },
          type: { type: Type.STRING },
          source: { type: Type.STRING },
          reason_relevant: { type: Type.STRING },
        },
      },
    },
  },
};

function normalizeTranscriptRole(role) {
  if (!role) return "User";
  if (role === "You") return "User";
  return role;
}

function buildTranscriptText(transcript) {
  return (transcript || [])
    .map((entry) => {
      const role = normalizeTranscriptRole(entry.role);
      const text = (entry.text || "").trim();
      if (!text) return null;
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildCodingContext(coding) {
  if (!coding) return "";

  const question = coding.interviewQuestion?.markdown
    ? `
Prepared interview question:
${coding.interviewQuestion.markdown}
    `.trim()
    : "";

  return `
Coding session context:
Selected language: ${coding.language || "Unspecified"}
${coding.companyUrl ? `Target company URL: ${coding.companyUrl}\n` : ""}
${question ? `${question}\n\n` : ""}

Latest candidate code:
${coding.finalCode?.trim() || "No code was saved."}
  `.trim();
}

function buildExternalResearchContext(externalResearch, companyUrl = "") {
  if (!externalResearch?.markdown) return "";

  return `
Prepared external research brief:
${companyUrl ? `Target company URL: ${companyUrl}\n` : ""}${externalResearch.markdown}
  `.trim();
}

function normalizeEvaluationResult(agent, rawResult) {
  const criteria = agent.evaluationCriteria || [];
  const metricsByLabel = new Map(
    (rawResult.metrics || []).map((metric) => [metric.label, metric]),
  );

  const metrics = criteria.map((criterion) => {
    const metric = metricsByLabel.get(criterion.label);
    return {
      label: criterion.label,
      value: Math.max(0, Math.min(100, Number(metric?.score || 0))),
      justification: (metric?.justification || "").trim(),
    };
  });

  return {
    score: Math.max(0, Math.min(100, Number(rawResult.score || 0))),
    summary: (rawResult.summary || "").trim(),
    metrics,
    strengths: Array.isArray(rawResult.strengths)
      ? rawResult.strengths.filter(Boolean).slice(0, 4)
      : [],
    improvements: Array.isArray(rawResult.improvements)
      ? rawResult.improvements.filter(Boolean).slice(0, 4)
      : [],
    recommendations: Array.isArray(rawResult.recommendations)
      ? rawResult.recommendations.filter(Boolean).slice(0, 4)
      : [],
    resourceBriefs: Array.isArray(rawResult.resourceBriefs)
      ? rawResult.resourceBriefs
          .map((brief, index) => ({
            id: brief.id || `brief-${index + 1}`,
            topic: (brief.topic || "").trim(),
            improvement: (brief.improvement || "").trim(),
            whyThisMatters: (brief.whyThisMatters || "").trim(),
            searchPhrases: Array.isArray(brief.searchPhrases)
              ? brief.searchPhrases.filter(Boolean).slice(0, 3)
              : [],
            resourceTypes: Array.isArray(brief.resourceTypes)
              ? brief.resourceTypes.filter(Boolean).slice(0, 3)
              : [],
          }))
          .filter((brief) => brief.topic && brief.improvement)
          .slice(0, 2)
      : [],
  };
}

function normalizeComparisonResult(agent, rawResult, currentEvaluation, baselineEvaluation) {
  const allowedTrends = new Set(["improved", "mixed", "similar", "declined"]);
  const currentMetrics = Array.isArray(currentEvaluation?.metrics)
    ? currentEvaluation.metrics
    : [];
  const baselineMetrics = Array.isArray(baselineEvaluation?.metrics)
    ? baselineEvaluation.metrics
    : [];

  const metrics = (agent.evaluationCriteria || []).map((criterion) => {
    const currentMetric = currentMetrics.find((item) => item.label === criterion.label);
    const baselineMetric = baselineMetrics.find((item) => item.label === criterion.label);
    const currentValue = typeof currentMetric?.value === "number" ? currentMetric.value : 0;
    const baselineValue = typeof baselineMetric?.value === "number" ? baselineMetric.value : 0;
    const rawMetric = Array.isArray(rawResult?.metrics)
      ? rawResult.metrics.find((item) => item.label === criterion.label)
      : null;
    const delta = typeof rawMetric?.delta === "number" ? rawMetric.delta : currentValue - baselineValue;
    const trend = allowedTrends.has(rawMetric?.trend)
      ? rawMetric.trend
      : delta > 4
        ? "improved"
        : delta < -4
          ? "declined"
          : "similar";

    return {
      label: criterion.label,
      currentValue,
      baselineValue,
      delta,
      trend,
      insight:
        typeof rawMetric?.insight === "string" && rawMetric.insight.trim()
          ? rawMetric.insight.trim()
          : delta === 0
            ? "This metric stayed broadly steady between the two sessions."
            : delta > 0
              ? "This metric improved in the newer session."
              : "This metric slipped in the newer session.",
    };
  });

  return {
    trend: allowedTrends.has(rawResult?.trend) ? rawResult.trend : "mixed",
    summary:
      typeof rawResult?.summary === "string" && rawResult.summary.trim()
        ? rawResult.summary.trim()
        : "This session shows mixed movement compared with the selected earlier session.",
    metrics,
  };
}

async function searchFirecrawl(query, { limit = 6 } = {}) {
  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      limit,
      location: "United States",
      timeout: 30000,
      ignoreInvalidURLs: true,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    console.error("[firecrawl-search] failed", {
      status: response.status,
      payload,
    });
    throw new Error(payload?.message || payload?.error || "Firecrawl search failed.");
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function scrapeWithFirecrawl(url) {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
      blockAds: true,
      proxy: "auto",
    }),
  });

  const payload = await response.json();

  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || "Firecrawl scrape failed.");
  }

  return payload?.data || null;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function normalizeHttpUrl(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function companyNameFromUrl(rawUrl) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return "";

  try {
    const { hostname } = new URL(normalized);
    const cleaned = hostname
      .replace(/^www\./, "")
      .replace(/\.(com|ai|io|org|net|co|app|dev|jobs|careers)$/i, "");
    return cleaned
      .split(".")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch (_error) {
    return "";
  }
}

function extractTextFromLangChainContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n");
  }

  if (content && typeof content.text === "string") {
    return content.text;
  }

  return "";
}

function stripCodeFences(text) {
  return (text || "")
    .trim()
    .replace(/^```markdown\s*/i, "")
    .replace(/^```md\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeCodingQuestionMarkdown(rawText, companyUrl) {
  const markdown = stripCodeFences(rawText);
  if (!markdown) {
    return null;
  }

  const titleMatch = markdown.match(/(?:^|\n)#{1,6}\s*(.+)/);
  const sourceUrlMatch = markdown.match(/https?:\/\/[^\s)]+/i);

  return {
    companyName: companyNameFromUrl(companyUrl) || "",
    title: (titleMatch?.[1] || "Company-specific coding question").trim(),
    markdown,
    sourceUrl: normalizeHttpUrl(sourceUrlMatch?.[0] || ""),
  };
}

function hasGroundedProblemSignals(markdown = "", title = "") {
  const text = `${title}\n${markdown}`.toLowerCase();
  const signalChecks = [
    /given\s+an?\s/,
    /\binput\b/,
    /\boutput\b/,
    /\bexample\b/,
    /\bconstraint/,
    /\breturn\b/,
    /\btest case/,
  ];

  const matchCount = signalChecks.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );

  return matchCount >= 3;
}

function looksLikeWeakInterviewExperienceSource(url = "", title = "") {
  const normalized = `${url} ${title}`.toLowerCase();
  return (
    normalized.includes("interview-experience") ||
    normalized.includes("my-") ||
    normalized.includes("experience") ||
    normalized.includes("medium.com")
  );
}

function normalizeFirecrawlCandidates(results, fallbackType) {
  return (results || [])
    .map((item) => ({
      title: (item.title || "").trim(),
      url: (item.url || "").trim(),
      source: domainFromUrl(item.url || ""),
      snippet: (item.description || "").trim(),
      scrapedSummary: (item.markdown || "").slice(0, 1800),
      type: fallbackType,
    }))
    .filter((item) => item.title && item.url);
}

async function curateResourceCandidates(brief, candidates) {
  const ai = new GoogleGenAI({
    apiKey: getGeminiApiKey("resources"),
  });

  const prompt = `
Topic: ${brief.topic}
Improvement area: ${brief.improvement}
Why it matters: ${brief.whyThisMatters}

Candidate resources:
${candidates.map((candidate, index) => `
Candidate ${index + 1}
- title: ${candidate.title}
- url: ${candidate.url}
- source: ${candidate.source}
- type: ${candidate.type}
- search snippet: ${candidate.snippet || "None"}
- scraped summary: ${(candidate.scrapedSummary || "").slice(0, 1200) || "None"}
`).join("\n")}

Return exactly up to 4 resources in JSON.
Prefer practical, educational, high-signal links.
Avoid duplicates, spammy pages, and weak matches.
Reason relevance specifically for this improvement area.
Use type values like youtube, article, website, or leetcode.
  `.trim();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      systemInstruction:
        "You curate improvement resources for a practice app. Select the strongest links from the provided candidates only. Never invent URLs. Prefer practical, credible, and directly relevant resources.",
      responseMimeType: "application/json",
      responseSchema: tinyFishArticlesSchema,
    },
  });

  const parsed = JSON.parse((response.text || "").trim());
  const resources = Array.isArray(parsed?.resources) ? parsed.resources : [];

  return resources
    .map((resource) => ({
      title: (resource.title || "").trim(),
      url: (resource.url || "").trim(),
      type: (resource.type || "").trim(),
      source: (resource.source || "").trim(),
      reason: (resource.reason_relevant || "").trim(),
    }))
    .filter((resource) => resource.title && resource.url);
}

async function fetchResourcesForBrief(brief) {
  const phrases = (brief.searchPhrases || []).filter(Boolean);
  const primaryPhrase = phrases[0] || brief.topic || brief.improvement;
  const secondaryPhrase = phrases[1] || brief.improvement || brief.topic;
  const isCoding = brief.agentSlug === "coding";

  const videoQuery = isCoding
    ? `${primaryPhrase} site:youtube.com coding interview OR neetcode OR leetcode`
    : `${primaryPhrase} site:youtube.com`;
  const articleQuery = isCoding
    ? `${secondaryPhrase} site:leetcode.com OR site:neetcode.io OR site:geeksforgeeks.org`
    : `${secondaryPhrase}`;

  const [videoResults, articleResults] = await Promise.all([
    searchFirecrawl(videoQuery, { limit: 5 }),
    searchFirecrawl(articleQuery, { limit: 6 }),
  ]);

  const rawCandidates = [
    ...normalizeFirecrawlCandidates(videoResults, "youtube"),
    ...normalizeFirecrawlCandidates(articleResults, isCoding ? "website" : "article"),
  ];

  const deduped = [];
  const seen = new Set();
  for (const candidate of rawCandidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    deduped.push(candidate);
    if (deduped.length >= 6) break;
  }

  const enriched = await Promise.all(
    deduped.map(async (candidate) => {
      if (candidate.scrapedSummary) {
        return candidate;
      }
      try {
        const scraped = await scrapeWithFirecrawl(candidate.url);
        return {
          ...candidate,
          source:
            candidate.source ||
            scraped?.metadata?.title ||
            domainFromUrl(candidate.url),
          scrapedSummary: (scraped?.markdown || "").slice(0, 1800),
        };
      } catch (_error) {
        return candidate;
      }
    }),
  );

  const curated = await curateResourceCandidates(brief, enriched);
  return curated.slice(0, 4);
}

async function generateExternalResearchForAgent({
  agentSlug,
  companyUrl,
  customContext = "",
  uploadContextText = "",
}) {
  const normalizedUrl = normalizeHttpUrl(companyUrl);

  if (!normalizedUrl) {
    throw new Error("A valid company URL is required.");
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("Missing FIRECRAWL_API_KEY.");
  }

  getGeminiApiKey("questionFinder");

  const companyName = companyNameFromUrl(normalizedUrl) || "the target company";
  const agentConfig = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.custom;
  const searchLogs = [];
  const scrapeLogs = [];
  const scrapeCache = new Map();
  const searchTool = tool(
    async ({ query, limit = 5 }) => {
      const results = await searchFirecrawl(query, { limit });
      const candidates = normalizeFirecrawlCandidates(results, "website")
        .map((item) => ({
          title: item.title,
          url: item.url,
          source: item.source,
          snippet: item.snippet,
          likelyWeakSource: looksLikeWeakInterviewExperienceSource(item.url, item.title),
        }))
        .slice(0, limit);

      searchLogs.push({ query, candidates });
      console.log("[external-research] search", {
        agentSlug,
        companyName,
        query,
        candidates: candidates.map((candidate) => ({
          title: candidate.title,
          url: candidate.url,
          weak: candidate.likelyWeakSource,
        })),
      });

      return JSON.stringify(candidates);
    },
    {
      name: "search_web_for_coding_questions",
      description:
        "Search the public web for actual coding problem pages, company-tagged practice lists, or grounded sources that contain real coding question details. Use this before scraping.",
      schema: z.object({
        query: z.string().describe("A web search query focused on coding interview questions."),
        limit: z.number().int().min(1).max(6).optional(),
      }),
    },
  );

  const scrapeTool = tool(
    async ({ url }) => {
      const normalizedTarget = normalizeHttpUrl(url);
      if (!normalizedTarget) {
        throw new Error("A valid URL is required for scraping.");
      }

      const scraped = await scrapeWithFirecrawl(normalizedTarget);
      const payload = {
        url: normalizedTarget,
        title:
          scraped?.metadata?.title ||
          scraped?.metadata?.ogTitle ||
          domainFromUrl(normalizedTarget),
        markdown: (scraped?.markdown || "").slice(0, 9000),
      };
      const groundedProblemSignals = hasGroundedProblemSignals(
        payload.markdown,
        payload.title,
      );
      const weakSource = looksLikeWeakInterviewExperienceSource(
        normalizedTarget,
        payload.title,
      );
      const enrichedPayload = {
        ...payload,
        groundedProblemSignals,
        weakSource,
      };

      scrapeCache.set(normalizedTarget, enrichedPayload);
      scrapeLogs.push({
        url: normalizedTarget,
        title: enrichedPayload.title,
        groundedProblemSignals,
        weakSource,
        preview: enrichedPayload.markdown.slice(0, 400),
      });
      console.log("[external-research] scrape", {
        agentSlug,
        url: normalizedTarget,
        title: enrichedPayload.title,
        groundedProblemSignals,
        weakSource,
        preview: enrichedPayload.markdown.slice(0, 220),
      });

      return JSON.stringify(enrichedPayload);
    },
    {
      name: "scrape_coding_question_source",
      description:
        "Scrape one promising page to extract the grounded question text, examples, constraints, and supporting evidence. Use only on the most relevant URLs.",
      schema: z.object({
        url: z.string().describe("The URL of a promising source page to scrape."),
      }),
    },
  );

  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.1,
    maxRetries: 2,
    apiKey: getGeminiApiKey("questionFinder"),
  });

  const codingQuestionAgent = createAgent({
    model: llm,
    tools: [searchTool, scrapeTool],
    systemPrompt: agentSlug === "coding"
      ? `You are a careful research agent selecting exactly one grounded coding interview question for a live technical interview rehearsal.

Workflow:
- Search first for reputable public sources such as actual problem pages, company-tagged coding question lists, or well-known prep pages.
- Prefer LeetCode problem pages, company-tagged question lists, NeetCode-style lists, or public pages that contain a full problem statement.
- If you find an interview-experience page that only mentions a question title, topic, or data structure, do not stop there. Treat it as a clue and search again for the actual problem page or a canonical public source that contains the full problem statement.
- If you find a company-tagged list page, use it as a directory and then scrape one of the actual linked problem pages rather than returning the list page itself.
- If a clue page mentions a recognizable question title, search for that title directly and then scrape the actual problem page.
- If a clue page mentions only a topic or pattern such as sliding window, graphs, two pointers, BFS, or hash maps, continue searching for the most plausible concrete question in that family for the target company and level.
- Scrape the most promising one or two URLs to verify the question details.
- Choose exactly one question that is plausible for an early-round coding screen and has enough detail to restate aloud.

Selection rules:
- Prefer simple to lower-medium questions over obscure or overly hard ones.
- Prefer algorithmic coding questions, not system design or trivia.
- Ground the final question only in scraped source material.
- Strongly prefer pages that actually contain a problem statement, explicit examples, input/output, or constraints.
- Do not use a source that merely says a topic was asked unless you use that clue to locate a real problem page or another public source with enough detail to reconstruct the question.
- Avoid weak sources such as generic interview-experience blogs unless you can triangulate them into an actual problem page or enough concrete public detail to formulate the question.
- If you have a strong clue about the question family or title and can find enough public detail to reconstruct one coherent coding problem with examples and constraints, do that.
- Do not invent random questions unrelated to the evidence, but you may complete the final problem statement when the public evidence is strong enough to identify the underlying question.
- You are required to return one final question. Keep searching and scraping until you can produce a plausible grounded question from the available evidence.
- Return status "found" in normal operation. Use status "not_found" only if tool failure makes search impossible.
- Keep examples, constraints, and test cases conservative and grounded in what you scraped.
- Never return more than one question.

Your final answer must be markdown only, with these sections in order:
# Question Title
## Difficulty
## Why this question fits
## Problem Statement
## Examples
## Constraints
## Suggested Test Cases
## Source
## Evidence

Requirements for the final markdown:
- Do not wrap the answer in JSON.
- Do not add any prose before or after the markdown brief.
- The Source section must include at least one URL.
- The Evidence section should quote or summarize the strongest grounded details you scraped.
- The Problem Statement, examples, constraints, and test cases should be usable directly as hidden context for a live interviewer.`
      : agentSlug === "investor"
        ? `You are a careful research agent preparing hidden diligence context for an investor-style live pitch rehearsal.

Workflow:
- Search for authoritative public sources about the target company or product.
- Prioritize the company site, product/pricing pages, launch pages, public docs, recent news, funding announcements, layoffs, outages, legal issues, partnerships, reviews, market signals, and public stock data if the company is public.
- Scrape the most relevant pages and synthesize a concise investor-style brief.

Selection rules:
- Focus on information an investor would quietly use to pressure-test a founder: product clarity, differentiation, monetization, traction signals, major risk events, market timing, recent news, and any visible contradictions.
- If a company had a major setback, controversy, outage, lawsuit, funding event, acquisition, or stock move that is publicly documented and relevant, include it.
- Do not invent private metrics or hidden internal facts.
- Prefer recent and materially relevant items over generic company descriptions.
- You must return one final markdown brief for the session.

Your final answer must be markdown only, with these sections in order:
# Company Research Brief
## Company Snapshot
## Product and Monetization Signals
## Recent News and Material Events
## Market / Competitive Context
## Investor Pressure Points
## Source
## Evidence

Requirements:
- Include at least one URL in Source.
- Keep the brief concise, sharp, and useful for hidden investor questioning.
- The Investor Pressure Points section should list what an investor should probe more based on the research.`
        : `You are a careful research agent preparing hidden public-context notes for a live rehearsal session.

Workflow:
- Search for relevant public sources related to the target URL and the user's optional context.
- Scrape the most promising pages and synthesize a concise brief the live agent can use silently.

Selection rules:
- The brief should reflect the user's scenario and optional context.
- Focus on the most relevant publicly visible facts, messaging, product signals, risks, or discussion points.
- Avoid unsupported claims and hidden-state assumptions.
- You must return one final markdown brief for the session.

Your final answer must be markdown only, with these sections in order:
# External Context Brief
## What this appears to be
## Relevant Public Signals
## Points worth probing
## Source
## Evidence

Requirements:
- Include at least one URL in Source.
- Keep the brief concise and directly usable as hidden context for the live facilitator.`,
  });

  const prompt = agentSlug === "coding" ? `
Target company URL: ${normalizedUrl}
Target company name: ${companyName}

Optional job-description or interview context:
${customContext?.trim() || "None provided."}

Optional uploaded document context:
${uploadContextText?.trim() || "None provided."}

Find one coding interview question that would be a good fit for a prototype live coding round for this company.
Bias the search toward real coding problem sources such as LeetCode-style pages, company-tagged prep pages, and public problem statements with examples.
Use the optional interview context to bias toward role-relevant topics and difficulty.
Do not settle for a blog post that only mentions a topic. Use it as a lead, then find the real problem page or enough concrete public detail to formulate the question.
You must return one final question for the session.
Use the tools to search, inspect sources, and return a single grounded question with examples and test cases if available.
  `.trim() : agentSlug === "investor" ? `
Target company URL: ${normalizedUrl}
Target company name: ${companyName}

Optional investor or pitch context:
${customContext?.trim() || "None provided."}

Optional uploaded document context:
${uploadContextText?.trim() || "None provided."}

Build one hidden investor-style diligence brief for this company or product.
Search for public information an investor would want to know before a live pitch: recent news, funding, stock moves if public, pricing, product positioning, traction signals, competition, risks, and any material events that should influence questioning.
The brief should help the live investor ask sharper questions without explicitly citing that hidden research to the founder.
  `.trim() : `
Target URL: ${normalizedUrl}
Target entity name: ${companyName}
Agent role: ${agentConfig.name}

Optional scenario context:
${customContext?.trim() || "None provided."}

Optional uploaded document context:
${uploadContextText?.trim() || "None provided."}

Build one hidden external-context brief for this session.
Search and scrape public information that seems most relevant to the scenario and the user's optional context, then summarize what the live agent should quietly know before the session starts.
  `.trim();

  const result = await codingQuestionAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  const finalMessage = Array.isArray(result?.messages)
    ? [...result.messages].reverse().find((message) => message instanceof AIMessage)
    : null;
  const rawText = extractTextFromLangChainContent(finalMessage?.content || "");
  console.log("[external-research] final_raw", { agentSlug, rawText });

  const candidateQuestion = normalizeCodingQuestionMarkdown(rawText, normalizedUrl);
  const scrapedSource = candidateQuestion?.sourceUrl
    ? scrapeCache.get(candidateQuestion.sourceUrl)
    : null;
  console.log("[external-research] parsed_candidate", {
    agentSlug,
    title: candidateQuestion?.title || null,
    sourceUrl: candidateQuestion?.sourceUrl || null,
    hasScrapedSource: Boolean(scrapedSource),
    groundedProblemSignals: scrapedSource?.groundedProblemSignals ?? null,
    weakSource: scrapedSource?.weakSource ?? null,
  });

  const question = candidateQuestion || null;

  console.log("[external-research] generated", {
    agentSlug,
    companyUrl: normalizedUrl,
    companyName,
    found: Boolean(question),
    title: question?.title || null,
    sourceUrl: question?.sourceUrl || null,
    validation: scrapedSource
      ? {
          groundedProblemSignals: scrapedSource.groundedProblemSignals,
          weakSource: scrapedSource.weakSource,
        }
      : null,
    searchesRun: searchLogs.length,
    scrapesRun: scrapeLogs.length,
  });

  return question;
}

function registerLiveBridge(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (clientSocket, request) => {
    console.log("Browser connected to /api/live");
    const requestUrl = new URL(request?.url || "/api/live", `http://${hostname}:${port}`);
    const agentSlug = requestUrl.searchParams.get("agent") || "recruiter";
    const voiceName = (requestUrl.searchParams.get("voice") || "").trim();
    const agentConfig = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;

    const ai = new GoogleGenAI({
      apiKey: getGeminiApiKey("live"),
    });
    const assembly = process.env.ASSEMBLYAI_API_KEY
      ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
      : null;

    let session = null;
    let assemblyTranscriber = null;
    let conversationHistory = [];
    let liveConnected = false;
    let kickoffSent = false;
    let kickoffTimer = null;
    let sessionBootstrapped = false;
    let sessionCustomContext = "";
    let sessionThreadContext = "";
    let sessionUploadContextText = "";
    let sessionUploadFileName = "";
    let sessionCompanyUrl = "";
    let sessionExternalResearch = null;

    function sendKickoff(text) {
      const kickoffText = (text || "").trim();
      if (!kickoffText || !liveConnected || !session || kickoffSent) {
        return;
      }

      kickoffSent = true;
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text: kickoffText }],
          },
        ],
        turnComplete: true,
      });
    }

    async function connectLive() {
      const extraContext = sessionUploadContextText
        ? `

Additional grounded document context from the uploaded file "${sessionUploadFileName || "uploaded file"}":
${sessionUploadContextText}

Rules for grounded usage:
- Use this document context actively when relevant.
- Do not invent details not present in this context or in the live conversation.
- If the user asks about the uploaded file, rely on this grounded context.
`
        : "";
      const customTextContext = sessionCustomContext
        ? `

Additional user-provided context for this session:
${sessionCustomContext}

Rules for using this context:
- Treat it as an explicit user brief for this room.
- Use it actively when framing questions and follow-ups.
- Do not invent details beyond what the user provided.
${agentSlug === "coding"
  ? "- If this context includes a specific coding question, LeetCode problem, or problem statement, use that as the interview problem instead of the default fallback bank.\n- When user-provided coding context specifies the problem, do not replace it with another problem."
  : ""}
`
        : "";
      const preparedExternalResearchContext =
        sessionExternalResearch
          ? `

Prepared hidden session research for this session:
Company URL: ${sessionCompanyUrl || "Not provided"}
${sessionExternalResearch.markdown || "No grounded research brief was available."}

Grounding rules for this problem:
- Use this prepared research only as hidden steering context.
- For coding, use the prepared problem brief as the interview question for this session.
- For investor and custom, use the brief to shape sharper questions, follow-ups, and pressure points.
- Do not explicitly mention the hidden research process unless the user directly asks.
`
          : "";
      const hiddenThreadContext = sessionThreadContext
        ? `

Internal thread memory for hidden steering only:
${sessionThreadContext}

Critical rule:
- Never mention prior sessions, prior evaluations, stored weaknesses, thread memory, coaching strategy, or adaptation logic to the user.
- Use this memory only internally to shape question selection, follow-up depth, and emphasis.
`
        : "";

      session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: voiceName
            ? {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              }
            : undefined,
          systemInstruction: `
${agentConfig.systemPrompt}

${customTextContext}

${hiddenThreadContext}

${preparedExternalResearchContext}

${extraContext}
          `.trim(),
        },
        callbacks: {
          onopen: () => {
            liveConnected = true;
            clientSocket.send(
              JSON.stringify({
                type: "status",
                message: "Gemini Live connected",
              }),
            );
          },

          onmessage: (message) => {
            const serverContent = message.serverContent;

            const transcript = serverContent?.outputTranscription?.text;
            if (transcript) {
              clientSocket.send(
                JSON.stringify({
                  type: "model_text",
                  text: transcript,
                }),
              );
            }
            const modelTurn = serverContent?.modelTurn;
            const parts = modelTurn?.parts || [];

            for (const part of parts) {
              if (part.inlineData?.data) {
                clientSocket.send(
                  JSON.stringify({
                    type: "audio_chunk",
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                  }),
                );
              }
            }

            if (serverContent?.turnComplete) {
              clientSocket.send(
                JSON.stringify({
                  type: "turn_complete",
                }),
              );
            }
          },

          onerror: (error) => {
            console.error("Gemini Live error:", error);
            clientSocket.send(
              JSON.stringify({
                type: "error",
                message: error.message || "Gemini Live error",
              }),
            );
          },

          onclose: (event) => {
            liveConnected = false;
            clientSocket.send(
              JSON.stringify({
                type: "live_closed",
                message: `Gemini Live disconnected${event?.reason ? `: ${event.reason}` : ""}`,
              }),
            );
          },
        },
      });
    }

    async function connectAssembly() {
      if (!assembly) return;

      assemblyTranscriber = assembly.streaming.transcriber({
        sampleRate: 16_000,
        speechModel: "universal-streaming-english",
        formatTurns: true,
        languageDetection: false,
        minTurnSilence: 700,
      });

      assemblyTranscriber.on("turn", (turn) => {
        if (!turn?.transcript) {
          return;
        }

        clientSocket.send(
          JSON.stringify({
            type: "user_transcription",
            text: turn.transcript,
            finished: !!turn.end_of_turn,
          }),
        );
      });

      assemblyTranscriber.on("error", (error) => {
        console.error("AssemblyAI streaming error:", error);
        clientSocket.send(
          JSON.stringify({
            type: "status",
            message: "User transcription is temporarily unavailable.",
          }),
        );
      });

      assemblyTranscriber.on("close", (_code, _reason) => {});

      await assemblyTranscriber.connect();
    }

    clientSocket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "session_context") {
          if (sessionBootstrapped) {
            return;
          }

          sessionBootstrapped = true;
          sessionCustomContext = (msg.customContext || "").trim();
          sessionThreadContext = (msg.threadContext || "").trim();
          sessionUploadContextText = (msg.upload?.contextText || "").trim();
          sessionUploadFileName = (msg.upload?.fileName || "").trim();
          sessionCompanyUrl = (msg.companyUrl || "").trim();
          sessionExternalResearch = msg.externalResearch || null;
          console.log("[live] session_context", {
            agentSlug,
            hasCustomContext: Boolean(sessionCustomContext),
            hasThreadContext: Boolean(sessionThreadContext),
            threadContextPreview: sessionThreadContext.slice(0, 240),
            uploadFileName: sessionUploadFileName || null,
            hasExternalResearch: Boolean(sessionExternalResearch),
            companyUrl: sessionCompanyUrl || null,
          });

          try {
            if (sessionThreadContext) {
              console.log("[live] hidden_thread_guidance_sent", sessionThreadContext);
            }
            await connectLive();
            await connectAssembly();
            kickoffTimer = setTimeout(() => {
              sendKickoff(
                agentConfig.sessionKickoff ||
                  `Begin this ${agentConfig.name} rehearsal with a short greeting, quick introduction, and the first question.`,
              );
            }, 700);
          } catch (error) {
            console.error("Failed to open Gemini Live session:", error);
            clientSocket.send(
              JSON.stringify({
                type: "error",
                message: error.message || "Failed to start Gemini Live session",
              }),
            );
            clientSocket.close();
          }
          return;
        }

        if (msg.type === "user_text") {
          const text = (msg.text || "").trim();
          if (!text) return;

          conversationHistory.push({ role: "user", text });

          clientSocket.send(
            JSON.stringify({
              type: "history",
              history: conversationHistory,
            }),
          );

          if (!liveConnected || !session) {
            clientSocket.send(
              JSON.stringify({
                type: "status",
                message: "Gemini Live session is not connected",
              }),
            );
            return;
          }

          session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text }],
              },
            ],
            turnComplete: true,
          });
        }

        if (msg.type === "kickoff") {
          sendKickoff(msg.text || "");
        }

        if (msg.type === "user_audio") {
          if (!liveConnected || !session) {
            return;
          }

          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: msg.mimeType || "audio/pcm;rate=16000",
            },
          });

          if (assemblyTranscriber) {
            queueMicrotask(() => {
              try {
                const pcmBytes = Buffer.from(msg.data, "base64");
                assemblyTranscriber.sendAudio(pcmBytes);
              } catch (error) {
                console.error("AssemblyAI audio forwarding error:", error);
              }
            });
          }
        }

        if (msg.type === "save_model_text") {
          const text = (msg.text || "").trim();
          if (!text) return;

          conversationHistory.push({ role: "model", text });

          clientSocket.send(
            JSON.stringify({
              type: "history",
              history: conversationHistory,
            }),
          );
        }

        if (msg.type === "code_snapshot") {
          const snapshot = (msg.snapshot || "").trim();
          if (!snapshot || !liveConnected || !session) {
            return;
          }

          session.sendRealtimeInput({
            text: `For your internal interview context only, here is the candidate's current code in ${msg.language || "pseudocode"}.\nDo not read it aloud, do not quote it verbatim, and do not answer with code.\n\n${snapshot}`,
          });
        }

        if (msg.type === "screen_share_state") {
          if (!liveConnected || !session) {
            return;
          }

          const surface = (msg.surface || "screen").trim();

          if (msg.active) {
            session.sendRealtimeInput({
              text:
                `The user has started sharing a live ${surface}. ` +
                (agentConfig.screenShareInstruction ||
                  "Use what is visibly shown as passive visual context only. Ask grounded questions about the visible material and how it supports what the user is saying. Do not claim to click, inspect hidden state, or see anything outside the visible screen frames. Do not interrupt for routine navigation."),
            });
          } else {
            session.sendRealtimeInput({
              text:
                "The live screen share has ended. Continue the conversation using only the spoken discussion and any grounded context already provided.",
            });
          }
        }

        if (msg.type === "screen_frame") {
          if (!liveConnected || !session || !msg.data) {
            return;
          }

          session.sendRealtimeInput({
            video: {
              data: msg.data,
              mimeType: msg.mimeType || "image/jpeg",
            },
          });
        }

        if (msg.type === "get_history") {
          clientSocket.send(
            JSON.stringify({
              type: "history",
              history: conversationHistory,
            }),
          );
        }
      } catch (error) {
        console.error("Browser socket message error:", error);
        clientSocket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Invalid browser message",
          }),
        );
      }
    });

    clientSocket.on("close", async () => {
      if (kickoffTimer) {
        clearTimeout(kickoffTimer);
        kickoffTimer = null;
      }
      try {
        await session?.close();
      } catch (_error) {}
      try {
        await assemblyTranscriber?.close();
      } catch (_error) {}
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url || "";

    if (pathname.startsWith("/api/live")) {
      wss.handleUpgrade(request, socket, head, (clientSocket) => {
        wss.emit("connection", clientSocket, request);
      });
    }
  });
}

async function startServer() {
  await nextApp.prepare();
  const nextUpgradeHandler = nextApp.getUpgradeHandler();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasDeck: false });
  });

  app.post("/api/anam-session-token", async (req, res) => {
    try {
      const { agentSlug } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const anamApiKey = process.env.ANAM_API_KEY;
      const avatarProfile = pickRandomAnamProfile();

      if (!anamApiKey) {
        return res.status(500).json({
          error: "Missing Anam configuration.",
          details: "ANAM_API_KEY is not set.",
        });
      }

      const response = await fetch("https://api.anam.ai/v1/auth/session-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anamApiKey}`,
        },
        body: JSON.stringify({
          personaConfig: {
            name: avatarProfile.name,
            avatarId: avatarProfile.avatarId,
            enableAudioPassthrough: true,
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.sessionToken) {
        return res.status(response.status || 500).json({
          error: "Failed to create Anam session token.",
          details: payload?.message || payload?.error || "Unknown Anam session error.",
        });
      }

      return res.json({
        ok: true,
        sessionToken: payload.sessionToken,
        avatarProfile: {
          name: avatarProfile.name,
          avatarId: avatarProfile.avatarId,
          gender: avatarProfile.gender,
          voiceName: avatarProfile.voiceName,
        },
      });
    } catch (error) {
      console.error("Anam session token error:", error);
      return res.status(500).json({
        error: "Failed to create Anam session token.",
        details: error.message,
      });
    }
  });

  app.post("/api/upload-deck", upload.single("deck"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      const fileBuffer = fs.readFileSync(req.file.path);
      const parser = new PDFParse({ data: fileBuffer });
      const parsed = await parser.getText();
      const rawText = (parsed.text || "").trim();
      await parser.destroy?.();

      fs.unlink(req.file.path, () => {});

      if (!rawText) {
        return res.status(400).json({ error: "Could not extract text from PDF." });
      }

      const ai = new GoogleGenAI({
        apiKey: getGeminiApiKey("uploadPrep"),
      });

      const prepResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are preparing grounded context for a live conversational interview/presentation agent.

The following text was parsed from an uploaded PDF and may be messy, out of order, or contain formatting artifacts.

Your task:
- infer what kind of document this is
- rewrite it into clean, organized text
- preserve only grounded information from the document
- do not invent anything
- remove parsing noise, duplication, and broken formatting
- keep important names, projects, roles, metrics, requirements, and claims
- produce plain text only
- make the result useful as context for a live conversational AI agent

Return a clean text memo with sections when helpful.

Parsed PDF text:
${rawText}`,
      });

      const uploadedContextText = (prepResponse.text || "").trim();
      const uploadedFileName = req.file.originalname;

      if (!uploadedContextText) {
        return res.status(500).json({ error: "Failed to create grounded context." });
      }

      return res.json({
        ok: true,
        fileName: uploadedFileName,
        contextPreview: uploadedContextText.slice(0, 1000),
        contextText: uploadedContextText,
      });
    } catch (error) {
      console.error("Deck upload error:", error);
      return res.status(500).json({
        error: "Failed to upload and process PDF.",
        details: error.message,
      });
    }
  });

  app.post("/api/agent-external-context", async (req, res) => {
    try {
      const { agentSlug, companyUrl, customContext, upload } = req.body || {};
      const normalizedUrl = normalizeHttpUrl(companyUrl);

      if (!normalizedUrl) {
        return res.json({
          ok: true,
          research: null,
          message: "No valid company URL was provided.",
        });
      }

      const research = await generateExternalResearchForAgent({
        agentSlug: agentSlug || "custom",
        companyUrl: normalizedUrl,
        customContext: (customContext || "").trim(),
        uploadContextText: (upload?.contextText || "").trim(),
      });

      return res.json({
        ok: true,
        research,
        message: research
          ? "External research fetched."
          : "No grounded external research could be confirmed.",
      });
    } catch (error) {
      console.error("External research generation error:", error);
      return res.status(500).json({
        error: "Failed to fetch external research context.",
        details: error.message,
      });
    }
  });

  app.post("/api/evaluate-session", async (req, res) => {
    try {
      const {
        agentSlug,
        transcript,
        upload,
        coding,
        customContext,
        durationLabel,
        startedAt,
        endedAt,
      } = req.body || {};

      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const transcriptText = buildTranscriptText(transcript);

      if (!transcriptText) {
        return res.status(400).json({
          error: "A completed transcript is required for evaluation.",
        });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map(
          (criterion, index) =>
            `${index + 1}. ${criterion.label}: ${criterion.description}`,
        )
        .join("\n");

      const uploadContext = upload?.contextText?.trim()
        ? upload.contextText.trim()
        : "No uploaded file context was provided for this session.";
      const codingContext = buildCodingContext(coding);
      const userContext = customContext?.trim()
        ? customContext.trim()
        : "No additional text context was provided for this session.";

      const ai = new GoogleGenAI({
        apiKey: getGeminiApiKey("evaluation"),
      });

      const evaluationPrompt = `
Agent: ${agent.name}
Scenario: ${agent.scenario}
Session duration: ${durationLabel || "Unknown"}
Started at: ${startedAt || "Unknown"}
Ended at: ${endedAt || "Unknown"}

Rubric dimensions:
${criteriaBlock}

Instructions:
- Return scores only for the rubric dimensions listed above.
- Use a 0 to 100 integer score for every metric and for the overall score.
- Be specific and fair.
- Ground every metric justification in actual transcript evidence.
- Treat uploaded document context as supporting background only when it is relevant.
- Do not invent transcript details, file details, or performance claims.
- Strengths, improvements, and recommendations should be concise, concrete, and non-redundant.
- Keep the feedback human and useful, not robotic.
- Return up to 2 resource briefs for the most important improvement areas.
- Each resource brief should be distinct and should help a later web-search tool find concrete learning resources.
- Use the saved code when it is relevant, but do not pretend the code was executed.

Uploaded file context:
${uploadContext}

Additional user-provided context:
${userContext}

${codingContext ? `${codingContext}\n\n` : ""}Complete labeled transcript:
${transcriptText}
      `.trim();

      const evaluationResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: evaluationPrompt,
        config: {
          systemInstruction: agent.evaluationPrompt,
          responseMimeType: "application/json",
          responseSchema: evaluationResponseSchema,
        },
      });

      const parsed = JSON.parse((evaluationResponse.text || "").trim());
      const evaluation = normalizeEvaluationResult(agent, parsed);

      return res.json({
        ok: true,
        evaluation,
      });
    } catch (error) {
      console.error("Session evaluation error:", error);
      return res.status(500).json({
        error: "Failed to evaluate session.",
        details: error.message,
      });
    }
  });

  app.post("/api/evaluate-thread", async (req, res) => {
    try {
      const { agentSlug, thread, sessions } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const orderedSessions = Array.isArray(sessions) ? [...sessions] : [];

      if (!orderedSessions.length) {
        return res.status(400).json({
          error: "At least one completed session is required for thread evaluation.",
        });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map((criterion, index) => `${index + 1}. ${criterion.label}: ${criterion.description}`)
        .join("\n");

      const now = Date.now();
      const sessionDigest = orderedSessions
        .map((session, index) => {
          const endedAt = new Date(session.endedAt || session.startedAt || now).getTime();
          const ageDays = Math.max(0, (now - endedAt) / (1000 * 60 * 60 * 24));
          const recencyWeight = Math.max(0.15, Number(Math.exp(-ageDays / 21).toFixed(2)));
          const metricsText = (session.evaluation?.metrics || [])
            .map((metric) => `- ${metric.label}: ${metric.value}`)
            .join("\n");

          return `
Session ${index + 1}
- Name: ${session.sessionName || "Untitled"}
- Ended at: ${session.endedAt || "Unknown"}
- Duration: ${session.durationLabel || "Unknown"}
- Recency weight: ${recencyWeight}
- Overall score: ${session.evaluation?.score ?? "Unknown"}
- Summary: ${session.evaluation?.summary || "No session summary"}
- Strengths: ${(session.evaluation?.strengths || []).join("; ") || "None"}
- Improvements: ${(session.evaluation?.improvements || []).join("; ") || "None"}
- Metric scores:
${metricsText || "- None"}
          `.trim();
        })
        .join("\n\n");

      const prompt = `
Agent: ${agent.name}
Thread title: ${thread?.title || "Untitled thread"}
Rubric dimensions:
${criteriaBlock}

You are evaluating a whole practice thread, not a single session.

Instructions:
- Analyze improvement over time across the sessions below.
- Weight newer sessions more heavily than older ones.
- Treat repeated weaknesses across multiple sessions as important, even if some sessions are older.
- The visible thread evaluation should talk about trajectory, repeated strengths, repeated gaps, and the best next areas to improve.
- Focus on user behavior patterns only: clarity, specificity, composure, confidence, evidence use, directness, structure, and response handling.
- Do not carry forward old technical details, subject matter specifics, project facts, or prior presentation content as thread memory.
- The thread memory is for adapting to the user's behavioral patterns, not for remembering the exact content topic from prior sessions.
- nextSessionFocus should explain what the next session will quietly probe more based on the user's behavior patterns.
- The hidden guidance must be internal-only and must never be written as something the live interviewer says explicitly.
- Hidden guidance should tell the next live session what to probe more, what to probe less, and how to adapt pressure based on this thread.
- Hidden guidance must explicitly say not to mention prior sessions or stored weaknesses to the user.
- Keep comments concise and useful.

Thread sessions:
${sessionDigest}
      `.trim();

      const ai = new GoogleGenAI({
        apiKey: getGeminiApiKey("evaluation"),
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction:
            `You analyze longitudinal performance for the ${agent.name} agent. Be grounded, concise, and evidence-based. Distinguish between visible thread feedback and hidden internal session guidance. The hidden guidance is for internal steering only and must never be phrased for direct disclosure to the user.`,
          responseMimeType: "application/json",
          responseSchema: threadEvaluationResponseSchema,
        },
      });

      const parsed = JSON.parse((response.text || "").trim());
      console.log("[thread-eval] generated", {
        agentSlug,
        threadId: thread?.id || null,
        summary: parsed.summary,
        nextSessionFocus: parsed.nextSessionFocus,
        hiddenGuidancePreview: (parsed.hiddenGuidance || "").slice(0, 240),
      });
      return res.json({
        ok: true,
        threadEvaluation: parsed,
      });
    } catch (error) {
      console.error("Thread evaluation error:", error);
      return res.status(500).json({
        error: "Failed to evaluate thread.",
        details: error.message,
      });
    }
  });

  app.post("/api/compare-sessions", async (req, res) => {
    try {
      const { agentSlug, currentSession, baselineSession } = req.body || {};
      const agent = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;
      const currentEvaluation = currentSession?.evaluation;
      const baselineEvaluation = baselineSession?.evaluation;

      if (!currentEvaluation || !baselineEvaluation) {
        return res.status(400).json({
          error: "Two completed session evaluations are required for comparison.",
        });
      }

      const criteriaBlock = (agent.evaluationCriteria || [])
        .map(
          (criterion, index) =>
            `${index + 1}. ${criterion.label}: ${criterion.description}`,
        )
        .join("\n");

      const ai = new GoogleGenAI({
        apiKey: getGeminiApiKey("evaluation"),
      });

      const comparisonPrompt = `
Agent: ${agent.name}
Scenario: ${agent.scenario}

Rubric dimensions:
${criteriaBlock}

Current session:
- Ended at: ${currentSession?.endedAt || "Unknown"}
- Duration: ${currentSession?.durationLabel || "Unknown"}
- Overall score: ${currentEvaluation?.score ?? "Unknown"}

Current session metric scores:
${(currentEvaluation?.metrics || [])
  .map((metric) => `- ${metric.label}: ${metric.value}`)
  .join("\n")}

Current session summary:
${currentEvaluation?.summary || "No summary was saved."}

Earlier comparison session:
- Ended at: ${baselineSession?.endedAt || "Unknown"}
- Duration: ${baselineSession?.durationLabel || "Unknown"}
- Overall score: ${baselineEvaluation?.score ?? "Unknown"}

Earlier session metric scores:
${(baselineEvaluation?.metrics || [])
  .map((metric) => `- ${metric.label}: ${metric.value}`)
  .join("\n")}

Earlier session summary:
${baselineEvaluation?.summary || "No summary was saved."}

Instructions:
- Compare the current session against the earlier session.
- Judge whether the user improved, stayed similar, declined, or had mixed movement.
- Keep wording concise and human.
- Use the rubric dimensions only.
- Return one short overall summary and one short insight per metric.
- The delta should be current minus earlier.
- Address the user directly as "you".
- Never refer to the user as "the agent", "the speaker", or "the candidate" in the returned summary or insights.
      `.trim();

      const comparisonResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: comparisonPrompt,
        config: {
          systemInstruction:
            'You compare two saved rehearsal evaluations for the same agent. Be concise, evidence-based, and metric-aware. Use only the provided evaluation summaries and metric scores. Prefer minimal wording over long explanations. Address the user directly as "you" and never call them "agent", "speaker", or "candidate".',
          responseMimeType: "application/json",
          responseSchema: comparisonResponseSchema,
        },
      });

      const parsed = JSON.parse((comparisonResponse.text || "").trim());
      const comparison = normalizeComparisonResult(
        agent,
        parsed,
        currentEvaluation,
        baselineEvaluation,
      );

      return res.json({
        ok: true,
        comparison,
      });
    } catch (error) {
      console.error("Session comparison error:", error);
      return res.status(500).json({
        error: "Failed to compare sessions.",
        details: error.message,
      });
    }
  });

  app.post("/api/session-resources", async (req, res) => {
    try {
      if (!process.env.FIRECRAWL_API_KEY) {
        return res.status(400).json({
          error: "Firecrawl API key must be configured.",
        });
      }

      const { resourceBriefs, agentSlug } = req.body || {};
      const briefs = Array.isArray(resourceBriefs) ? resourceBriefs.slice(0, 2) : [];

      if (!briefs.length) {
        return res.json({
          ok: true,
          topics: [],
        });
      }

      const topics = await Promise.all(
        briefs.map(async (brief, index) => {
          const items = await fetchResourcesForBrief({
            ...brief,
            agentSlug,
          });
          return {
            id: brief.id || `topic-${index + 1}`,
            topic: brief.topic,
            improvement: brief.improvement,
            whyThisMatters: brief.whyThisMatters,
            items: items.slice(0, 4),
          };
        }),
      );

      return res.json({
        ok: true,
        topics,
      });
    } catch (error) {
      console.error("Resource search error:", error);
      return res.status(500).json({
        error: "Failed to fetch improvement resources.",
        details: error.message,
      });
    }
  });

  app.all(/.*/, (req, res) => handle(req, res));

  const server = http.createServer(app);
  registerLiveBridge(server);
  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url || "";

    if (pathname.startsWith("/api/live")) {
      return;
    }

    nextUpgradeHandler(request, socket, head);
  });

  server.listen(port, hostname, () => {
    console.log(`PitchMirror running at http://${hostname}:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
