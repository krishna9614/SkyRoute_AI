/* SkyRoute AI — chat client.
 * Talks to the ADK api_server mounted at the same origin:
 *   POST /apps/{app}/users/{user}/sessions        -> create session
 *   GET  /apps/{app}/users/{user}/sessions/{id}   -> restore history
 *   POST /run_sse                                 -> stream agent events (SSE)
 */

const APP_NAME = "skyroute_agent";
const USER_ID = "web_user";

const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const composer = document.getElementById("composer");
const conn = document.getElementById("conn-status");
const newChatBtn = document.getElementById("new-chat");
const chatCard = document.getElementById("chat-card");

let sessionId = localStorage.getItem("skyroute_session_id") || newSessionId();
let busy = false;

const HERO_ICON = document.querySelector(".hero-icon")?.innerHTML || "";

function newSessionId() {
  return "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- ambient: starfield ---------- */
(function makeStars() {
  const sky = document.getElementById("stars");
  for (let i = 0; i < 70; i++) {
    const s = document.createElement("span");
    s.className = "star";
    const size = Math.random() * 2.2 + 0.8;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%; top:${Math.random() * 100}%;
      --dur:${(Math.random() * 3 + 2).toFixed(1)}s;
      --delay:${(Math.random() * 4).toFixed(1)}s;`;
    sky.appendChild(s);
  }
})();

/* ---------- ambient: subtle tilt on pointer ---------- */
document.addEventListener("pointermove", (e) => {
  const rx = (e.clientX / innerWidth - 0.5) * 1.4;
  const ry = (e.clientY / innerHeight - 0.5) * -1.2;
  chatCard.style.transform = `perspective(1400px) rotateY(${rx}deg) rotateX(${ry}deg)`;
});
document.addEventListener("pointerleave", () => {
  chatCard.style.transform = "";
});

/* ---------- helpers ---------- */
function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

function removeHero() {
  const hero = chat.querySelector(".hero");
  if (hero) hero.remove();
}

function showHero() {
  if (chat.querySelector(".hero")) return;
  chat.innerHTML = `
    <div class="hero">
      <div class="hero-icon">${HERO_ICON}</div>
      <h2>Where to next?</h2>
      <p>Ask me about weather, places to visit, or start planning a trip.</p>
      <div class="chips">
        <button class="chip" data-prompt="What's the weather in Paris?">🌤 Weather in Paris</button>
        <button class="chip" data-prompt="What places should I visit in Tokyo?">🗼 Places in Tokyo</button>
        <button class="chip" data-prompt="What's the weather and what can I visit in London?">🧳 Weather + places in London</button>
        <button class="chip" data-prompt="Hi! Who are you?">👋 Just say hi</button>
      </div>
    </div>`;
  bindChips();
}

function fmtTime(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMeta(msgEl, text, ts) {
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span>${fmtTime(ts)}</span>`;
  if (msgEl.classList.contains("agent")) {
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "copy";
    btn.title = "Copy reply";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text());
        btn.textContent = "copied ✓";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "copy"; btn.classList.remove("copied"); }, 1500);
      } catch { /* clipboard blocked */ }
    });
    meta.appendChild(btn);
  }
  msgEl.querySelector(".bubble").appendChild(meta);
}

function addUserMsg(text, ts) {
  removeHero();
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `<div class="avatar">🧳</div><div class="bubble"><div class="text"></div></div>`;
  el.querySelector(".text").textContent = text;
  addMeta(el, () => text, ts);
  chat.appendChild(el);
  scrollDown();
}

function addAgentMsg(ts) {
  removeHero();
  const el = document.createElement("div");
  el.className = "msg agent";
  el.innerHTML = `
    <div class="avatar">✈</div>
    <div class="bubble">
      <div class="tool-activity"></div>
      <div class="text"><span class="typing"><i></i><i></i><i></i></span></div>
    </div>`;
  chat.appendChild(el);
  const msg = {
    el,
    textEl: el.querySelector(".text"),
    toolsEl: el.querySelector(".tool-activity"),
    text: "",
    tools: {},
    error: false,
    ts,
  };
  msg._textGetter = () => msg.text;
  addMeta(el, msg._textGetter, ts);
  scrollDown();
  return msg;
}

function renderAgentText(msg) {
  msg.textEl.innerHTML = "";
  msg.textEl.textContent = msg.text;
  scrollDown();
}

function upsertToolChip(msg, name, args) {
  const key = `${name}:${JSON.stringify(args || {})}`;
  if (msg.tools[key]) {
    msg.tools[key].classList.add("done");
    return;
  }
  const chip = document.createElement("div");
  chip.className = "tool-chip";
  const argStr = args && Object.keys(args).length ? `(${JSON.stringify(args).slice(1, -1)})` : "";
  chip.innerHTML = `<span class="spinner"></span><span>⚙ ${name}${argStr}</span>`;
  chip.title = `${name} ${JSON.stringify(args || {})}`;
  msg.toolsEl.appendChild(chip);
  msg.tools[key] = chip;
  scrollDown();
}

/* ---------- rich result cards ---------- */
function unwrapResponse(fr) {
  let r = fr && fr.response !== undefined ? fr.response : fr;
  if (r && typeof r === "object" && "result" in r) r = r.result;
  if (typeof r === "string") {
    try { r = JSON.parse(r); } catch { return null; }
  }
  if (r && typeof r === "object" && Array.isArray(r.content)) {
    // MCP content blocks -> first text block is JSON
    const t = r.content.find((c) => c.type === "text" && c.text);
    if (t) { try { return JSON.parse(t.text); } catch { return null; } }
    return null;
  }
  return r && typeof r === "object" ? r : null;
}

function weatherIcon(cond) {
  const c = (cond || "").toLowerCase();
  if (c.includes("sun") || c.includes("clear")) return "☀";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧";
  if (c.includes("storm") || c.includes("thunder")) return "⛈";
  if (c.includes("snow")) return "🌨";
  if (c.includes("cloud")) return "⛅";
  return "🌤";
}

function renderToolResult(msg, name, data) {
  if (!data) return;
  if (data.temperature || data.conditions) {
    const card = document.createElement("div");
    card.className = "wcard";
    card.innerHTML = `
      <div class="wcard-top">
        <span class="wicon">${weatherIcon(data.conditions)}</span>
        <div><div class="wcity">${esc(data.city || "")}</div><div class="wcond">${esc(data.conditions || "")}</div></div>
        <div class="wtemp">${esc(data.temperature || "")}</div>
      </div>
      <div class="wrows">
        ${data.humidity ? `<div class="wrow"><span>Humidity</span><span>${esc(data.humidity)}</span></div>` : ""}
        ${data.wind ? `<div class="wrow"><span>Wind</span><span>${esc(data.wind)}</span></div>` : ""}
      </div>`;
    msg.toolsEl.appendChild(card);
    scrollDown();
    return;
  }
  if (Array.isArray(data.places)) {
    const card = document.createElement("div");
    card.className = "pcard";
    card.innerHTML = `<div class="pcard-title">📍 Places in ${esc(data.city || "")}</div>` +
      data.places.map((p) => `
        <div class="place">
          <div><div class="pname">${esc(p.name || "")}</div></div>
          <span class="pcat">${esc(p.category || "spot")}</span>
          <span class="prate">★ ${esc(String(p.rating ?? "—"))}</span>
        </div>`).join("");
    msg.toolsEl.appendChild(card);
    scrollDown();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showError(text) {
  const msg = addAgentMsg();
  msg.textEl.innerHTML = "";
  msg.textEl.textContent = text;
  msg.el.querySelector(".bubble").style.borderColor = "rgba(248,113,113,.5)";
}

/* ---------- SSE handling ---------- */
function handleEvent(event, msg) {
  const errMsg =
    (event.error_details && event.error_details.error_message) ||
    event.errorMessage ||
    (typeof event.error === "string" ? event.error : null);
  if (errMsg) {
    msg.error = true;
    msg.textEl.innerHTML = "";
    msg.textEl.textContent = `⚠ ${errMsg}`;
    msg.el.querySelector(".bubble").style.borderColor = "rgba(248,113,113,.5)";
    scrollDown();
    return;
  }
  const parts = (event.content && event.content.parts) || [];
  for (const p of parts) {
    if (p.functionCall) {
      upsertToolChip(msg, p.functionCall.name, p.functionCall.args);
    } else if (p.functionResponse) {
      const chipKey = Object.keys(msg.tools).find((k) => k.startsWith(p.functionResponse.name + ":"));
      if (chipKey) msg.tools[chipKey].classList.add("done");
      renderToolResult(msg, p.functionResponse.name, unwrapResponse(p.functionResponse));
    } else if (typeof p.text === "string" && event.author !== "user") {
      msg.text = event.partial === true ? msg.text + p.text : p.text;
      renderAgentText(msg);
    }
  }
}

async function askAgent(text) {
  const res = await fetch("/run_sse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_name: APP_NAME,
      user_id: USER_ID,
      session_id: sessionId,
      streaming: true,
      new_message: { role: "user", parts: [{ text }] },
    }),
  });
  if (!res.ok) throw new Error(`run_sse failed: ${res.status}`);

  const msg = addAgentMsg();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        handleEvent(event, msg);
      }
    }
  }
  if (!msg.text && !Object.keys(msg.tools).length && !msg.error) {
    msg.textEl.innerHTML = "";
    msg.textEl.textContent = "The agent didn't return a response. Check the server logs.";
  }
}

/* ---------- session + history ---------- */
async function ensureSession() {
  const res = await fetch(`/apps/${APP_NAME}/users/${USER_ID}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (res.status === 409 || res.status === 400) return; // already exists
  if (!res.ok) throw new Error(`session create failed: ${res.status}`);
}

async function restoreHistory() {
  let res;
  try {
    res = await fetch(`/apps/${APP_NAME}/users/${USER_ID}/sessions/${sessionId}`);
    if (!res.ok) return;
  } catch { return; }
  const session = await res.json();
  const events = session.events || [];
  if (!events.length) return;

  let current = null;
  for (const ev of events) {
    const parts = (ev.content && ev.content.parts) || [];
    const texts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
    const hasCalls = parts.some((p) => p.functionCall || p.functionResponse);
    if (ev.author === "user" && texts.length && !hasCalls) {
      addUserMsg(texts.join(""), ev.timestamp);
      current = null;
      continue;
    }
    if (!current) current = addAgentMsg(ev.timestamp);
    handleEvent(ev, current);
    if (texts.length && ev.partial !== true) {
      current.text = texts.join("");
      renderAgentText(current);
    }
  }
  scrollDown();
}

/* ---------- actions ---------- */
async function send(text) {
  const value = (text || "").trim();
  if (!value || busy) return;
  busy = true;
  addUserMsg(value);
  input.value = "";
  sendBtn.disabled = true;
  input.disabled = true;
  try {
    await askAgent(value);
  } catch (e) {
    console.error(e);
    showError("Something went wrong talking to the agent. Check that GOOGLE_API_KEY is set and the MCP servers are running, then try again.");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

async function startNewChat() {
  sessionId = newSessionId();
  localStorage.setItem("skyroute_session_id", sessionId);
  try {
    await ensureSession();
  } catch (e) {
    console.error(e);
  }
  chat.innerHTML = "";
  showHero();
  input.focus();
}

/* ---------- wiring ---------- */
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});

function bindChips() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => send(chip.dataset.prompt));
  });
}

newChatBtn.addEventListener("click", startNewChat);

async function init() {
  try {
    await ensureSession();
    conn.classList.add("ok");
    conn.querySelector(".conn-label").textContent = "online";
    await restoreHistory();
  } catch (e) {
    conn.classList.add("err");
    conn.querySelector(".conn-label").textContent = "offline";
    console.error(e);
  }
}

init();
