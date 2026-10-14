// Static host + thin proxy to the Kapital AI gateway (STT / TTS). Keeps the gateway key server-side and avoids browser CORS.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const E = k => process.env[k] ?? env[k];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const body = req => new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/config") return send(res, 200, { endpoint: E("KORE_ENDPOINT"), apiKey: E("KORE_PUBLIC_KEY"), projectId: E("KORE_PROJECT_ID"), channelId: E("KORE_CHANNEL_ID"), voice: E("TTS_VOICE"), sttModel: E("STT_MODEL"), ttsModel: E("TTS_MODEL") });
    if (u.pathname === "/stt" && req.method === "POST") {
      const audio = await body(req), type = req.headers["content-type"] || "audio/webm", ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      const fd = new FormData(); fd.append("file", new Blob([audio], { type }), `speech.${ext}`); fd.append("model", E("STT_MODEL"));
      const lang = u.searchParams.get("language"); if (lang) fd.append("language", lang);
      const r = await fetch(E("GATEWAY_BASE") + "/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + E("GATEWAY_API_KEY") }, body: fd });
      const t = await r.text(); res.writeHead(r.status, { "Content-Type": "application/json" }); return res.end(t);
    }
    if (u.pathname === "/tts" && req.method === "POST") {
      const { input, voice, format } = JSON.parse((await body(req)).toString() || "{}");
      const r = await fetch(E("GATEWAY_BASE") + "/v1/audio/speech", { method: "POST", headers: { Authorization: "Bearer " + E("GATEWAY_API_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ model: E("TTS_MODEL"), input, voice: voice || E("TTS_VOICE"), response_format: format || "mp3" }) });
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "audio/mpeg" }); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const f = path.join(root, "docs", u.pathname === "/" ? "index.html" : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(path.join(root, "docs")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 502, { error: String(e.cause?.code || e.message) }); }
}).listen(+E("PORT") || 8787, () => console.log("Voice call UI: http://localhost:" + (E("PORT") || 8787)));
