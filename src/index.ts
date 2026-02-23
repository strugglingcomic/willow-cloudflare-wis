/**
 * Willow Inference Server (WIS) replacement using Cloudflare Workers AI.
 *
 * Exposes /api/willow (ASR) and /api/tts (TTS) endpoints compatible with the
 * Willow voice assistant ecosystem (ESP32-S3-BOX-3 + WAS).
 */

interface Env {
  AI: Ai;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // Authenticate API endpoints via ?key= query param
      if (url.pathname === "/api/willow" || url.pathname === "/api/tts" || url.pathname === "/api/echo") {
        const authError = checkAuth(url, env);
        if (authError) return authError;
      }

      if (url.pathname === "/api/willow" && request.method === "POST") {
        return await handleASR(request, env);
      }

      if (url.pathname === "/api/tts" && request.method === "GET") {
        return await handleTTS(url, env);
      }

      if (url.pathname === "/api/echo" && request.method === "POST") {
        return await handleEcho(request);
      }

      // Health check
      if (url.pathname === "/" || url.pathname === "/api/health") {
        return jsonResponse({ status: "ok", service: "willow-wis-cf" });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Request failed:", message);
      return jsonResponse({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// ASR: /api/willow — accepts raw audio POST, returns { text: "..." }
// ---------------------------------------------------------------------------

async function handleASR(request: Request, env: Env): Promise<Response> {
  const codec = request.headers.get("x-audio-codec") || "pcm";
  const sampleRate = parseInt(request.headers.get("x-audio-sample-rate") || "16000", 10);
  const bits = parseInt(request.headers.get("x-audio-bits") || "16", 10);
  const channels = parseInt(request.headers.get("x-audio-channel") || "1", 10);

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength === 0) {
    return jsonResponse({ error: "Empty audio body" }, 400);
  }

  // Whisper needs a recognizable audio format. If the device sends raw PCM,
  // wrap it in a WAV header. If it already sends WAV, pass through.
  let audioBytes: ArrayBuffer;
  if (codec === "pcm") {
    audioBytes = wrapPCMasWAV(rawBody, sampleRate, bits, channels);
  } else {
    // wav, amrwb, or other — pass as-is and hope Whisper handles it
    audioBytes = rawBody;
  }

  const base64Audio = arrayBufferToBase64(audioBytes);

  const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64Audio,
    task: "transcribe",
    language: "en",
  });

  console.log("ASR result:", JSON.stringify(result));

  return jsonResponse({ text: result.text || "" });
}

// ---------------------------------------------------------------------------
// TTS: /api/tts?text=... — returns WAV audio
// ---------------------------------------------------------------------------

async function handleTTS(url: URL, env: Env): Promise<Response> {
  const text = url.searchParams.get("text");
  if (!text) {
    return jsonResponse({ error: "Missing 'text' query parameter" }, 400);
  }

  const response = await env.AI.run(
    "@cf/deepgram/aura-2-en",
    {
      text,
      speaker: "luna",
      encoding: "linear16",
      container: "wav",
    },
    { returnRawResponse: true },
  );

  // returnRawResponse gives us a Response object with the audio stream
  return new Response(response.body, {
    status: 200,
    headers: {
      ...Object.fromEntries(corsHeaders().entries()),
      "Content-Type": "audio/wav",
    },
  });
}

// ---------------------------------------------------------------------------
// Echo: /api/echo — command endpoint for WAS REST; echoes transcription back
// ---------------------------------------------------------------------------

async function handleEcho(request: Request): Promise<Response> {
  const body = await request.json<{ text?: string }>().catch(() => null);
  const text = body?.text || "";
  console.log("Echo request:", text);
  const speech = text ? `You said: ${text}` : "I didn't catch that.";
  return new Response(speech, {
    status: 200,
    headers: {
      ...Object.fromEntries(corsHeaders().entries()),
      "Content-Type": "text/plain",
    },
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function checkAuth(url: URL, env: Env): Response | null {
  const key = url.searchParams.get("key");
  if (!env.API_KEY) {
    // No secret configured — allow all (dev/testing mode)
    return null;
  }
  if (!key || key !== env.API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap raw PCM data in a minimal WAV header. */
function wrapPCMasWAV(
  pcmData: ArrayBuffer,
  sampleRate: number,
  bitsPerSample: number,
  numChannels: number,
): ArrayBuffer {
  const dataLength = pcmData.byteLength;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // 44-byte WAV header
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true); // file size - 8
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true); // audio format (PCM = 1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Combine header + PCM data
  const wav = new Uint8Array(44 + dataLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(new Uint8Array(pcmData), 44);
  return wav.buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...Object.fromEntries(corsHeaders().entries()),
      "Content-Type": "application/json",
    },
  });
}

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-audio-codec, x-audio-sample-rate, x-audio-bits, x-audio-channel",
  });
}
