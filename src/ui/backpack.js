'use strict';

/* 全局背包: 屏幕下方的「背包」按钮 + 底部快捷浮窗, 任何界面都能开
 *
 * - 浮窗贴在屏幕下方, 不遮住制作台; 营业中可从浮窗把面皮/馅料拖到托盘
 * - 其他界面只做查看
 * - 由 state.js 的指针分发在最前面拦截, main.js 统一绘制
 */

/* global W, H, COLORS, shop, run, scenes, CRUSTS, FILLINGS, isUnlocked, findCrustDef,
   findFillingDef, backpackCount, backpackTake, backpackAdd, drawCrustPart, drawFillingIcon,
   fillRoundRect, strokeRoundRect, roundRect, drawText, uiButton, pointInRect, clamp, SFX,
   slotRect, placeCrust, placeFilling, ASSEMBLY */

const backpackUI = {
  open: false,
  scroll: 0,
  drag: null, // { kind, productId, x, y }
  hoverItem: null,
};

/* 左上角按钮(抬头区左侧, HUD 标题会为它让位) */
function backpackButtonRect() {
  return { x: 16, y: 13, w: 132, h: 44 };
}

function backpackToggle(force) {
  backpackUI.open = force == null ? !backpackUI.open : !!force;
  backpackUI.scroll = 0;
  backpackUI.drag = null;
  SFX.click();
}

/* 浮窗(底部一条) */
const BPW = { h: 172, pad: 14, gap: 8, titleH: 36, cols: 12 };
function backpackWindowRect() {
  return { x: 10, y: H - BPW.h - 8, w: W - 20, h: BPW.h };
}
function backpackCloseRect() {
  const p = backpackWindowRect();
  return { x: p.x + p.w - 96, y: p.y + 8, w: 84, h: 28 };
}

function backpackProductDefs() {
  const defs = [];
  /* 已解锁的常驻显示; 未解锁但只要背包里有货(工厂捡来的)也要显示出来 */
  for (const d of CRUSTS) {
    if (isUnlocked(d) || backpackCount('crust', d.id) > 0) {
      defs.push({
        kind: 'crust', id: d.id, name: d.name, col: d.col, color: d.color,
        value: d.value || 0, effectText: d.effectText || '',
      });
    }
  }
  for (const d of FILLINGS) {
    if (isUnlocked(d) || backpackCount('filling', d.id) > 0) {
      defs.push({
        kind: 'filling', id: d.id, name: d.name, index: d.index, color: d.color,
        value: d.value || 0, effectText: d.effectText || '',
      });
    }
  }
  return defs;
}
function backpackCellRects() {
  const p = backpackWindowRect();
  const defs = backpackProductDefs();
  const n = defs.length;
  const cols = Math.max(1, Math.min(BPW.cols, n));
  const rows = Math.max(1, Math.ceil(n / cols));
  const gridX = p.x + BPW.pad;
  const gridY = p.y + BPW.titleH;
  const gridW = p.w - BPW.pad * 2;
  const gridH = p.h - BPW.titleH - BPW.pad;
  const cellW = (gridW - (cols - 1) * BPW.gap) / cols;
  const cellH = (gridH - (rows - 1) * BPW.gap) / rows;
  return defs.map((d, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return Object.assign({}, d, {
      rect: {
        x: gridX + col * (cellW + BPW.gap),
        y: gridY + row * (cellH + BPW.gap) - backpackUI.scroll,
        w: cellW,
        h: cellH,
      },
    });
  });
}
function backpackContentH() {
  const p = backpackWindowRect();
  const n = backpackProductDefs().length;
  const cols = Math.max(1, Math.min(BPW.cols, n));
  const rows = Math.max(1, Math.ceil(n / cols));
  const gridH = p.h - BPW.titleH - BPW.pad;
  return rows * ((gridH - (rows - 1) * BPW.gap) / rows + BPW.gap);
}
function backpackWindowMaxScroll() {
  const p = backpackWindowRect();
  const gridH = p.h - BPW.titleH - BPW.pad;
  return Math.max(0, backpackContentH() - gridH);
}
function backpackItemAt(x, y) {
  for (const it of backpackCellRects()) {
    if (pointInRect(x, y, it.rect) && backpackCount(it.kind, it.id) > 0) return it;
  }
  return null;
}

/* ---- 指针分发(由 state.js 最优先调用) ---- */
function backpackHandleDown(x, y) {
  /* 点左上角背包按钮: 开 / 关 */
  if (pointInRect(x, y, backpackButtonRect())) {
    backpackToggle();
    return true;
  }
  if (backpackUI.open) {
    const it = backpackItemAt(x, y);
    if (it) {
      backpackUI.drag = { kind: it.kind, productId: it.id, x, y };
      SFX.click();
    }
    return true; // 打开时吞掉所有指针事件
  }
  return false;
}
function backpackHandleMove(x, y) {
  if (backpackUI.drag) {
    backpackUI.drag.x = x;
    backpackUI.drag.y = y;
    return true;
  }
  return backpackUI.open;
}
function backpackHandleUp(x, y) {
  if (backpackUI.drag) {
    backpackTryDrop(backpackUI.drag, x, y);
    backpackUI.drag = null;
    return true;
  }
  return backpackUI.open;
}
function backpackHandleWheel(x, y, delta) {
  if (!backpackUI.open) return false;
  const maxS = backpackWindowMaxScroll();
  if (maxS > 0) {
    backpackUI.scroll = clamp(backpackUI.scroll + delta * 60, 0, maxS);
  }
  return true;
}

/* 从浮窗拖到制作台托盘(仅营业前台) */
function backpackTryDrop(drag, x, y) {
  if (typeof run === 'undefined' || run.scene !== 'shop') return;
  if (run.factoryOpen) return;
  if (!run.slots || !run.slots.length) return;
  for (let i = 0; i < run.slots.length; i++) {
    const r = slotRect(i);
    if (!pointInRect(x, y, r)) continue;
    const slot = run.slots[i];
    if (drag.kind === 'crust') {
      if (!backpackTake('crust', drag.productId, 1)) return;
      const res = placeCrust(slot, drag.productId);
      if (!res.ok) {
        backpackAdd('crust', drag.productId, 1); // 退回
      } else {
        SFX.stamp();
      }
    } else {
      if (!backpackTake('filling', drag.productId, 1)) return;
      const res = placeFilling(slot, drag.productId, ASSEMBLY.maxFillings);
      if (!res.ok) {
        backpackAdd('filling', drag.productId, 1); // 退回
      } else {
        SFX.stamp();
      }
    }
    return;
  }
}

/* ---- 绘制(由 main.js 统一调用) ---- */
function drawBackpackButton(g) {
  const r = backpackButtonRect();
  uiButton(g, Object.assign({
    id: 'backpack', label: '🎒 背包', size: 17,
    accent: backpackUI.open ? COLORS.ok : COLORS.gold,
  }, r));
}

function drawBackpackWindow(g) {
  const p = backpackWindowRect();
  g.save();
  g.fillStyle = 'rgba(7,6,5,0.35)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, p.x, p.y, p.w, p.h, { r: 16, color: COLORS.panelDark });
  drawText(g, '背包（拖动产物到制作台 · 滚轮滚动 · 再点左上角按钮关闭）', p.x + 18, p.y + 20, {
    size: 16, weight: 700, color: COLORS.panelTitle,
  });

  /* 裁剪到内容区 */
  const area = { x: p.x + BPW.pad, y: p.y + BPW.titleH, w: p.w - BPW.pad * 2, h: p.h - BPW.titleH - BPW.pad };
  g.save();
  g.beginPath();
  g.rect(area.x, area.y, area.w, area.h);
  g.clip();

  const items = backpackCellRects();
  if (!items.length) {
    drawText(g, '背包是空的：去工厂面板收集产物', p.x + 18, p.y + 70, { size: 15, color: COLORS.textDim });
  }
  for (const it of items) {
    const r = it.rect;
    if (r.y + r.h < area.y || r.y > area.y + area.h) continue;
    const cnt = backpackCount(it.kind, it.id);
    const empty = cnt <= 0;
    const cx = r.x + r.w / 2;
    g.save();
    g.globalAlpha = empty ? 0.45 : 1;
    drawCard(g, r.x, r.y, r.w, r.h, 10, !empty);

    let drew = false;
    if (it.kind === 'crust') drew = drawCrustPart(g, it.col, 'raw', cx - 23, r.y + 8, 46, 46);
    else drew = drawFillingIcon(g, it.index, cx, r.y + 34, 56);
    if (!drew) {
      g.fillStyle = it.color;
      g.beginPath();
      g.arc(cx, r.y + 31, 18, 0, Math.PI * 2);
      g.fill();
    }

    drawText(g, 'x' + Math.floor(cnt), r.x + r.w - 8, r.y + 15, {
      size: 14, weight: 700, align: 'right', color: empty ? COLORS.fail : COLORS.gold,
    });
    drawText(g, it.name, cx, r.y + 62, {
      size: 12, weight: 600, align: 'center', color: COLORS.panelInk, maxWidth: r.w - 4,
    });
    drawText(g, '售价 💰' + it.value, cx, r.y + 80, {
      size: 12, weight: 700, align: 'center', color: COLORS.gold,
    });
    if (it.effectText) {
      drawText(g, it.effectText, cx, r.y + 98, {
        size: 9, align: 'center', color: COLORS.warn, maxWidth: r.w - 2,
      });
    }
    g.restore();
  }
  g.restore();

  /* 滚动条 */
  const maxS = backpackWindowMaxScroll();
  if (maxS > 0) {
    const trackH = area.h;
    const thumbH = Math.max(30, trackH * (area.h / backpackContentH()));
    const ty = area.y + (trackH - thumbH) * (backpackUI.scroll / maxS);
    fillRoundRect(g, area.x + area.w - 6, area.y, 6, trackH, 3, 'rgba(19,16,13,0.5)');
    fillRoundRect(g, area.x + area.w - 6, ty, 6, thumbH, 3, 'rgba(196,158,86,0.75)');
  }

  /* 拖拽跟随 */
  if (backpackUI.drag) {
    const d = backpackUI.drag;
    g.save();
    g.globalAlpha = 0.92;
    if (d.kind === 'crust') {
      const cd = findCrustDef(d.productId);
      if (!drawCrustPart(g, cd ? cd.col : 0, 'raw', d.x - 34, d.y - 34, 68, 68)) {
        g.fillStyle = cd ? cd.color : COLORS.crust;
        g.beginPath();
        g.arc(d.x, d.y, 26, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const fi = findFillingDef(d.productId);
      if (!drawFillingIcon(g, fi ? fi.index : 0, d.x, d.y, 54)) {
        g.fillStyle = fi ? fi.color : COLORS.panelInk;
        g.beginPath();
        g.arc(d.x, d.y, 24, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}
