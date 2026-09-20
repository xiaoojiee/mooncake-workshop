'use strict';

/* 通用工具: 数学/绘图/文本/色彩/几何 */

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}
function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
/* 帧率无关的指数逼近 */
function approach(cur, target, rate, dt) {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}
function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
function pointInCircle(px, py, cx, cy, r) {
  return dist(px, py, cx, cy) <= r;
}

/* ---- 绘图 ---- */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
function fillRoundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}
function strokeRoundRect(ctx, x, y, w, h, r, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw || 2;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

/* ---- 文本 ---- */

/* global UI_SCALE */
function setFont(ctx, size, weight) {
  const s = UI_SCALE ? size * UI_SCALE : size;
  ctx.font = (weight || 400) + ' ' + s.toFixed(1) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
}
/* 居中/对齐绘制的简写 */
function drawText(ctx, text, x, y, opts) {
  const o = opts || {};
  ctx.save();
  if (o.size) setFont(ctx, o.size, o.weight);
  ctx.fillStyle = o.color || '#6d3a12';
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'middle';
  if (o.shadow) {
    ctx.shadowColor = o.shadow;
    ctx.shadowBlur = o.shadowBlur || 4;
    ctx.shadowOffsetY = o.shadowOffsetY || 2;
  }
  /* 卡通描边字: 先描粗边再填色 */
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = o.strokeWidth || 3;
    ctx.strokeStyle = o.stroke;
    if (o.maxWidth) ctx.strokeText(text, x, y, o.maxWidth);
    else ctx.strokeText(text, x, y);
  }
  if (o.maxWidth) ctx.fillText(text, x, y, o.maxWidth);
  else ctx.fillText(text, x, y);
  ctx.restore();
}
/* 自动换行, 返回占用高度 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight, opts) {
  const o = opts || {};
  if (o.size) setFont(ctx, o.size, o.weight);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = o.color || '#6d3a12';
  const lh = lineHeight * (UI_SCALE || 1);
  let line = '';
  let cy = y;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = ch;
      cy += lh;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lh;
  }
  return cy - y;
}

/* ---- 颜色 ---- */

function shade(hex, amount) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = clamp(Math.round(r + amount * 255), 0, 255);
  g = clamp(Math.round(g + amount * 255), 0, 255);
  b = clamp(Math.round(b + amount * 255), 0, 255);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ---- 时间格式 ---- */

function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function formatNum(n) {
  return Math.floor(n).toLocaleString('en-US');
}
