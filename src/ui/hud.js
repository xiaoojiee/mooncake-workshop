'use strict';

/* UI 组件: 按钮 / 面板 / 卡片 / 进度条 / 金币条
 * 全部为立即模式(immediate mode), 由场景每帧绘制并自行处理点击 */

/* global COLORS, input, isUnlocked, img, drawSprite, drawNine, formatNum, SFX, W, H, LAYOUT,
   shop, pointInRect, fillRoundRect, strokeRoundRect, drawText, clamp, BG */

/* 面板底色: 沿左上→右下 做浅→深的斜面渐变 */
function panelBody(g, x, y, w, h, base) {
  if (typeof base !== 'string' || base[0] !== '#') return base;
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, shade(base, 0.14));
  grd.addColorStop(0.55, base);
  grd.addColorStop(1, shade(base, -0.16));
  return grd;
}
/* 金属包边: 左上高光金 → 右下暗金 */
function metalBorder(g, x, y, w, h) {
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, '#ffe9a8');
  grd.addColorStop(0.35, COLORS.panelBorder);
  grd.addColorStop(0.7, '#d99a1e');
  grd.addColorStop(1, '#8f5f0a');
  return grd;
}
/* 粗金属包边(外圈渐变描边 + 左上内高光) */
function strokeMetal(g, x, y, w, h, r, width) {
  const bw = width || 4;
  strokeRoundRect(g, x, y, w, h, r, metalBorder(g, x, y, w, h), bw);
  g.save();
  g.globalAlpha = 0.32;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5;
  roundRect(g, x + bw * 0.75, y + bw * 0.75, w - bw * 1.5, h - bw * 1.5, Math.max(2, r - bw * 0.75));
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

  /* 按钮也程序化绘制: 斜面底 + 粗金属包边(悬停/按下更亮) */
  const rr = b.r || 14;
  const base = (hover || pressed) && !disabled ? COLORS.panelLight : COLORS.panel;
  fillRoundRect(g, x, y + 5, b.w, b.h, rr, 'rgba(0,0,0,0.35)');
  fillRoundRect(g, x, y, b.w, b.h, rr, panelBody(g, x, y, b.w, b.h, base));
  if (b.accent) strokeRoundRect(g, x, y, b.w, b.h, rr, b.accent, 4);
  else strokeMetal(g, x, y, b.w, b.h, rr, 4);

  /* 文字 */
  const cx = x + b.w / 2;
  const cy = y + b.h / 2;
  if (b.sublabel) {
    drawText(g, b.label, cx, cy - 10, { size: b.size || 20, weight: 700, align: 'center', color: b.color || COLORS.cream });
    drawText(g, b.sublabel, cx, cy + 14, { size: 13, align: 'center', color: COLORS.textDim });
  } else {
    drawText(g, b.label, cx, cy, { size: b.size || 18, weight: 600, align: 'center', color: b.color || COLORS.cream });
  }

  /* 价格 */
  if (b.cost != null) {
    drawText(g, '💰 ' + formatNum(b.cost), cx, y + b.h + 16, {
      size: 15,
      weight: 600,
      align: 'center',
      color: b.costColor || COLORS.gold,
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
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
  }
  fillRoundRect(g, x, y, w, h, r, panelBody(g, x, y, w, h, o.color || COLORS.panel));
  g.restore();
  if (o.border !== false) {
    if (o.borderColor) strokeRoundRect(g, x, y, w, h, r, o.borderColor, o.borderWidth || 4);
    else strokeMetal(g, x, y, w, h, r, o.borderWidth || 4);
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
  g.fillStyle = 'rgba(20,16,12,0.6)';
  g.fillRect(0, 0, W, LAYOUT.headerH);

  /* 左侧留给全局背包 / 调试按钮 */
  drawText(g, o.title || '月饼工坊', 248, LAYOUT.headerH / 2, { size: 30, weight: 700, color: COLORS.gold });

  /* 金币 */
  const rx = W - 28;
  drawSprite(g, 'ui_coin', rx - 200, LAYOUT.headerH / 2 - 17, 34, 34);
  drawText(g, formatNum(shop.coins), rx - 155, LAYOUT.headerH / 2, { size: 24, weight: 700, color: COLORS.goldLight });
  drawText(g, '第 ' + shop.day + ' 天', rx - 20, LAYOUT.headerH / 2 - 12, {
    size: 18,
    weight: 600,
    align: 'right',
    color: COLORS.cream,
  });
  drawText(g, '口碑 ' + shop.reputation, rx - 20, LAYOUT.headerH / 2 + 14, {
    size: 14,
    align: 'right',
    color: COLORS.textDim,
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
  /* 暖木色底, 和面板/柜台统一 */
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a1710');
  bg.addColorStop(1, '#140c07');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const grd = g.createRadialGradient(W / 2, H * 0.4, 60, W / 2, H * 0.4, H);
  grd.addColorStop(0, 'rgba(217,164,65,0.14)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
}

/* 画背景贴图: cover 铺满(不拉伸变形) + 可上下提拉对位; 缺失时退回渐变并标注 key */
function drawBg(g, key) {
  const i = img(key);
  if (i) {
    /* 平移后底部可能露边, 先铺底色, 免得露出透明画布 */
    g.fillStyle = COLORS.bg;
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
