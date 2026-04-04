"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  SimliClient,
  LogLevel,
  generateSimliSessionToken,
} from "simli-client";
import { AGENT_LOOKUP } from "../lib/agents";
import { AppShell } from "./shell";
import { useAppState } from "./app-provider";

function floatTo16BitPCM(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    int16Array[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16Array;
}

function downsampleFloat32(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return buffer;

  const ratio = inputSampleRate / outputSampleRate;
  const nextLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(nextLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
      sum += buffer[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? sum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function base64ToUint8Array(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

function pcmBytesToInt16Array(pcmBytes) {
  return new Int16Array(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    Math.floor(pcmBytes.byteLength / 2),
  );
}

function downsampleInt16(input, inputRate = 24000, outputRate = 16000) {
  if (outputRate === inputRate) return input;

  const ratio = inputRate / outputRate;
  const nextLength = Math.floor(input.length / ratio);
  const result = new Int16Array(nextLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = offsetInput; index < nextOffsetInput && index < input.length; index += 1) {
      sum += input[index];
      count += 1;
    }

    result[offsetResult] = count > 0 ? Math.round(sum / count) : 0;
    offsetResult += 1;
    offsetInput = nextOffsetInput;
  }

  return result;
}

function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function SessionPage({ slug }) {
  const router = useRouter();
  const { state, patchAgent, createSessionRecord } = useAppState();
  const agent = AGENT_LOOKUP[slug];
  const agentState = state.agents[slug];
  const upload = agentState?.upload;

  const [permissionState, setPermissionState] = useState("pending");
  const [sessionPhase, setSessionPhase] = useState("preflight");
  const [statusText, setStatusText] = useState("Preparing rehearsal room...");
  const [modelBuffer, setModelBuffer] = useState("");
  const [userBuffer, setUserBuffer] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [startAttempt, setStartAttempt] = useState(0);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const simliClientRef = useRef(null);
  const browserSocketRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  const cleanupPromiseRef = useRef(null);
  const startedRef = useRef(false);
  const mutedRef = useRef(false);
  const timerRef = useRef(null);
  const endedRef = useRef(false);
  const liveClosedRef = useRef(false);
  const transcriptListRef = useRef(null);
  const modelBufferRef = useRef("");
  const userBufferRef = useRef("");
  const transcriptEntries = [
    ...transcript,
    ...(userBuffer.trim()
      ? [{ id: "live-user", role: "You", text: userBuffer.trim(), live: true }]
      : []),
    ...(modelBuffer.trim()
      ? [{ id: "live-model", role: agent?.name || "Agent", text: modelBuffer.trim(), live: true }]
      : []),
  ];

  function mergeTranscriptChunk(previous, incoming) {
    const next = (incoming || "").trim();
    if (!next) return previous;
    if (!previous) return next;
    if (next.startsWith(previous)) return next;
    if (previous.startsWith(next)) return previous;
    return `${previous} ${next}`.trim();
  }

  function flushUserTranscript(finalText) {
    const cleaned = (finalText || "").trim();
    if (!cleaned) return;

    setTranscript((current) => [
      ...current,
      {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "You",
        text: cleaned,
        live: false,
      },
    ]);
  }

  function finalizeUserBuffer() {
    const finalText = userBufferRef.current.trim();
    if (!finalText) return;
    flushUserTranscript(finalText);
    setUserBuffer("");
    userBufferRef.current = "";
  }

  useEffect(() => {
    mutedRef.current = agentState?.session?.muted || false;
  }, [agentState?.session?.muted]);

  useEffect(() => {
    if (!agent || !agentState) return undefined;
    let cancelled = false;

    async function initializeSession() {
      if (startedRef.current) return;
      endedRef.current = false;
      liveClosedRef.current = false;
      startedRef.current = true;
      patchAgent(slug, (current) => ({
        ...current,
        session: {
          ...current.session,
          status: "starting",
        },
      }));

      try {
        setStatusText("Requesting microphone access...");
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = mediaStream;
        setPermissionState("granted");
        setSessionPhase("connecting");

        await startSessionFlow(mediaStream);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setPermissionState("denied");
        setSessionPhase("blocked");
        setStatusText("Microphone access is required to start the rehearsal room.");
        patchAgent(slug, (current) => ({
          ...current,
          session: {
            ...current.session,
            status: "idle",
          },
        }));
      }
    }

    initializeSession();

    const unloadHandler = () => {
      void performCleanup();
    };

    window.addEventListener("beforeunload", unloadHandler);
    window.addEventListener("pagehide", unloadHandler);

    return () => {
      cancelled = true;
      startedRef.current = false;
      window.removeEventListener("beforeunload", unloadHandler);
      window.removeEventListener("pagehide", unloadHandler);
      void performCleanup();
    };
  }, [agent, patchAgent, slug, startAttempt]);

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const element = transcriptListRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [transcriptEntries]);

  async function createMicPipeline(mediaStream) {
    const audioContext = new window.AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    sourceNode.connect(processorNode);
    processorNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    processorNode.onaudioprocess = (event) => {
      if (mutedRef.current) return;

      const socket = browserSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32(input, audioContext.sampleRate, 16000);
      const pcm16 = floatTo16BitPCM(downsampled);
      const audioBase64 = int16ToBase64(pcm16);

      socket.send(
        JSON.stringify({
          type: "user_audio",
          data: audioBase64,
          mimeType: "audio/pcm;rate=16000",
        }),
      );
    };

    audioContextRef.current = audioContext;
    sourceNodeRef.current = sourceNode;
    processorNodeRef.current = processorNode;
    gainNodeRef.current = gainNode;
  }

  function attachSocketHandlers(socket) {
    socket.onopen = () => {
      setStatusText("Connected to the live question bridge.");
      socket.send(JSON.stringify({ type: "get_history" }));
      socket.send(
        JSON.stringify({
          type: "user_text",
          text: `Begin this ${agent.name} rehearsal with a short greeting, quick introduction, and the first question.`,
        }),
      );
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "status") {
        setStatusText(message.message);
        return;
      }

      if (message.type === "live_closed") {
        liveClosedRef.current = true;
        setSessionPhase("ended");
        setStatusText(message.message || "Gemini Live session ended.");
        void performCleanup();
        return;
      }

      if (message.type === "error") {
        setSessionPhase("error");
        setStatusText(message.message || "The session encountered an error.");
        return;
      }

      if (message.type === "model_text") {
        setModelBuffer((current) => {
          const next = mergeTranscriptChunk(current, message.text || "");
          modelBufferRef.current = next;
          return next;
        });
        return;
      }

      if (message.type === "user_transcription") {
        const nextText = (message.text || "").trim();
        setUserBuffer(nextText);
        userBufferRef.current = nextText;

        if (message.finished) {
          finalizeUserBuffer();
        }
        return;
      }

      if (message.type === "audio_chunk" && simliClientRef.current) {
        const pcm24kBytes = base64ToUint8Array(message.data);
        const pcm24kInt16 = pcmBytesToInt16Array(pcm24kBytes);
        const pcm16kInt16 = downsampleInt16(pcm24kInt16, 24000, 16000);
        simliClientRef.current.sendAudioData(new Uint8Array(pcm16kInt16.buffer));
        return;
      }

      if (message.type === "turn_complete") {
        const finalText = modelBufferRef.current.trim();
        if (finalText) {
          setTranscript((current) => [
            ...current,
            {
              id: `model-${Date.now()}`,
              role: agent.name,
              text: finalText,
              live: false,
            },
          ]);
          socket.send(JSON.stringify({ type: "save_model_text", text: finalText }));
      }
      setModelBuffer("");
      modelBufferRef.current = "";
      return;
      }

      if (message.type === "history") {
        const nextTranscript = (message.history || [])
          .filter(
            (item) =>
              item.text &&
              !item.text.startsWith(`Begin this ${agent.name} rehearsal with a short greeting`),
          )
          .map((item) => ({
            id: `history-${item.role}-${item.text.slice(0, 32)}`,
            role: item.role === "user" ? "You" : agent.name,
            text: item.text,
            live: false,
          }));

        setTranscript((current) => {
          if (!current.length && !modelBufferRef.current.trim()) {
            return nextTranscript;
          }

          const existingKeys = new Set(
            current.map((entry) => `${entry.role}::${entry.text.trim()}`),
          );
          const additions = nextTranscript.filter(
            (entry) => !existingKeys.has(`${entry.role}::${entry.text.trim()}`),
          );
          return additions.length ? [...current, ...additions] : current;
        });
      }
    };

    socket.onerror = () => {
      setSessionPhase("error");
      setStatusText("The live browser bridge disconnected.");
    };

    socket.onclose = () => {
      if (!endedRef.current) {
        setStatusText("The live browser bridge closed.");
      }
    };
  }

  async function startSessionFlow(mediaStream) {
    try {
      const apiKey = process.env.NEXT_PUBLIC_SIMLI_API_KEY;
      const faceId = process.env.NEXT_PUBLIC_SIMLI_FACE_ID;

      if (!apiKey || !faceId) {
        throw new Error("Missing Simli configuration.");
      }

      setStatusText("Creating secure avatar session...");
      const sessionToken = await generateSimliSessionToken({
        apiKey,
        config: {
          faceId,
          handleSilence: true,
          maxSessionLength: 600,
          maxIdleTime: 180,
          model: "fasttalk",
        },
      });

      if (!videoRef.current || !audioRef.current) {
        throw new Error("Video stage is not ready.");
      }

      const simliClient = new SimliClient(
        sessionToken?.session_token || sessionToken,
        videoRef.current,
        audioRef.current,
        null,
        LogLevel.CRITICAL,
        "livekit",
      );

      simliClient.on("start", () => {
        setSessionPhase("live");
        setStatusText("Avatar connected. Session is live.");
        patchAgent(slug, (current) => ({
          ...current,
          session: {
            ...current.session,
            status: "active",
          },
        }));
      });

      simliClient.on("stop", () => {
        setStatusText("Avatar stream ended.");
      });

      simliClient.on("error", (message) => {
        setSessionPhase("error");
        setStatusText(message || "Avatar stream error.");
      });

      simliClient.on("startup_error", (message) => {
        setSessionPhase("error");
        setStatusText(message || "Avatar failed to start.");
      });

      simliClientRef.current = simliClient;

      await simliClient.start();

      const socketUrl = `${
        window.location.protocol === "https:" ? "wss" : "ws"
      }://${window.location.host}/api/live`;
      const socket = new WebSocket(socketUrl);
      browserSocketRef.current = socket;
      attachSocketHandlers(socket);
      await createMicPipeline(mediaStream);
    } catch (error) {
      console.error(error);
      setSessionPhase("error");
      setStatusText(error.message || "Failed to start the session.");
      patchAgent(slug, (current) => ({
        ...current,
        session: {
          ...current.session,
          status: "idle",
        },
      }));
    }
  }

  async function performCleanup() {
    if (cleanupPromiseRef.current) {
      return cleanupPromiseRef.current;
    }

    cleanupPromiseRef.current = (async () => {
      if (processorNodeRef.current) {
        processorNodeRef.current.disconnect();
        processorNodeRef.current = null;
      }

      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }

      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch (_error) {}
        audioContextRef.current = null;
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (browserSocketRef.current) {
        browserSocketRef.current.close();
        browserSocketRef.current = null;
      }

      if (simliClientRef.current) {
        try {
          await simliClientRef.current.stop();
        } catch (_error) {}
        simliClientRef.current = null;
      }
      setModelBuffer("");
      modelBufferRef.current = "";
      setUserBuffer("");
      userBufferRef.current = "";
    })();

    await cleanupPromiseRef.current;
    cleanupPromiseRef.current = null;
  }

  async function retryMicAccess() {
    setPermissionState("pending");
    setSessionPhase("preflight");
    setStatusText("Requesting microphone access...");
    startedRef.current = false;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setStartAttempt((current) => current + 1);
  }

  async function endSession() {
    endedRef.current = true;
    setSessionPhase("ended");
    setStatusText("Ending rehearsal room...");
    const transcriptSnapshot = [...transcript];
    const finalUserText = userBufferRef.current.trim();
    const finalModelText = modelBufferRef.current.trim();

    if (finalUserText) {
      transcriptSnapshot.push({
        id: `user-${Date.now()}-final`,
        role: "You",
        text: finalUserText,
        live: false,
      });
    }

    if (finalModelText) {
      transcriptSnapshot.push({
        id: `model-${Date.now()}-final`,
        role: agent.name,
        text: finalModelText,
        live: false,
      });
    }

    await performCleanup();
    const now = new Date();
    createSessionRecord({
      id: `session-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      agentSlug: slug,
      agentName: agent.name,
      startedAt: new Date(now.getTime() - elapsed * 1000).toISOString(),
      endedAt: now.toISOString(),
      durationLabel: formatDuration(elapsed),
      transcript: transcriptSnapshot,
      upload: upload.fileName
        ? {
            fileName: upload.fileName,
            contextPreview: upload.contextPreview,
          }
        : null,
    });
    patchAgent(slug, (current) => ({
      ...current,
      upload: {
        status: "idle",
        fileName: "",
        previewUrl: "",
        previewOpen: false,
        contextPreview: "",
        error: "",
      },
      session: {
        ...current.session,
        status: "idle",
        lastEndedAt: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        lastDurationLabel: formatDuration(elapsed),
      },
    }));
    router.replace(`/agents/${slug}?ended=1`);
  }

  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    patchAgent(slug, (current) => ({
      ...current,
      session: {
        ...current.session,
        muted: mutedRef.current,
      },
    }));
  }

  if (!agent || !agentState) {
    return (
      <AppShell compact>
        <div className="empty-state">
          Missing session context. Return to the <Link href="/">landing page</Link>.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell compact>
      <div className="meet-shell">
        <div className="session-topbar">
          <div className="brand">
            <div className="brand-mark">PM</div>
            <div>
              <div className="brand-title">{agent.name}</div>
              <div className="brand-subtitle">{agent.scenario}</div>
            </div>
          </div>
          <div className="footer-cluster">
            <div className="session-stat">
              <div className="session-stat-label">Document</div>
              <div className="session-stat-value">
                {upload.fileName || "No supporting file"}
              </div>
            </div>
            <div className="session-stat">
              <div className="session-stat-label">Elapsed</div>
              <div className="session-stat-value">{formatDuration(elapsed)}</div>
            </div>
          </div>
        </div>

        <div className="session-main">
          <div className="video-stage">
            <div className="stage-badge">
              <span className="stage-badge-live" />
              {sessionPhase === "live" ? "Live rehearsal" : "Preparing room"}
            </div>
            <video ref={videoRef} className="video-element" autoPlay playsInline />
            <audio ref={audioRef} autoPlay />

            {(sessionPhase === "preflight" || sessionPhase === "connecting") && (
              <div className="loading-overlay">
                <div className="overlay-card">
                  <div className="spinner" />
                  <h2 className="overlay-title">Setting up your live room</h2>
                  <p className="muted-copy">{statusText}</p>
                </div>
              </div>
            )}

            {permissionState === "denied" && (
              <div className="permission-overlay">
                <div className="overlay-card">
                  <h2 className="overlay-title">Microphone access required</h2>
                  <p className="muted-copy">
                    PitchMirror cannot begin the session until browser audio
                    permission is granted.
                  </p>
                  <div className="button-row" style={{ justifyContent: "center", marginTop: 16 }}>
                    <button type="button" className="btn btn-primary" onClick={retryMicAccess}>
                      Try again
                    </button>
                    <Link href={`/agents/${slug}`} className="btn btn-secondary">
                      Back to setup
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {sessionPhase === "error" && (
              <div className="video-overlay">
                <div className="overlay-card">
                  <h2 className="overlay-title">Session unavailable</h2>
                  <p className="muted-copy">{statusText}</p>
                  <div className="button-row" style={{ justifyContent: "center", marginTop: 16 }}>
                    <button type="button" className="btn btn-danger" onClick={endSession}>
                      Leave room
                    </button>
                  </div>
                </div>
              </div>
            )}

            {sessionPhase === "ended" && liveClosedRef.current && (
              <div className="video-overlay">
                <div className="overlay-card">
                  <h2 className="overlay-title">Session ended</h2>
                  <p className="muted-copy">{statusText}</p>
                  <div className="button-row" style={{ justifyContent: "center", marginTop: 16 }}>
                    <button type="button" className="btn btn-danger" onClick={endSession}>
                      Back to setup
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="transcript-card">
            <div className="section-title">Live transcript</div>
            <p className="muted-copy">
              Current status: {statusText}
            </p>
            <div className="transcript-list" ref={transcriptListRef}>
              {transcriptEntries.length ? (
                transcriptEntries.map((entry, index) => (
                  <div className="transcript-item" key={entry.id || `${entry.role}-${index}`}>
                    <div className="transcript-role">
                      {entry.role}
                      {entry.live ? " • Live" : ""}
                    </div>
                    <p className="transcript-text">{entry.text}</p>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  Transcript will appear here after the greeting and first
                  question begin.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="session-footer">
          <div className="footer-cluster">
            <button
              type="button"
              className={`btn ${agentState.session.muted ? "btn-secondary" : "btn-primary"}`}
              onClick={toggleMute}
            >
              {agentState.session.muted ? "Unmute mic" : "Mute mic"}
            </button>
            <div className="mute-pill">
              <strong>{agentState.session.muted ? "Mic muted" : "Mic live"}</strong>
              <span className="muted-copy">
                {agentState.session.muted
                  ? "Your audio is paused until you unmute."
                  : "Your audio is streaming to the rehearsal room."}
              </span>
            </div>
            {modelBuffer.trim() ? (
              <div className="status-chip status-warning">
                <span className="status-dot" />
                Transcript streaming live
              </div>
            ) : null}
            {transcript.length ? (
              <div className="status-chip status-success">
                <span className="status-dot" />
                {transcript.length} transcript turn{transcript.length > 1 ? "s" : ""}
              </div>
            ) : null}
            {!transcript.length && !modelBuffer.trim() ? (
              <div className="status-chip">
                <span className="status-dot" />
                Waiting for transcript data
              </div>
            ) : null}
          </div>
          <div className="footer-cluster">
            <button type="button" className="btn btn-danger" onClick={endSession}>
              End call
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
