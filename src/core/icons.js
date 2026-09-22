'use strict';

/* 程序化图标: 组件 / 工厂 / 属性图标没有贴图时, 用代码画一个像样的
 * (有贴图时优先用贴图, 见 assets.js 的 drawSprite)
 * 风格对齐游戏: 厚描边 + 暖金/木色, 圆润简单 */

/* global COLORS, fillRoundRect, roundRect, img */

const ICON_INK = '#3a2412'; // 统一描边色
const ICON_WOOD = '#8a5a2b';
const ICON_COPPER = '#b5713f';

function iconStroke(g, size, w) {
  g.strokeStyle = ICON_INK;
  g.lineWidth = Math.max(1, size * (w || 0.06));
  g.lineJoin = 'round';
}
function iconFill(g, color) {
  g.fillStyle = color;
}
function iconCircle(g, cx, cy, r, fill, size, lineW) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  if (fill) { iconFill(g, fill); g.fill(); }
  if (size) { iconStroke(g, size, lineW); g.stroke(); }
}
function iconRect(g, x, y, w, h, r, fill, size, lineW) {
  if (r) {
    g.beginPath();
    roundRect(g, x, y, w, h, r);
    if (fill) { iconFill(g, fill); g.fill(); }
    if (size) { iconStroke(g, size, lineW); g.stroke(); }
  } else {
    if (fill) { iconFill(g, fill); g.fillRect(x, y, w, h); }
    if (size) { iconStroke(g, size, lineW); g.strokeRect(x, y, w, h); }
  }
}
function iconPath(g, pts, fill, size, lineW) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) { iconFill(g, fill); g.fill(); }
  if (size) { iconStroke(g, size, lineW); g.stroke(); }
}

/* 齿轮: 圆 + 一圈齿 */
function iconGear(g, cx, cy, r, size) {
  const teeth = 8;
  iconFill(g, COLORS.gold);
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = a0 + Math.PI / teeth * 0.55;
    const a2 = a0 + Math.PI / teeth * 1.1;
    const R = r * 1.28;
    g.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
    g.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
  }
  g.closePath();
  g.fill();
  iconStroke(g, size);
  g.stroke();
  iconCircle(g, cx, cy, r * 0.32, ICON_INK, 0);
}

/* 画某个 key 的程序化图标(居中, 最大边 ≈ size); 不认识返回 false */
function drawIconArt(g, key, cx, cy, size) {
  const s = size;
  const u = s / 100; // 以 100 为基准的缩放
  g.save();
  switch (key) {
    /* ---- 组件 ---- */
    case 'comp_motor': { // 动力马达: 木底座 + 铜缸 + 飞轮 + 白烟
      iconRect(g, cx - 40 * u, cy + 16 * u, 80 * u, 20 * u, 4 * u, ICON_WOOD, s);
      iconRect(g, cx - 30 * u, cy - 14 * u, 44 * u, 32 * u, 6 * u, ICON_COPPER, s);
      iconCircle(g, cx + 20 * u, cy + 2 * u, 20 * u, COLORS.gold, s);
      g.beginPath();
      g.moveTo(cx + 20 * u, cy - 14 * u);
      g.lineTo(cx + 20 * u, cy + 18 * u);
      g.moveTo(cx + 4 * u, cy + 2 * u);
      g.lineTo(cx + 36 * u, cy + 2 * u);
      g.stroke();
      iconCircle(g, cx - 20 * u, cy - 30 * u, 8 * u, 'rgba(251,244,230,0.9)', s);
      iconCircle(g, cx - 8 * u, cy - 40 * u, 6 * u, 'rgba(251,244,230,0.7)', 0);
      break;
    }
    case 'comp_gear': { // 传动齿轮: 一大一小
      iconGear(g, cx - 12 * u, cy + 8 * u, 28 * u, s);
      iconGear(g, cx + 28 * u, cy - 22 * u, 18 * u, s);
      break;
    }
    case 'comp_cooler': { // 冷凝管: 铜盘管 + 冰
      iconRect(g, cx - 26 * u, cy - 34 * u, 52 * u, 14 * u, 4 * u, ICON_COPPER, s);
      g.strokeStyle = ICON_INK;
      g.lineWidth = Math.max(1, s * 0.05);
      for (let i = 0; i < 3; i++) {
        const y = cy - 10 * u + i * 18 * u;
        g.beginPath();
        g.moveTo(cx - 24 * u, y);
        g.quadraticCurveTo(cx, y + 14 * u, cx + 24 * u, y);
        iconFill(g, ICON_COPPER);
        g.lineWidth = Math.max(1, s * 0.12);
        g.strokeStyle = ICON_COPPER;
        g.stroke();
        g.strokeStyle = ICON_INK;
        g.lineWidth = Math.max(1, s * 0.05);
        g.stroke();
      }
      iconCircle(g, cx + 26 * u, cy + 20 * u, 12 * u, COLORS.icy, s);
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        g.moveTo(cx + 26 * u - Math.cos(a) * 8 * u, cy + 20 * u - Math.sin(a) * 8 * u);
        g.lineTo(cx + 26 * u + Math.cos(a) * 8 * u, cy + 20 * u + Math.sin(a) * 8 * u);
      }
      g.stroke();
      break;
    }
    case 'comp_mold': { // 精工模具: 圆模 + 花
      iconCircle(g, cx, cy + 2 * u, 34 * u, COLORS.gold, s);
      iconFill(g, COLORS.goldLight);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * 14 * u, cy + 2 * u + Math.sin(a) * 14 * u, 8 * u, 6 * u, a, 0, Math.PI * 2);
        g.fill();
      }
      iconCircle(g, cx, cy + 2 * u, 7 * u, COLORS.goldLight, s, 0.04);
      break;
    }
    case 'comp_mixer': { // 搅拌桨: 盆 + 桨
      g.beginPath();
      g.moveTo(cx - 34 * u, cy - 4 * u);
      g.quadraticCurveTo(cx, cy + 44 * u, cx + 34 * u, cy - 4 * u);
      g.closePath();
      iconFill(g, '#cfd6da');
      g.fill();
      iconStroke(g, s);
      g.stroke();
      iconRect(g, cx - 4 * u, cy - 38 * u, 8 * u, 44 * u, 3 * u, COLORS.gold, s, 0.045);
      iconRect(g, cx - 16 * u, cy - 12 * u, 32 * u, 7 * u, 3 * u, COLORS.gold, s, 0.045);
      break;
    }
    case 'comp_moon': { // 月光石: 月牙 + 星
      iconCircle(g, cx - 2 * u, cy + 2 * u, 30 * u, COLORS.goldLight, s);
      iconCircle(g, cx + 14 * u, cy - 6 * u, 26 * u, 'rgba(0,0,0,0)', 0);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(cx + 16 * u, cy - 8 * u, 26 * u, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      iconCircle(g, cx - 2 * u, cy + 2 * u, 30 * u, null, s);
      for (const [dx, dy, r] of [[-30, -22, 5], [26, 20, 4], [6, -34, 3]]) {
        iconPath(g, [[cx + dx * u, cy + (dy - r) * u], [cx + (dx + r) * u, cy + dy * u],
          [cx + dx * u, cy + (dy + r) * u], [cx + (dx - r) * u, cy + dy * u]], COLORS.goldLight, 0);
      }
      break;
    }
    case 'comp_melon': { // 西瓜刀
      iconPath(g, [[cx - 34 * u, cy - 22 * u], [cx + 8 * u, cy - 26 * u], [cx + 14 * u, cy + 14 * u],
        [cx - 28 * u, cy + 12 * u]], '#e8e2d6', s);
      iconPath(g, [[cx - 30 * u, cy - 20 * u], [cx + 4 * u, cy - 23 * u], [cx + 9 * u, cy + 6 * u],
        [cx - 25 * u, cy + 4 * u]], '#c94b4b', 0);
      iconRect(g, cx + 6 * u, cy + 8 * u, 34 * u, 12 * u, 5 * u, ICON_WOOD, s, 0.045);
      iconFill(g, ICON_INK);
      for (const [dx, dy] of [[-20, -12], [-8, -4], [-16, 2]]) {
        g.beginPath();
        g.ellipse(cx + dx * u, cy + dy * u, 3 * u, 4.5 * u, 0.4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'comp_nut': { // 螺母馅压机
      iconRect(g, cx - 30 * u, cy - 34 * u, 60 * u, 10 * u, 3 * u, ICON_WOOD, s, 0.045);
      iconRect(g, cx - 26 * u, cy - 24 * u, 8 * u, 46 * u, 3 * u, ICON_WOOD, s, 0.045);
      iconRect(g, cx + 18 * u, cy - 24 * u, 8 * u, 46 * u, 3 * u, ICON_WOOD, s, 0.045);
      iconRect(g, cx - 18 * u, cy - 14 * u, 36 * u, 10 * u, 3 * u, COLORS.gold, s, 0.045);
      iconPath(g, [[cx, cy + 2 * u], [cx + 15 * u, cy + 10 * u], [cx + 15 * u, cy + 26 * u],
        [cx, cy + 34 * u], [cx - 15 * u, cy + 26 * u], [cx - 15 * u, cy + 10 * u]], '#b9c0c7', s, 0.045);
      iconCircle(g, cx, cy + 18 * u, 6 * u, ICON_INK, 0);
      break;
    }
    case 'comp_kiln': { // 高温窑炉
      g.beginPath();
      g.moveTo(cx - 34 * u, cy + 30 * u);
      g.lineTo(cx - 34 * u, cy - 2 * u);
      g.quadraticCurveTo(cx, cy - 40 * u, cx + 34 * u, cy - 2 * u);
      g.lineTo(cx + 34 * u, cy + 30 * u);
      g.closePath();
      iconFill(g, '#a8543c');
      g.fill();
      iconStroke(g, s);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - 34 * u, cy + 8 * u);
      g.lineTo(cx + 34 * u, cy + 8 * u);
      g.moveTo(cx - 20 * u, cy - 14 * u);
      g.lineTo(cx - 20 * u, cy + 8 * u);
      g.moveTo(cx + 20 * u, cy - 14 * u);
      g.lineTo(cx + 20 * u, cy + 8 * u);
      g.stroke();
      iconPath(g, [[cx, cy + 2 * u], [cx + 11 * u, cy + 22 * u], [cx - 11 * u, cy + 22 * u]], '#f0a83c', 0);
      iconPath(g, [[cx, cy + 12 * u], [cx + 5 * u, cy + 24 * u], [cx - 5 * u, cy + 24 * u]], '#f6d06a', 0);
      break;
    }
    case 'comp_spawner': { // 僵尸刷怪笼
      iconRect(g, cx - 30 * u, cy - 22 * u, 60 * u, 52 * u, 6 * u, '#4b4f52', s);
      g.strokeStyle = 'rgba(120,240,140,0.9)';
      g.lineWidth = Math.max(1, s * 0.045);
      for (let i = 1; i < 3; i++) {
        g.beginPath();
        g.moveTo(cx - 30 * u + (60 * u / 3) * i, cy - 22 * u);
        g.lineTo(cx - 30 * u + (60 * u / 3) * i, cy + 30 * u);
        g.moveTo(cx - 30 * u, cy - 22 * u + (52 * u / 3) * i);
        g.lineTo(cx + 30 * u, cy - 22 * u + (52 * u / 3) * i);
        g.stroke();
      }
      iconCircle(g, cx, cy + 4 * u, 14 * u, 'rgba(120,240,140,0.5)', 0);
      break;
    }
    /* ---- 工厂 / 属性 ---- */
    case 'factory_crust': { // 饼皮工坊: 压面机
      iconRect(g, cx - 36 * u, cy - 18 * u, 72 * u, 44 * u, 6 * u, ICON_WOOD, s);
      iconCircle(g, cx - 16 * u, cy + 2 * u, 14 * u, COLORS.gold, s, 0.045);
      iconCircle(g, cx + 16 * u, cy + 2 * u, 14 * u, COLORS.gold, s, 0.045);
      iconRect(g, cx - 30 * u, cy + 20 * u, 60 * u, 10 * u, 3 * u, COLORS.crust, s, 0.045);
      iconCircle(g, cx - 18 * u, cy - 30 * u, 7 * u, 'rgba(251,244,230,0.9)', s, 0.04);
      break;
    }
    case 'factory_filling': { // 馅料产线: 漏斗 + 馅球
      iconPath(g, [[cx - 30 * u, cy - 32 * u], [cx + 30 * u, cy - 32 * u], [cx + 12 * u, cy + 2 * u],
        [cx - 12 * u, cy + 2 * u]], ICON_WOOD, s);
      iconRect(g, cx - 24 * u, cy + 16 * u, 48 * u, 12 * u, 4 * u, ICON_WOOD, s, 0.045);
      iconCircle(g, cx, cy + 8 * u, 7 * u, COLORS.custard, s, 0.04);
      iconCircle(g, cx - 10 * u, cy + 20 * u, 6 * u, COLORS.bean, s, 0.04);
      iconCircle(g, cx + 9 * u, cy + 20 * u, 6 * u, COLORS.custard, s, 0.04);
      break;
    }
    case 'icon_speed': { // 速度: 闪电
      iconPath(g, [[cx + 4 * u, cy - 34 * u], [cx - 18 * u, cy + 4 * u], [cx - 2 * u, cy + 4 * u],
        [cx - 10 * u, cy + 34 * u], [cx + 18 * u, cy - 6 * u], [cx + 2 * u, cy - 6 * u]], COLORS.goldLight, s);
      g.strokeStyle = 'rgba(234,200,123,0.85)';
      g.lineWidth = Math.max(1, s * 0.05);
      for (const dy of [-16, 0, 16]) {
        g.beginPath();
        g.moveTo(cx - 40 * u, cy + dy * u);
        g.lineTo(cx - 22 * u, cy + dy * u);
        g.stroke();
      }
      break;
    }
    case 'icon_capacity': { // 产能: 木箱 + 加号
      iconRect(g, cx - 32 * u, cy - 22 * u, 64 * u, 50 * u, 6 * u, ICON_WOOD, s);
      g.beginPath();
      g.moveTo(cx - 32 * u, cy - 6 * u);
      g.lineTo(cx + 32 * u, cy - 6 * u);
      g.stroke();
      iconRect(g, cx - 12 * u, cy + 4 * u, 24 * u, 7 * u, 2 * u, COLORS.goldLight, 0);
      iconRect(g, cx - 3.5 * u, cy - 4 * u, 7 * u, 24 * u, 2 * u, COLORS.goldLight, 0);
      break;
    }
    case 'icon_quality': { // 品质: 钻石 + 缎带
      iconPath(g, [[cx, cy + 12 * u], [cx - 30 * u, cy - 14 * u], [cx, cy - 34 * u], [cx + 30 * u, cy - 14 * u]], '#4fa8e0', s);
      iconPath(g, [[cx - 30 * u, cy - 14 * u], [cx, cy + 12 * u], [cx + 30 * u, cy - 14 * u], [cx, cy - 22 * u]], 'rgba(255,255,255,0.35)', 0);
      iconPath(g, [[cx - 22 * u, cy + 8 * u], [cx - 34 * u, cy + 34 * u], [cx - 6 * u, cy + 20 * u]], COLORS.gold, s, 0.04);
      iconPath(g, [[cx + 22 * u, cy + 8 * u], [cx + 34 * u, cy + 34 * u], [cx + 6 * u, cy + 20 * u]], COLORS.gold, s, 0.04);
      break;
    }
    case 'icon_unlock': { // 解锁: 开着的挂锁
      g.beginPath();
      g.arc(cx + 12 * u, cy - 16 * u, 18 * u, Math.PI * 1.05, Math.PI * 1.95);
      iconStroke(g, s, 0.09);
      g.stroke();
      iconRect(g, cx - 30 * u, cy - 4 * u, 52 * u, 40 * u, 8 * u, COLORS.gold, s);
      iconCircle(g, cx - 4 * u, cy + 12 * u, 6 * u, ICON_INK, 0);
      iconRect(g, cx - 7 * u, cy + 14 * u, 6 * u, 12 * u, 2 * u, ICON_INK, 0);
      break;
    }
    default:
      g.restore();
      return false;
  }
  g.restore();
  return true;
}
