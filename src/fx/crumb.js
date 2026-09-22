'use strict';

/* 碎屑粒子: 吃东西时冒出来的小方块(像 Minecraft 吃东西)
 * 由 main.js 每帧 update/draw, 任何场景都能用 */

/* global ctx, W */

const crumbs = [];

/* 在 (x,y) 冒 n 个某颜色的碎屑 */
function spawnCrumbs(x, y, color, n, power) {
  const k = n || 6;
  const p = power || 1;
  for (let i = 0; i < k; i++) {
    const life = 0.5 + Math.random() * 0.45;
    crumbs.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 130 * p,
      vy: -60 * p - Math.random() * 120 * p,
      size: 3 + Math.random() * 4,
      color: color || '#d8c9a3',
      life: life,
      maxLife: life,
      spin: Math.random() * Math.PI,
      spinV: (Math.random() - 0.5) * 12,
    });
  }
}

function updateCrumbs(dt) {
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i];
    c.life -= dt;
    if (c.life <= 0) { crumbs.splice(i, 1); continue; }
    c.vy += 900 * dt; // 重力
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.spin += c.spinV * dt;
  }
}

function drawCrumbs(g) {
  if (!crumbs.length) return;
  g.save();
  for (const c of crumbs) {
    const a = Math.min(1, c.life / (c.maxLife * 0.7));
    g.globalAlpha = a;
    g.fillStyle = c.color;
    g.translate(c.x, c.y);
    g.rotate(c.spin);
    g.fillRect(-c.size / 2, -c.size / 2, c.size, c.size);
    g.rotate(-c.spin);
    g.translate(-c.x, -c.y);
  }
  g.restore();
}
