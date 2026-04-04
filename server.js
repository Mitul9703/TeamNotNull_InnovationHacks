import http from "node:http";
import fs from "node:fs";
import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import next from "next";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

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
  const wss = new WebSocketServer({ server, path: "/api/live" });

  wss.on("connection", async (clientSocket) => {
    console.log("Browser connected to /api/live");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    let session = null;
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
You are PitchMirror acting as a realistic recruiter conducting a live interview based on the candidate's spoken answers and any uploaded document context.

Your role:
- Act like a real recruiter, not a chatbot.
- Listen carefully to what the candidate says.
- Use any uploaded document context actively if it exists.
- Ask thoughtful interview questions based on both the spoken answers and grounded context.
- Sound professional, natural, and conversational.

Primary behavior:
- Ask one question at a time.
- Do not ask all questions only from the uploaded context.
- Do not ask all questions only from the latest spoken answer.
- Balance both sources intelligently.
- Let the candidate speak when they are giving a meaningful answer.
- Interrupt only when necessary.

Grounding rules:
- Only ask about experiences, projects, roles, skills, requirements, or claims that are explicitly present in the grounded context or explicitly stated by the user in this conversation.
- Do not invent projects, companies, technologies, achievements, or requirements.
- If grounded context is unavailable or insufficient, rely on the conversation and say so rather than guessing.

Recruiter style:
- Focus on impact, ownership, technical depth, communication, teamwork, and decision-making.
- Ask concise but meaningful questions.
- If the candidate gives a weak answer, ask a follow-up.
- If the candidate gives a strong answer, go deeper or move to another relevant topic.

Conversation policy:
- Maintain continuity across the conversation.
- Remember prior answers and avoid repeating yourself.
- Use grounded document context whenever it is relevant.

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
                type: "status",
                message: `Gemini Live disconnected${event?.reason ? `: ${event.reason}` : ""}`,
              }),
            );
          },
        },
      });
    }

    try {
      await connectLive();
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
                type: "error",
                message: "Gemini Live session is not connected",
              }),
            );
            return;
          }

          session.sendRealtimeInput({ text });
        }

        if (msg.type === "user_audio") {
          if (!liveConnected || !session) {
            clientSocket.send(
              JSON.stringify({
                type: "error",
                message: "Gemini Live session is not connected",
              }),
            );
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
    });
  });
}

async function startServer() {
  await nextApp.prepare();

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

  server.listen(port, hostname, () => {
    console.log(`PitchMirror running at http://${hostname}:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
