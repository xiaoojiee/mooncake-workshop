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

const SFX = {
  click: () => beep(520, 0.08, 'triangle', 0.12),
  stamp: () => beep(220, 0.16, 'square', 0.1),
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
