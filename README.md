# Voice call to a Kore agent

Browser voice call: mic -> VAD -> STT (AI gateway) -> Kore agent (web SDK) -> TTS (AI gateway) -> speaker.

- **GitHub Pages (static):** open the page, expand *Call settings*, paste the gateway API key (kept only in your browser), press call. The gateway must be reachable from your browser (VPN) and allow cross-origin requests.
- **Local (key stays server-side):** copy `.env.example` to `.env`, set `GATEWAY_API_KEY`, run `node server.mjs`, open http://localhost:8787.
