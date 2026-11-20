import { firebaseConfig } from "./firebase-config.js";
import { createLocalBackend } from "./backend-local.js";
import { Tree } from "./tree.js";
import { Tree3D, supportsWebGL2 } from "./tree3d.js";
import { ShakeDetector } from "./shake.js";

// ---------- Game settings ----------
const ORNAMENTS = 40;          // decorations per tree (the star is the last one)
const COUNTDOWN_MS = 3800;     // 3, 2, 1, go
const TIME_LIMIT_MS = 90_000;  // round ends for everyone after this
const HOST_GRACE_MS = 60_000;  // how long the host can be away before someone else takes over

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const VIEWS = ["home", "lobby", "game", "wait", "results"];
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O

const fmt = (ms) => (ms / 1000).toFixed(2) + "s";
const randomCode = () => Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
const cleanCode = (s) => (s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
const inviteUrl = (code) => `${location.origin}${location.pathname}?room=${code}${backend?.kind === "local" ? "&local" : ""}`;

function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  document.body.dataset.view = view;
}

// ---------- State ----------
let backend = null;
let code = null;            // current room code
let room = null;            // latest room snapshot
let unwatch = null;
let motionReady = false;    // this device has granted motion access
let tapMode = false;        // player chose Tap instead of Shake
let game = null;            // { round, tree, removed, finished, lastSent }
let hostOfflineSince = 0;
let wakeLock = null;
let qrFor = null;
let celebratedRound = null;

const TAP_COOLDOWN_MS = 150; // keeps tapping roughly as fast as a good shaker, no faster
let lastTap = 0;
const looksLikePhone = () => matchMedia("(pointer: coarse)").matches && "DeviceMotionEvent" in window;
const me = () => room?.players?.[backend.uid];
const isHost = () => room?.hostId === backend.uid;
const isParticipant = () => !!room?.participants?.[backend.uid];
const roomPath = (p = "") => `rooms/${code}${p ? "/" + p : ""}`;

// ---------- Sound ----------
let audio = null;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch { /* no audio */ }
}
const NOTES = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
function ding(big = false) {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = "triangle";
  o.frequency.value = big ? 2093 : NOTES[Math.floor(Math.random() * NOTES.length)];
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(big ? 0.25 : 0.08, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.9 : 0.25));
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + 1);
}

// ---------- Shaking ----------
const detector = new ShakeDetector(onShake);

function onShake(power, dir) {
  if (document.body.dataset.view === "lobby") {
    const bell = $("shake-bell");
    bell.classList.remove("ring");
    void bell.offsetWidth;
    bell.classList.add("ring");
    return;
  }
  if (!game || game.finished || !room || room.status !== "playing") return;
  const now = backend.serverNow();
  if (now < room.startAt || now > room.endsAt) return;

  const n = game.tree.knock(power, dir);
  if (!n) return;
  game.removed += n;
  ding(game.tree.remaining === 0);
  navigator.vibrate?.(game.tree.remaining === 0 ? [60, 40, 120] : 12);
  $("hud-left").textContent = game.tree.remaining;
  $("shake-hint").hidden = true;

  if (game.tree.remaining === 0) {
    game.finished = true;
    const finishMs = now - room.startAt;
    game.finishMs = finishMs;
    backend.update(roomPath(`players/${backend.uid}`), { progress: ORNAMENTS, finishMs });
    setTimeout(render, 700); // let the star fly first
  } else if (now - game.lastSent > 400) {
    game.lastSent = now;
    backend.update(roomPath(`players/${backend.uid}`), { progress: game.removed });
  }
}

// Tap mode: click/tap anywhere on the game screen, or press space.
function tapShake() {
  const t = performance.now();
  if (t - lastTap < TAP_COOLDOWN_MS) return;
  lastTap = t;
  onShake(1, Math.random() < 0.5 ? -1 : 1);
}
$("view-game").addEventListener("pointerdown", () => { if (tapMode) tapShake(); });
window.addEventListener("keydown", (e) => {
  if (tapMode && e.code === "Space") { e.preventDefault(); if (!e.repeat) tapShake(); }
});

/** Player picked how to play: "shake" (motion sensor) or "tap" (click/tap). */
async function chooseMode(mode) {
  $("ready-error").textContent = "";
  unlockAudio();
  if (mode === "shake") {
    const perm = await detector.requestPermission();
    let ok = false;
    if (perm === "granted") {
      detector.start();
      ok = await detector.waitForSensor(1500);
    }
    if (!ok) {
      $("ready-error").textContent =
        perm === "denied"
          ? "Motion access was blocked. Choose Tap, or reload the page and tap Allow when asked."
          : "No motion sensor found on this device. Choose Tap instead.";
      if (document.body.dataset.view === "wait") $("wait-sub").textContent = $("ready-error").textContent;
      return;
    }
    tapMode = false;
  } else {
    detector.stop();
    tapMode = true;
  }
  motionReady = true;
  await backend.update(roomPath(`players/${backend.uid}`), { ready: true, tap: tapMode || null });
  render();
}

async function changeMode() {
  motionReady = false;
  await backend.update(roomPath(`players/${backend.uid}`), { ready: false });
  render();
}

async function keepAwake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported */ }
}

// ---------- Rooms ----------
function playerRecord(name) {
  return { name, online: true, ready: false, joinedAt: backend.serverNow() };
}

async function createRoom() {
  const name = readName();
  if (!name) return;
  setBusy(true);
  try {
    for (let i = 0; i < 8; i++) {
      const c = randomCode();
      const ok = await backend.createIfAbsent(`rooms/${c}`, {
        hostId: backend.uid,
        status: "lobby",
        round: 0,
        createdAt: backend.serverNow(),
        players: { [backend.uid]: playerRecord(name) },
      });
      if (ok) return enterRoom(c);
    }
    homeError("Couldn't create a room. Try again.");
  } catch (err) {
    console.error(err);
    homeError("Couldn't create a room. Check your connection.");
  } finally {
    setBusy(false);
  }
}

async function joinRoom(c) {
  const name = readName();
  if (!name) return;
  c = cleanCode(c);
  if (c.length !== 4) return homeError("Room codes are 4 letters.");
  setBusy(true);
  try {
    const host = await backend.get(`rooms/${c}/hostId`);
    if (!host) {
      setInviteMode(null); // let them create their own room instead
      return homeError(`Room ${c} doesn't exist any more. Create a new one, or check the code.`);
    }
    const existing = await backend.get(`rooms/${c}/players/${backend.uid}`);
    await backend.update(`rooms/${c}/players/${backend.uid}`, existing
      ? { name, online: true, ready: false }
      : playerRecord(name));
    enterRoom(c);
  } catch (err) {
    console.error(err);
    homeError("Couldn't join that room. Check your connection.");
  } finally {
    setBusy(false);
  }
}

function enterRoom(c) {
  code = c;
  motionReady = false;
  history.replaceState(null, "", `?room=${c}${backend.kind === "local" ? "&local" : ""}`);
  backend.onDisconnectSet(roomPath(`players/${backend.uid}/online`), false);
  unwatch?.();
  unwatch = backend.watch(roomPath(), (r) => { room = r; render(); });
}

async function leaveRoom() {
  if (!code) return;
  const c = code;
  unwatch?.();
  unwatch = null;
  await backend.cancelOnDisconnect(roomPath(`players/${backend.uid}/online`));
  await backend.set(`rooms/${c}/players/${backend.uid}`, null);
  code = null;
  room = null;
  endGame();
  history.replaceState(null, "", location.pathname + (backend.kind === "local" && params.has("local") ? "?local" : ""));
  setInviteMode(null);
  show("home");
}

async function startGame() {
  if (!isHost()) return;
  const ready = Object.entries(room.players || {}).filter(([, p]) => p.online);
  if (!ready.length) return;
  const startAt = backend.serverNow() + COUNTDOWN_MS;
  const updates = {
    status: "playing",
    round: (room.round || 0) + 1,
    seed: Math.floor(Math.random() * 1e9),
    startAt,
    endsAt: startAt + TIME_LIMIT_MS,
    participants: Object.fromEntries(ready.map(([id, p]) => [id, p.name])),
  };
  for (const id of Object.keys(room.players)) {
    updates[`players/${id}/progress`] = null;
    updates[`players/${id}/finishMs`] = null;
  }
  await backend.update(roomPath(), updates);
}

async function playAgain() {
  if (!isHost()) return;
  await backend.update(roomPath(), { status: "lobby", participants: null, startAt: null, endsAt: null });
}

// ---------- Game lifecycle ----------
function ensureGame() {
  if (game && game.round === room.round) return;
  endGame();
  const opts = { count: ORNAMENTS, seed: room.seed || 1 };
  let tree;
  try {
    tree = supportsWebGL2() && !params.has("flat") ? new Tree3D($("tree-stage"), opts) : new Tree($("tree-stage"), opts);
  } catch (err) {
    console.warn("3D tree unavailable, using flat tree", err);
    tree = new Tree($("tree-stage"), opts);
  }
  const already = me()?.progress || 0; // resuming after a reload
  tree.removeInstantly(already);
  game = {
    round: room.round,
    tree,
    removed: already,
    finished: !!me()?.finishMs,
    finishMs: me()?.finishMs || null,
    lastSent: 0,
  };
  $("hud-left").textContent = tree.remaining;
  $("shake-hint").hidden = false;
  $("shake-hint").textContent = tapMode ? "TAP!" : "SHAKE!";
  if (!tapMode) detector.start();
  keepAwake(true);
}

function endGame() {
  game?.tree.destroy();
  game = null;
  keepAwake(false);
}

// ---------- Rendering ----------
function render() {
  if (!code) return show("home");
  if (!room) {
    const c = code;
    code = null;
    unwatch?.();
    show("home");
    homeError(`Room ${c} has closed.`);
    return;
  }
  if (!me()) return; // our join write hasn't landed yet

  maybeTakeOverHost();

  if (room.status === "lobby") {
    if (game) endGame();
    return renderLobby();
  }
  if (room.status === "results") return renderResults();

  // playing
  if (!isParticipant()) {
    showWait("⏳", "Round in progress", "", "You'll join in the next round.");
    return;
  }
  ensureGame();
  const now = backend.serverNow();
  if (!motionReady && !game.finished && now < room.endsAt) {
    // Didn't pick Shake or Tap before the start (or reloaded mid-round).
    showWait("🎄", "How will you play?", "", "Quick, the game is starting! Shake needs a phone; Tap works anywhere.");
    $("wait-choices").hidden = false;
    $("wait-shake").classList.toggle("primary", looksLikePhone());
    $("wait-tap").classList.toggle("primary", !looksLikePhone());
    return;
  }
  if (game.finished) {
    const done = Object.keys(room.participants).filter((id) => room.players?.[id]?.finishMs).length;
    const total = Object.keys(room.participants).length;
    showWait("🎄", "Tree cleared!", fmt(game.finishMs), total > 1 ? `Waiting for others… ${done} of ${total} done` : "");
  } else if (now > room.endsAt) {
    const pct = Math.round((game.removed / ORNAMENTS) * 100);
    showWait("⏰", "Time's up!", "", `You cleared ${pct}% of your tree.`);
  } else {
    $("shake-hint").textContent = tapMode ? "TAP!" : "SHAKE!";
    show("game");
  }
}

function showWait(emoji, title, time, sub) {
  $("wait-choices").hidden = true;
  $("wait-emoji").textContent = emoji;
  $("wait-title").textContent = title;
  $("wait-time").textContent = time;
  $("wait-sub").textContent = sub;
  show("wait");
}

function renderLobby() {
  show("lobby");
  $("room-code").textContent = code;
  renderQr();

  $("ready-box").hidden = motionReady;
  $("ready-ok").hidden = !motionReady;
  const phone = looksLikePhone();
  $("mode-shake").classList.toggle("recommended", phone);
  $("mode-tap").classList.toggle("recommended", !phone);
  document.querySelector('[data-rec="phone"]').hidden = !phone;
  document.querySelector('[data-rec="computer"]').hidden = phone;
  $("shake-bell").textContent = tapMode ? "🖱️" : "🔔";
  $("ready-ok-sub").textContent = tapMode
    ? "You'll click or tap the tree. Give it a test click here."
    : "Give it a test shake: the bell rings.";

  const players = Object.entries(room.players || {})
    .filter(([, p]) => p.online)
    .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
  $("player-count").textContent = players.length;
  const list = $("player-list");
  list.innerHTML = "";
  for (const [id, p] of players) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = (id === room.hostId ? "👑 " : "") + p.name;
    if (id === backend.uid) { name.classList.add("me"); name.textContent += " (you)"; }
    const tag = document.createElement("span");
    tag.className = "tag" + (p.ready ? " ok" : "");
    tag.textContent = p.ready ? (p.tap ? "ready · 🖱️ tap" : "ready · 📱 shake") : "choosing…";
    li.append(name, tag);
    list.appendChild(li);
  }

  $("start-btn").hidden = !isHost();
  $("start-btn").disabled = players.length === 0;
  $("start-btn").textContent = `Start game · ${players.length} player${players.length === 1 ? "" : "s"}`;
  $("lobby-wait").hidden = false;
  $("lobby-wait").textContent = isHost()
    ? "Tap Start once everyone has joined."
    : "Waiting for the host to start…";
}

function renderQr() {
  if (qrFor === code) return;
  const box = $("qr");
  if (!window.qrcode) {
    box.innerHTML = "";
    window.addEventListener("load", () => { qrFor = null; if (room?.status === "lobby") renderQr(); }, { once: true });
    return;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(inviteUrl(code));
  qr.make();
  box.innerHTML = qr.createImgTag(5, 0, "QR code to join");
  qrFor = code;
}

function standings() {
  const ids = Object.keys(room.participants || {});
  const rows = ids.map((id) => {
    const p = room.players?.[id] || {};
    const savedName = typeof room.participants[id] === "string" ? room.participants[id] : "Someone";
    return { id, name: p.name || savedName, finishMs: p.finishMs || null, progress: p.progress || 0, tap: !!p.tap };
  });
  const done = rows.filter((r) => r.finishMs).sort((a, b) => a.finishMs - b.finishMs);
  const dnf = rows.filter((r) => !r.finishMs).sort((a, b) => b.progress - a.progress);
  return { done, dnf };
}

function renderResults() {
  if (document.body.dataset.view !== "results") {
    // Avoid accidental taps on the buttons while people are still mid-shake.
    for (const id of ["again-btn", "leave-btn-2"]) {
      $(id).disabled = true;
      setTimeout(() => ($(id).disabled = false), 1500);
    }
  }
  show("results");
  keepAwake(false);
  const { done, dnf } = standings();

  const podium = $("podium");
  podium.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉"];
  for (let i = 0; i < 3; i++) {
    const r = done[i];
    const step = document.createElement("div");
    step.className = `step p${i + 1}` + (r ? "" : " empty");
    if (r) {
      const crown = document.createElement("div");
      crown.className = "crown";
      crown.textContent = medals[i];
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = r.name + (r.id === backend.uid ? " (you)" : "");
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = fmt(r.finishMs) + (r.tap ? " 🖱️" : " 📱");
      step.append(crown, who, t);
    }
    const block = document.createElement("div");
    block.className = "block";
    block.textContent = i + 1;
    step.appendChild(block);
    podium.appendChild(step);
  }

  const rest = $("rest-list");
  rest.innerHTML = "";
  const addRow = (label, name, value) => {
    const li = document.createElement("li");
    const n = document.createElement("span");
    n.textContent = `${label}  ${name}`;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = value;
    li.append(n, t);
    rest.appendChild(li);
  };
  done.slice(3).forEach((r, i) => addRow(`${i + 4}.`, r.name, fmt(r.finishMs)));
  dnf.forEach((r) => addRow("–", r.name, `${Math.round((r.progress / ORNAMENTS) * 100)}% cleared`));

  $("again-btn").hidden = !isHost();
  $("again-wait").hidden = isHost();

  if (celebratedRound !== room.round) {
    celebratedRound = room.round;
    if (done[0]?.id === backend.uid) confetti();
  }
}

function confetti() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  document.body.appendChild(layer);
  const colours = ["#ffd56b", "#e8323c", "#34c472", "#ffffff"];
  for (let i = 0; i < 70; i++) {
    const d = document.createElement("div");
    const size = 6 + Math.random() * 8;
    Object.assign(d.style, {
      position: "absolute", left: Math.random() * 100 + "vw", top: "-20px",
      width: size + "px", height: size * (Math.random() < 0.5 ? 1 : 0.5) + "px",
      background: colours[i % colours.length], borderRadius: Math.random() < 0.4 ? "50%" : "2px",
    });
    layer.appendChild(d);
    d.animate(
      [
        { transform: "translate(0,0) rotate(0)" },
        { transform: `translate(${(Math.random() - 0.5) * 200}px, 110vh) rotate(${Math.random() * 900}deg)` },
      ],
      { duration: 2200 + Math.random() * 1800, delay: Math.random() * 600, easing: "cubic-bezier(.3,.6,.6,1)", fill: "forwards" }
    );
  }
  setTimeout(() => layer.remove(), 5000);
}

// ---------- Clock tick: countdown, timer, host duties ----------
let lastCount = null;
setInterval(() => {
  if (!room || !code) return;
  const now = backend.serverNow();

  if (room.status === "playing" && game && isParticipant()) {
    const cd = $("countdown");
    if (now < room.startAt) {
      const n = Math.ceil((room.startAt - now) / 1000);
      const label = n > 3 ? "" : String(n);
      cd.hidden = !label;
      if (label && label !== lastCount) {
        cd.textContent = label;
        cd.classList.remove("pop"); void cd.offsetWidth; cd.classList.add("pop");
        ding();
      }
      lastCount = label;
      $("hud-time").textContent = "0.00s";
    } else {
      if (lastCount !== "go") {
        lastCount = "go";
        cd.hidden = true;
      }
      if (!game.finished) $("hud-time").textContent = fmt(Math.min(now - room.startAt, TIME_LIMIT_MS));
      if (!game.finished && now > room.endsAt && document.body.dataset.view === "game") render();
    }
  }

  // Host ends the round once everyone is done or time runs out.
  if (isHost() && room.status === "playing") {
    const ids = Object.keys(room.participants || {});
    const allDone = ids.every((id) => room.players?.[id]?.finishMs || room.players?.[id]?.online === false);
    if ((allDone && now > room.startAt) || now > room.endsAt + 1000) {
      backend.update(roomPath(), { status: "results" });
    }
  }

  maybeTakeOverHost();
}, 100);

function maybeTakeOverHost() {
  if (!room || isHost() || !me()?.online) return;
  const host = room.players?.[room.hostId];
  if (host?.online) { hostOfflineSince = 0; return; }
  if (!hostOfflineSince) hostOfflineSince = Date.now();
  if (Date.now() - hostOfflineSince < HOST_GRACE_MS) return;
  const next = Object.entries(room.players || {})
    .filter(([, p]) => p.online)
    .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
  if (next?.[0] === backend.uid) {
    hostOfflineSince = 0;
    backend.set(roomPath("hostId"), backend.uid).catch(() => {});
  }
}

// ---------- Home screen ----------
function readName() {
  const name = $("name-input").value.trim().slice(0, 16);
  if (!name) {
    homeError("Enter your name first.");
    $("name-input").focus();
    return null;
  }
  localStorage.setItem("bauble-shake-name", name);
  return name;
}
function homeError(msg) { $("home-error").textContent = msg; }

/** Opened from an invite link: only show name + join. */
function setInviteMode(c) {
  const on = !!c;
  $("invite-head").hidden = !on;
  $("invite-code").textContent = c || "";
  $("invite-join-btn").hidden = !on;
  $("create-btn").hidden = on;
  $("join-divider").hidden = on;
  $("join-row").hidden = on;
  document.querySelector(".tagline").hidden = on;
}
function setBusy(b) { $("create-btn").disabled = b; $("join-btn").disabled = b; }

$("create-btn").addEventListener("click", () => { homeError(""); createRoom(); });
$("join-btn").addEventListener("click", () => { homeError(""); joinRoom($("code-input").value); });
$("invite-join-btn").addEventListener("click", () => { homeError(""); joinRoom($("invite-code").textContent); });
$("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !$("invite-join-btn").hidden) $("invite-join-btn").click();
});
$("code-input").addEventListener("input", (e) => { e.target.value = cleanCode(e.target.value); });
$("code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("join-btn").click(); });
$("mode-shake").addEventListener("click", () => chooseMode("shake"));
$("mode-tap").addEventListener("click", () => chooseMode("tap"));
$("wait-shake").addEventListener("click", () => chooseMode("shake"));
$("wait-tap").addEventListener("click", () => chooseMode("tap"));
$("mode-change").addEventListener("click", changeMode);
$("ready-ok").addEventListener("pointerdown", (e) => {
  // test click in tap mode rings the bell
  if (tapMode && e.target.id !== "mode-change") onShake(1, 1);
});
$("start-btn").addEventListener("click", startGame);
$("again-btn").addEventListener("click", playAgain);
$("leave-btn").addEventListener("click", leaveRoom);
$("leave-btn-2").addEventListener("click", leaveRoom);
$("share-btn").addEventListener("click", async () => {
  const url = inviteUrl(code);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Bauble Shake", text: `Join my Bauble Shake room: ${code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      $("share-note").textContent = "Link copied!";
      setTimeout(() => ($("share-note").textContent = ""), 2500);
    }
  } catch { /* share cancelled */ }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && game && !game.finished) keepAwake(true);
});

// ---------- Boot ----------
async function boot() {
  show("home");
  $("name-input").value = localStorage.getItem("bauble-shake-name") || "";
  const roomParam = cleanCode(params.get("room"));
  if (roomParam) { $("code-input").value = roomParam; setInviteMode(roomParam); }

  const configured = firebaseConfig?.apiKey && !firebaseConfig.apiKey.startsWith("YOUR");
  const banner = $("mode-banner");
  setBusy(true);
  try {
    if (configured && !params.has("local")) {
      const { createFirebaseBackend } = await import("./backend-firebase.js");
      backend = await createFirebaseBackend(firebaseConfig);
      backend.onReconnect(() => {
        if (!code) return;
        backend.update(roomPath(`players/${backend.uid}`), { online: true });
        backend.onDisconnectSet(roomPath(`players/${backend.uid}/online`), false);
      });
    } else {
      backend = createLocalBackend();
      banner.hidden = false;
      banner.textContent = configured
        ? "Local demo mode: open more tabs on this device to add players."
        : "Local demo mode: add your Firebase config to play across phones. Open more tabs to add players.";
    }
  } catch (err) {
    console.error(err);
    banner.hidden = false;
    banner.textContent = "Couldn't connect to the game server. Check your connection and reload.";
    return;
  }
  setBusy(false);

  if (roomParam && $("name-input").value.trim()) joinRoom(roomParam);
}

boot();
