import http from "node:http";
import fs from "node:fs";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import next from "next";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
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
      });
    } catch (error) {
      console.error("Deck upload error:", error);
      return res.status(500).json({
        error: "Failed to upload and process PDF.",
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
