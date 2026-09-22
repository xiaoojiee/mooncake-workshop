'use strict';

/* 画布元素与 DPR 适配: 固定 16:9 逻辑分辨率, CSS 负责 letterbox 缩放 */

/* global W, H */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let dpr = 1;
function resize() {
  /* 手机(iPhone 类 3x 屏)把 DPR 压到 1.5, 少画一半像素, 保住帧率 */
  const small = Math.min(window.innerWidth || W, window.innerHeight || H) < 900;
  dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  /* 缩放贴图时使用高质量采样, 避免边缘发糊(改 canvas 尺寸会重置上下文状态) */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}
resize();
window.addEventListener('resize', resize);

/* 手机 / Toy 容器适配: 按容器给的可用尺寸(扣掉刘海/安全区)算画布显示大小
 * 状态来自 Toy.onContainerChange(端外没这能力时靠 CSS 的 env() 安全区) */
function applyContainerSize(state) {
  if (!state) { resize(); return; }
  const vp = state.viewport || {};
  const sa = state.safeArea || {};
  const vw = vp.width || window.innerWidth || W;
  const vh = vp.height || window.innerHeight || H;
  const availW = Math.max(160, vw - (sa.left || 0) - (sa.right || 0) - 6);
  const availH = Math.max(90, vh - (sa.top || 0) - (sa.bottom || 0) - 6);
  let cw = availW;
  let ch = (cw * H) / W;
  if (ch > availH) {
    ch = availH;
    cw = (ch * W) / H;
  }
  canvas.style.width = Math.floor(cw) + 'px';
  canvas.style.height = Math.floor(ch) + 'px';
  resize();
}

/* 逻辑坐标 <-> 屏幕坐标(供指针输入换算, 兼容 letterbox 留边) */
function screenToLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * W,
    y: ((clientY - r.top) / r.height) * H,
  };
}
