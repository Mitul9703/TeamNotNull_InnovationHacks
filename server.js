import http from "node:http";
import fs from "node:fs";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import next from "next";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { AssemblyAI } from "assemblyai";
import { AGENT_LOOKUP } from "./lib/agents.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const hostname = "127.0.0.1";
const port = Number(process.env.PORT || 3000);

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
const upload = multer({ dest: "uploads/" });

let uploadedContextText = "";
let uploadedFileName = "";

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

function buildTinyFishGoal({ brief, kind }) {
  const phrases = (brief.searchPhrases || []).filter(Boolean).join("; ");
  const typeHint =
    kind === "video"
      ? 'Set "type" to "youtube".'
      : 'Set "type" to "article" or "website" depending on what the result is.';

  return `
Find high-quality ${kind === "video" ? "YouTube videos" : "articles and websites"} that help a user improve this communication skill.

Topic: ${brief.topic}
Improvement area: ${brief.improvement}
Why it matters: ${brief.whyThisMatters}
Search phrases to use: ${phrases || brief.topic}

Return JSON matching this exact structure:
{
  "resources": [
    {
      "title": "string",
      "url": "string",
      "type": "string",
      "source": "string",
      "reason_relevant": "string"
    }
  ]
}

Rules:
- Return exactly 2 resources.
- Prefer practical, educational, high-signal content.
- Avoid paywalled, spammy, or low-credibility results.
- Avoid duplicate URLs or duplicate ideas.
- ${typeHint}
- "source" should be the publisher or website name.
- "reason_relevant" should be a short sentence tailored to this improvement area.
- Stop once you have 2 strong results.

If you cannot find 2 good matches, return the best available results and keep the same JSON structure.
  `.trim();
}

async function runTinyFish({ url, goal }) {
  const response = await fetch("https://agent.tinyfish.ai/v1/automation/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.TINYFISH_API_KEY,
    },
    body: JSON.stringify({
      url,
      goal,
      browser_profile: "stealth",
      api_integration: "pitchmirror",
      feature_flags: {
        enable_agent_memory: false,
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || "Failed to run TinyFish search.");
  }

  if (payload?.status && payload.status !== "COMPLETED") {
    throw new Error(payload?.error?.message || "TinyFish run did not complete successfully.");
  }

  return payload?.result;
}

function parseTinyFishResources(result) {
  if (!result) return [];

  let parsed = result;

  if (typeof result === "string") {
    parsed = JSON.parse(result);
  }

  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];

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

async function fetchTinyFishResourcesForBrief(brief) {
  const videoGoal = buildTinyFishGoal({ brief, kind: "video" });
  const articleGoal = buildTinyFishGoal({ brief, kind: "article" });

  const [videoResult, articleResult] = await Promise.all([
    runTinyFish({
      url: "https://www.youtube.com/results?search_query=public+speaking",
      goal: videoGoal,
    }),
    runTinyFish({
      url: "https://duckduckgo.com/",
      goal: articleGoal,
    }),
  ]);

  const merged = [
    ...parseTinyFishResources(videoResult),
    ...parseTinyFishResources(articleResult),
  ];

  const seen = new Set();

  return merged.filter((resource) => {
    if (seen.has(resource.url)) {
      return false;
    }
    seen.add(resource.url);
    return true;
  });
}

function registerLiveBridge(server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (clientSocket, request) => {
    console.log("Browser connected to /api/live");
    const requestUrl = new URL(request?.url || "/api/live", `http://${hostname}:${port}`);
    const agentSlug = requestUrl.searchParams.get("agent") || "recruiter";
    const agentConfig = AGENT_LOOKUP[agentSlug] || AGENT_LOOKUP.recruiter;

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const assembly = process.env.ASSEMBLYAI_API_KEY
      ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
      : null;

    let session = null;
    let assemblyTranscriber = null;
    let conversationHistory = [];
    let liveConnected = false;

    async function connectLive() {
      const extraContext = uploadedContextText
        ? `

Additional grounded document context from the uploaded file "${uploadedFileName}":
${uploadedContextText}

Rules for grounded usage:
- Use this document context actively when relevant.
- Do not invent details not present in this context or in the live conversation.
- If the user asks about the uploaded file, rely on this grounded context.
`
        : "";

      session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          systemInstruction: `
${agentConfig.systemPrompt}

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

    try {
      await connectLive();
      await connectAssembly();
    } catch (error) {
      console.error("Failed to open Gemini Live session:", error);
      clientSocket.send(
        JSON.stringify({
          type: "error",
          message: error.message || "Failed to start Gemini Live session",
        }),
      );
      clientSocket.close();
      return;
    }

    clientSocket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

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

          session.sendRealtimeInput({ text });
        }

        if (msg.type === "user_audio") {
          if (assemblyTranscriber) {
            try {
              const pcmBytes = Buffer.from(msg.data, "base64");
              assemblyTranscriber.sendAudio(pcmBytes);
            } catch (error) {
              console.error("AssemblyAI audio forwarding error:", error);
            }
          }

          if (!liveConnected || !session) {
            return;
          }

          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: msg.mimeType || "audio/pcm;rate=16000",
            },
          });
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
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasDeck: !!uploadedContextText });
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
        apiKey: process.env.GEMINI_API_KEY,
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

      uploadedContextText = (prepResponse.text || "").trim();
      uploadedFileName = req.file.originalname;

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

  app.post("/api/evaluate-session", async (req, res) => {
    try {
      const {
        agentSlug,
        transcript,
        upload,
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

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
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

Uploaded file context:
${uploadContext}

Complete labeled transcript:
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

  app.post("/api/session-resources", async (req, res) => {
    try {
      if (!process.env.TINYFISH_API_KEY) {
        return res.status(400).json({
          error: "TinyFish API key is not configured.",
        });
      }

      const { resourceBriefs } = req.body || {};
      const briefs = Array.isArray(resourceBriefs) ? resourceBriefs.slice(0, 2) : [];

      if (!briefs.length) {
        return res.json({
          ok: true,
          topics: [],
        });
      }

      const topics = await Promise.all(
        briefs.map(async (brief, index) => {
          const items = await fetchTinyFishResourcesForBrief(brief);
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
      console.error("TinyFish resource error:", error);
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
