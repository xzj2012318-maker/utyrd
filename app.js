// i love s2u 💗 — 摄像头手指文字跟随 + 手势触发语音（双手版）
// 手部识别库与模型从 CDN 加载（部署包仅需 8 个小文件）
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const loadingDot = document.getElementById('loadingDot');
const errBox = document.getElementById('errBox');
const retryBtn = document.getElementById('retryBtn');

// ---------- 配置 ----------
const TIPS = { thumb: 4, middle: 12, ring: 16 };
const TOUCH_DIST = 0.06;   // 归一化距离阈值（可调：越大越灵敏）

// 右手：i(拇指) love(无名指) s2u(中指) ｜ 左手：•(拇指) very(无名指) much(中指)
const LABELS_RIGHT = [
  { key: 'i',    tip: TIPS.thumb,  text: 'i',    cls: 'label-i' },
  { key: 'love', tip: TIPS.ring,   text: 'love', cls: 'label-love' },
  { key: 's2u',  tip: TIPS.middle, text: 's2u',  cls: 'label-s2u' },
];
const LABELS_LEFT = [
  { key: 'dot',  tip: TIPS.thumb,  text: '•',    cls: 'label-dot' },
  { key: 'very', tip: TIPS.ring,   text: 'very', cls: 'label-very' },
  { key: 'much', tip: TIPS.middle, text: 'much', cls: 'label-much' },
];
// 触发声音：拇指+无名指 / 拇指+中指
const VOICES_RIGHT = { ring: 'I love', middle: '哈秋' };
const VOICES_LEFT  = { ring: 'very',   middle: 'much' };

let landmarker = null;
let lastVideoTime = -1;
// 每只手独立的手势状态
const handState = new Map();   // handIdx -> { ring: bool, middle: bool }

// ---------- 声音（预生成音频文件：多端一致、零延迟、无浏览器 TTS 限制） ----------
const SOUNDS = {
  'I love': 'i_love.wav',
  '哈秋':   'haqiu.wav',
  'very':   'very.wav',
  'much':   'much.wav',
};
const players = {};
for (const k in SOUNDS) {
  const a = new Audio(SOUNDS[k]);
  a.preload = 'auto';
  players[k] = a;
}

// iOS/部分浏览器要求用户手势后才能出声：首次触摸时预热解锁
function unlockAudio() {
  for (const k in players) {
    const a = players[k];
    a.volume = 0;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = 1; }).catch(() => {});
  }
}
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });
window.addEventListener('load', unlockAudio, { once: true });

function playSound(text) {
  const a = players[text];
  if (!a) return;
  // 打断其他声音，立即播新的
  for (const k in players) {
    if (k !== text) { players[k].pause(); players[k].currentTime = 0; }
  }
  a.currentTime = 0;
  a.play().catch(() => {});
}

// ---------- 指尖文字（每只手独立创建） ----------
const handLabelCache = new Map();   // handIdx -> { key -> el }
const smoothState = new Map();      // handIdx -> { key -> {x,y} }

function getLabelsForHand(i, labels) {
  let els = handLabelCache.get(i);
  if (!els) {
    els = {};
    for (const l of labels) {
      const el = document.createElement('div');
      el.className = 'finger-label ' + l.cls;
      el.textContent = l.text;
      overlay.appendChild(el);
      els[l.key] = el;
    }
    handLabelCache.set(i, els);
    smoothState.set(i, {});
    for (const l of labels) smoothState.get(i)[l.key] = { x: null, y: null };
  }
  return els;
}

function flashEl(...els) {
  for (const el of els) {
    if (!el) continue;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

// ---------- cover 坐标映射 ----------
function mapPoint(p) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const W = overlay.clientWidth;
  const H = overlay.clientHeight;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (W - dw) / 2;
  const oy = (H - dh) / 2;
  return {
    x: ox + (1 - p.x) * dw,   // overlay 不镜像，坐标反转匹配镜像画面
    y: oy + p.y * dh,
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------- 渲染 ----------
function render(res) {
  // 先隐藏所有文字
  const all = document.querySelectorAll('.finger-label');
  for (const el of all) el.style.opacity = '0';

  if (!res.landmarks || res.landmarks.length === 0) return;

  for (let i = 0; i < res.landmarks.length; i++) {
    const lm = res.landmarks[i];
    if (!lm || lm.length < 21) continue;

    // 判定手：图像中 Left = 用户右手；无 handedness 时按索引 0=右 1=左
    let isUserRight = (i === 0);
    if (res.handednesses && res.handednesses[i] && res.handednesses[i][0]) {
      isUserRight = res.handednesses[i][0].categoryName === 'Left';
    }
    const labels = isUserRight ? LABELS_RIGHT : LABELS_LEFT;
    const voices = isUserRight ? VOICES_RIGHT : VOICES_LEFT;
    const els = getLabelsForHand(i, labels);
    const st = smoothState.get(i);
    const conf = res.handednesses && res.handednesses[i] && res.handednesses[i][0]
      ? res.handednesses[i][0].score : 0;

    // 文字跟随指尖
    for (const l of labels) {
      const p = mapPoint(lm[l.tip]);
      const prev = st[l.key];
      if (prev.x === null) {
        prev.x = p.x; prev.y = p.y;
      } else {
        prev.x = prev.x * 0.35 + p.x * 0.65;   // EMA 平滑（跟手更快）
        prev.y = prev.y * 0.35 + p.y * 0.65;
      }
      const el = els[l.key];
      el.style.left = prev.x + 'px';
      el.style.top = prev.y + 'px';
      el.style.opacity = conf > 0.5 ? '1' : '0.25';
    }

    // 手势触发（碰一次响一次，每只手独立）
    if (!handState.has(i)) handState.set(i, { ring: false, middle: false });
    const hs = handState.get(i);

    const dIR = dist(lm[TIPS.thumb], lm[TIPS.ring]);    // 拇指-无名指
    const dIM = dist(lm[TIPS.thumb], lm[TIPS.middle]);  // 拇指-中指

    if (dIR < TOUCH_DIST) {
      if (!hs.ring) {
        hs.ring = true;
        playSound(voices.ring);
        flashEl(els[labels[1].key], els[labels[0].key]);
      }
    } else {
      hs.ring = false;
    }

    if (dIM < TOUCH_DIST) {
      if (!hs.middle) {
        hs.middle = true;
        playSound(voices.middle);
        flashEl(els[labels[2].key], els[labels[0].key]);
      }
    } else {
      hs.middle = false;
    }
  }
}

// ---------- 主循环 ----------
function loop() {
  if (landmarker && video.readyState >= 2) {
    const t = video.currentTime;
    if (t !== lastVideoTime) {
      lastVideoTime = t;
      try {
        const res = landmarker.detectForVideo(video, performance.now());
        render(res);
      } catch (e) {
        console.error(e);
      }
    }
  }
  requestAnimationFrame(loop);
}

// ---------- 加载模型 ----------
async function loadModel() {
  loadingDot.classList.remove('hidden');
  try {
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/');
    const opts = {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.7,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(vision, opts);
    } catch (gpuErr) {
      console.warn('GPU failed, CPU fallback:', gpuErr);
      opts.baseOptions.delegate = 'CPU';
      landmarker = await HandLandmarker.createFromOptions(vision, opts);
    }
    return true;
  } catch (e) {
    console.error(e);
    errBox.textContent = '模型加载失败，刷新重试';
    errBox.classList.remove('hidden');
    return false;
  } finally {
    loadingDot.classList.add('hidden');
  }
}

// ---------- 自动启动（页面加载即尝试调取摄像头；失败时显示触摸层，点屏幕重试） ----------
const tapLayer = document.getElementById('tapLayer');
let starting = false;
async function start() {
  if (starting) return;
  starting = true;
  retryBtn.classList.add('hidden');
  errBox.classList.add('hidden');
  loadingDot.classList.remove('hidden');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    if (!landmarker) {
      const ok = await loadModel();
      if (!ok) { starting = false; return; }
    }
    loop();
  } catch (e) {
    console.error(e);
    // 自动请求被拒（移动端需用户手势）：显示触摸层，点屏幕重试
    tapLayer.classList.remove('hidden');
  } finally {
    loadingDot.classList.add('hidden');
    starting = false;
  }
}

function tapStart() {
  tapLayer.classList.add('hidden');
  unlockAudio();
  start();
}

// 页面加载完成即自动调取摄像头
window.addEventListener('load', start);
tapLayer.addEventListener('click', tapStart);
tapLayer.addEventListener('touchstart', tapStart, { passive: true });
retryBtn.addEventListener('click', start);
