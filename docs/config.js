// Public, non-secret settings for the static (GitHub Pages) build. The gateway API key is typed in by the user at runtime.
window.STATIC_CFG = {
  endpoint: "https://uae-agents.kore.ai",
  apiKey: "pk_79c36a9ba364158d7a793b8e9f3de63f3adf3948d456849d", // Kore web SDK public key
  projectId: "01a0e7e1-b27c-7d4f-9e9c-5a7448d2223b",
  channelId: "01a138a6-3ea8-704d-a0c4-27e8f6a14d6e",
  gatewayBase: "https://dev.ai-gateway.kapitalbank.az",
  sttModel: "gemini-3.5-transcribe",
  ttsModel: "gemini-3.8-flash-lite-tts",
  voice: "alloy"
};
