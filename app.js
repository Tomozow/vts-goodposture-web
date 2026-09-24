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
    theme: "dark",
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
    settings.theme = saved.theme === "light" ? "light" : "dark";
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
      item.timer = setTimeout(() => {
        item.fail(new Error("VTube Studio の応答がタイムアウトしました"));
        if (this.ws) this.ws.close();
      }, 5000);
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

  hostInput.value = settings.host;
  portInput.value = String(settings.port);
  document.getElementById("auto-start").checked = settings.autoStart;
  document.getElementById("polling").value = String(settings.pollingMs);
  alphaInput.value = String(settings.alpha);
  alphaVal.textContent = settings.alpha.toFixed(2);
  document.getElementById("alert").checked = settings.alert;
  applyTheme();
  document.getElementById("threshold").value = String(settings.threshold);
  document.getElementById("duration").value = String(settings.duration);
  document.getElementById("cooldown").value = String(settings.cooldown);
  document.getElementById("volume").value = String(settings.volume);
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
    settings.threshold = clamp(document.getElementById("threshold").value, 0, 100, 70);
    settings.duration = clamp(document.getElementById("duration").value, 0, 3600, 3);
    settings.cooldown = clamp(document.getElementById("cooldown").value, 0, 3600, 10);
    settings.volume = clamp(document.getElementById("volume").value, 0, 1, 0.5);
    save();
    refreshOverlayUrl();
  }

  function refreshOverlayUrl() {
    const query = new URLSearchParams({
      overlay: "1",
      alert: settings.alert ? "1" : "0",
      threshold: String(settings.threshold),
      duration: String(settings.duration),
      cooldown: String(settings.cooldown),
      volume: String(settings.volume),
      port: String(settings.port),
      host: settings.host,
      theme: settings.theme,
    });
    const path = location.pathname.endsWith("/") ? `${location.pathname}index.html` : location.pathname;
    overlayUrl.value = `${location.origin}${path}?${query}`;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    themeButton.textContent = settings.theme === "light" ? "ダーク" : "ライト";
  }

  function clearScore() {
    liveScore.textContent = "";
    liveScore.style.color = "";
    liveStatus.textContent = "";
  }

  function paintScore(value) {
    const look = scoreAppearance(value);
    liveScore.textContent = String(value);
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
    for (const name of PARAMS) {
      const card = document.createElement("div");
      card.className = "param-card";
      card.innerHTML = `
        <div class="param-head"><strong>${name}</strong><span id="live-${name}">現在 —</span></div>
        <div class="track-wrap">
          <input class="axis view-min" data-name="${name}" type="number" step="0.1" aria-label="表示最小">
          <div class="track" data-name="${name}">
            <div class="track-line"></div>
            <div class="track-range" id="range-${name}"></div>
            <div class="base-dot" id="base-${name}"></div>
            <div class="live-dot" id="dot-${name}"></div>
            <div class="handle" data-name="${name}" data-side="min"></div>
            <div class="handle" data-name="${name}" data-side="max"></div>
          </div>
          <input class="axis view-max" data-name="${name}" type="number" step="0.1" aria-label="表示最大">
        </div>
        <div class="param-meta">
          <span id="min-label-${name}"></span>
          <span id="base-label-${name}"></span>
          <span id="max-label-${name}"></span>
        </div>
        <label>重み <input class="weight" data-name="${name}" type="range" min="0.1" max="5" step="0.1"></label>
      `;
      paramCards.append(card);
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
      document.getElementById(`min-label-${name}`).textContent = `最小 ${settings.minLimits[name].toFixed(2)}`;
      document.getElementById(`base-label-${name}`).textContent = `基準 ${settings.baseline[name].toFixed(2)}`;
      document.getElementById(`max-label-${name}`).textContent = `最大 ${settings.maxLimits[name].toFixed(2)}`;
      const viewMin = paramCards.querySelector(`.view-min[data-name="${name}"]`);
      const viewMax = paramCards.querySelector(`.view-max[data-name="${name}"]`);
      const weight = paramCards.querySelector(`.weight[data-name="${name}"]`);
      if (document.activeElement !== viewMin) viewMin.value = String(settings.displayMin[name]);
      if (document.activeElement !== viewMax) viewMax.value = String(settings.displayMax[name]);
      if (document.activeElement !== weight) weight.value = String(settings.weights[name]);
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
      setStatus("接続しました");
      if (settings.autoStart) monitoring = true;
      if (monitoring) {
        score = 100;
        paintScore(score);
        setStatus("監視中");
        scheduleLoop(0);
      }
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
    if (!monitoring || !client.connected) return;
    loopTimer = window.setTimeout(tick, delay);
  }

  async function tick() {
    if (!monitoring || !client.connected) return;
    if (document.visibilityState !== "visible") {
      updateHiddenWarn();
      scheduleLoop(settings.pollingMs);
      return;
    }
    const started = performance.now();
    try {
      const listed = await client.request("InputParameterListRequest", {});
      const values = readListedParams(listed);
      if (values) {
        paintParamCards(values);
        const raw = calculateRawScore(values, settings.minLimits, settings.maxLimits, settings.weights);
        score = applyEma(score, raw, settings.alpha);
        paintScore(score);
        const injected = await client.request("InjectParameterDataRequest", {
          faceFound: true,
          mode: "set",
          parameterValues: [{ id: PARAM_NAME, value: score, weight: 1 }],
        });
        if (injected.messageType === "APIError") {
          setStatus(apiErrorText(injected) || "スコアを書き込めません");
        }
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

  document.getElementById("disconnect").addEventListener("click", () => {
    monitoring = false;
    window.clearTimeout(loopTimer);
    window.clearTimeout(reconnectTimer);
    session += 1;
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
    window.clearTimeout(loopTimer);
    score = 100;
    paintScore(score);
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

  for (const id of ["host", "port", "auto-start", "polling", "alpha", "alert", "threshold", "duration", "cooldown", "volume"]) {
    document.getElementById(id).addEventListener("change", readForm);
  }

  document.addEventListener("visibilitychange", updateHiddenWarn);
  updateHiddenWarn();
}

function startOverlay() {
  const query = new URLSearchParams(location.search);
  const alertOn = query.get("alert") === "1";
  const threshold = clamp(query.get("threshold"), 0, 100, 70);
  const duration = clamp(query.get("duration"), 0, 3600, 3);
  const cooldown = clamp(query.get("cooldown"), 0, 3600, 10);
  const volume = clamp(query.get("volume"), 0, 1, 0.5);
  const port = clamp(query.get("port"), 1, 65535, 8001);
  const host = (query.get("host") || "127.0.0.1").trim();

  const storeKey = "vtsGoodPosture.overlay";
  const settings = loadStore(storeKey);
  settings.port = port;
  const save = () => saveStore(storeKey, settings);
  const client = new VtsClient(OVERLAY_PLUGIN);
  const scoreEl = document.getElementById("ov-score");
  const labelEl = document.getElementById("ov-label");
  const gaugeEl = document.getElementById("ov-gauge-fill");

  let audioCtx = null;
  let badSince = null;
  let lastSound = 0;
  let reconnectTimer = 0;

  function showMissing() {
    scoreEl.textContent = "";
    scoreEl.style.color = "";
    labelEl.textContent = "未接続";
    gaugeEl.style.width = "0";
    gaugeEl.parentElement.hidden = true;
  }

  function showScore(score) {
    const look = scoreAppearance(score);
    scoreEl.textContent = String(score);
    scoreEl.style.color = look.color;
    labelEl.textContent = look.label;
    labelEl.style.color = "";
    gaugeEl.style.width = `${Math.max(0, Math.min(100, score))}%`;
    gaugeEl.style.backgroundColor = look.color;
    gaugeEl.parentElement.hidden = false;
    maybeAlert(score);
  }

  function maybeAlert(score) {
    if (!alertOn) {
      badSince = null;
      return;
    }
    const now = performance.now() / 1000;
    if (score <= threshold) {
      if (badSince == null) badSince = now;
      if (now - badSince >= duration && now - lastSound >= cooldown) {
        playBeep();
        lastSound = now;
      }
    } else {
      badSince = null;
    }
  }

  function playBeep() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = Math.max(volume, 0.001);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const end = audioCtx.currentTime + 0.35;
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.start();
    osc.stop(end);
  }

  function scheduleReconnect() {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(openSession, 2000);
  }

  async function openSession() {
    try {
      await client.connect(host, port);
      await client.authenticate(settings, save);
      poll();
    } catch (_) {
      showMissing();
      scheduleReconnect();
    }
  }

  client.onClose = () => {
    showMissing();
    scheduleReconnect();
  };

  async function poll() {
    if (!client.connected) return;
    try {
      const message = await client.request("ParameterValueRequest", { name: PARAM_NAME });
      if (message.messageType === "APIError") {
        showMissing();
      } else if (message.data && Number.isFinite(Number(message.data.value))) {
        showScore(roundDigits(Number(message.data.value), 2));
      } else {
        showMissing();
      }
    } catch (_) {
      showMissing();
      return;
    }
    window.setTimeout(poll, 200);
  }

  showMissing();
  openSession();
}

boot();
