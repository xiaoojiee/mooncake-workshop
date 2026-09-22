'use strict';

/* 拾取金币的「飞入」动画: 钱从柜台飞向顶栏的金币图标
 * 由 main.js 每帧 update/draw, 任何场景都能用 */

/* global ctx, W, COLORS, clamp, addFloater, coinIconPos, img, drawSprite */

const flyCoins = [];

/* 在 (fromX,fromY) 生成一枚飞向金币图标的钱 */
function spawnCoinFly(fromX, fromY, value) {
  let to = { x: W - 60, y: 35 };
  if (typeof coinIconPos === 'function') {
    try { to = coinIconPos(ctx); } catch (_) { /* 兜底用默认点 */ }
  }
  flyCoins.push({
    x0: fromX,
    y0: fromY,
    x1: to.x,
    y1: to.y,
    t: 0,
    dur: 0.46,
    value: value || 0,
    spin: Math.random() * Math.PI,
  });
}

function updateCoinFly(dt) {
  for (let i = flyCoins.length - 1; i >= 0; i--) {
    const f = flyCoins[i];
    f.t += dt;
    if (f.t < f.dur) continue;
    flyCoins.splice(i, 1);
    /* 到账: 在图标旁边冒个 +N */
    if (typeof addFloater === 'function') addFloater('+' + f.value, f.x1, f.y1 + 30, COLORS.gold, 0.7);
  }
}

function drawCoinFly(g) {
  if (!flyCoins.length) return;
  for (const f of flyCoins) {
    const p = clamp(f.t / f.dur, 0, 1);
    const e = p * p * (3 - 2 * p); // 平滑缓动
    const x = f.x0 + (f.x1 - f.x0) * e;
    const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(p * Math.PI) * 70; // 抛物线
    const size = 26 - 12 * p; // 越飞越小
    g.save();
    g.globalAlpha = 0.35 + 0.65 * (1 - p * p);
    const spr = typeof img === 'function' ? img('ui_coin') : null;
    if (spr && typeof drawSprite === 'function') {
      drawSprite(g, 'ui_coin', x - size / 2, y - size / 2, size, size);
    } else {
      g.fillStyle = COLORS.gold;
      g.beginPath();
      g.arc(x, y, size / 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
