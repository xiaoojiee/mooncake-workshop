'use strict';

/* UI 组件: 按钮 / 面板 / 卡片 / 进度条 / 金币条
 * 全部为立即模式(immediate mode), 由场景每帧绘制并自行处理点击 */

/* global COLORS, input, isUnlocked, img, drawSprite, drawNine, formatNum, SFX, W, H, LAYOUT,
   shop, run, DAY, pointInRect, fillRoundRect, strokeRoundRect, drawText, clamp, BG, clock,
   counterTopY, setFont */

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
    grd.addColorStop(0, COLORS.btnTopOn);
    grd.addColorStop(0.5, COLORS.btnMidOn);
    grd.addColorStop(1, COLORS.btnBotOn);
  } else {
    grd.addColorStop(0, COLORS.btnTop);
    grd.addColorStop(0.5, COLORS.btnMid);
    grd.addColorStop(1, COLORS.btnBot);
  }
  return grd;
}
/* 包边: 上亮金 → 下深橙(琥珀) */
function metalBorder(g, x, y, w, h) {
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, COLORS.borderTop);
  grd.addColorStop(0.45, COLORS.panelBorder);
  grd.addColorStop(1, COLORS.borderBot);
  return grd;
}
/* 粗包边(外圈深色刻画线 + 内圈细高光), 卡通描边风 */
function strokeMetal(g, x, y, w, h, r, width) {
  const bw = width || 5;
  g.save();
  g.globalAlpha = 0.22; // 外圈深色刻画线, 拉开层次
  strokeRoundRect(g, x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5, COLORS.btnInk, bw * 0.7);
  g.restore();
  strokeRoundRect(g, x, y, w, h, r, metalBorder(g, x, y, w, h), bw);
  g.save();
  g.globalAlpha = 0.7; // 内圈细白高光
  g.strokeStyle = COLORS.gloss;
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
  fillRoundRect(g, x, y + 5, b.w, b.h, rr, COLORS.shadow);
  fillRoundRect(g, x, y, b.w, b.h, rr, buttonBody(g, x, y, b.w, b.h, (hover || pressed) && !disabled));
  g.save();
  g.globalAlpha = 0.4;
  fillRoundRect(g, x + rr * 0.55, y + 3, Math.max(8, b.w - rr * 1.1), Math.max(5, b.h * 0.28), rr * 0.55, COLORS.gloss);
  g.restore();
  if (b.accent) strokeRoundRect(g, x, y, b.w, b.h, rr, b.accent, 4);
  else strokeMetal(g, x, y, b.w, b.h, rr, 4);

  /* 文字: 奶油字 + 深橙描边(卡通感) */
  const cx = x + b.w / 2;
  const cy = y + b.h / 2;
  const outline = COLORS.btnInk;
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
    g.shadowColor = COLORS.shadow;
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
    fillRoundRect(g, x + r * 0.4, y + 4, Math.max(10, w - r * 0.8), Math.max(6, h * 0.07), r * 0.4, COLORS.gloss);
    g.restore();
  }
}

/* 进度条 */
function uiBar(g, x, y, w, h, ratio, color, bg) {
  fillRoundRect(g, x, y, w, h, h / 2, bg || 'rgba(19,16,13,0.75)');
  const r = clamp(ratio, 0, 1);
  if (r > 0) fillRoundRect(g, x, y, Math.max(h, w * r), h, h / 2, color || COLORS.gold);
}

/* 顶部状态栏(天数/金币/口碑/静音) */
function uiHeader(g, opts) {
  const o = opts || {};
  g.save();
  /* 暖橙横条 + 底部亮边(压在背景上, 卡通感) */
  const bar = g.createLinearGradient(0, 0, 0, LAYOUT.headerH);
  bar.addColorStop(0, COLORS.headerTop);
  bar.addColorStop(1, COLORS.btnBotOn);
  g.fillStyle = bar;
  g.fillRect(0, 0, W, LAYOUT.headerH);
  g.fillStyle = COLORS.shadow;
  g.fillRect(0, 0, W, 3);
  g.fillStyle = COLORS.gloss;
  g.fillRect(0, LAYOUT.headerH - 4, W, 4);
  g.fillStyle = COLORS.shadow;
  g.fillRect(0, LAYOUT.headerH - 7, W, 3);

  /* 左侧留给全局背包 / 调试按钮 */
  drawText(g, o.title || '月饼工坊', 248, LAYOUT.headerH / 2, {
    size: 30, weight: 700, color: COLORS.cream, stroke: COLORS.btnInk, strokeWidth: 4,
  });

  /* 金币: 数字「右端固定、向左生长」, 金币图标紧贴数字左侧
   * 这样位数再多也不会顶到右边的「第N天 / 口碑」 */
  const rx = W - 28;
  const numStr = formatNum(shop.coins);
  setFont(g, 24, 700);
  const numW = g.measureText(numStr).width;
  const numRight = rx - 132;
  drawText(g, numStr, numRight, LAYOUT.headerH / 2, {
    size: 24, weight: 700, align: 'right', color: COLORS.cream, stroke: '#a35c12', strokeWidth: 3.5,
  });
  drawSprite(g, 'ui_coin', Math.max(430, numRight - numW - 42), LAYOUT.headerH / 2 - 17, 34, 34);
  drawText(g, '第 ' + shop.day + ' 天', rx - 20, LAYOUT.headerH / 2 - 12, {
    size: 18,
    weight: 700,
    align: 'right',
    color: COLORS.cream,
    stroke: COLORS.btnInk,
    strokeWidth: 3,
  });
  drawText(g, '口碑 ' + shop.reputation, rx - 20, LAYOUT.headerH / 2 + 14, {
    size: 14,
    weight: 600,
    align: 'right',
    color: COLORS.creamDim,
    stroke: COLORS.btnInk,
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
  bg.addColorStop(0.55, COLORS.bgWarm);
  bg.addColorStop(1, COLORS.bgWarmDeep);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  /* 中上方金色光晕 */
  const grd = g.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, H * 0.95);
  grd.addColorStop(0, 'rgba(243,227,182,0.42)');
  grd.addColorStop(1, 'rgba(243,227,182,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
}

/* ---- 程序化背景: 星空 + 圆月(暂代背景贴图, BG.sky 关掉即回退贴图) ---- */

/* 星星位置固定(用定种子伪随机生成一次, 免得每帧乱跳) */
let _stars = null;
function bgStars() {
  if (_stars) return _stars;
  _stars = [];
  let seed = 20260920;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 150; i++) {
    _stars.push({
      x: rnd() * W,
      y: rnd() * H * 0.66,
      r: 0.6 + rnd() * 1.7,
      a: 0.3 + rnd() * 0.7,
      tw: rnd() * Math.PI * 2, // 闪烁相位
    });
  }
  return _stars;
}

/* 环形山(相对月心的偏移/半径比例) */
const MOON_CRATERS = [
  [-0.30, -0.28, 0.18], [0.24, -0.34, 0.12], [0.34, 0.16, 0.16],
  [-0.16, 0.34, 0.13], [0.02, -0.06, 0.10], [-0.46, 0.08, 0.09],
  [0.12, 0.46, 0.08],
];

/* 一天的进度: 0 = 刚开门(月亮在东边/左), 1 = 打烊(月亮走到西边/右)
 * 没在营业(开始界面/工厂/排行榜)时按「已打烊」处理 = 1 */
function moonProgress() {
  const dur = (typeof DAY === 'object' && DAY && DAY.duration) || 90;
  const left = (typeof run === 'object' && run && run.dayTimeLeft) || 0;
  if (left <= 0) return 1;
  return clamp(1 - left / dur, 0, 1);
}

function drawNightSky(g) {
  g.save();

  /* 夜空: 深靛蓝 -> 紫 -> 暖橙地平线(和暖色 UI 衔接) */
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#141a3c');
  sky.addColorStop(0.34, '#2e2c58');
  sky.addColorStop(0.62, '#6b4a63');
  sky.addColorStop(0.82, '#a4694a');
  sky.addColorStop(1, '#c98a4a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  /* 银河雾带(斜向柔光) */
  const milky = g.createLinearGradient(W * 0.1, 0, W * 0.9, H * 0.7);
  milky.addColorStop(0, 'rgba(180,190,255,0)');
  milky.addColorStop(0.5, 'rgba(180,190,255,0.10)');
  milky.addColorStop(1, 'rgba(180,190,255,0)');
  g.fillStyle = milky;
  g.fillRect(0, 0, W, H * 0.8);

  /* 星星(带闪烁) */
  const t = (typeof clock === 'object' && clock && clock.time) || 0;
  for (const s of bgStars()) {
    const tw = 0.72 + 0.28 * Math.sin(t * 1.7 + s.tw);
    g.globalAlpha = s.a * tw;
    g.fillStyle = '#fff6dd';
    g.beginPath();
    g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  /* 圆月 + 光晕: 位置跟着一天的进度从左划到右(中段升到最高) */
  const mp = moonProgress();
  const mx = W * 0.12 + W * 0.76 * mp;
  const my = 172 - Math.sin(mp * Math.PI) * 58;
  const mr = 54;

  /* 光晕: 内圈亮 + 外圈柔(让月亮在夜空里「发光」) */
  const halo = g.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 5.2);
  halo.addColorStop(0, 'rgba(255,250,226,0.85)');
  halo.addColorStop(0.28, 'rgba(255,242,200,0.38)');
  halo.addColorStop(0.62, 'rgba(255,236,182,0.13)');
  halo.addColorStop(1, 'rgba(255,236,182,0)');
  g.fillStyle = halo;
  g.fillRect(mx - mr * 5.6, my - mr * 5.6, mr * 11.2, mr * 11.2);

  /* 月盘: 整体提亮, 只有最外缘略暗 */
  g.beginPath();
  g.arc(mx, my, mr, 0, Math.PI * 2);
  const moon = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.36, mr * 0.08, mx, my, mr * 1.02);
  moon.addColorStop(0, '#ffffff');
  moon.addColorStop(0.5, '#fffbe8');
  moon.addColorStop(0.85, '#fdf1c9');
  moon.addColorStop(1, '#f2e0ac');
  g.fillStyle = moon;
  g.fill();

  /* 环形山(很淡, 只做质感) */
  for (const [dx, dy, r] of MOON_CRATERS) {
    g.beginPath();
    g.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2);
    g.fillStyle = 'rgba(198,168,112,0.13)';
    g.fill();
  }
  /* 月缘亮圈 */
  g.beginPath();
  g.arc(mx, my, mr - 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255,255,244,0.9)';
  g.lineWidth = 2.5;
  g.stroke();

  /* 低空云带(几缕, 压在地平线附近) */
  g.globalAlpha = 0.22;
  g.fillStyle = '#ffe6bd';
  const clouds = [[-60, 470, 420, 34], [520, 512, 520, 40], [980, 452, 460, 30]];
  for (const [cx, cy, cw, ch] of clouds) {
    g.beginPath();
    g.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  g.restore();
}

/* 闭店: 分块给 UI 蒙一层半透明黑(关灯)
 * 三块: 头顶表头 / 柜台(面板)区 / 牌子(仅开始界面有牌子)
 * 中间的天空带(月亮所在)不蒙 */
/* 全局 HUD 挂件(背包/调试按钮 + 各浮窗)只在进入游戏后显示
 * 启动/加载页不显示, 也不响应点击 */
function hudChromeVisible() {
  return run.scene !== 'boot' && run.scene !== 'loading';
}

/* 蒙板只在「开始界面」用: 加载页/工厂/排行榜/营业场景都不蒙 */
function closedMaskActive() {
  return run.scene === 'menu';
}
/* 牌子的蒙板: 只在「今日休息」那一面(闭店)时压暗
 * 由 menu.js 的 drawFlipSign 在翻转变换内绘制, 所以会跟着牌子一起翻转 */
function signDimAlpha(open) {
  return closedMaskActive() && !open ? 0.45 : 0;
}
function closedMaskRects() {
  /* 天空带下沿 = 柜台真实上沿; 再往上多吃 2px, 兜住台面描边的抗锯齿边(免得露亮缝) */
  const top = (typeof counterTopY === 'function') ? counterTopY() : LAYOUT.counterY - 34;
  const skyBottom = top - 2;
  return [
    { x: 0, y: 0, w: W, h: LAYOUT.headerH, r: 0 }, // 头顶栏位
    { x: 0, y: skyBottom, w: W, h: H - skyBottom, r: 0 }, // 柜台部分
  ];
}
function drawClosedOverlay(g) {
  if (!closedMaskActive()) return; // 不在开始界面 -> 不蒙
  const color = 'rgba(0,0,0,0.45)';
  g.save();
  for (const r of closedMaskRects()) {
    if (r.r) fillRoundRect(g, r.x, r.y, r.w, r.h, r.r, color); // 圆角块(牌子)
    else {
      g.fillStyle = color;
      g.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  g.restore();
}

/* 画背景: 默认程序化星空圆月; BG.sky=false 时走贴图(cover 铺满 + 可上下提拉对位) */
function drawBg(g, key) {
  if (BG.sky !== false) {
    drawNightSky(g);
    return;
  }
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
  drawText(g, key, W - 20, H - 16, { size: 13, align: 'right', color: 'rgba(171,153,128,0.4)' });
}
