# willow-cloudflare-wis

Cloudflare Worker replacing dead Willow Inference Server (infer.tovera.io).

## Endpoints

- `POST /api/willow` — ASR via `@cf/openai/whisper-large-v3-turbo`
- `GET /api/tts?text=...` — TTS via `@cf/deepgram/aura-2-en` (speaker: luna, WAV output)
- Both require `?key=` query param (secret in `pass willow-wis/api-key` and Cloudflare Worker secret `API_KEY`)

## Deploy

- `npx wrangler deploy` — deploy to Cloudflare
- `npx wrangler tail` — live logs
- `echo "NEW_KEY" | npx wrangler secret put API_KEY` — rotate API key

## Willow Audio Format

- Device sends: raw PCM 16kHz/16-bit/mono via chunked POST with `x-audio-*` headers
- Worker wraps PCM in WAV header before passing to Whisper
- TTS URL constructed by WAS with `?text=` appended (preserves other query params like `key`)
