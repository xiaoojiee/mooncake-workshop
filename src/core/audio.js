'use strict';

/* 音效: WebAudio 合成占位, 可后续替换为 assets/audio/*.mp3
 * 非用户手势前不创建 AudioContext(浏览器策略) */

let audioCtx = null;
let audioMuted = false;

function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  } catch (_) {
    audioCtx = null;
  }
  return audioCtx;
}

/* 简单音调: freq 频率, dur 时长, type 波形, vol 音量 */
function beep(freq, dur, type, vol) {
  if (audioMuted) return;
  const ac = ensureAudio();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(vol == null ? 0.15 : vol, ac.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

/* ---- 音效文件(assets/音效/*.mp3) ----
 * 首次播放时懒加载(避免无用户手势时被浏览器拦); 同一音效可以重叠播放, 所以用小池子 */
const SOUND_SRC = {
  steve: 'assets/音效/史蒂夫.mp3', // 史蒂夫提要求
  eat: 'assets/音效/吃东西.mp3', // 所有与「吃」相关的(含耄耋偷吃)
  laowu: 'assets/音效/老吴.mp3', // 耄耋被打飞
  huff: 'assets/音效/哈气.mp3', // 耄耋扑人
  oven: 'assets/音效/烤炉工作音效.mp3', // 月饼入炉开烤
  place: 'assets/音效/放置音效.mp3', // 放料 / 摆盘 / 装组件
  hit: 'assets/音效/五金月饼击中音效.mp3', // 五金月饼命中
};
const SOUND_POOL = { steve: 1, eat: 4, laowu: 1, huff: 2, oven: 2, place: 3, hit: 2 }; // 每个音效准备几个实例
const soundPool = {};
const soundIdx = {};

function initSounds() {
  if (typeof Audio === 'undefined') return false; // Node/无音频环境
  for (const key in SOUND_SRC) {
    if (soundPool[key]) continue;
    const n = SOUND_POOL[key] || 1;
    soundPool[key] = [];
    for (let i = 0; i < n; i++) {
      const a = new Audio(SOUND_SRC[key]);
      a.preload = 'auto';
      soundPool[key].push(a);
    }
  }
  return true;
}

/* 播放某个音效; 无音频环境/静音时静默跳过 */
/* 移动端解锁: 浏览器/WebView 要求「首次用户手势」里才能真正播放,
 * 所以第一次按下时把每个音效实例静音播一下再暂停(prime), 之后就能正常响 */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const ac = ensureAudio();
  if (ac && ac.state === 'suspended') ac.resume();
  if (typeof Audio === 'undefined') return;
  try { initSounds(); } catch (_) { return; }
  for (const key in soundPool) {
    for (const a of soundPool[key]) {
      try {
        a.muted = true;
        const p = a.play();
        if (p && p.then) {
          p.then(() => {
            try { a.pause(); a.currentTime = 0; } catch (_) {}
            a.muted = false;
          }).catch(() => { a.muted = false; });
        } else a.muted = false;
      } catch (_) { a.muted = false; }
    }
  }
}

function playSound(key, vol) {
  if (audioMuted) return;
  if (typeof Audio === 'undefined') return;
  if (!soundPool[key]) { try { initSounds(); } catch (_) { return; } }
  const pool = soundPool[key];
  if (!pool || !pool.length) return;
  const i = (soundIdx[key] = (soundIdx[key] || 0) + 1);
  const a = pool[i % pool.length];
  try {
    a.currentTime = 0;
    a.volume = vol == null ? 1 : vol;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // 自动播放被拦: 忽略
  } catch (_) {}
}

const SFX = {
  steve: () => playSound('steve'),
  eat: () => playSound('eat'),
  laowu: () => playSound('laowu'),
  huff: () => playSound('huff'),
  oven: () => playSound('oven'),
  hit: () => playSound('hit'),
  click: () => beep(520, 0.08, 'triangle', 0.12),
  /* 放料 / 摆盘 / 装组件: 用「放置音效」文件 */
  stamp: () => playSound('place'),
  success: () => {
    beep(660, 0.12, 'sine', 0.14);
    setTimeout(() => beep(880, 0.18, 'sine', 0.14), 90);
  },
  fail: () => {
    beep(200, 0.22, 'sawtooth', 0.12);
    setTimeout(() => beep(150, 0.28, 'sawtooth', 0.12), 120);
  },
  coin: () => {
    beep(1200, 0.06, 'square', 0.1);
    setTimeout(() => beep(1600, 0.1, 'square', 0.08), 60);
  },
  unlock: () => {
    beep(523, 0.12, 'sine', 0.14);
    setTimeout(() => beep(659, 0.12, 'sine', 0.14), 100);
    setTimeout(() => beep(784, 0.2, 'sine', 0.14), 200);
  },
};

function toggleMute() {
  audioMuted = !audioMuted;
  showScreenText(audioMuted ? '静音' : '声音开');
}
function isMuted() {
  return audioMuted;
}
