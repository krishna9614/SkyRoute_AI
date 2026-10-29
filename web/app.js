/* SkyRoute AI — chat client.
 * Talks to the ADK api_server mounted at the same origin:
 *   POST /apps/{app}/users/{user}/sessions  -> create session
 *   POST /run_sse                           -> stream agent events (SSE)
 */

const APP_NAME = "skyroute_agent";
const USER_ID = "web_user";
const SESSION_ID = "s_" + Math.random().toString(36).slice(2, 10);

const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const composer = document.getElementById("composer");
const conn = document.getElementById("conn-status");

/* ---------- session bootstrap ---------- */
async function ensureSession() {
  const res = await fetch(`/apps/${APP_NAME}/users/${USER_ID}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: SESSION_ID }),
  });
  if (!res.ok) throw new Error(`session create failed: ${res.status}`);
}

async function init() {
  try {
    await ensureSession();
    conn.classList.add("ok");
    conn.querySelector(".conn-label").textContent = "online";
  } catch (e) {
    conn.classList.add("err");
    conn.querySelector(".conn-label").textContent = "offline";
    console.error(e);
  }
}

/* ---------- DOM helpers ---------- */
function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

function removeHero() {
  const hero = chat.querySelector(".hero");
  if (hero) hero.remove();
}

function addUserMsg(text) {
  removeHero();
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `<div class="avatar">🧳</div><div class="bubble"></div>`;
  el.querySelector(".bubble").textContent = text;
  chat.appendChild(el);
  scrollDown();
}

function addAgentMsg() {
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
  scrollDown();
  return {
    el,
    textEl: el.querySelector(".text"),
    toolsEl: el.querySelector(".tool-activity"),
    text: "",
    tools: {},
  };
}

function renderAgentText(msg) {
  msg.textEl.textContent = msg.text || "";
  scrollDown();
}

function upsertToolChip(msg, name, args) {
  if (msg.tools[name]) {
    msg.tools[name].classList.add("done");
    return;
  }
  const chip = document.createElement("div");
  chip.className = "tool-chip";
  const argStr = args && Object.keys(args).length ? `(${JSON.stringify(args).slice(1, -1)})` : "";
  chip.innerHTML = `<span class="spinner"></span><span>⚙ ${name}${argStr}</span>`;
  msg.toolsEl.appendChild(chip);
  msg.tools[name] = chip;
  scrollDown();
}

function showError(text) {
  const el = addAgentMsg();
  el.textEl.innerHTML = "";
  el.textEl.textContent = text;
  el.el.querySelector(".bubble").style.borderColor = "rgba(248,113,113,.5)";
}

/* ---------- SSE parsing ---------- */
function extractParts(event) {
  const parts = (event.content && event.content.parts) || [];
  const texts = [];
  for (const p of parts) {
    if (p.functionCall) {
      texts.push({ kind: "call", name: p.functionCall.name, args: p.functionCall.args });
    } else if (p.functionResponse) {
      texts.push({ kind: "response", name: p.functionResponse.name });
    } else if (typeof p.text === "string" && event.author !== "user") {
      texts.push({ kind: "text", text: p.text, partial: event.partial === true });
    }
  }
  return texts;
}

async function askAgent(text) {
  const res = await fetch("/run_sse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_name: APP_NAME,
      user_id: USER_ID,
      session_id: SESSION_ID,
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
        const errMsg =
          (event.error_details && event.error_details.error_message) ||
          event.errorMessage ||
          (typeof event.error === "string" ? event.error : null);
        if (errMsg) {
          msg.error = msg.error || true;
          msg.textEl.innerHTML = "";
          msg.textEl.textContent = `⚠ ${errMsg}`;
          msg.el.querySelector(".bubble").style.borderColor = "rgba(248,113,113,.5)";
          scrollDown();
          continue;
        }
        for (const part of extractParts(event)) {
          if (part.kind === "call") {
            upsertToolChip(msg, part.name, part.args);
          } else if (part.kind === "response") {
            upsertToolChip(msg, part.name);
          } else if (part.kind === "text") {
            msg.text = part.partial ? msg.text + part.text : part.text;
            renderAgentText(msg);
          }
        }
      }
    }
  }
  if (!msg.text && !Object.keys(msg.tools).length && !msg.error) {
    msg.textEl.innerHTML = "";
    msg.textEl.textContent = "The agent didn't return a response. Check the server logs.";
  }
}

/* ---------- wiring ---------- */
async function send(text) {
  const value = (text || "").trim();
  if (!value) return;
  addUserMsg(value);
  input.value = "";
  sendBtn.disabled = true;
  input.disabled = true;
  try {
    await askAgent(value);
  } catch (e) {
    console.error(e);
    showError(
      "Something went wrong talking to the agent. Check that GOOGLE_API_KEY is set and the MCP servers are running, then try again."
    );
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => send(chip.dataset.prompt));
});

init();
