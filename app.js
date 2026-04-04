import {
    SimliClient,
    LogLevel,
    generateSimliSessionToken,
  } from "simli-client";
  
  const statusEl = document.getElementById("status");
  const videoEl = document.getElementById("video");
  const audioEl = document.getElementById("audio");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const apiKeyInput = document.getElementById("apiKey");
  const faceIdInput = document.getElementById("faceId");
  const userMessageInput = document.getElementById("userMessage");
  const sendMessageBtn = document.getElementById("sendMessageBtn");
  const deckFileInput = document.getElementById("deckFile");
const uploadDeckBtn = document.getElementById("uploadDeckBtn");

  const startMicBtn = document.getElementById("startMicBtn");
    const stopMicBtn = document.getElementById("stopMicBtn");

    let sessionStarted = false;

    let audioContext = null;
    let mediaStream = null;
    let sourceNode = null;
    let processorNode = null;
    let isMicStreaming = false;
  
  let simliClient = null;
  let browserLiveSocket = null;
  let currentModelText = "";
  let conversationHistory = [];
  
  function setStatus(message) {
    statusEl.textContent = message;
    console.log(message);
  }

  function floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i += 1) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }
  
  function downsampleFloat32(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) return buffer;
    const ratio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
  
    let offsetResult = 0;
    let offsetBuffer = 0;
  
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
  
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
        accum += buffer[i];
        count += 1;
      }
  
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }
  
    return result;
  }
  
  function int16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function startMicStreaming() {
    if (!browserLiveSocket || browserLiveSocket.readyState !== WebSocket.OPEN) {
      setStatus("Live backend is not connected yet.");
      return;
    }
  
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  
    processorNode.onaudioprocess = (event) => {
      if (!isMicStreaming) return;
  
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32(input, audioContext.sampleRate, 16000);
      const pcm16 = floatTo16BitPCM(downsampled);
      const audioBase64 = int16ToBase64(pcm16);
  
      browserLiveSocket.send(
        JSON.stringify({
          type: "user_audio",
          data: audioBase64,
          mimeType: "audio/pcm;rate=16000",
        })
      );
    };
  
    isMicStreaming = true;
    startMicBtn.disabled = true;
    stopMicBtn.disabled = false;
    setStatus("Mic streaming to Gemini Live...");
  }
  
  function stopMicStreaming() {
    isMicStreaming = false;
  
    if (processorNode) {
      processorNode.disconnect();
      processorNode = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  
    startMicBtn.disabled = false;
    stopMicBtn.disabled = true;
    setStatus("Mic stopped.");
  }
  
  async function getSessionToken(apiKey, faceId) {
    const config = {
      faceId,
      handleSilence: true,
      maxSessionLength: 600,
      maxIdleTime: 180,
      model: "fasttalk",
    };
  
    const response = await generateSimliSessionToken({
      apiKey,
      config,
    });
  
    return response.session_token;
  }
  
  function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  function pcmBytesToInt16Array(pcmBytes) {
    return new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      Math.floor(pcmBytes.byteLength / 2)
    );
  }
  
  function downsampleInt16(input, inputRate = 24000, outputRate = 16000) {
    if (outputRate === inputRate) return input;
    if (outputRate > inputRate) {
      throw new Error("Output sample rate must be <= input sample rate.");
    }
  
    const ratio = inputRate / outputRate;
    const newLength = Math.floor(input.length / ratio);
    const result = new Int16Array(newLength);
  
    let offsetResult = 0;
    let offsetInput = 0;
  
    while (offsetResult < result.length) {
      const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
  
      for (let i = offsetInput; i < nextOffsetInput && i < input.length; i += 1) {
        accum += input[i];
        count += 1;
      }
  
      result[offsetResult] = count > 0 ? Math.round(accum / count) : 0;
      offsetResult += 1;
      offsetInput = nextOffsetInput;
    }
  
    return result;
  }
  
  function int16ToUint8Array(int16Array) {
    return new Uint8Array(int16Array.buffer);
  }
  
  function sendAudioChunkToSimli(base64Audio) {
    if (!simliClient) return;
  
    const pcm24kBytes = base64ToUint8Array(base64Audio);
    const pcm24kInt16 = pcmBytesToInt16Array(pcm24kBytes);
    const pcm16kInt16 = downsampleInt16(pcm24kInt16, 24000, 16000);
    const pcm16kBytes = int16ToUint8Array(pcm16kInt16);
  
    simliClient.sendAudioData(pcm16kBytes);
  }
  
  function connectBrowserLiveSocket() {
    if (browserLiveSocket && browserLiveSocket.readyState === WebSocket.OPEN) {
      return;
    }
  
    browserLiveSocket = new WebSocket("ws://localhost:3001/live");
  
    browserLiveSocket.onopen = () => {
      setStatus("Connected to backend Live bridge.");
      browserLiveSocket.send(JSON.stringify({ type: "get_history" }));
    };
  
    browserLiveSocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
  
      if (msg.type === "status") {
        setStatus(msg.message);
        return;
      }
  
      if (msg.type === "error") {
        setStatus(`Error: ${msg.message}`);
        return;
      }
  
      if (msg.type === "model_text") {
        currentModelText += msg.text;
        setStatus(`Gemini Live reply:\n${currentModelText}`);
        return;
      }
  
      if (msg.type === "audio_chunk") {
        try {
          sendAudioChunkToSimli(msg.data);
        } catch (error) {
          console.error("Audio chunk error:", error);
        }
        return;
      }
  
      if (msg.type === "turn_complete") {
        if (currentModelText.trim()) {
          conversationHistory.push({ role: "model", text: currentModelText.trim() });
  
          browserLiveSocket.send(
            JSON.stringify({
              type: "save_model_text",
              text: currentModelText.trim(),
            })
          );
        }
  
        setStatus(`Gemini Live reply:\n${currentModelText}\n\nTurn complete.`);
        currentModelText = "";
        return;
      }
  
      if (msg.type === "history") {
        conversationHistory = msg.history || [];
        console.log("Conversation history:", conversationHistory);
        return;
      }
    };
  
    browserLiveSocket.onerror = () => {
      setStatus("Backend Live socket error.");
    };
  
    browserLiveSocket.onclose = () => {
      setStatus("Backend Live socket closed.");
    };
  }
  
  async function startSimli() {

    sessionStarted = true;
uploadDeckBtn.disabled = true;
deckFileInput.disabled = true;

    const apiKey = apiKeyInput.value.trim();
    const faceId = faceIdInput.value.trim();
  
    if (!apiKey || !faceId) {
      setStatus("Enter both API key and Face ID.");
      return;
    }
  
    try {
      startBtn.disabled = true;
      setStatus("Creating Simli session token...");
  
      const sessionToken = await getSessionToken(apiKey, faceId);
  
      setStatus("Starting Simli client...");
  
      simliClient = new SimliClient(
        sessionToken,
        videoEl,
        audioEl,
        null,
        LogLevel.DEBUG,
        "livekit"
      );
  
      simliClient.on("start", () => {
        setStatus("Simli connected. Avatar stream should appear.");
        stopBtn.disabled = false;
      });
  
      simliClient.on("speaking", () => {
        console.log("Simli avatar speaking");
      });
  
      simliClient.on("silent", () => {
        console.log("Simli avatar silent");
      });
  
      simliClient.on("stop", () => {
        setStatus("Simli stopped.");
        stopBtn.disabled = true;
        startBtn.disabled = false;
      });
  
      simliClient.on("error", (err) => {
        console.error("Simli error:", err);
        setStatus("Simli error. Check console.");
        stopBtn.disabled = true;
        startBtn.disabled = false;
      });
  
      simliClient.on("startup_error", (message) => {
        console.error("Simli startup_error:", message);
        setStatus(`Startup error: ${message}`);
        stopBtn.disabled = true;
        startBtn.disabled = false;
      });
  
      await simliClient.start();
      connectBrowserLiveSocket();
    } catch (error) {
      console.error(error);
      setStatus(`Failed to start: ${error.message}`);
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }
  
  async function stopSimli() {

    sessionStarted = false;
uploadDeckBtn.disabled = false;
deckFileInput.disabled = false;


    if (browserLiveSocket) {
      browserLiveSocket.close();
      browserLiveSocket = null;
    }
  
    if (!simliClient) return;
  
    try {
      await simliClient.stop();
    } catch (error) {
      console.error(error);
      setStatus(`Stop error: ${error.message}`);
    } finally {
      simliClient = null;
      stopBtn.disabled = true;
      startBtn.disabled = false;
    }
  }
  async function uploadDeck() {
    if (sessionStarted) {
        setStatus("Upload is locked after the session starts. Stop and restart to upload a new file.");
        return;
      }

    const file = deckFileInput.files?.[0];
  
    if (!file) {
      setStatus("Choose a deck file first.");
      return;
    }
  
    try {
      uploadDeckBtn.disabled = true;
      setStatus("Uploading deck...");
  
      const formData = new FormData();
      formData.append("deck", file);
  
      const response = await fetch("http://localhost:3001/upload-deck", {
        method: "POST",
        body: formData,
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }
  
      setStatus(
        `Deck uploaded: ${data.fileName}.\n\nContext preview:\n${data.contextPreview}\n\nRestart avatar session to use it.`
      );
    } catch (error) {
      console.error(error);
      setStatus(`Deck upload error: ${error.message}`);
    } finally {
      uploadDeckBtn.disabled = false;
    }
  }
  
  function sendMessageToGeminiLive() {
    const message = userMessageInput.value.trim();
  
    if (!message) {
      setStatus("Type a message first.");
      return;
    }
  
    if (!browserLiveSocket || browserLiveSocket.readyState !== WebSocket.OPEN) {
      setStatus("Live backend is not connected yet.");
      return;
    }
  
    if (!simliClient) {
      setStatus("Start the avatar first.");
      return;
    }
  
    conversationHistory.push({ role: "user", text: message });
    currentModelText = "";
  
    browserLiveSocket.send(
      JSON.stringify({
        type: "user_text",
        text: message,
      })
    );
  
    setStatus(`You: ${message}\n\nWaiting for Gemini Live reply...`);
    userMessageInput.value = "";
  }
  
  startBtn.addEventListener("click", startSimli);
  stopBtn.addEventListener("click", stopSimli);
  startMicBtn.addEventListener("click", startMicStreaming);
stopMicBtn.addEventListener("click", stopMicStreaming);
  sendMessageBtn.addEventListener("click", sendMessageToGeminiLive);
  uploadDeckBtn.addEventListener("click", uploadDeck);
  
  setStatus("Ready. Start avatar, then send a message.");