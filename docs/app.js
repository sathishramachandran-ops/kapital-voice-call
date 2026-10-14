// Voice call to a Kore agent: mic -> VAD -> STT (gateway) -> Kore SDK chat -> TTS (gateway) -> speaker.
const $ = id => document.getElementById(id);
const el = { orb: $("orb"), status: $("status"), sub: $("sub"), timer: $("timer"), bars: $("bars"), start: $("start"), end: $("end"), mute: $("mute"), log: $("log"), title: $("title") };
let CFG, sdk, chat, stream, actx, analyser, vadTimer, tickTimer, t0, muted = false, state = "idle", callId = 0;
let rec, recChunks = [], speechMs = 0, silenceMs = 0, floor = 0.01, calib = [], bargeMs = 0, audio, speakQueueId = 0;
const spoken = new Map(), seen = new Map(); let idleTimer, thinkTimer, lastUserSend = 0;
const BARS = 28; el.bars.innerHTML = "<i></i>".repeat(BARS);
const bars = [...el.bars.children];

function ui(s, sub) {
  state = s; el.orb.className = "orb " + (["listening", "speaking", "thinking"].includes(s) ? s : "");
  const label = { idle: "Ready to call", connecting: "Connecting…", listening: "Listening…", capturing: "Listening…", transcribing: "Transcribing…", thinking: "Agent is thinking…", speaking: "Agent is speaking" }[s] || s;
  el.status.textContent = label; if (sub !== undefined) el.sub.textContent = sub;
}
function add(kind, text, meta) {
  const e = el.log.querySelector(".empty"); if (e) e.remove();
  const d = document.createElement("div"); d.className = "m " + kind; d.textContent = text;
  if (meta) { const s = document.createElement("small"); s.textContent = meta; d.appendChild(s); }
  el.log.appendChild(d); el.log.scrollTop = el.log.scrollHeight; return d;
}
const clean = t => String(t || "").replace(/```[\s\S]*?```/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#>`~]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
const textOf = c => typeof c === "string" ? c : c && typeof c === "object" ? (c.text || c.content || c.message || (Array.isArray(c) ? c.map(textOf).join(" ") : "")) : "";

async function loadSdk() {
  if (window.AgentSDK) return;
  await new Promise((ok, no) => { const s = document.createElement("script"); s.src = CFG.endpoint + "/api/sdk/embed/script"; s.onload = ok; s.onerror = () => no(new Error("Could not load the Kore SDK from " + CFG.endpoint)); document.head.appendChild(s); });
  if (!window.AgentSDK) throw new Error("Kore SDK did not initialise");
}

async function startCall() {
  if (CFG?.direct) { if (!$("gwkey").value.trim()) { add("e", "Enter the gateway API key under Call settings first."); return; } localStorage.gwkey = $("gwkey").value.trim(); localStorage.gwbase = $("gwbase").value.trim(); }
  const my = ++callId; el.start.style.display = "none"; el.end.style.display = ""; el.end.disabled = false; el.mute.disabled = false; ui("connecting", "Connecting to the agent and microphone…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    actx = new (window.AudioContext || window.webkitAudioContext)(); await actx.resume();
    const src = actx.createMediaStreamSource(stream); analyser = actx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
    await loadSdk();
    sdk = new window.AgentSDK({ endpoint: CFG.endpoint, apiKey: CFG.apiKey, projectId: CFG.projectId, channelId: CFG.channelId });
    await sdk.connect(); if (my !== callId) return;
    chat = sdk.chat(); wireChat(my);
    t0 = Date.now(); tickTimer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); el.timer.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }, 500);
    add("s", "Call connected"); calib = []; floor = 0.01; ui("listening", "Speak when you're ready - I'll answer when you pause.");
    vadTimer = setInterval(vad, 30);
    // the agent's opening message (ON_START) arrives as a normal assistant message
    armIdle();
  } catch (e) { add("e", "Could not start the call: " + (e.message || e)); endCall(true); }
}

function wireChat(my) {
  chat.on("message", m => {
    if (my !== callId || !m || m.role !== "assistant") return;
    const t = clean(textOf(m.content)); if (!t) return;
    seen.set(m.id, t); armIdle();
  });
  chat.on("error", e => add("e", "Agent error: " + (e?.error?.message || e?.message || "unknown")));
  sdk.on?.("disconnected", () => { if (my === callId && state !== "idle") add("s", "Connection to the agent was lost"); });
}
// An assistant turn can arrive as several messages; speak once they stop changing.
function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(flushAssistant, 1300); }
function flushAssistant() {
  const fresh = []; for (const [id, t] of seen) if (spoken.get(id) !== t) { spoken.set(id, t); fresh.push(t); }
  if (!fresh.length) return; clearTimeout(thinkTimer);
  const text = fresh.join(" "); add("a", text); speak(text);
}

function pickMime() { return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || ""; }
function level() { const b = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); }
function vad() {
  if (!analyser) return; const lv = level(), sens = +$("sens").value, sil = +$("sil").value;
  bars.forEach((b, i) => b.style.height = Math.max(4, Math.min(34, lv * 900 * (0.5 + Math.abs(Math.sin(Date.now() / 140 + i)) * 0.7))) + "px");
  if (muted) return;
  if (calib.length < 20) { calib.push(lv); floor = Math.max(0.006, calib.reduce((a, b) => a + b, 0) / calib.length); return; }
  const thr = Math.max(0.018, floor * 3.2) * sens, hot = lv > (state === "speaking" ? thr * 2.4 : thr);
  if (state === "speaking") { bargeMs = hot ? bargeMs + 30 : 0; if ($("barge").value === "1" && bargeMs >= 240) { stopSpeaking(); beginCapture(); } return; }
  if (state === "listening") { if (hot) { speechMs += 30; if (speechMs >= 60) beginCapture(); } else speechMs = 0; return; }
  if (state === "capturing") { if (hot) { silenceMs = 0; speechMs += 30; } else silenceMs += 30; if (silenceMs >= sil) endCapture(); }
}
function beginCapture() {
  recChunks = []; silenceMs = 0; speechMs = 60; const mime = pickMime();
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); rec.ondataavailable = e => e.data.size && recChunks.push(e.data); rec.start(); ui("capturing", "…");
}
function endCapture() {
  const dur = speechMs; ui("transcribing", ""); const r = rec, type = r.mimeType || "audio/webm";
  r.onstop = async () => {
    if (dur < 350) { ui("listening", "Too short - say that again."); speechMs = 0; return; }
    try { await transcribe(new Blob(recChunks, { type })); } catch (e) { add("e", "Speech-to-text failed: " + (e.message || e)); ui("listening", ""); speechMs = 0; }
  }; r.stop();
}
const gwHeaders = () => ({ Authorization: "Bearer " + ($("gwkey").value.trim() || localStorage.gwkey || "") });
const gwBase = () => ($("gwbase").value.trim() || CFG.gatewayBase || "").replace(/\/$/, "");
async function transcribe(blob) {
  if (CFG.direct) return transcribeDirect(blob);
  const lang = $("lang").value.trim(), r = await fetch("/stt" + (lang ? "?language=" + encodeURIComponent(lang) : ""), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || j.error || "HTTP " + r.status);
  const text = (j.text || "").trim(); speechMs = 0;
  if (!text) { ui("listening", "I didn't catch that."); return; }
  add("u", text); ui("thinking", ""); lastUserSend = Date.now();
  await chat.send(text);
  thinkTimer = setTimeout(() => { if (state === "thinking") { add("e", "The agent did not respond in time."); ui("listening", ""); } }, 60000);
}

function chunks(t) { const out = []; let cur = ""; for (const s of t.match(/[^.!?؟۔]+[.!?؟۔]*\s*/g) || [t]) { if ((cur + s).length > 380 && cur) { out.push(cur.trim()); cur = s; } else cur += s; } if (cur.trim()) out.push(cur.trim()); return out; }
async function transcribeDirect(blob) {
  const fd = new FormData(), lang = $("lang").value.trim(); fd.append("file", blob, "speech." + (blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm")); fd.append("model", CFG.sttModel); if (lang) fd.append("language", lang);
  const r = await fetch(gwBase() + "/v1/audio/transcriptions", { method: "POST", headers: gwHeaders(), body: fd }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j.error || "HTTP " + r.status);
  const text = (j.text || "").trim(); speechMs = 0; if (!text) { ui("listening", "I didn't catch that."); return; }
  add("u", text); ui("thinking", ""); await chat.send(text);
  thinkTimer = setTimeout(() => { if (state === "thinking") { add("e", "The agent did not respond in time."); ui("listening", ""); } }, 60000);
}
async function tts(input) {
  if (CFG.direct) {
    const r = await fetch(gwBase() + "/v1/audio/speech", { method: "POST", headers: { ...gwHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ model: CFG.ttsModel, input, voice: $("voice").value.trim() || CFG.voice, response_format: "mp3" }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message || j.error || "HTTP " + r.status); }
    return URL.createObjectURL(await r.blob());
  }
  const r = await fetch("/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, voice: $("voice").value.trim() || undefined }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message || j.error || "HTTP " + r.status); }
  return URL.createObjectURL(await r.blob());
}
async function speak(text) {
  const id = ++speakQueueId, parts = chunks(text); ui("speaking", ""); bargeMs = 0;
  try {
    let next = tts(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const url = await next; if (id !== speakQueueId) return; if (i + 1 < parts.length) next = tts(parts[i + 1]);
      await new Promise(res => { audio = new Audio(url); audio.onended = audio.onerror = res; audio.play().catch(res); });
      if (id !== speakQueueId) return;
    }
  } catch (e) { add("e", "Text-to-speech failed: " + (e.message || e)); }
  if (id === speakQueueId && callId) { ui("listening", ""); speechMs = 0; }
}
function stopSpeaking() { speakQueueId++; if (audio) { audio.pause(); audio = null; } }

function endCall(failed) {
  callId++; clearInterval(vadTimer); clearInterval(tickTimer); clearTimeout(idleTimer); clearTimeout(thinkTimer); stopSpeaking();
  try { rec && rec.state !== "inactive" && rec.stop(); } catch {} try { sdk?.endSession?.(); sdk?.disconnect?.(); } catch {}
  stream?.getTracks().forEach(t => t.stop()); try { actx?.close(); } catch {} sdk = chat = stream = actx = analyser = null; seen.clear(); spoken.clear(); muted = false; el.mute.classList.remove("on");
  el.start.style.display = ""; el.end.style.display = "none"; el.mute.disabled = true; bars.forEach(b => b.style.height = "4px");
  if (!failed) add("s", "Call ended · " + el.timer.textContent); ui("idle", "Press the green button to call again.");
}
el.start.onclick = startCall; el.end.onclick = () => endCall(false);
el.mute.onclick = () => { muted = !muted; stream?.getAudioTracks().forEach(t => t.enabled = !muted); el.mute.classList.toggle("on", muted); el.sub.textContent = muted ? "Microphone muted" : ""; };
const STATIC = window.STATIC_CFG || {};
fetch("/config").then(r => r.ok ? r.json() : Promise.reject()).catch(() => ({ ...STATIC, direct: true })).then(c => {
  CFG = c; $("voice").value = c.voice || ""; el.title.textContent = "Voice call · " + new URL(c.endpoint).hostname;
  if (c.direct) { $("gw").style.display = ""; $("gwbase").value = localStorage.gwbase || c.gatewayBase || ""; $("gwkey").value = localStorage.gwkey || ""; el.sub.textContent = "Add your gateway API key under Call settings, then press call."; }
}).catch(() => add("e", "Could not load configuration."));
