'use strict';

/* 月兔面板: 买月兔 + 每只的能力单独升级(能力不互通)
 * 由 state.js 的指针分发拦截, main.js 统一绘制 */

/* global W, H, COLORS, shop, run, RABBIT, rabbitAbil, rabbitAbilCost, rabbitBuyCost,
   buyRabbit, upgradeRabbit, RABBIT_ART_NPC, drawText, drawNpc, uiPanel, uiButton,
   drawRabbitFigure,
   fillRoundRect, strokeRoundRect, pointInRect, formatNum, SFX, clamp, showScreenText */

const rabbitUI = { open: false, scroll: 0, hover: null };

const RABBIT_PANEL = { w: 940, h: 588, titleH: 66, blockH: 236, gap: 12, pad: 16 };

function rabbitPanelRect() {
  return { x: (W - RABBIT_PANEL.w) / 2, y: (H - RABBIT_PANEL.h) / 2, w: RABBIT_PANEL.w, h: RABBIT_PANEL.h };
}
function rabbitCloseRect() {
  const p = rabbitPanelRect();
  return { x: p.x + p.w - 108, y: p.y + 16, w: 88, h: 36 };
}
function rabbitBuyRect() {
  const p = rabbitPanelRect();
  return { x: p.x + p.w - 348, y: p.y + 16, w: 230, h: 36 };
}
function rabbitListArea() {
  const p = rabbitPanelRect();
  return { x: p.x + RABBIT_PANEL.pad, y: p.y + RABBIT_PANEL.titleH, w: p.w - RABBIT_PANEL.pad * 2 - 10, h: p.h - RABBIT_PANEL.titleH - RABBIT_PANEL.pad };
}
function rabbitContentH() {
  const n = (shop.rabbits || []).length;
  return Math.max(rabbitListArea().h, n * (RABBIT_PANEL.blockH + RABBIT_PANEL.gap) + 8);
}
function rabbitMaxScroll() {
  return Math.max(0, rabbitContentH() - rabbitListArea().h);
}
function clampRabbitScroll() {
  rabbitUI.scroll = clamp(rabbitUI.scroll || 0, 0, rabbitMaxScroll());
}

/* 每只月兔占一块; 块内是 2 列 × 3 行的能力 */
function rabbitBlockRect(i) {
  const a = rabbitListArea();
  return {
    x: a.x,
    y: a.y + i * (RABBIT_PANEL.blockH + RABBIT_PANEL.gap) - (rabbitUI.scroll || 0),
    w: a.w,
    h: RABBIT_PANEL.blockH,
  };
}
const RABBIT_ABIL_ORDER = ['calm', 'speed', 'cashier', 'cook', 'bake', 'serve', 'fix'];
function rabbitAbilRowRect(i, k) {
  const b = rabbitBlockRect(i);
  const col = k % 2;
  const row = Math.floor(k / 2);
  const left = b.x + 96;
  const colW = (b.w - 96 - 20) / 2;
  return {
    x: left + col * (colW + 20),
    y: b.y + 16 + row * 50,
    w: colW,
    h: 42,
  };
}
/* 能力行右侧的升级按钮 */
function rabbitUpBtnRect(i, k) {
  const r = rabbitAbilRowRect(i, k);
  return { x: r.x + r.w - 108, y: r.y + 4, w: 100, h: 34 };
}

function rabbitOpen() {
  rabbitUI.open = true;
  clampRabbitScroll();
  SFX.click();
}
function rabbitClose() {
  rabbitUI.open = false;
}

function rabbitHandleDown(x, y) {
  if (!rabbitUI.open) return false;
  if (pointInRect(x, y, rabbitCloseRect())) { rabbitClose(); SFX.click(); return true; }
  if (pointInRect(x, y, rabbitBuyRect())) {
    const res = buyRabbit();
    if (!res.ok) { SFX.fail(); showScreenText(res.reason, '', COLORS.fail); }
    else clampRabbitScroll();
    return true;
  }
  const n = (shop.rabbits || []).length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < RABBIT_ABIL_ORDER.length; k++) {
      if (!pointInRect(x, y, rabbitUpBtnRect(i, k))) continue;
      const key = RABBIT_ABIL_ORDER[k];
      const res = upgradeRabbit(i, key);
      if (!res.ok) { SFX.fail(); showScreenText(res.reason, '', COLORS.fail); }
      return true;
    }
  }
  return pointInRect(x, y, rabbitPanelRect()); // 面板内吃掉点击
}
function rabbitHandleMove(x, y) {
  if (!rabbitUI.open) return false;
  rabbitUI.hover = null;
  const n = (shop.rabbits || []).length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < RABBIT_ABIL_ORDER.length; k++) {
      if (pointInRect(x, y, rabbitUpBtnRect(i, k))) rabbitUI.hover = i + ':' + k;
    }
  }
  return false;
}
function rabbitHandleUp() {
  return !!rabbitUI.open;
}
function rabbitHandleWheel(x, y, delta) {
  if (!rabbitUI.open) return false;
  if (pointInRect(x, y, rabbitPanelRect())) {
    rabbitUI.scroll += delta * 48; // 和快捷栏/烤炉面板一个手感(1 格滚轮 = 48px)
    clampRabbitScroll();
    return true;
  }
  return false;
}

/* ---- 绘制 ---- */
function drawRabbitWindow(g) {
  if (!rabbitUI.open) return;
  const p = rabbitPanelRect();
  g.save();
  g.fillStyle = 'rgba(10,8,6,0.62)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, p.x, p.y, p.w, p.h, { r: 20 });
  drawText(g, '月兔', p.x + 24, p.y + 34, { size: 24, weight: 700, color: COLORS.panelTitle });

  /* 购买按钮 */
  const bc = rabbitBuyCost();
  const br = rabbitBuyRect();
  uiButton(g, {
    id: 'rabbitBuy',
    x: br.x, y: br.y, w: br.w, h: br.h,
    label: bc == null ? '已养满 ' + RABBIT.max + ' 只' : ('领养月兔  ' + formatNum(bc) + ' 金'),
    size: 15,
    disabled: bc == null,
    accent: bc == null ? COLORS.textDim : COLORS.gold,
  });
  uiButton(g, Object.assign({ id: 'rabbitClose', label: '关闭', size: 14, accent: COLORS.textDim }, rabbitCloseRect()));

  drawText(g, '每只月兔能力独立, 各自花钱升级', p.x + 24, p.y + 56, {
    size: 12, color: COLORS.textDim,
  });

  const a = rabbitListArea();
  g.save();
  g.beginPath();
  g.rect(a.x, a.y, a.w, a.h);
  g.clip();

  const list = shop.rabbits || [];
  if (!list.length) {
    drawText(g, '还没有月兔：点右上角「领养月兔」', a.x + 20, a.y + 40, { size: 15, color: COLORS.textDim });
  }
  for (let i = 0; i < list.length; i++) {
    const b = rabbitBlockRect(i);
    if (b.y + b.h < a.y || b.y > a.y + a.h) continue;
    const r = list[i];
    fillRoundRect(g, b.x, b.y, b.w, b.h, 12, 'rgba(202,136,63,0.14)');

    /* 头像 + 名字 (有月兔贴图就用贴图, 否则退回特殊立绘) */
    drawRabbitFigure(g, r.art, b.x + 48, b.y + 96, 84);
    drawText(g, '月兔 ' + (i + 1), b.x + 48, b.y + 118, {
      size: 13, weight: 700, align: 'center', color: COLORS.panelInk,
    });

    for (let k = 0; k < RABBIT_ABIL_ORDER.length; k++) {
      const key = RABBIT_ABIL_ORDER[k];
      const def = RABBIT.abil[key];
      const rr = rabbitAbilRowRect(i, k);
      const lv = rabbitAbil(r, key);
      const cost = rabbitAbilCost(key, lv);
      const can = cost != null && shop.coins >= cost;
      fillRoundRect(g, rr.x, rr.y, rr.w, rr.h, 9, 'rgba(255,255,255,0.55)');

      drawText(g, def.label, rr.x + 10, rr.y + 13, { size: 13, weight: 700, color: COLORS.panelInk });
      drawText(g, 'Lv.' + lv + '/' + def.max, rr.x + 10, rr.y + 30, { size: 11, color: COLORS.textDim });
      drawText(g, rabbitValueText(key, lv), rr.x + 76, rr.y + 30, { size: 11, color: COLORS.panelTitle });

      const ub = rabbitUpBtnRect(i, k);
      uiButton(g, {
        id: 'rabbitUp',
        x: ub.x, y: ub.y, w: ub.w, h: ub.h,
        label: cost == null ? '满级' : ('＋ ' + formatNum(cost)),
        size: 12,
        disabled: cost == null,
        accent: can ? COLORS.ok : COLORS.textDim,
        hover: rabbitUI.hover === i + ':' + k,
      });
    }
  }
  g.restore();

  /* 滚动条 */
  const maxS = rabbitMaxScroll();
  if (maxS > 0) {
    const thumbH = Math.max(30, a.h * (a.h / rabbitContentH()));
    const ty = a.y + (a.h - thumbH) * ((rabbitUI.scroll || 0) / maxS);
    fillRoundRect(g, a.x + a.w + 2, a.y, 7, a.h, 3.5, 'rgba(19,16,13,0.4)');
    fillRoundRect(g, a.x + a.w + 2, ty, 7, thumbH, 3.5, 'rgba(196,158,86,0.8)');
  }
}

/* 能力数值的展示文案 */
function rabbitValueText(key, lv) {
  if (lv <= 0) return '未训练';
  const v = rabbitAbilValue(key, lv);
  if (key === 'calm') return '耐心 -' + Math.round(v * 100) + '%';
  if (key === 'speed') return Math.round(v) + 'px/s';
  if (key === 'cashier') return '半径 ' + Math.round(v);
  if (key === 'cook') return '每 ' + v.toFixed(1) + 's 一块';
  if (key === 'bake') return '每 ' + v.toFixed(1) + 's 一炉';
  if (key === 'serve') return '每 ' + v.toFixed(1) + 's 一单';
  if (key === 'fix') return '每 ' + v.toFixed(1) + 's 查一次';
  return '';
}
