const PARAMS = [
  "FaceAngleX", "FaceAngleY", "FaceAngleZ",
  "FacePositionX", "FacePositionY", "FacePositionZ",
];

const DEFAULT_WEIGHTS = {
  FaceAngleX: 1.5,
  FaceAngleY: 2.0,
  FaceAngleZ: 1.0,
  FacePositionX: 0.5,
  FacePositionY: 1.5,
  FacePositionZ: 2.0,
};
const PARAM_NAME = "PostureScore";
const PLUGIN_DEVELOPER = "Developer";
const ALERT_PARAM_SPECS = [
  { parameterName: "PostureAlert", explanation: "1 when the posture alert sound is enabled", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureAlertSound", explanation: "Index of the selected alert sound", min: 0, max: 7, defaultValue: 0 },
  { parameterName: "PostureAlertThreshold", explanation: "Score at or below which the alert can play", min: 0, max: 100, defaultValue: 70 },
  { parameterName: "PostureAlertDuration", explanation: "Seconds the score must stay low before the alert", min: 0, max: 3600, defaultValue: 3 },
  { parameterName: "PostureAlertCooldown", explanation: "Seconds between alert sounds", min: 0, max: 3600, defaultValue: 10 },
  { parameterName: "PostureAlertVolume", explanation: "Alert volume from 0 to 1", min: 0, max: 1, defaultValue: 0.5 },
  { parameterName: "PostureAlertFrom", explanation: "0 overlay, 1 control page", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureTheme", explanation: "0 for dark theme, 1 for light theme", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureOverlayStyle", explanation: "0 clear, 1 white background, 2 black background", min: 0, max: 2, defaultValue: 1 },
  { parameterName: "PosturePlateFade", explanation: "0 opaque plate, 1 fully transparent", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureScoreMode", explanation: "0 decimals, 1 integer, 2 hidden", min: 0, max: 2, defaultValue: 0 },
  { parameterName: "PostureGauge", explanation: "1 when the overlay gauge is shown", min: 0, max: 1, defaultValue: 1 },
  { parameterName: "PostureLabel", explanation: "1 when the overlay status word is shown", min: 0, max: 1, defaultValue: 1 },
  { parameterName: "PostureVisible", explanation: "1 while the control tab is visible", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureMonitoring", explanation: "1 while posture monitoring is running", min: 0, max: 1, defaultValue: 0 },
  { parameterName: "PostureDismiss", explanation: "1 when the control page disconnects", min: 0, max: 1, defaultValue: 0 },
];

function scoreSyncSpecs() {
  const specs = [
    { parameterName: "PostureAlpha", explanation: "Smoothing alpha for the posture score", min: 0, max: 1, defaultValue: 0.1 },
  ];
  for (const name of PARAMS) {
    const angle = name.includes("Angle");
    const min = angle ? -180 : -50;
    const max = angle ? 180 : 50;
    specs.push(
      { parameterName: `PostureMin${name}`, explanation: `Lower limit for ${name}`, min, max, defaultValue: 0 },
      { parameterName: `PostureMax${name}`, explanation: `Upper limit for ${name}`, min, max, defaultValue: 0 },
      { parameterName: `PostureWeight${name}`, explanation: `Weight for ${name}`, min: 0, max: 5, defaultValue: 1 },
    );
  }
  return specs;
}
const OVERLAY_PLATES = ["clear", "light", "dark"];
const SCORE_MODES = ["decimal", "integer", "none"];

const ALERTS = [
  "警告音　サイレン.mp3",
  "ビシッとツッコミ3.mp3",
  "ビシッとツッコミ1.mp3",
  "クイズ不正解2.mp3",
  "クイズ不正解1.mp3",
  "エアーホーン.mp3",
  "「アウト」.mp3",
  "警告音2.mp3",
];

const CONTROL_PLUGIN = "VTS GoodPosture";
const OVERLAY_PLUGIN = "VTS GoodPosture Overlay";

function defaultFace(angle, position) {
  const values = {};
  for (const name of PARAMS) {
    values[name] = name.includes("Angle") ? angle : position;
  }
  return values;
}

function defaultSettings() {
  return {
    token: "",
    host: "127.0.0.1",
    port: 8001,
    autoStart: false,
    pollingMs: 200,
    alpha: 0.1,
    weights: { ...DEFAULT_WEIGHTS },
    displayMin: defaultFace(-30, -5),
    displayMax: defaultFace(30, 5),
    baseline: defaultFace(0, 0),
    minLimits: defaultFace(-15, -0.5),
    maxLimits: defaultFace(15, 0.5),
    minOffsets: defaultFace(-15, -0.5),
    maxOffsets: defaultFace(15, 0.5),
    alert: false,
    threshold: 70,
    duration: 3,
    cooldown: 10,
    volume: 0.5,
    sound: ALERTS[0],
    alertFrom: "overlay",
    theme: "dark",
    overlayStyle: "light",
    plateFade: 0,
    scoreMode: "decimal",
    showGauge: true,
    showLabel: true,
    configured: false,
  };
}

function roundDigits(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calculateRawScore(current, minLimits, maxLimits, weights) {
  let totalWeight = 0;
  let weightedPenalty = 0;
  for (const name of PARAMS) {
    const value = current[name];
    if (value == null || Number.isNaN(value)) continue;
    const minLimit = minLimits[name];
    const maxLimit = maxLimits[name];
    const weight = weights[name];
    let deviation = 0;
    if (value < minLimit) {
      const outerSpan = name.includes("Angle") ? 15 : 0.5;
      deviation = Math.min((minLimit - value) / Math.max(outerSpan, 1e-6), 1);
    } else if (value > maxLimit) {
      const outerSpan = name.includes("Angle") ? 15 : 0.5;
      deviation = Math.min((value - maxLimit) / Math.max(outerSpan, 1e-6), 1);
    }
    weightedPenalty += deviation * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 100;
  const avgPenalty = weightedPenalty / totalWeight;
  return Math.max(0, roundDigits(100 * (1 - avgPenalty), 2));
}

function applyEma(prev, raw, alpha) {
  return roundDigits(alpha * raw + (1 - alpha) * prev, 2);
}

function scoreAppearance(score) {
  if (score >= 80) return { label: "良好", color: "#27ae60" };
  if (score >= 60) return { label: "注意", color: "#e67e22" };
  return { label: "危険", color: "#e74c3c" };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function loadStore(key) {
  const settings = defaultSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    for (const group of ["baseline", "minLimits", "maxLimits", "minOffsets", "maxOffsets", "weights", "displayMin", "displayMax"]) {
      if (saved[group] && typeof saved[group] === "object") {
        for (const name of PARAMS) {
          if (Number.isFinite(Number(saved[group][name]))) {
            settings[group][name] = Number(saved[group][name]);
          }
        }
      }
    }
    if (typeof saved.token === "string") settings.token = saved.token;
    if (typeof saved.host === "string" && saved.host.trim()) settings.host = saved.host.trim();
    settings.port = clamp(saved.port, 1, 65535, settings.port);
    settings.autoStart = Boolean(saved.autoStart);
    settings.pollingMs = clamp(saved.pollingMs, 50, 900, settings.pollingMs);
    settings.alpha = clamp(saved.alpha, 0.01, 1, settings.alpha);
    settings.alert = Boolean(saved.alert);
    settings.threshold = clamp(saved.threshold, 0, 100, settings.threshold);
    settings.duration = clamp(saved.duration, 0, 3600, settings.duration);
    settings.cooldown = clamp(saved.cooldown, 0, 3600, settings.cooldown);
    settings.volume = clamp(saved.volume, 0, 1, settings.volume);
    if (ALERTS.includes(saved.sound)) settings.sound = saved.sound;
    settings.alertFrom = saved.alertFrom === "control" ? "control" : "overlay";
    settings.theme = saved.theme === "light" ? "light" : "dark";
    settings.overlayStyle = saved.overlayStyle === "dark" ? "dark" : "light";
    settings.plateFade = clamp(saved.plateFade, 0, 1, 0);
    if (SCORE_MODES.includes(saved.scoreMode)) settings.scoreMode = saved.scoreMode;
    if (typeof saved.showGauge === "boolean") settings.showGauge = saved.showGauge;
    if (typeof saved.showLabel === "boolean") settings.showLabel = saved.showLabel;
    settings.configured = saved.configured === true;
  } catch (_) {
    /* 壊れた保存値は初期値のまま使う */
  }
  return settings;
}

function saveStore(key, settings) {
  const copy = { ...settings, token: settings.token };
  localStorage.setItem(key, JSON.stringify(copy));
}

class VtsClient {
  constructor(pluginName) {
    this.pluginName = pluginName;
    this.ws = null;
    this.queue = [];
    this.pumping = false;
    this.closedByUser = false;
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect(host, port) {
    this.closedByUser = false;
    const socket = new WebSocket(`ws://${host}:${port}`);
    this.ws = socket;
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        socket.removeEventListener("open", onOpen);
        reject(error);
      };
      const onOpen = () => {
        socket.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => fail(new Error("VTube Studio に接続できません"));
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        const waiter = this.queue.find((item) => item.requestID === message.requestID && item.sent);
        if (!waiter) return;
        waiter.settle(message);
      });
      socket.addEventListener("close", (event) => {
        if (socket.ignoreClose) return;
        const reason = event.code === 1006
          ? "ローカル接続が拒否された可能性があります。Chrome のローカルネットワークアクセスを許可してください"
          : `切断されました (${event.code})`;
        this.failPending(new Error(reason));
        if (this.onClose && !this.closedByUser) this.onClose(event.code, reason);
      });
    });
  }

  close() {
    this.closedByUser = true;
    this.failPending(new Error("切断しました"));
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.ignoreClose = true;
      socket.close();
    }
  }

  failPending(error) {
    const pending = this.queue.splice(0);
    for (const item of pending) item.fail(error);
  }

  request(messageType, data) {
    const requestID = `${messageType}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const item = {
        requestID,
        messageType,
        data,
        sent: false,
        settle: (message) => {
          if (item.done) return;
          item.done = true;
          clearTimeout(item.timer);
          resolve(message);
        },
        fail: (error) => {
          if (item.done) return;
          item.done = true;
          clearTimeout(item.timer);
          reject(error);
        },
      };
      const waitMs = messageType === "AuthenticationTokenRequest" ? 180000 : 5000;
      item.timer = setTimeout(() => {
        item.fail(new Error("VTube Studio の応答がタイムアウトしました"));
        if (messageType !== "AuthenticationTokenRequest" && this.ws) this.ws.close();
      }, waitMs);
      this.queue.push(item);
      this.pump();
    });
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    while (this.queue.length) {
      const item = this.queue[0];
      if (!this.connected) {
        this.failPending(new Error("VTube Studio に接続されていません"));
        break;
      }
      item.sent = true;
      this.ws.send(JSON.stringify({
        apiName: "VTubeStudioPublicAPI",
        apiVersion: "1.0",
        requestID: item.requestID,
        messageType: item.messageType,
        data: item.data,
      }));
      try {
        await new Promise((resolve, reject) => {
          const prevSettle = item.settle;
          const prevFail = item.fail;
          item.settle = (message) => {
            prevSettle(message);
            resolve();
          };
          item.fail = (error) => {
            prevFail(error);
            reject(error);
          };
        });
      } catch (_) {
        break;
      }
      if (this.queue[0] === item) this.queue.shift();
    }
    this.pumping = false;
  }

  async authenticate(settings, save) {
    const identity = {
      pluginName: this.pluginName,
      pluginDeveloper: PLUGIN_DEVELOPER,
    };
    if (settings.token) {
      const authed = await this.request("AuthenticationRequest", {
        ...identity,
        authenticationToken: settings.token,
      });
      if (authed.data && authed.data.authenticated) return;
      settings.token = "";
      save();
    }
    const issued = await this.request("AuthenticationTokenRequest", identity);
    if (issued.messageType === "APIError" || !issued.data || !issued.data.authenticationToken) {
      throw new Error(apiErrorText(issued) || "トークンを取得できません");
    }
    settings.token = issued.data.authenticationToken;
    save();
    const authed = await this.request("AuthenticationRequest", {
      ...identity,
      authenticationToken: settings.token,
    });
    if (!authed.data || !authed.data.authenticated) {
      settings.token = "";
      save();
      throw new Error((authed.data && authed.data.reason) || "認証に失敗しました");
    }
  }
}

function apiErrorText(message) {
  if (!message || message.messageType !== "APIError" || !message.data) return "";
  const id = message.data.errorID;
  const text = message.data.message || "";
  return id ? `${text} (${id})` : text;
}

function readListedParams(message) {
  if (!message || message.messageType !== "InputParameterListResponse" || !message.data) return null;
  const values = {};
  for (const group of ["defaultParameters", "customParameters"]) {
    for (const param of message.data[group] || []) {
      if (param.name != null && param.value != null) values[param.name] = Number(param.value);
    }
  }
  return values;
}

let alertPlayer = null;

function playAlert(kind, level) {
  const file = ALERTS.includes(kind) ? kind : ALERTS[0];
  const url = new URL(`sounds/${encodeURIComponent(file)}`, document.baseURI).href;
  if (alertPlayer) alertPlayer.pause();
  // 同じ要素の src を差し替えると、直前の音声がまだ読める状態のまま再生される
  const player = new Audio(url);
  alertPlayer = player;
  player.volume = Math.min(1, Math.max(0, Number(level) || 0));
  player.play().catch(() => {});
}

function boot() {
  if (document.documentElement.classList.contains("overlay")) {
    startOverlay();
  } else {
    startControl();
  }
}

function startControl() {
  const storeKey = "vtsGoodPosture.control";
  const settings = loadStore(storeKey);
  const save = () => saveStore(storeKey, settings);
  const client = new VtsClient(CONTROL_PLUGIN);
  const status = document.getElementById("status");
  const hiddenWarn = document.getElementById("hidden-warn");
  const hostInput = document.getElementById("host");
  const portInput = document.getElementById("port");
  const liveScore = document.getElementById("live-score");
  const liveStatus = document.getElementById("live-status");
  const paramCards = document.getElementById("param-cards");
  const overlayUrl = document.getElementById("overlay-url");
  const alphaInput = document.getElementById("alpha");
  const alphaVal = document.getElementById("alpha-val");
  const themeButton = document.getElementById("theme");

  let monitoring = false;
  let score = 100;
  let loopTimer = 0;
  let reconnectTimer = 0;
  let session = 0;
  let badSince = null;
  let lastSound = 0;
  let dismiss = false;

  hostInput.value = settings.host;
  hostInput.addEventListener("input", () => {
    const cleaned = hostInput.value.replace(/[^A-Za-z0-9.-]/g, "");
    if (cleaned !== hostInput.value) hostInput.value = cleaned;
  });
  portInput.value = String(settings.port);
  document.getElementById("auto-start").checked = settings.autoStart;
  document.getElementById("polling").value = String(settings.pollingMs);
  alphaInput.value = String(settings.alpha);
  alphaVal.textContent = settings.alpha.toFixed(2);
  document.getElementById("alert").checked = settings.alert;
  document.getElementById("alert-from").value = settings.alertFrom;
  const themeIcons = {
    light: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    dark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>`,
  };
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const next = settings.theme === "light" ? "dark" : "light";
    themeButton.innerHTML = themeIcons[next];
    themeButton.setAttribute("aria-label", next === "dark" ? "ダーク" : "ライト");
  }
  applyTheme();
  document.getElementById("threshold").value = String(settings.threshold);
  document.getElementById("duration").value = String(settings.duration);
  document.getElementById("cooldown").value = String(settings.cooldown);
  document.getElementById("volume").value = String(settings.volume);
  document.getElementById("volume-val").textContent = Number(settings.volume).toFixed(1);
  document.getElementById("sound").value = settings.sound;
  document.getElementById("overlay-style").value = settings.overlayStyle;
  document.getElementById("plate-fade").value = String(settings.plateFade);
  document.getElementById("plate-fade-val").textContent = settings.plateFade.toFixed(2);
  document.getElementById("score-mode").value = settings.scoreMode;
  document.getElementById("show-gauge").checked = settings.showGauge;
  document.getElementById("show-label").checked = settings.showLabel;
  buildParamCards();
  paintParamCards({});
  refreshOverlayUrl();
  clearScore();

  function setStatus(text) {
    status.textContent = text;
  }

  function readForm() {
    const host = hostInput.value.trim();
    settings.host = host || "127.0.0.1";
    hostInput.value = settings.host;
    settings.port = clamp(portInput.value, 1, 65535, 8001);
    portInput.value = String(settings.port);
    settings.autoStart = document.getElementById("auto-start").checked;
    settings.pollingMs = clamp(document.getElementById("polling").value, 50, 900, 200);
    settings.alpha = clamp(alphaInput.value, 0.01, 1, 0.1);
    alphaVal.textContent = settings.alpha.toFixed(2);
    settings.alert = document.getElementById("alert").checked;
    settings.alertFrom = document.getElementById("alert-from").value === "control" ? "control" : "overlay";
    settings.threshold = clamp(document.getElementById("threshold").value, 0, 100, 70);
    settings.duration = clamp(document.getElementById("duration").value, 0, 3600, 3);
    settings.cooldown = clamp(document.getElementById("cooldown").value, 0, 3600, 10);
    settings.volume = clamp(document.getElementById("volume").value, 0, 1, 0.5);
    settings.sound = document.getElementById("sound").value;
    const plate = document.getElementById("overlay-style").value;
    settings.overlayStyle = plate === "dark" ? "dark" : "light";
    settings.plateFade = clamp(document.getElementById("plate-fade").value, 0, 1, 0);
    document.getElementById("plate-fade-val").textContent = settings.plateFade.toFixed(2);
    const mode = document.getElementById("score-mode").value;
    settings.scoreMode = SCORE_MODES.includes(mode) ? mode : "decimal";
    settings.showGauge = document.getElementById("show-gauge").checked;
    settings.showLabel = document.getElementById("show-label").checked;
    save();
    refreshOverlayUrl();
  }

  function refreshOverlayUrl() {
    const query = new URLSearchParams({ overlay: "1" });
    if (settings.host !== "127.0.0.1") query.set("host", settings.host);
    if (settings.port !== 8001) query.set("port", String(settings.port));
    const path = location.pathname.endsWith("/") ? `${location.pathname}index.html` : location.pathname;
    overlayUrl.value = `${location.origin}${path}?${query}`;
  }

  function alertParameterValues(score) {
    const soundIndex = ALERTS.indexOf(settings.sound);
    const values = [
      { id: "PostureAlert", value: settings.alert ? 1 : 0 },
      { id: "PostureAlertSound", value: soundIndex >= 0 ? soundIndex : 0 },
      { id: "PostureAlertThreshold", value: settings.threshold },
      { id: "PostureAlertDuration", value: settings.duration },
      { id: "PostureAlertCooldown", value: settings.cooldown },
      { id: "PostureAlertVolume", value: settings.volume },
      { id: "PostureAlertFrom", value: settings.alertFrom === "control" ? 1 : 0 },
      { id: "PostureTheme", value: settings.theme === "light" ? 1 : 0 },
      { id: "PostureOverlayStyle", value: Math.max(0, OVERLAY_PLATES.indexOf(settings.overlayStyle)) },
      { id: "PosturePlateFade", value: settings.plateFade },
      { id: "PostureScoreMode", value: Math.max(0, SCORE_MODES.indexOf(settings.scoreMode)) },
      { id: "PostureGauge", value: settings.showGauge ? 1 : 0 },
      { id: "PostureLabel", value: settings.showLabel ? 1 : 0 },
      { id: "PostureVisible", value: 1 },
      { id: "PostureMonitoring", value: monitoring ? 1 : 0 },
      { id: "PostureDismiss", value: dismiss ? 1 : 0 },
      { id: "PostureAlpha", value: settings.alpha },
    ];
    for (const name of PARAMS) {
      values.push(
        { id: `PostureMin${name}`, value: settings.minLimits[name] },
        { id: `PostureMax${name}`, value: settings.maxLimits[name] },
        { id: `PostureWeight${name}`, value: settings.weights[name] },
      );
    }
    if (score != null) values.unshift({ id: PARAM_NAME, value: score });
    return values.map((item) => ({ ...item, weight: 1 }));
  }

  function clearScore() {
    liveScore.textContent = "";
    liveScore.style.color = "";
    liveStatus.textContent = "";
    const line = liveScore.closest(".score-line");
    line.classList.remove("is-live", "is-paused");
  }

  function paintPaused() {
    const line = liveScore.closest(".score-line");
    line.classList.add("is-live", "is-paused");
    liveScore.textContent = "停止中";
    liveScore.style.color = "";
    liveStatus.textContent = "";
  }

  function paintScore(value) {
    const look = scoreAppearance(value);
    const line = liveScore.closest(".score-line");
    line.classList.add("is-live");
    line.classList.remove("is-paused");
    liveScore.textContent = Number(value).toFixed(2);
    liveScore.style.color = look.color;
    liveStatus.textContent = look.label;
    liveStatus.style.color = "";
  }

  function percent(name, value) {
    const min = settings.displayMin[name];
    const max = settings.displayMax[name];
    const span = max - min || 1;
    return Math.max(0, Math.min(100, ((value - min) / span) * 100));
  }

  function buildParamCards() {
    paramCards.replaceChildren();
    const axisNotes = {
      X: "左右の向きと、左右の位置です。",
      Y: "上下の向きと、上下の位置です。",
      Z: "横への傾きと、前後の位置です。",
    };
    for (const axis of ["X", "Y", "Z"]) {
      const section = document.createElement("section");
      section.className = "axis-section";
      section.innerHTML = `<h3>Face ${axis}</h3><p class="axis-note">${axisNotes[axis]}</p>`;
      for (const kind of ["Angle", "Position"]) {
        const name = `Face${kind}${axis}`;
        const card = document.createElement("div");
        card.className = "param-card";
        card.innerHTML = `
          <div class="param-head"><strong>${kind === "Angle" ? "角度" : "位置"}</strong><span id="live-${name}">現在 —</span></div>
          <div class="track-wrap">
            <input class="axis view-min" data-name="${name}" type="number" step="0.1" aria-label="表示最小">
            <div class="track" data-name="${name}">
              <div class="track-line"></div>
              <div class="track-range" id="range-${name}">
                <span class="range-num range-min" id="min-label-${name}"></span>
                <span class="range-num range-max" id="max-label-${name}"></span>
              </div>
              <div class="base-dot" id="base-${name}"><span id="base-label-${name}"></span></div>
              <div class="live-dot" id="dot-${name}"></div>
              <div class="handle" data-name="${name}" data-side="min" role="slider" aria-label="下限"></div>
              <div class="handle" data-name="${name}" data-side="max" role="slider" aria-label="上限"></div>
            </div>
            <input class="axis view-max" data-name="${name}" type="number" step="0.1" aria-label="表示最大">
          </div>
          <div class="influence">
            <span class="influence-label">重要度</span>
            <input class="weight" data-name="${name}" type="range" min="0.1" max="5" step="0.1" aria-label="重要度">
            <output class="weight-val" id="weight-val-${name}"></output>
          </div>
        `;
        section.append(card);
      }
      paramCards.append(section);
    }
    paramCards.querySelectorAll(".handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const name = handle.dataset.name;
        const side = handle.dataset.side;
          const track = handle.closest(".track");
        const move = (point) => {
          const rect = track.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
          const viewMin = settings.displayMin[name];
          const viewMax = settings.displayMax[name];
          const value = roundDigits(viewMin + ratio * (viewMax - viewMin), 4);
          if (side === "min") settings.minLimits[name] = Math.min(value, settings.maxLimits[name]);
          else settings.maxLimits[name] = Math.max(value, settings.minLimits[name]);
          paintParamCards();
        };
        const onMove = (point) => move(point);
        const onUp = () => {
          handle.releasePointerCapture(event.pointerId);
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          save();
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        move(event);
      });
    });
    paramCards.querySelectorAll(".weight").forEach((input) => {
      input.addEventListener("input", () => {
        const name = input.dataset.name;
        document.getElementById(`weight-val-${name}`).textContent = clamp(input.value, 0.1, 5, 1).toFixed(1);
      });
    });
    paramCards.querySelectorAll(".view-min, .view-max, .weight").forEach((input) => {
      input.addEventListener("change", () => {
        const name = input.dataset.name;
        if (input.classList.contains("weight")) {
          settings.weights[name] = clamp(input.value, 0.1, 5, DEFAULT_WEIGHTS[name]);
        } else if (input.classList.contains("view-min")) {
          settings.displayMin[name] = Number(input.value);
        } else {
          settings.displayMax[name] = Number(input.value);
        }
        if (settings.displayMin[name] >= settings.displayMax[name]) {
          settings.displayMax[name] = settings.displayMin[name] + 1;
        }
        save();
        paintParamCards();
      });
    });
  }

  function paintParamCards(values) {
    for (const name of PARAMS) {
      const minPct = percent(name, settings.minLimits[name]);
      const maxPct = percent(name, settings.maxLimits[name]);
      const range = document.getElementById(`range-${name}`);
      range.style.left = `${minPct}%`;
      range.style.width = `${Math.max(0, maxPct - minPct)}%`;
      document.getElementById(`base-${name}`).style.left = `${percent(name, settings.baseline[name])}%`;
      const handles = paramCards.querySelectorAll(`.handle[data-name="${name}"]`);
      handles[0].style.left = `${minPct}%`;
      handles[1].style.left = `${maxPct}%`;
      document.getElementById(`min-label-${name}`).textContent = settings.minLimits[name].toFixed(2);
      document.getElementById(`base-label-${name}`).textContent = settings.baseline[name].toFixed(2);
      document.getElementById(`max-label-${name}`).textContent = settings.maxLimits[name].toFixed(2);
      const viewMin = paramCards.querySelector(`.view-min[data-name="${name}"]`);
      const viewMax = paramCards.querySelector(`.view-max[data-name="${name}"]`);
      const weight = paramCards.querySelector(`.weight[data-name="${name}"]`);
      if (document.activeElement !== viewMin) viewMin.value = String(settings.displayMin[name]);
      if (document.activeElement !== viewMax) viewMax.value = String(settings.displayMax[name]);
      if (document.activeElement !== weight) weight.value = String(settings.weights[name]);
      document.getElementById(`weight-val-${name}`).textContent = Number(settings.weights[name]).toFixed(1);
      if (values && values[name] != null && !Number.isNaN(values[name])) {
        document.getElementById(`dot-${name}`).style.left = `${percent(name, values[name])}%`;
        document.getElementById(`live-${name}`).textContent = `現在 ${roundDigits(values[name], 3)}`;
      }
    }
  }

  function updateHiddenWarn() {
    hiddenWarn.hidden = document.visibilityState === "visible";
  }

  async function openSession() {
    dismiss = false;
    window.clearTimeout(reconnectTimer);
    const current = ++session;
    readForm();
    setStatus(`ws://127.0.0.1:${settings.port} に接続しています`);
    try {
      await client.connect(settings.host, settings.port);
      if (current !== session) return;
      setStatus("認証しています");
      await client.authenticate(settings, save);
      if (current !== session) return;
      const created = await client.request("ParameterCreationRequest", {
        parameterName: PARAM_NAME,
        explanation: "Posture score 0-100 from VTS GoodPosture plugin",
        min: 0,
        max: 100,
        defaultValue: 100,
      });
      if (created.messageType === "APIError") {
        throw new Error(apiErrorText(created) || "PostureScore を作成できません");
      }
      for (const spec of [...ALERT_PARAM_SPECS, ...scoreSyncSpecs()]) {
        const made = await client.request("ParameterCreationRequest", spec);
        if (made.messageType === "APIError") {
          throw new Error(apiErrorText(made) || `${spec.parameterName} を作成できません`);
        }
      }
      setStatus("接続しました");
      if (settings.autoStart) monitoring = true;
      if (monitoring) {
        score = 100;
        paintScore(score);
        setStatus("監視中");
      } else {
        paintPaused();
      }
      scheduleLoop(0);
    } catch (error) {
      if (current !== session) return;
      setStatus(error.message || "接続に失敗しました");
      clearScore();
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (client.closedByUser) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      openSession();
    }, 2000);
  }

  client.onClose = (code, reason) => {
    if (session === 0) return;
    setStatus(reason);
    clearScore();
    scheduleReconnect();
  };

  function scheduleLoop(delay) {
    window.clearTimeout(loopTimer);
    if (!client.connected || dismiss) return;
    loopTimer = window.setTimeout(tick, delay);
  }

  function noteControlAlert(value) {
    const now = performance.now() / 1000;
    if (value <= settings.threshold) {
      if (badSince == null) badSince = now;
      if (now - badSince >= settings.duration && now - lastSound >= settings.cooldown) {
        playAlert(settings.sound, settings.volume);
        lastSound = now;
      }
    } else {
      badSince = null;
    }
  }

  async function tick() {
    if (!client.connected || dismiss) return;
    if (document.visibilityState !== "visible") {
      updateHiddenWarn();
      scheduleLoop(settings.pollingMs);
      return;
    }
    const started = performance.now();
    let scoreValue = null;
    try {
      if (monitoring) {
        const listed = await client.request("InputParameterListRequest", {});
        const values = readListedParams(listed);
        if (values) {
          paintParamCards(values);
          const raw = calculateRawScore(values, settings.minLimits, settings.maxLimits, settings.weights);
          score = applyEma(score, raw, settings.alpha);
          paintScore(score);
          scoreValue = score;
          if (settings.alert && settings.alertFrom === "control") noteControlAlert(score);
          else badSince = null;
        }
      }
      const injected = await client.request("InjectParameterDataRequest", {
        faceFound: true,
        mode: "set",
        parameterValues: alertParameterValues(scoreValue),
      });
      if (injected.messageType === "APIError") {
        setStatus(apiErrorText(injected) || "設定を書き込めません");
      }
    } catch (error) {
      if (!client.closedByUser) setStatus(error.message || "監視に失敗しました");
    }
    scheduleLoop(Math.max(0, settings.pollingMs - (performance.now() - started)));
  }

  document.getElementById("connect").addEventListener("click", () => {
    client.close();
    client.closedByUser = false;
    openSession();
  });

  document.getElementById("disconnect").addEventListener("click", async () => {
    monitoring = false;
    dismiss = true;
    window.clearTimeout(loopTimer);
    window.clearTimeout(reconnectTimer);
    session += 1;
    if (client.connected) {
      try {
        await client.request("InjectParameterDataRequest", {
          faceFound: true,
          mode: "set",
          parameterValues: [{ id: "PostureDismiss", value: 1, weight: 1 }],
        });
      } catch (_) {
        /* 切断の合図が送れなくても、こちらは切断する */
      }
    }
    client.close();
    clearScore();
    setStatus("切断しました");
  });

  document.getElementById("start").addEventListener("click", () => {
    if (!client.connected) {
      setStatus("先に接続してください");
      return;
    }
    monitoring = true;
    score = 100;
    paintScore(score);
    setStatus("監視中");
    scheduleLoop(0);
  });

  document.getElementById("stop").addEventListener("click", () => {
    monitoring = false;
    score = 100;
    if (client.connected) paintPaused();
    else clearScore();
    setStatus(client.connected ? "接続しました" : "未接続");
  });

  document.getElementById("calibrate").addEventListener("click", async () => {
    if (!client.connected || client.pumping || client.queue.length) {
      setStatus("監視を止めてから基準を取ってください");
      return;
    }
    try {
      const listed = await client.request("InputParameterListRequest", {});
      const values = readListedParams(listed);
      if (!values) throw new Error("顔パラメータを読めません");
      for (const name of PARAMS) {
        const base = values[name] == null ? 0 : roundDigits(Number(values[name]), 4);
        settings.baseline[name] = base;
        settings.minLimits[name] = roundDigits(base + settings.minOffsets[name], 4);
        settings.maxLimits[name] = roundDigits(base + settings.maxOffsets[name], 4);
      }
      save();
      paintParamCards(values);
      setStatus("今の姿勢を基準にしました");
    } catch (error) {
      setStatus(error.message || "基準を取れません");
    }
  });

  document.getElementById("test-sound").addEventListener("click", () => {
    readForm();
    playAlert(settings.sound, settings.volume);
  });

  overlayUrl.addEventListener("click", () => overlayUrl.select());
  document.getElementById("copy-url").addEventListener("click", async () => {
    readForm();
    const url = overlayUrl.value;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("オーバーレイ URL をコピーしました");
    } catch (_) {
      overlayUrl.focus();
      overlayUrl.select();
      setStatus("URL を選択しました。コピーしてください");
    }
  });

  document.getElementById("save-offsets").addEventListener("click", () => {
    for (const name of PARAMS) {
      settings.minOffsets[name] = roundDigits(settings.minLimits[name] - settings.baseline[name], 4);
      settings.maxOffsets[name] = roundDigits(settings.maxLimits[name] - settings.baseline[name], 4);
    }
    save();
    setStatus("現在の許容値を保存しました");
  });

  document.getElementById("reset-offsets").addEventListener("click", () => {
    settings.minOffsets = defaultFace(-15, -0.5);
    settings.maxOffsets = defaultFace(15, 0.5);
    for (const name of PARAMS) {
      settings.minLimits[name] = roundDigits(settings.baseline[name] + settings.minOffsets[name], 4);
      settings.maxLimits[name] = roundDigits(settings.baseline[name] + settings.maxOffsets[name], 4);
    }
    save();
    paintParamCards();
    setStatus("許容値を初期値に戻しました");
  });

  themeButton.addEventListener("click", () => {
    settings.theme = settings.theme === "light" ? "dark" : "light";
    applyTheme();
    save();
    refreshOverlayUrl();
  });

  alphaInput.addEventListener("input", () => {
    alphaVal.textContent = clamp(alphaInput.value, 0.01, 1, 0.1).toFixed(2);
  });

  const volumeInput = document.getElementById("volume");
  volumeInput.addEventListener("input", () => {
    document.getElementById("volume-val").textContent = clamp(volumeInput.value, 0, 1, 0.5).toFixed(1);
  });

  const plateFadeInput = document.getElementById("plate-fade");
  plateFadeInput.addEventListener("input", () => {
    document.getElementById("plate-fade-val").textContent = clamp(plateFadeInput.value, 0, 1, 0).toFixed(2);
  });

  for (const id of ["host", "port", "auto-start", "polling", "alpha", "alert", "alert-from", "sound", "threshold", "duration", "cooldown", "volume", "overlay-style", "plate-fade", "score-mode", "show-gauge", "show-label"]) {
    document.getElementById(id).addEventListener("change", readForm);
  }

  document.addEventListener("visibilitychange", updateHiddenWarn);
  updateHiddenWarn();
}

function startOverlay() {
  const query = new URLSearchParams(location.search);
  let alertOn = false;
  let threshold = 70;
  let duration = 3;
  let cooldown = 10;
  let volume = 0.5;
  let sound = ALERTS[0];
  let scoreMode = "decimal";
  let showGauge = true;
  let showLabel = true;
  let plateFade = 0;
  let playOnOverlay = true;
  const rawPort = query.get("port");
  const port = rawPort == null || rawPort === "" ? 8001 : clamp(rawPort, 1, 65535, 8001);
  const host = (query.get("host") || "127.0.0.1").trim();

  const storeKey = "vtsGoodPosture.overlay";
  const settings = loadStore(storeKey);
  settings.port = port;
  const save = () => saveStore(storeKey, settings);
  const client = new VtsClient(OVERLAY_PLUGIN);
  const scoreEl = document.getElementById("ov-score");
  const labelEl = document.getElementById("ov-label");
  const gaugeEl = document.getElementById("ov-gauge-fill");

  let badSince = null;
  let lastSound = 0;
  let reconnectTimer = 0;
  let session = 0;
  let ownScore = null;
  let dismissed = false;

  function showStatus(text) {
    scoreEl.textContent = text;
    scoreEl.classList.add("is-status");
    scoreEl.style.color = "";
    labelEl.textContent = "";
    gaugeEl.style.width = "0";
    gaugeEl.parentElement.hidden = true;
  }

  function showPaused() {
    badSince = null;
    scoreEl.classList.remove("is-status");
    scoreEl.textContent = "--";
    scoreEl.style.color = "";
    labelEl.textContent = "停止中";
    labelEl.style.color = "";
    gaugeEl.style.width = "0";
    gaugeEl.parentElement.hidden = true;
  }

  function showScore(score) {
    const look = scoreAppearance(score);
    scoreEl.classList.remove("is-status");
    if (scoreMode === "none") scoreEl.textContent = "";
    else if (scoreMode === "integer") scoreEl.textContent = String(Math.round(score));
    else scoreEl.textContent = Number(score).toFixed(2);
    scoreEl.style.color = scoreMode === "none" ? "" : look.color;
    labelEl.textContent = showLabel ? look.label : "";
    labelEl.style.color = "";
    gaugeEl.parentElement.hidden = !showGauge;
    if (showGauge) {
      gaugeEl.style.width = `${Math.max(0, Math.min(100, score))}%`;
      gaugeEl.style.backgroundColor = look.color;
    }
    maybeAlert(score);
  }

  function applyRemoteSettings(values) {
    if (Number.isFinite(values.PostureAlert)) alertOn = values.PostureAlert >= 0.5;
    const soundIndex = Math.round(Number(values.PostureAlertSound));
    if (ALERTS[soundIndex]) sound = ALERTS[soundIndex];
    if (Number.isFinite(values.PostureAlertThreshold)) threshold = clamp(values.PostureAlertThreshold, 0, 100, threshold);
    if (Number.isFinite(values.PostureAlertDuration)) duration = clamp(values.PostureAlertDuration, 0, 3600, duration);
    if (Number.isFinite(values.PostureAlertCooldown)) cooldown = clamp(values.PostureAlertCooldown, 0, 3600, cooldown);
    if (Number.isFinite(values.PostureAlertVolume)) volume = clamp(values.PostureAlertVolume, 0, 1, volume);
    if (Number.isFinite(values.PostureAlertFrom)) playOnOverlay = values.PostureAlertFrom < 0.5;
    if (Number.isFinite(values.PostureTheme)) {
      document.documentElement.dataset.theme = values.PostureTheme >= 0.5 ? "light" : "dark";
    }
    const plateIndex = Math.round(Number(values.PostureOverlayStyle));
    document.documentElement.dataset.plate = OVERLAY_PLATES[plateIndex] === "dark" ? "dark" : "light";
    if (Number.isFinite(values.PosturePlateFade)) plateFade = clamp(values.PosturePlateFade, 0, 1, plateFade);
    document.documentElement.style.setProperty("--plate-alpha", String(1 - plateFade));
    const modeIndex = Math.round(Number(values.PostureScoreMode));
    if (SCORE_MODES[modeIndex]) scoreMode = SCORE_MODES[modeIndex];
    if (Number.isFinite(values.PostureGauge)) showGauge = values.PostureGauge >= 0.5;
    if (Number.isFinite(values.PostureLabel)) showLabel = values.PostureLabel >= 0.5;
  }

  function rememberSettings(values) {
    applyRemoteSettings(values);
    if (!Number.isFinite(values.PostureAlpha)) return;
    settings.alpha = clamp(values.PostureAlpha, 0.01, 1, settings.alpha);
    for (const name of PARAMS) {
      const minLimit = values[`PostureMin${name}`];
      const maxLimit = values[`PostureMax${name}`];
      const weight = values[`PostureWeight${name}`];
      if (!Number.isFinite(minLimit) || !Number.isFinite(maxLimit) || !Number.isFinite(weight)) return;
      settings.minLimits[name] = minLimit;
      settings.maxLimits[name] = maxLimit;
      settings.weights[name] = clamp(weight, 0.1, 5, settings.weights[name]);
    }
    settings.alert = alertOn;
    settings.threshold = threshold;
    settings.duration = duration;
    settings.cooldown = cooldown;
    settings.volume = volume;
    settings.sound = sound;
    settings.alertFrom = playOnOverlay ? "overlay" : "control";
    settings.theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    settings.overlayStyle = OVERLAY_PLATES.includes(document.documentElement.dataset.plate)
      ? document.documentElement.dataset.plate
      : "clear";
    settings.scoreMode = scoreMode;
    settings.showGauge = showGauge;
    settings.showLabel = showLabel;
    settings.plateFade = plateFade;
    settings.configured = true;
    save();
  }

  function useStoredSettings() {
    alertOn = settings.alert;
    threshold = settings.threshold;
    duration = settings.duration;
    cooldown = settings.cooldown;
    volume = settings.volume;
    sound = settings.sound;
    playOnOverlay = settings.alertFrom !== "control";
    scoreMode = settings.scoreMode;
    showGauge = settings.showGauge;
    showLabel = settings.showLabel;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.plate = settings.overlayStyle === "dark" ? "dark" : "light";
    plateFade = settings.plateFade;
    document.documentElement.style.setProperty("--plate-alpha", String(1 - plateFade));
  }

  function maybeAlert(score) {
    if (!alertOn || !playOnOverlay) {
      badSince = null;
      return;
    }
    const now = performance.now() / 1000;
    if (score <= threshold) {
      if (badSince == null) badSince = now;
      if (now - badSince >= duration && now - lastSound >= cooldown) {
        playAlert(sound, volume);
        lastSound = now;
      }
    } else {
      badSince = null;
    }
  }

  function scheduleReconnect() {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(openSession, 2000);
  }

  async function openSession() {
    window.clearTimeout(reconnectTimer);
    const current = ++session;
    showStatus("接続しています");
    if (client.ws) {
      client.close();
      client.closedByUser = false;
    }
    try {
      await client.connect(host, port);
      if (current !== session) return;
      await client.authenticate(settings, save);
      if (current !== session) return;
      poll();
    } catch (error) {
      if (current !== session) return;
      const text = error.message || "接続できませんでした";
      const pending = text.includes("(51)") || /ongoing/i.test(text);
      showStatus(pending ? "VTube Studio に許可画面が出ています。そちらを押してください" : text);
      if (!pending) scheduleReconnect();
    }
  }

  client.onClose = (_code, reason) => {
    showStatus(reason || "切断されました");
    scheduleReconnect();
  };

  async function poll() {
    if (!client.connected) return;
    try {
      const listed = await client.request("InputParameterListRequest", {});
      const values = readListedParams(listed);
      if (!values) {
        showStatus("スコアを受信していません");
      } else {
        const controlOpen = Number.isFinite(values.PostureVisible) && values.PostureVisible >= 0.5;
        if (controlOpen) dismissed = false;
        else if (Number.isFinite(values.PostureDismiss) && values.PostureDismiss >= 0.5) dismissed = true;
        if (dismissed) {
          ownScore = null;
          badSince = null;
          showStatus("切断しました");
        } else if (controlOpen) {
          ownScore = null;
          rememberSettings(values);
          const monitoringOn = !Number.isFinite(values.PostureMonitoring) || values.PostureMonitoring >= 0.5;
          if (!monitoringOn) showPaused();
          else if (!Number.isFinite(values[PARAM_NAME])) showStatus("スコアを受信していません");
          else showScore(roundDigits(values[PARAM_NAME], 2));
        } else if (Number.isFinite(values.PostureMonitoring) && values.PostureMonitoring < 0.5) {
          useStoredSettings();
          showPaused();
        } else if (settings.configured) {
          useStoredSettings();
          const faceReady = PARAMS.every((name) => Number.isFinite(values[name]));
          if (!faceReady) {
            showStatus("スコアを受信していません");
          } else {
            const raw = calculateRawScore(values, settings.minLimits, settings.maxLimits, settings.weights);
            ownScore = ownScore == null ? raw : applyEma(ownScore, raw, settings.alpha);
            showScore(ownScore);
          }
        } else {
          showStatus("設定タブを表示してください。");
        }
      }
    } catch (error) {
      showStatus(error.message || "スコアを受信できませんでした");
      return;
    }
    window.setTimeout(poll, 200);
  }

  showStatus("接続しています");
  openSession();
}

boot();
