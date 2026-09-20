'use strict';

/* 开门前「今日菜单」浮层: 翻牌子开门时弹出
 * - 免费勾选今天要卖的饼皮/馅料 => 顾客只会点菜单里的东西
 * - 食材靠工厂生产, 菜单选择不花钱
 * - 至少各选 1 种饼皮和馅料才能开门
 * - 窗内可直接打开「制作台升级」(制作台数量/自动化 + 烤炉数量/速度)
 * 由 state.js 指针分发拦截, main.js 统一绘制 */

/* global W, H, COLORS, shop, run, CRUSTS, FILLINGS, isUnlocked, findCrustDef, findFillingDef,
   backpackCount, buildDayPlan, uiPanel, uiButton, drawText, pointInRect, fillRoundRect,
   strokeRoundRect, SFX, showScreenText, benchUpgradeUI, benchUpgradeToggle */

const stockingUI = {
  open: false,
  picked: {}, // 'kind:id' -> true 在今日菜单里
  onConfirm: null,
  onCancel: null,
};

function stockingOpen() {
  stockingUI.picked = {};
  stockingUI.open = true;
}
function stockingPicked(it) {
  return !!stockingUI.picked[it.kind + ':' + it.id];
}
function stockingToggle(it) {
  const k = it.kind + ':' + it.id;
  stockingUI.picked[k] = !stockingUI.picked[k];
}
function stockingCatalog() {
  const out = [];
  /* 只要「工厂已解锁」或「背包里有现货」就能选进今日菜单 */
  for (const d of CRUSTS) {
    if (isUnlocked(d) || backpackCount('crust', d.id) > 0) {
      out.push({ kind: 'crust', id: d.id, name: d.name, color: d.color, col: d.col });
    }
  }
  for (const d of FILLINGS) {
    if (isUnlocked(d) || backpackCount('filling', d.id) > 0) {
      out.push({ kind: 'filling', id: d.id, name: d.name, color: d.color, index: d.index });
    }
  }
  return out;
}
function stockingSelected(kind) {
  const ids = [];
  for (const it of stockingCatalog()) {
    if (it.kind === kind && stockingPicked(it)) ids.push(it.id);
  }
  return ids;
}

/* ---- 几何 ---- */
function stockingPanelRect() {
  const w = 960;
  const h = 578;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
function stockingCloseRect() {
  const p = stockingPanelRect();
  return { x: p.x + p.w - 104, y: p.y + 16, w: 84, h: 34 };
}
function stockingCellRect(i) {
  const p = stockingPanelRect();
  const areaX = p.x + 24;
  const areaW = p.w - 356;
  const colW = (areaW - 10) / 2;
  const cellH = 54;
  const gapY = 6;
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { x: areaX + col * (colW + 10), y: p.y + 92 + row * (cellH + gapY), w: colW, h: cellH };
}
function stockingUpgradeRect() {
  const p = stockingPanelRect();
  return { x: p.x + p.w - 316, y: p.y + p.h - 140, w: 296, h: 50 };
}
function stockingConfirmRect() {
  const p = stockingPanelRect();
  return { x: p.x + p.w - 316, y: p.y + p.h - 80, w: 296, h: 56 };
}

/* ---- 指针分发 ---- */
function stockingHandleDown(x, y) {
  if (!stockingUI.open) return false;
  if (pointInRect(x, y, stockingCloseRect())) {
    stockingUI.open = false;
    if (stockingUI.onCancel) stockingUI.onCancel();
    return true;
  }
  if (pointInRect(x, y, stockingUpgradeRect())) {
    benchUpgradeUI.focus = null;
    benchUpgradeToggle(true);
    return true;
  }
  if (pointInRect(x, y, stockingConfirmRect())) {
    stockingConfirm();
    return true;
  }
  const cat = stockingCatalog();
  for (let i = 0; i < cat.length; i++) {
    if (pointInRect(x, y, stockingCellRect(i))) {
      stockingToggle(cat[i]);
      SFX.click();
      return true;
    }
  }
  return true;
}
function stockingHandleMove() {
  return stockingUI.open;
}
function stockingHandleUp() {
  return stockingUI.open;
}
function stockingHandleWheel() {
  return stockingUI.open;
}

function stockingConfirm() {
  const crusts = stockingSelected('crust');
  const fillings = stockingSelected('filling');
  if (crusts.length < 1) {
    showScreenText('至少选 1 种饼皮', '', COLORS.warn);
    SFX.fail();
    return;
  }
  if (fillings.length < 1) {
    showScreenText('至少选 1 种馅料', '', COLORS.warn);
    SFX.fail();
    return;
  }
  /* 今日菜单: 顾客只点这些 (不花钱, 食材靠工厂产) */
  run.orderPool = { crusts: crusts, fillings: fillings };
  stockingUI.open = false;
  SFX.click();
  if (stockingUI.onConfirm) stockingUI.onConfirm();
}

/* ---- 绘制 ---- */
function drawStockingWindow(g) {
  const p = stockingPanelRect();
  g.save();
  g.fillStyle = 'rgba(8,6,4,0.62)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, p.x, p.y, p.w, p.h, { r: 20, color: COLORS.panelDark });
  drawText(g, '今日菜单', p.x + 28, p.y + 38, { size: 25, weight: 700, color: COLORS.goldLight });
  drawText(g, '免费勾选今天要卖的食材，顾客只会点菜单里的东西（至少各 1 种）', p.x + 28, p.y + 68, {
    size: 13, color: COLORS.textDim,
  });
  const cr = stockingCloseRect();
  uiButton(g, Object.assign({ id: 'stockingClose', label: '再想想', size: 14, accent: COLORS.textDim }, cr));

  const cat = stockingCatalog();
  cat.forEach((it, i) => {
    const r = stockingCellRect(i);
    const on = stockingPicked(it);
    drawCard(g, r.x, r.y, r.w, r.h, 10, on);

    g.fillStyle = it.color;
    g.beginPath();
    g.arc(r.x + 24, r.y + 27, 13, 0, Math.PI * 2);
    g.fill();

    drawText(g, it.name, r.x + 46, r.y + 20, { size: 16, weight: 600, color: COLORS.cream });
    drawText(g, it.kind === 'crust' ? '饼皮' : '馅料', r.x + 46, r.y + 40, { size: 12, color: COLORS.textDim });

    drawText(g, on ? '✔ 已加入菜单' : '加入菜单', r.x + r.w - 16, r.y + r.h / 2, {
      size: 14, weight: 700, align: 'right', color: on ? COLORS.ok : COLORS.textDim,
    });
  });

  /* 右侧: 今日菜单预览 + 操作 */
  const rx = p.x + p.w - 320;
  uiPanel(g, rx, p.y + 92, 296, 322, { r: 12 });
  drawText(g, '今日菜单', rx + 16, p.y + 118, { size: 16, weight: 700, color: COLORS.goldLight });
  drawText(g, '顾客只会点这些', rx + 16, p.y + 140, { size: 11, color: COLORS.textDim });
  let dy = p.y + 166;
  const selC = stockingSelected('crust');
  const selF = stockingSelected('filling');
  const nameOf = (kind, id) => {
    const d = kind === 'crust' ? findCrustDef(id) : findFillingDef(id);
    return d ? d.name : id;
  };
  const all = selF.concat(selC);
  if (!all.length) {
    drawText(g, '还没选任何食材', rx + 16, dy, { size: 13, color: COLORS.textDim });
  }
  all.slice(0, 8).forEach((id) => {
    const isF = selF.indexOf(id) >= 0;
    drawText(g, (isF ? '馅 ' : '皮 ') + nameOf(isF ? 'filling' : 'crust', id), rx + 16, dy, {
      size: 13, color: COLORS.cream,
    });
    dy += 26;
  });

  const ok = selC.length >= 1 && selF.length >= 1;
  const ur = stockingUpgradeRect();
  uiButton(g, Object.assign({ id: 'stockingUpgrade', label: '⚙ 升级制作台 / 炉子', size: 15, accent: COLORS.ok }, ur));
  const br = stockingConfirmRect();
  uiButton(g, Object.assign({
    id: 'stockingConfirm', label: '确认并开门', size: 18,
    accent: ok ? COLORS.ok : COLORS.textDim, disabled: !ok,
  }, br));
}
