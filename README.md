# willow-cloudflare-wis

Cloudflare Workers AI replacement for the dead Willow Inference Server (WIS) at `infer.tovera.io`.

Provides ASR (Whisper) and TTS (Deepgram Aura-2) endpoints compatible with the Willow voice assistant ecosystem (ESP32-S3-BOX-3 + WAS).

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/willow` | POST | ASR — accepts raw PCM/WAV audio, returns `{"text": "..."}` |
| `/api/tts?text=Hello` | GET | TTS — returns WAV audio |
| `/api/health` | GET | Health check |

## Models Used

- **ASR:** `@cf/openai/whisper-large-v3-turbo` (~$0.0005/audio minute)
- **TTS:** `@cf/deepgram/aura-2-en` (~$0.03/1k characters)

Free tier: 10,000 neurons/day (~200 ASR + ~50 TTS requests)

## Setup

```bash
npm install
npx wrangler login    # authenticate with Cloudflare
npx wrangler deploy   # deploy to Cloudflare edge
```

## WAS Configuration

After deploying, update your WAS config (http://localhost:8502/admin/config/):

- **WIS URL:** `https://willow-wis.<your-subdomain>.workers.dev/api/willow`
- **WIS TTS URL:** `https://willow-wis.<your-subdomain>.workers.dev/api/tts`

## Local Development

```bash
npx wrangler dev   # starts local dev server on port 8787
```

## Monitoring

```bash
npx wrangler tail   # stream live logs from deployed Worker
```
