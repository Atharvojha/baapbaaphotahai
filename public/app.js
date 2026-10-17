import { baapFace, chappal } from "./baap.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const local = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(`bbh:${k}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try { localStorage.setItem(`bbh:${k}`, JSON.stringify(v)); } catch {}
  },
};

const LANG_LABELS = {
  "hi-IN": "Hindi / Hinglish", "en-IN": "English", "te-IN": "Telugu", "ta-IN": "Tamil",
  "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali",
  "gu-IN": "Gujarati", "pa-IN": "Punjabi", "od-IN": "Odia",
};

// Short fixed lines that don't need the LLM. Hindi for hi-IN, English otherwise.
const LINES = {
  wake: { hi: "उठ जाओ! फ़ोन उठाओ! पापा बोल रहे हैं!", en: "Wake up! Pick up the phone! It's Papa!" },
  night: {
    hi: "रात के इतने बजे तक जाग रहे हो? फ़ोन रखो और सो जाओ। सुबह मेरा फ़ोन आएगा, याद रखना।",
    en: "Still awake at this hour? Put the phone down and sleep. I will call you in the morning, remember that.",
  },
  preview: {
    hi: "हाँ बेटा, मैं बोल रहा हूँ। कल सुबह सात बजे फ़ोन उठाना, वरना चप्पल तैयार है।",
    en: "Yes beta, it's me. Pick up my call at seven tomorrow, or the chappal is ready.",
  },
};
const line = (key) => LINES[key][state?.language === "hi-IN" ? "hi" : "en"];

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>',
  chappal: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="7" y="2" width="10" height="20" rx="5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

let state = null; // server info + this browser's settings
let tasksData = null;

const SETTING_KEYS = ["child_name", "dad_title", "language", "strictness", "wake_time", "breakfast_close", "ics_url", "voice_id"];
const settings = () => Object.fromEntries(SETTING_KEYS.map((k) => [k, state[k]]));
function saveSettings(patch) {
  Object.assign(state, patch);
  local.set("settings", settings());
}

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const pw = local.get("pw", "");
  if (pw) headers["X-App-Password"] = pw;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(body?.detail || `Request failed (${res.status})`);
    err.code = body?.code;
    if (err.code === "missing_key") $("#keyBanner").hidden = false;
    if (err.code === "auth") showGate("Galat password. Phir se bolo.");
    throw err;
  }
  return body;
}
const postJSON = (path, data) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

let toastTimer;
function toast(msg, { error = false, ms = 3400 } = {}) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("is-error", error);
  el.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), ms);
}

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
function todayAt(time) {
  const [hr, mn] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(hr, mn, 0, 0);
  return d;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try { new Notification(title, { body, icon: "favicon.svg", tag: "baap" }); } catch {}
}

// ---------------------------------------------------------------- audio

let ctx;
function audioCtx() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

const speechCache = new Map(); // text -> Promise<object URL>
function fetchSpeech(text) {
  if (!speechCache.has(text)) {
    const p = postJSON("/api/speak", { text, settings: settings() }).then(({ audio, mime }) => {
      const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
    p.catch(() => speechCache.delete(text));
    speechCache.set(text, p);
  }
  return speechCache.get(text);
}
function clearSpeechCache() {
  for (const p of speechCache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  speechCache.clear();
}

const player = new Audio();
let playToken = 0;
async function say(text, talkEl) {
  if (!text) return;
  const token = ++playToken;
  const url = await fetchSpeech(text);
  if (token !== playToken) return; // something newer started talking
  player.pause();
  player.src = url;
  talkEl?.classList.add("is-talking");
  try {
    await player.play();
    await new Promise((res) => {
      player.onended = res;
      player.onpause = res;
    });
  } finally {
    talkEl?.classList.remove("is-talking");
  }
}
function stopSpeaking() {
  playToken++;
  player.pause();
}

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}
const extFor = (type) => (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");

async function startRecorder({ onLevel, clean = true } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean },
  });
  const mimeType = pickMime();
  const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let raf = 0;
  if (onLevel) {
    const c = audioCtx();
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    c.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      onLevel(Math.sqrt(sum / buf.length));
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  mr.start();
  return {
    get recording() { return mr.state === "recording"; },
    stop: () =>
      new Promise((resolve) => {
        mr.onstop = () => {
          cancelAnimationFrame(raf);
          stream.getTracks().forEach((t) => t.stop());
          onLevel?.(0);
          resolve(new Blob(chunks, { type: mr.mimeType || mimeType || "audio/webm" }));
        };
        mr.stop();
      }),
  };
}

// ---------------------------------------------------------------- mascots + tabs

function mountMascots(root = document) {
  $$("[data-baap]", root).forEach((el) => {
    el.innerHTML = el.dataset.baap === "chappal" ? chappal() : baapFace({ badge: el.dataset.baap === "badge" });
  });
}

const tabButtons = $$(".tabs [role=tab]");
function moveIndicator(btn, instant = false) {
  const ind = $(".tab-indicator");
  if (instant) ind.style.transition = "none";
  ind.style.width = `${btn.offsetWidth}px`;
  ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  if (instant) {
    ind.getBoundingClientRect();
    ind.style.transition = "";
  }
}
function showTab(name, instant = false) {
  if (!$(`[data-panel="${name}"]`)) name = "today";
  tabButtons.forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) moveIndicator(b, instant);
  });
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
}
tabButtons.forEach((b, i) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
  b.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabButtons[(i + (e.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length];
    showTab(next.dataset.tab, true);
    next.focus();
  });
});
window.addEventListener("resize", () => moveIndicator($(".tabs [aria-selected=true]"), true));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
$(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  showTab("today");
});

// ---------------------------------------------------------------- today: greeting + gussa-meter

function greeting() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const name = state?.child_name || "beta";
  if (mins >= 30 && mins < 300) return "Abhi tak jaag rahe ho?!";
  if (mins < 30) return `Sone ka time ho gaya, ${name}.`;
  if (mins < 11 * 60) return `Uth gaye, ${name}?`;
  if (mins < 17 * 60) return "Kaam ho raha hai ya phone?";
  if (mins < 22 * 60) return "Kal ki taiyari ho gayi?";
  return `Sone ka time ho gaya, ${name}.`;
}

function isLateNight() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 30 && mins < 300;
}

const MOOD_LABEL = { calm: "Shaant", annoyed: "Thoda gussa", furious: "Chappal ready" };
function setGussa(level) {
  level = Math.max(4, Math.min(96, level));
  const mood = level < 35 ? "calm" : level < 68 ? "annoyed" : "furious";
  $(".gauge").style.setProperty("--needle", `${-90 + level * 1.8}deg`);
  $(".hero").dataset.mood = mood;
  $("#gussaValue").textContent = MOOD_LABEL[mood];
}
function computeGussa() {
  if (!state) return;
  const now = new Date();
  const upcomingDaant = (tasksData?.events || []).filter((e) => e.daant?.needs_daant && new Date(e.end) > now).length;
  let level = state.strictness * 14 + upcomingDaant * 8 + local.get("lastWrong", 0) * 3;
  level += armed ? -12 : 18;
  if (isLateNight()) level += 35;
  setGussa(level);
}

// ---------------------------------------------------------------- today: tasks

const fmtDuration = (a, b) => {
  const m = Math.round((b - a) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
};

function playButton(text, label) {
  const btn = h("button", { class: "icon-btn", "aria-label": label, html: ICONS.play });
  btn.addEventListener("click", async () => {
    if (btn.classList.contains("is-playing")) {
      stopSpeaking();
      return;
    }
    $$(".icon-btn.is-playing").forEach((b) => {
      b.classList.remove("is-playing");
      b.innerHTML = ICONS.play;
    });
    btn.classList.add("is-playing");
    btn.innerHTML = ICONS.stop;
    try {
      await say(text, $(".hero-baap"));
    } catch (e) {
      toast(e.message, { error: true });
    } finally {
      btn.classList.remove("is-playing");
      btn.innerHTML = ICONS.play;
    }
  });
  return btn;
}

function renderTasks() {
  const list = $("#taskList");
  list.replaceChildren();
  const events = tasksData?.events || [];
  if (!events.length) {
    list.append(h("li", { class: "empty" }, "Aaj calendar khaali hai. Padhai kab karoge?"));
    return;
  }
  const now = new Date();
  events.forEach((e, i) => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    const past = end < now;
    const current = start <= now && now < end;
    const d = e.daant;
    const tag = d
      ? d.needs_daant
        ? h("span", { class: "tag tag-daant", html: `${ICONS.chappal}Daant zaroori` })
        : h("span", { class: "tag tag-ok", html: `${ICONS.check}Theek hai` })
      : null;
    list.append(
      h(
        "li",
        { class: `task${past ? " is-past" : ""}${current ? " is-now" : ""}`, style: `--i:${i}` },
        h("div", { class: "task-time" }, e.all_day ? "All day" : hhmm(start), e.all_day ? null : h("small", {}, fmtDuration(start, end))),
        h(
          "div",
          {},
          h("div", { class: "task-title" }, e.title),
          h("div", { class: "task-meta" }, tag, d?.reason || e.location || ""),
          d?.needs_daant && d.daant ? h("div", { class: "task-daant" }, `“${d.daant}”`) : null,
        ),
        d?.needs_daant && d.daant ? playButton(d.daant, `Play Papa's daant for ${e.title}`) : h("span"),
      ),
    );
  });
}

async function loadTasks(refresh = false) {
  const list = $("#taskList");
  const summary = $("#summary");
  if (!tasksData) list.replaceChildren(...[0, 1, 2].map(() => h("li", { class: "skeleton" })));
  summary.classList.add("is-loading");
  try {
    tasksData = await postJSON("/api/tasks", { settings: settings(), refresh });
  } catch (e) {
    summary.classList.remove("is-loading");
    summary.textContent = e.message;
    list.replaceChildren(h("li", { class: "empty" }, "Calendar nahi khula. Settings mein link check karo."));
    return;
  }
  summary.classList.remove("is-loading");
  $("#sourceChip").textContent = tasksData.source === "google" ? "Google Calendar" : "Demo calendar";
  summary.textContent =
    tasksData.summary ||
    (tasksData.error ? "Papa needs the Sarvam key before he can judge your day." : "Hmm. Dekhte hain aaj kya karte ho.");
  $("#playSummary").disabled = !tasksData.summary;
  renderTasks();
  computeGussa();
}

$("#playSummary").addEventListener("click", async () => {
  try {
    await say(tasksData.summary, $(".hero-baap"));
  } catch (e) {
    toast(e.message, { error: true });
  }
});
$("#refreshTasks").addEventListener("click", () => loadTasks(true));

// ---------------------------------------------------------------- alarm

let armed = local.get("armed", false);
let wakeLock = null;

async function keepAwake() {
  if (!armed || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", keepAwake);

function nextRing() {
  const t = todayAt(state.wake_time);
  if (t <= new Date() || local.get("lastRing") === dateKey()) t.setDate(t.getDate() + 1);
  return t;
}

function streakText() {
  const s = local.get("streak", { count: 0 });
  return s.count ? ` Streak: ${s.count} din.` : "";
}

function updateAlarmUI() {
  if (!state) return;
  $("#alarmTime").textContent = state.wake_time;
  $("#alarmCard").classList.toggle("is-armed", armed);
  $("#armToggle").checked = armed;
  if (armed) {
    const mins = Math.max(1, Math.round((nextRing() - new Date()) / 60000));
    const left = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    $("#alarmStatus").textContent = `Rings in ${left}. Papa is waiting.${streakText()}`;
  } else {
    $("#alarmStatus").textContent = "Off. Papa can't call if you don't let him.";
  }
}

$("#armToggle").addEventListener("change", async (e) => {
  armed = e.target.checked;
  local.set("armed", armed);
  if (armed) {
    audioCtx(); // unlock audio while we still have a user gesture
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    keepAwake();
    toast(`Done. ${state.dad_title} will call at ${state.wake_time}.`);
  } else {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    toast("Alarm off. Papa has been informed.");
  }
  updateAlarmUI();
  computeGussa();
});

$("#testCall").addEventListener("click", () => {
  audioCtx();
  startCall({ test: true });
});

function nag(e) {
  const text = e.daant.daant;
  toast(`${state.dad_title}: ${text}`, { ms: 8000 });
  notify(`${state.dad_title}: ${e.title}`, text);
  say(text, $(".hero-baap")).catch(() => {});
}

function tick() {
  if (!state) return;
  const now = new Date();
  const wake = todayAt(state.wake_time);
  if (armed && !callActive && local.get("lastRing") !== dateKey() && now >= wake && now - wake < 30 * 60000) {
    local.set("lastRing", dateKey());
    startCall({ test: false });
  }
  if (armed && !callActive && tasksData) {
    for (const e of tasksData.events) {
      if (!e.daant?.needs_daant || !e.daant.daant) continue;
      const diff = new Date(e.start) - now;
      const key = `nag:${dateKey()}:${e.id}`;
      if (diff <= 10 * 60000 && diff > -5 * 60000 && !local.get(key)) {
        local.set(key, true);
        nag(e);
        break;
      }
    }
  }
  const night = isLateNight();
  $("#nightBanner").hidden = !night;
  if (night) {
    $("#nightBanner .night-text").textContent =
      `Raat ke ${hhmm(now)} baj rahe hain. Phone rakho, so jao. Subah ${state.wake_time} baje ${state.dad_title} ka call aayega.`;
  }
  $("#greeting").textContent = greeting();
  updateAlarmUI();
}

$("#nightPlay").addEventListener("click", () => say(line("night"), $(".hero-baap")).catch((e) => toast(e.message, { error: true })));

// ---------------------------------------------------------------- the call

const call = $("#call");
let callActive = false;
let isTest = false;
let token = null;
let callStart = null;
let callTimer = 0;
let callStartedAt = 0;
let wrongCount = 0;
let callFailed = false;
let declines = 0;

// Ringtone: the classic two-tone trill, synthesised so there's no asset to load.
let ringTimer = 0;
let ringCount = 0;
function ringBurst() {
  const c = audioCtx();
  const out = c.createGain();
  out.gain.value = Math.min(0.08 + ringCount * 0.025, 0.4); // gets louder the longer you ignore him
  out.connect(c.destination);
  const t0 = c.currentTime + 0.02;
  for (const start of [0, 0.6]) {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    for (let k = 0; k < 10; k++) {
      g.gain.setValueAtTime(1, t0 + start + k * 0.04);
      g.gain.setValueAtTime(0.12, t0 + start + k * 0.04 + 0.02);
    }
    g.gain.setValueAtTime(0, t0 + start + 0.4);
    g.connect(out);
    for (const f of [440, 480]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(t0 + start);
      o.stop(t0 + start + 0.45);
    }
  }
  ringCount++;
}
function startRinging() {
  ringCount = 0;
  ringBurst();
  ringTimer = setInterval(() => {
    ringBurst();
    navigator.vibrate?.([400, 200, 400]);
    if (ringCount % 4 === 0) say(line("wake"), $(".call-face")).catch(() => {});
  }, 2600);
  navigator.vibrate?.([400, 200, 400]);
}
function stopRinging() {
  clearInterval(ringTimer);
  ringTimer = 0;
  navigator.vibrate?.(0);
  stopSpeaking();
}

function setCallState(s) {
  call.dataset.state = s;
}

function renderDots(needed, score = 0) {
  $("#scoreNeed").textContent = needed;
  $("#scoreNum").textContent = score;
  $("#dots").replaceChildren(...Array.from({ length: needed }, (_, i) => h("li", { class: i < score ? "is-done" : null })));
}

function setInputs(enabled) {
  $("#micBtn").disabled = !enabled;
  $("#typeInput").disabled = !enabled;
  $("#typeForm button").disabled = !enabled;
}

async function swapText(el, text) {
  el.classList.add("is-swapping");
  await wait(180);
  el.textContent = text;
  el.classList.remove("is-swapping");
}

async function papaSays(label, text) {
  $("#qLabel").textContent = label;
  await swapText($("#qText"), text);
  try {
    await say(text, $(".live-face"));
  } catch {
    await wait(Math.min(4000, 800 + text.length * 40)); // no audio: give them time to read
  }
}

function startCall({ test }) {
  if (callActive) return;
  callActive = true;
  isTest = test;
  callFailed = false;
  wrongCount = 0;
  declines = 0;
  token = null;
  $("#callName").textContent = state.dad_title;
  $("#liveName").textContent = state.dad_title;
  $("#ringLine").textContent = test ? "calling… (test call)" : "calling…";
  call.dataset.mood = "furious";
  setCallState("ringing");
  resetSlider();
  call.hidden = false;
  call.classList.add("is-entering");
  requestAnimationFrame(() => requestAnimationFrame(() => call.classList.remove("is-entering")));
  startRinging();
  notify(`${state.dad_title} calling…`, "Uth jao. Abhi.");

  // Fetch the questions while it rings, so answering feels instant.
  callStart = postJSON("/api/call/start", { settings: settings() });
  callStart.then((d) => [d.intro, d.question.q].forEach((t) => fetchSpeech(t).catch(() => {}))).catch(() => {});
  setTimeout(() => $("#sliderKnob").focus({ preventScroll: true }), 300);
}

async function answerCall() {
  stopRinging();
  setCallState("live");
  renderDots(10);
  setInputs(false);
  $("#youSaid").textContent = "";
  $("#youSaid").className = "you-said";
  $("#qLabel").textContent = "Connecting…";
  $("#qText").textContent = "";
  callStartedAt = Date.now();
  clearInterval(callTimer);
  callTimer = setInterval(() => ($("#liveTimer").textContent = mmss((Date.now() - callStartedAt) / 1000)), 1000);

  let d;
  try {
    d = await callStart;
  } catch (e) {
    callFailed = true;
    $("#qLabel").textContent = "Network issue";
    $("#qText").textContent = `Papa's line dropped: ${e.message}`;
    return;
  }
  token = d.token;
  renderDots(d.needed);
  await papaSays(state.dad_title, d.intro);
  await askQuestion(d.question);
}

async function askQuestion(q) {
  $("#youSaid").textContent = "";
  $("#youSaid").className = "you-said";
  $("#micHint").textContent = "Papa is asking…";
  $("#typeInput").disabled = false;
  $("#typeForm button").disabled = false;
  $("#typeInput").value = "";
  await papaSays(`Sawaal ${q.index + 1}`, q.q);
  setInputs(true);
  $("#micHint").textContent = "Tap to answer, tap again to send";
}

async function submitAnswer(form) {
  setInputs(false);
  $("#micHint").textContent = "Papa is listening…";
  let r;
  try {
    form.append("token", token);
    form.append("settings", JSON.stringify(settings()));
    r = await api("/api/call/answer", { method: "POST", body: form });
  } catch (e) {
    toast(e.message, { error: true });
    setInputs(true);
    $("#micHint").textContent = "Try again";
    return;
  }
  const said = $("#youSaid");
  said.textContent = r.transcript ? `You said “${r.transcript}”` : "Papa didn't hear anything.";
  said.className = `you-said ${r.correct ? "is-right" : "is-wrong"}`;
  $("#scoreNum").textContent = r.score;
  $$("#dots li").forEach((li, i) => li.classList.toggle("is-done", i < r.score));
  if (r.correct) {
    navigator.vibrate?.(25);
    call.dataset.mood = "annoyed";
  } else {
    wrongCount++;
    navigator.vibrate?.([60, 40, 60]);
    call.dataset.mood = "furious";
  }
  if (r.token) token = r.token;
  if (r.question) fetchSpeech(r.question.q).catch(() => {});
  if (r.done) fetchSpeech(r.outro).catch(() => {});
  await papaSays(r.correct ? "Sahi" : `Galat · answer: ${r.answer}`, r.reaction);
  if (r.done) finishCall(r.outro);
  else await askQuestion(r.question);
}

function finishCall(outro) {
  setInputs(false);
  clearInterval(callTimer);
  call.dataset.mood = "proud";
  $("#outroText").textContent = outro;
  $("#doneMeta").textContent = `Call ended · ${mmss((Date.now() - callStartedAt) / 1000)} · ${wrongCount} galat`;
  setCallState("done");
  local.set("lastWrong", wrongCount);
  if (!isTest) {
    const s = local.get("streak", { count: 0, last: null });
    const y = new Date();
    y.setDate(y.getDate() - 1);
    local.set("streak", { count: s.last === dateKey(y) ? s.count + 1 : 1, last: dateKey() });
  }
  token = null;
  say(outro, $(".done-face")).catch(() => {});
}

function closeCall() {
  stopRinging();
  stopSpeaking();
  if (mic?.recording) mic.stop();
  mic = null;
  clearInterval(callTimer);
  callActive = false;
  token = null;
  call.classList.add("is-entering");
  setTimeout(() => {
    call.hidden = true;
    call.classList.remove("is-entering");
  }, 260);
  computeGussa();
  updateAlarmUI();
}

const DECLINE_LINES = ["Phone kaatoge? Papa ka?", "Decline button sirf dikhane ke liye hai.", "Himmat dekho iski!"];
$("#declineBtn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (isTest && declines >= 2) {
    toast("Test tha, isliye chhod diya. Kal nahi chhodenge.");
    closeCall();
    return;
  }
  $("#ringLine").textContent = DECLINE_LINES[declines % DECLINE_LINES.length];
  declines++;
  ringCount += 4;
  btn.classList.remove("is-denied");
  btn.getBoundingClientRect();
  btn.classList.add("is-denied");
  navigator.vibrate?.([80, 50, 80]);
});

$("#endCall").addEventListener("click", () => {
  if (isTest || callFailed) return closeCall();
  toast("10 sahi jawab first. Then the call ends.", { error: true });
});
$("#doneBtn").addEventListener("click", closeCall);

// Mic answer
let mic = null;
$("#micBtn").addEventListener("click", async () => {
  const btn = $("#micBtn");
  if (mic?.recording) {
    clearTimeout(mic.autoStop);
    const blob = await mic.stop();
    mic = null;
    btn.classList.remove("is-recording");
    btn.setAttribute("aria-label", "Start answering");
    const form = new FormData();
    form.append("audio", blob, `answer.${extFor(blob.type)}`);
    submitAnswer(form);
    return;
  }
  stopSpeaking();
  try {
    mic = await startRecorder({
      onLevel: (v) => ($("#micLevel").style.transform = `scale(${1 + Math.min(v * 4, 0.6)})`),
    });
  } catch {
    toast("Mic permission chahiye. Or type the answer.", { error: true });
    return;
  }
  btn.classList.add("is-recording");
  btn.setAttribute("aria-label", "Send answer");
  $("#micHint").textContent = "Bolo… tap again to send";
  mic.autoStop = setTimeout(() => mic?.recording && btn.click(), 8000);
});

$("#typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#typeInput").value.trim();
  if (!text || !token) return;
  const form = new FormData();
  form.append("text", text);
  submitAnswer(form);
});

// Slide to answer: 1:1 tracking, rubber-band edges, momentum projection, spring settle.
const slider = $("#slider");
const knob = $("#sliderKnob");
const sliderLabel = $(".slider-label");
let knobX = 0;
let springRaf = 0;
const maxX = () => slider.clientWidth - knob.offsetWidth - 12;
const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
// 0.99 rather than scroll's 0.998: the track is short, so a nudge shouldn't throw it all the way.
const project = (v, d = 0.99) => ((v / 1000) * d) / (1 - d);

function renderKnob() {
  knob.style.transform = `translateX(${knobX}px)`;
  sliderLabel.style.opacity = String(Math.max(0, 1 - knobX / (maxX() * 0.55)));
}
function resetSlider() {
  cancelAnimationFrame(springRaf);
  knobX = 0;
  renderKnob();
}
// Apple-style spring params: damping ratio + response (seconds).
function springTo(target, velocity, { damping = 1, response = 0.35, done } = {}) {
  cancelAnimationFrame(springRaf);
  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  let v = velocity;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    v += (-k * (knobX - target) - c * v) * dt;
    knobX += v * dt;
    if (Math.abs(v) < 4 && Math.abs(knobX - target) < 0.5) {
      knobX = target;
      renderKnob();
      done?.();
      return;
    }
    renderKnob();
    springRaf = requestAnimationFrame(step);
  };
  springRaf = requestAnimationFrame(step);
}

let drag = null;
knob.addEventListener("pointerdown", (e) => {
  if (call.dataset.state !== "ringing" || drag) return;
  cancelAnimationFrame(springRaf); // grab it mid-flight, from where it actually is
  knob.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, grab: e.clientX - knobX, hist: [{ x: knobX, t: performance.now() }] };
});
knob.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const m = maxX();
  let x = e.clientX - drag.grab;
  if (x < 0) x = -rubberband(-x, m);
  else if (x > m) x = m + rubberband(x - m, m);
  knobX = x;
  renderKnob();
  drag.hist.push({ x, t: performance.now() });
  if (drag.hist.length > 6) drag.hist.shift();
});
function release(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { hist } = drag;
  drag = null;
  const a = hist[0];
  const b = hist[hist.length - 1];
  const velocity = ((b.x - a.x) / Math.max(1, b.t - a.t)) * 1000;
  const m = maxX();
  if (knobX + project(velocity) >= m * 0.75) {
    springTo(m, velocity, { done: answerCall });
  } else {
    springTo(0, velocity, { damping: Math.abs(velocity) > 300 ? 0.8 : 1 });
  }
}
knob.addEventListener("pointerup", release);
knob.addEventListener("pointercancel", release);
knob.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (call.dataset.state === "ringing") springTo(maxX(), 0, { done: answerCall });
  }
});

// ---------------------------------------------------------------- voice cloning

function renderVoiceStatus() {
  const el = $("#voiceStatus");
  el.classList.toggle("is-cloned", state.voice_id);
  const text = state.voice_id
    ? `Using ${state.dad_title}'s cloned voice`
    : "Using a stock Sarvam voice until you clone Papa";
  const preview = h("button", { class: "btn btn-small", type: "button" }, "Preview");
  preview.addEventListener("click", () =>
    say(line("preview"), $(".voice-avatar")).catch((e) => toast(e.message, { error: true })),
  );
  const actions = h("div", { class: "row" }, preview);
  if (state.voice_id) {
    const remove = h("button", { class: "btn btn-small", type: "button" }, "Remove voice");
    remove.addEventListener("click", async () => {
      try {
        await postJSON("/api/voice/delete", { voice_id: state.voice_id });
        saveSettings({ voice_id: null });
        $("#settingsForm").elements.voice_id.value = "";
        clearSpeechCache();
        renderVoiceStatus();
        toast("Voice deleted from Sarvam.");
      } catch (e) {
        toast(e.message, { error: true });
      }
    });
    actions.append(remove);
  }
  el.replaceChildren(h("span", { class: "state" }, h("span", { class: "dot" }), text), actions);
}

function setConsent(on) {
  $("#recordBtn").disabled = !on;
  $("#voiceFile").disabled = !on;
  $("#dropZone").classList.toggle("is-disabled", !on);
}
$("#consent").addEventListener("change", (e) => setConsent(e.target.checked));

async function uploadVoice(blob, filename) {
  const card = $(".voice");
  card.classList.add("is-busy");
  toast("Cloning Papa's voice… this takes a few seconds.", { ms: 10000 });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("consent", "true");
  form.append("settings", JSON.stringify(settings()));
  try {
    const { voice_id } = await api("/api/voice", { method: "POST", body: form });
    saveSettings({ voice_id });
    $("#settingsForm").elements.voice_id.value = voice_id;
    clearSpeechCache();
    renderVoiceStatus();
    toast("Papa ki awaaz ready. Ab bachke rehna.");
    say(line("preview"), $(".voice-avatar")).catch(() => {});
  } catch (e) {
    toast(e.message, { error: true, ms: 6000 });
  } finally {
    card.classList.remove("is-busy");
  }
}

let voiceRec = null;
let recTick = 0;
$("#recordBtn").addEventListener("click", async () => {
  const btn = $("#recordBtn");
  if (voiceRec?.recording) {
    clearInterval(recTick);
    const secs = (Date.now() - voiceRec.started) / 1000;
    const blob = await voiceRec.stop();
    voiceRec = null;
    btn.classList.remove("is-recording");
    $(".rec-label", btn).textContent = "Start recording";
    $("#recTimer").textContent = "";
    if (secs < 10) {
      toast("Too short. Get at least 15 seconds of Papa.", { error: true });
      return;
    }
    uploadVoice(blob, `papa.${extFor(blob.type)}`);
    return;
  }
  try {
    voiceRec = await startRecorder({ clean: false }); // keep his natural voice, unprocessed
  } catch {
    toast("Mic permission denied. Upload a voice note instead.", { error: true });
    return;
  }
  voiceRec.started = Date.now();
  btn.classList.add("is-recording");
  $(".rec-label", btn).textContent = "Stop & clone";
  recTick = setInterval(() => {
    const s = (Date.now() - voiceRec.started) / 1000;
    $("#recTimer").textContent = `${mmss(s)}${s < 15 ? " · keep going" : " · good"}`;
    if (s >= 40) btn.click();
  }, 250);
});

$("#voiceFile").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) uploadVoice(file, file.name);
  e.target.value = "";
});
const drop = $("#dropZone");
["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    if (!$("#voiceFile").disabled) drop.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  if ($("#voiceFile").disabled) return toast("Tick the consent box first.", { error: true });
  const file = e.dataTransfer.files?.[0];
  if (file) uploadVoice(file, file.name);
});

async function loadVoiceScript() {
  try {
    $("#voiceScript").textContent = (await api(`/api/voice/script?language=${encodeURIComponent(state.language)}`)).script;
  } catch {}
}

// ---------------------------------------------------------------- settings

const form = $("#settingsForm");
function fillSettings() {
  const sel = $("#languageSelect");
  sel.replaceChildren(...state.languages.map((code) => h("option", { value: code }, LANG_LABELS[code] || code)));
  for (const name of ["child_name", "dad_title", "language", "wake_time", "breakfast_close", "ics_url", "voice_id"]) {
    form.elements[name].value = state[name] ?? "";
  }
  $$('input[name="strictness"]', form).forEach((r) => (r.checked = Number(r.value) === state.strictness));
}

form.elements.ics_url.addEventListener("input", (e) => {
  e.target.removeAttribute("aria-invalid");
  $("#icsError").textContent = "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.strictness = Number(data.strictness || state.strictness);
  data.ics_url = data.ics_url.trim();
  if (data.ics_url && !/^(https|webcal):\/\//.test(data.ics_url)) {
    form.elements.ics_url.setAttribute("aria-invalid", "true");
    $("#icsError").textContent = "That should start with https:// (the secret iCal address).";
    form.elements.ics_url.focus();
    return;
  }
  const langChanged = data.language !== state.language;
  const voiceChanged = (data.voice_id || null) !== (state.voice_id || null);
  data.voice_id = data.voice_id.trim() || null;
  saveSettings(data);
  if (langChanged || voiceChanged) {
    clearSpeechCache();
    loadVoiceScript();
  }
  applyState();
  toast("Saved. Papa has noted it down.");
  loadTasks();
});

// ---------------------------------------------------------------- password gate

let passGate;
let gatePassed = new Promise((r) => (passGate = r));
function showGate(error = "") {
  const gate = $("#gate");
  gate.hidden = false;
  $("#gateError").textContent = error;
  setTimeout(() => $("#gateInput").focus(), 50);
}
$("#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#gateInput").value;
  if (!pw) return;
  local.set("pw", pw);
  try {
    await api("/api/auth", { method: "POST" });
  } catch {
    local.set("pw", "");
    $("#gateInput").select();
    return;
  }
  $("#gate").hidden = true;
  passGate();
  gatePassed = new Promise((r) => (passGate = r));
});

// ---------------------------------------------------------------- boot

function applyState() {
  $("#keyBanner").hidden = state.key_configured;
  renderVoiceStatus();
  updateAlarmUI();
  $("#greeting").textContent = greeting();
  computeGussa();
}

async function init() {
  mountMascots();
  showTab(location.hash.slice(1) || "today", true);
  document.fonts?.ready.then(() => moveIndicator($(".tabs [aria-selected=true]"), true));
  $("#todayDate").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  try {
    const info = await api("/api/state");
    state = { ...info.defaults, ...local.get("settings", {}), ...info };
    delete state.defaults;
    state.languages = info.languages;
  } catch {
    toast("Can't reach the server.", { error: true, ms: 8000 });
    return;
  }
  if (state.auth_required && !local.get("pw", "")) {
    showGate();
    await gatePassed;
  }
  fillSettings();
  applyState();
  loadTasks();
  loadVoiceScript();
  tick();
  setInterval(tick, 15000);
  if (armed) keepAwake();
}

init();
