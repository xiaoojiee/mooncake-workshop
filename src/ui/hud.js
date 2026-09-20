'use strict';

/* UI 组件: 按钮 / 面板 / 卡片 / 进度条 / 金币条
 * 全部为立即模式(immediate mode), 由场景每帧绘制并自行处理点击 */

/* global COLORS, input, isUnlocked, img, drawSprite, drawNine, formatNum, SFX, W, H, LAYOUT,
   shop, pointInRect, fillRoundRect, strokeRoundRect, drawText, clamp, BG */

/* 面板底色: 竖向「顶亮→底暗」渐变(奶油/塑料质感) */
function panelBody(g, x, y, w, h, base) {
  if (typeof base !== 'string' || base[0] !== '#') return base;
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, shade(base, 0.1));
  grd.addColorStop(0.45, base);
  grd.addColorStop(1, shade(base, -0.08));
  return grd;
}
/* 按钮/橙色件底色: 橙面渐变(active 更亮) */
function buttonBody(g, x, y, w, h, active) {
  const grd = g.createLinearGradient(x, y, x, y + h);
  if (active) {
    grd.addColorStop(0, '#ffd071');
    grd.addColorStop(0.5, '#f6a52f');
    grd.addColorStop(1, '#dd7d13');
  } else {
    grd.addColorStop(0, '#ffc766');
    grd.addColorStop(0.5, '#f0a03c');
    grd.addColorStop(1, '#d97f21');
  }
  return grd;
}
/* 包边: 上亮金 → 下深橙(琥珀) */
function metalBorder(g, x, y, w, h) {
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, '#ffd27a');
  grd.addColorStop(0.45, COLORS.panelBorder);
  grd.addColorStop(1, '#c2650d');
  return grd;
}
/* 粗包边(外圈深色刻画线 + 内圈细高光), 卡通描边风 */
function strokeMetal(g, x, y, w, h, r, width) {
  const bw = width || 5;
  g.save();
  g.globalAlpha = 0.22; // 外圈深色刻画线, 拉开层次
  strokeRoundRect(g, x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5, '#6d3a12', bw * 0.7);
  g.restore();
  strokeRoundRect(g, x, y, w, h, r, metalBorder(g, x, y, w, h), bw);
  g.save();
  g.globalAlpha = 0.7; // 内圈细白高光
  g.strokeStyle = '#fffdf2';
  g.lineWidth = 1.6;
  roundRect(g, x + bw * 0.72, y + bw * 0.72, w - bw * 1.44, h - bw * 1.44, Math.max(2, r - bw * 0.72));
  g.stroke();
  g.restore();
}

/* 通用卡片/标签: 斜面底 + 金属包边(active 更亮更粗) */
function drawCard(g, x, y, w, h, r, active) {
  const base = active ? COLORS.panelLight : COLORS.panel;
  fillRoundRect(g, x, y, w, h, r, panelBody(g, x, y, w, h, base));
  strokeMetal(g, x, y, w, h, r, active ? 5 : 3);
}

function uiButton(g, b) {
  const hover = b.hover || false;
  const disabled = b.disabled || false;
  const pressed = b.pressed || false;
  const lift = pressed ? 2 : 0;
  const x = b.x;
  const y = b.y + lift;

  g.save();
  g.globalAlpha = disabled ? 0.45 : 1;

  /* 按钮: 橙色渐变 + 顶部高光带 + 粗包边(悬停/按下更亮) */
  const rr = b.r || 14;
  fillRoundRect(g, x, y + 5, b.w, b.h, rr, 'rgba(109,58,18,0.32)');
  fillRoundRect(g, x, y, b.w, b.h, rr, buttonBody(g, x, y, b.w, b.h, (hover || pressed) && !disabled));
  g.save();
  g.globalAlpha = 0.4;
  fillRoundRect(g, x + rr * 0.55, y + 3, Math.max(8, b.w - rr * 1.1), Math.max(5, b.h * 0.28), rr * 0.55, '#ffffff');
  g.restore();
  if (b.accent) strokeRoundRect(g, x, y, b.w, b.h, rr, b.accent, 4);
  else strokeMetal(g, x, y, b.w, b.h, rr, 4);

  /* 文字: 奶油字 + 深橙描边(卡通感) */
  const cx = x + b.w / 2;
  const cy = y + b.h / 2;
  const outline = '#a35c12';
  if (b.sublabel) {
    drawText(g, b.label, cx, cy - 10, {
      size: b.size || 20, weight: 700, align: 'center',
      color: b.color || COLORS.cream, stroke: outline, strokeWidth: 3.5,
    });
    drawText(g, b.sublabel, cx, cy + 14, {
      size: 13, align: 'center', color: b.subColor || COLORS.creamDim, stroke: outline, strokeWidth: 2.5,
    });
  } else {
    drawText(g, b.label, cx, cy, {
      size: b.size || 18, weight: 700, align: 'center',
      color: b.color || COLORS.cream, stroke: outline, strokeWidth: 3,
    });
  }

  /* 价格(画在浅色面板上 -> 深棕) */
  if (b.cost != null) {
    drawText(g, '💰 ' + formatNum(b.cost), cx, y + b.h + 16, {
      size: 15,
      weight: 700,
      align: 'center',
      color: b.costColor || COLORS.panelInk,
    });
  }

  /* 锁定角标 */
  if (b.locked) {
    g.globalAlpha = 0.9;
    fillRoundRect(g, x, y, b.w, b.h, b.r || 14, 'rgba(0,0,0,0.55)');
    drawSprite(g, 'ui_lock', cx - 22, cy - 22, 44, 44);
    if (b.lockLabel) {
      drawText(g, b.lockLabel, cx, cy + 34, { size: 13, align: 'center', color: COLORS.warn });
    }
  }
  g.restore();
}

function uiPanel(g, x, y, w, h, opts) {
  const o = opts || {};
  /* 面板: 程序化绘制 —— 左上亮/右下暗斜面底 + 粗金属包边 */
  if (o.image && img(o.image)) {
    g.drawImage(img(o.image), x, y, w, h);
    return;
  }
  const r = o.r || 18;
  g.save();
  if (o.shadow !== false) {
    g.shadowColor = 'rgba(90,45,10,0.35)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 5;
  }
  fillRoundRect(g, x, y, w, h, r, panelBody(g, x, y, w, h, o.color || COLORS.panel));
  g.restore();
  if (o.border !== false) {
    if (o.borderColor) strokeRoundRect(g, x, y, w, h, r, o.borderColor, o.borderWidth || 4);
    else strokeMetal(g, x, y, w, h, r, o.borderWidth || 4);
  }
  /* 顶部内高光: 奶油面板的塑料光泽 */
  if (o.gloss !== false) {
    g.save();
    g.globalAlpha = 0.3;
    fillRoundRect(g, x + r * 0.4, y + 4, Math.max(10, w - r * 0.8), Math.max(6, h * 0.07), r * 0.4, '#ffffff');
    g.restore();
  }
}

/* 进度条 */
function uiBar(g, x, y, w, h, ratio, color, bg) {
  fillRoundRect(g, x, y, w, h, h / 2, bg || 'rgba(20,16,12,0.75)');
  const r = clamp(ratio, 0, 1);
  if (r > 0) fillRoundRect(g, x, y, Math.max(h, w * r), h, h / 2, color || COLORS.gold);
}

/* 顶部状态栏(天数/金币/口碑/静音) */
function uiHeader(g, opts) {
  const o = opts || {};
  g.save();
  /* 暖橙横条 + 底部亮边(压在背景上, 卡通感) */
  const bar = g.createLinearGradient(0, 0, 0, LAYOUT.headerH);
  bar.addColorStop(0, '#f2a641');
  bar.addColorStop(1, '#dd7d13');
  g.fillStyle = bar;
  g.fillRect(0, 0, W, LAYOUT.headerH);
  g.fillStyle = 'rgba(109,58,18,0.7)';
  g.fillRect(0, 0, W, 3);
  g.fillStyle = 'rgba(255,226,160,0.85)';
  g.fillRect(0, LAYOUT.headerH - 4, W, 4);
  g.fillStyle = 'rgba(109,58,18,0.25)';
  g.fillRect(0, LAYOUT.headerH - 7, W, 3);

  /* 左侧留给全局背包 / 调试按钮 */
  drawText(g, o.title || '月饼工坊', 248, LAYOUT.headerH / 2, {
    size: 30, weight: 700, color: COLORS.cream, stroke: '#a35c12', strokeWidth: 4,
  });

  /* 金币 */
  const rx = W - 28;
  drawSprite(g, 'ui_coin', rx - 200, LAYOUT.headerH / 2 - 17, 34, 34);
  drawText(g, formatNum(shop.coins), rx - 155, LAYOUT.headerH / 2, {
    size: 24, weight: 700, color: COLORS.cream, stroke: '#a35c12', strokeWidth: 3.5,
  });
  drawText(g, '第 ' + shop.day + ' 天', rx - 20, LAYOUT.headerH / 2 - 12, {
    size: 18,
    weight: 700,
    align: 'right',
    color: COLORS.cream,
    stroke: '#a35c12',
    strokeWidth: 3,
  });
  drawText(g, '口碑 ' + shop.reputation, rx - 20, LAYOUT.headerH / 2 + 14, {
    size: 14,
    weight: 600,
    align: 'right',
    color: COLORS.creamDim,
    stroke: '#a35c12',
    strokeWidth: 2.5,
  });
  g.restore();
}

/* 通用按钮点击检测: 返回被点击的按钮 */
function hitButton(buttons, x, y) {
  for (const b of buttons) {
    if (b.disabled) continue;
    if (pointInRect(x, y, b)) return b;
  }
  return null;
}

/* ---- 背景绘制 ---- */

/* 纯色渐变兜底背景 */
function drawFallbackBg(g) {
  /* 暖橙底, 和奶油面板/橙色按钮统一 */
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, COLORS.bgWarm);
  bg.addColorStop(0.55, '#eb9430');
  bg.addColorStop(1, COLORS.bgWarmDeep);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  /* 中上方金色光晕 */
  const grd = g.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, H * 0.95);
  grd.addColorStop(0, 'rgba(255,232,170,0.42)');
  grd.addColorStop(1, 'rgba(255,232,170,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
}

/* 画背景贴图: cover 铺满(不拉伸变形) + 可上下提拉对位; 缺失时退回渐变并标注 key */
function drawBg(g, key) {
  const i = img(key);
  if (i) {
    /* 平移后底部可能露边, 先铺底色, 免得露出透明画布 */
    g.fillStyle = COLORS.bgWarm;
    g.fillRect(0, 0, W, H);
    const zoom = (typeof BG === 'object' && BG && BG.zoom) || 1;
    const offY = (typeof BG === 'object' && BG && BG.offsetY) || 0; // 比例: -0.3 = 上移 30%
    const offX = (typeof BG === 'object' && BG && BG.offsetX) || 0;
    const s = Math.max(W / i.naturalWidth, H / i.naturalHeight) * zoom;
    const dw = i.naturalWidth * s;
    const dh = i.naturalHeight * s;
    g.drawImage(i, (W - dw) / 2 + offX * dw, (H - dh) / 2 + offY * dh, dw, dh);
    return;
  }
  drawFallbackBg(g);
  drawText(g, key, W - 20, H - 16, { size: 13, align: 'right', color: 'rgba(179,155,120,0.4)' });
}
