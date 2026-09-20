'use strict';

/* 共享工厂面板: 5×5 网格 + 能源核心 + 仓库(工厂/组件/背包 标签切换) + 商店(工厂/组件)
 *
 * 同一块面板同时用于:
 *   - 工厂管理场景(scenes/factory.js)
 *   - 营业中打开的面板(shop.js, 不暂停)
 *
 * 交互:
 *   左栏仓库[工厂卡] → 拖到网格上场; [组件] → 拖到右侧详情空槽; [背包] 查看产物
 *   网格工厂 → 点击选中 / 拖到空格换位 / 拖出网格收回仓库
 *   工厂卡上的进度条: 满 1 生成「掉落产物」; 点掉落徽标 → 收进背包
 *   能源核心: 电量有限, 右侧可花金币升级
 */

/* global shop, run, W, H, COLORS, GRID, CORE, PRODUCE, FACTORIES, COMPONENT_TYPES, CRUSTS, FILLINGS,
   findFactoryDef, findCrustDef, findFillingDef, findComponentDef, componentEffectText, isUnlocked, unlockLabel,
   unitsList, unitAtCell, poweredUnitIds, isUnitPowered, coreLevel, coreCapacity,
   coreUpgradeCost, applyCoreUpgrade, deployFactory, undeployUnit, moveUnit, unitKind,
   collectDrop, collectAllDrops, buyFactory, sellFactory, buyComponent, sellComponent,
   buySlot, installComponent, removeComponent, moveComponent, upgradeComponent,
   slotCost, MAX_SLOTS, backpackCount, factoryBagCount, showScreenText, formatNum,
   drawSprite, uiPanel, uiButton, drawText, pointInRect, dist, SFX, clamp, rand, img,
   fillRoundRect, strokeRoundRect, roundRect */

const factoryBoard = {
  visible: false,
  closeAction: null, // 关闭按钮回调(由宿主场景设置)
  tabWarehouse: 'factory', // 'factory' | 'component' | 'backpack'
  shopOpen: false,
  tabShop: 'factory', // 'factory' | 'component'
  selected: null, // 选中的 uid
  drag: null,
  pending: null,
  hover: null,
  buttons: [],
  scroll: { warehouse: 0, shop: 0 },
  maxScroll: { warehouse: 0, shop: 0 },
};

const FB = {
  top: 84,
  bottom: 706,
  leftX: 20,
  leftW: 322,
  gridX: 362,
  gridW: 552,
  rightX: 934,
  rightW: 326,
  cell: 100,
  gap: 9,
  gridY: 120,
};

/* ---- 重置 ---- */
function factoryBoardReset() {
  factoryBoard.tabWarehouse = 'factory';
  factoryBoard.shopOpen = false;
  factoryBoard.drag = null;
  factoryBoard.pending = null;
  factoryBoard.hover = null;
  factoryBoard.scroll.warehouse = 0;
  factoryBoard.scroll.shop = 0;
  if (!shop.units[factoryBoard.selected]) {
    const list = unitsList();
    factoryBoard.selected = list.length ? list[0].uid : null;
  }
}

/* ---- 几何 ---- */
function fbCellRect(cell) {
  const col = cell % GRID.size;
  const row = Math.floor(cell / GRID.size);
  return {
    x: FB.gridX + col * (FB.cell + FB.gap),
    y: FB.gridY + row * (FB.cell + FB.gap),
    w: FB.cell,
    h: FB.cell,
  };
}
function fbCellAt(x, y) {
  for (let cell = 0; cell < GRID.size * GRID.size; cell++) {
    if (pointInRect(x, y, fbCellRect(cell))) return cell;
  }
  return -1;
}

/* ---- 掉落产物(物理): 与 unit.drops 数量对账, 像金币一样落出来 ---- */
let factoryBoardDrops = []; // { uid, kind, productId, x, y, vx, vy, rest, spin }

function fbSyncDrops() {
  /* 删掉已下场工厂的孤儿 */
  factoryBoardDrops = factoryBoardDrops.filter((d) => shop.units[d.uid]);
  for (const uid in shop.units) {
    const u = shop.units[uid];
    const def = findFactoryDef(u.factoryId);
    let have = 0;
    for (const d of factoryBoardDrops) if (d.uid === uid) have += 1;
    while (have < (u.drops || 0)) {
      const r = fbCellRect(u.cell);
      factoryBoardDrops.push({
        uid,
        kind: def ? def.kind : 'filling',
        productId: def ? def.productId : '',
        x: r.x + r.w / 2 + rand(-16, 16),
        y: r.y + 24,
        vx: rand(-60, 60),
        vy: rand(-60, -10),
        rest: false,
        spin: Math.random() * Math.PI * 2,
      });
      have += 1;
    }
    let excess = have - (u.drops || 0);
    for (let i = factoryBoardDrops.length - 1; i >= 0 && excess > 0; i--) {
      if (factoryBoardDrops[i].uid === uid) {
        factoryBoardDrops.splice(i, 1);
        excess -= 1;
      }
    }
  }
}

function factoryBoardUpdate(dt) {
  fbSyncDrops();
  for (const d of factoryBoardDrops) {
    const u = shop.units[d.uid];
    if (!u) continue;
    const r = fbCellRect(u.cell);
    const restY = r.y + r.h - 18;
    d.spin += dt * 4;
    if (d.rest) {
      d.x = clamp(d.x, r.x + 16, r.x + r.w - 16);
      d.y = restY;
      continue;
    }
    d.vy += 900 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.x < r.x + 16) {
      d.x = r.x + 16;
      d.vx = Math.abs(d.vx) * 0.5;
    }
    if (d.x > r.x + r.w - 16) {
      d.x = r.x + r.w - 16;
      d.vx = -Math.abs(d.vx) * 0.5;
    }
    if (d.y >= restY && d.vy > 0) {
      d.y = restY;
      d.vy = -d.vy * 0.32;
      d.vx *= 0.6;
      if (Math.abs(d.vy) < 55) {
        d.vy = 0;
        d.vx = 0;
        d.rest = true;
      }
    }
  }
}

/* 按住的指针扫过就收: 返回收集数量 */
function factoryBoardSweep(x, y) {
  const radius = 34;
  let n = 0;
  for (let i = factoryBoardDrops.length - 1; i >= 0; i--) {
    const d = factoryBoardDrops[i];
    if (dist(x, y, d.x, d.y) > radius) continue;
    if (collectDrop(d.uid)) {
      factoryBoardDrops.splice(i, 1);
      n += 1;
    }
  }
  return n;
}

function fbDrawDrops(g) {
  const t = performance.now() / 1000;
  for (const d of factoryBoardDrops) {
    const def = d.kind === 'crust' ? findCrustDef(d.productId) : findFillingDef(d.productId);
    const color = def ? def.color : COLORS.cream;
    const bob = d.rest ? Math.sin(t * 4 + d.spin) * 1.6 : 0;
    const x = d.x;
    const y = d.y + bob;
    /* 影子 */
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(x, y + 11, 11, 4, 0, 0, Math.PI * 2);
    g.fill();
    /* 产物圆 */
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x - 3, y - 3, 4, Math.PI * 0.9, Math.PI * 1.7);
    g.stroke();
    g.restore();
  }
}
function fbTabRect(i) {
  const w = (FB.leftW - 16) / 3;
  return { x: FB.leftX + 8 + i * w, y: FB.top + 10, w: w - 4, h: 36 };
}
function fbWarehouseRowRect(i) {
  const r = { x: FB.leftX + 10, y: FB.top + 66 + i * 52 - factoryBoard.scroll.warehouse, w: FB.leftW - 20, h: 46 };
  return r;
}
function fbWarehouseSellRect(i) {
  const r = fbWarehouseRowRect(i);
  return { x: r.x + r.w - 40, y: r.y + r.h - 20, w: 34, h: 16 };
}
function fbShopTabRect(i) {
  const p = fbShopRect();
  return { x: p.x + 96 + i * 116, y: p.y + 12, w: 108, h: 34 };
}
function fbShopRect() {
  return { x: FB.leftX, y: FB.top, w: FB.gridW + FB.rightW + 40, h: FB.bottom - FB.top };
}
/* 商店宫格: 4 列卡片 */
const FB_SHOP = { cols: 4, pad: 16, gapX: 12, gapY: 12, cellH: 112 };
function fbShopCellRect(i) {
  const p = fbShopRect();
  const { cols, pad, gapX, gapY, cellH } = FB_SHOP;
  const cellW = (p.w - pad * 2 - (cols - 1) * gapX) / cols;
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: p.x + pad + col * (cellW + gapX),
    y: p.y + 64 + row * (cellH + gapY) - factoryBoard.scroll.shop,
    w: cellW,
    h: cellH,
  };
}
function fbDetailSlotRect(i) {
  const w = (FB.rightW - 40) / 2;
  const h = 76;
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { x: FB.rightX + 12 + col * (w + 8), y: FB.top + 168 + row * (h + 8), w, h };
}
function fbShopButtonRect() {
  return { x: FB.rightX + 12, y: FB.bottom - 92, w: (FB.rightW - 32) / 2, h: 40 };
}
function fbCoreButtonRect() {
  return { x: FB.rightX + 12 + (FB.rightW - 32) / 2 + 8, y: FB.bottom - 92, w: (FB.rightW - 32) / 2, h: 40 };
}

/* ---- 事件 ---- */
function factoryBoardDown(x, y) {
  /* 商店弹窗优先 */
  if (factoryBoard.shopOpen) {
    return fbShopDown(x, y);
  }
  /* 仓库标签 */
  for (let i = 0; i < 3; i++) {
    if (pointInRect(x, y, fbTabRect(i))) {
      factoryBoard.tabWarehouse = ['factory', 'component', 'backpack'][i];
      factoryBoard.scroll.warehouse = 0;
      SFX.click();
      return;
    }
  }
  /* 仓库内容 */
  if (x >= FB.leftX && x <= FB.leftX + FB.leftW && y >= FB.top + 60 && y <= FB.bottom) {
    return fbWarehouseDown(x, y);
  }
  /* 按住碰到掉落产物 → 收进背包 */
  if (factoryBoardSweep(x, y) > 0) return;
  /* 网格 */
  const cell = fbCellAt(x, y);
  if (cell >= 0) {
    if (isCoreCell(cell)) {
      factoryBoard.selected = null;
      return;
    }
    const u = unitAtCell(cell);
    if (u) {
      factoryBoard.selected = u.uid;
      factoryBoard.pending = { kind: 'unit', uid: u.uid, x, y };
    }
    return;
  }
  /* 右侧详情 */
  if (x >= FB.rightX && x <= FB.rightX + FB.rightW) {
    return fbDetailDown(x, y);
  }
  /* 按钮 */
  const b = hitBoardButton(x, y);
  if (b) {
    SFX.click();
    fbHandleButton(b);
  }
}

function fbWarehouseDown(x, y) {
  /* 点掉落不需要 */
  if (factoryBoard.tabWarehouse === 'factory') {
    const ids = Object.keys(shop.factoryBag).filter((id) => shop.factoryBag[id] > 0);
    for (let i = 0; i < ids.length; i++) {
      if (pointInRect(x, y, fbWarehouseSellRect(i))) {
        const res = sellFactory(ids[i]);
        if (res.ok) showScreenText('卖出 ' + factoryName(ids[i]) + ' +' + res.price, '', COLORS.gold);
        return;
      }
      if (pointInRect(x, y, fbWarehouseRowRect(i))) {
        factoryBoard.pending = { kind: 'card', factoryId: ids[i], x, y };
        SFX.click();
        return;
      }
    }
  } else if (factoryBoard.tabWarehouse === 'component') {
    const ids = Object.keys(shop.components).filter((id) => shop.components[id] > 0);
    for (let i = 0; i < ids.length; i++) {
      if (pointInRect(x, y, fbWarehouseSellRect(i))) {
        const res = sellComponent(ids[i]);
        if (res.ok) showScreenText('卖出 ' + compName(ids[i]) + ' +' + res.price, '', COLORS.gold);
        return;
      }
      if (pointInRect(x, y, fbWarehouseRowRect(i))) {
        factoryBoard.pending = { kind: 'component', compId: ids[i], x, y };
        SFX.click();
        return;
      }
    }
  }
}

function fbDetailDown(x, y) {
  const u = shop.units[factoryBoard.selected];
  /* 按钮 */
  const b = hitBoardButton(x, y);
  if (b) {
    SFX.click();
    fbHandleButton(b);
    return;
  }
  if (!u) return;
  const si = fbPickSlot(x, y);
  if (si < 0) return;
  if (u.slots[si]) {
    factoryBoard.pending = { kind: 'slotComp', uid: u.uid, slotIndex: si, compId: u.slots[si].compId, x, y };
  } else {
    showScreenText('从左边「组件」仓库拖组件到空槽', '', COLORS.warn);
  }
}

function fbShopDown(x, y) {
  /* 关闭 */
  const close = { x: fbShopRect().x + fbShopRect().w - 96, y: fbShopRect().y + 12, w: 84, h: 34 };
  if (pointInRect(x, y, close)) {
    factoryBoard.shopOpen = false;
    SFX.click();
    return;
  }
  for (let i = 0; i < 2; i++) {
    if (pointInRect(x, y, fbShopTabRect(i))) {
      factoryBoard.tabShop = i === 0 ? 'factory' : 'component';
      factoryBoard.scroll.shop = 0;
      SFX.click();
      return;
    }
  }
  const rows = fbShopRows();
  for (let i = 0; i < rows.length; i++) {
    if (!pointInRect(x, y, fbShopCellRect(i))) continue;
    if (factoryBoard.tabShop === 'factory') {
      const res = buyFactory(rows[i].id);
      if (res.ok) showScreenText('购买 ' + rows[i].name + ' -' + res.cost, '', COLORS.ok);
      else showScreenText(res.reason, '', COLORS.fail);
    } else {
      const res = buyComponent(rows[i].id);
      if (res.ok) showScreenText('购买 ' + rows[i].name + ' -' + rows[i].cost, '', COLORS.ok);
      else showScreenText(res.reason, '', COLORS.fail);
    }
    return;
  }
}

function factoryBoardMove(x, y) {
  if (factoryBoard.drag) {
    factoryBoard.drag.x = x;
    factoryBoard.drag.y = y;
    return;
  }
  if (factoryBoard.pending) {
    const p = factoryBoard.pending;
    if (dist(x, y, p.x, p.y) > 12) {
      if (p.kind === 'slotComp') {
        removeComponent(p.uid, p.slotIndex);
        factoryBoard.drag = { kind: 'detachedComp', compId: p.compId, x, y };
      } else {
        factoryBoard.drag = Object.assign({}, p, { x, y });
      }
      factoryBoard.pending = null;
    }
    return;
  }
  factoryBoard.hover = hitBoardButton(x, y);
}

function factoryBoardUp(x, y) {
  const pending = factoryBoard.pending;
  factoryBoard.pending = null;
  if (pending && pending.kind === 'slotComp') {
    fbClickSlot(pending.uid, pending.slotIndex);
    return;
  }
  const drag = factoryBoard.drag;
  factoryBoard.drag = null;
  if (!drag) return;

  if (drag.kind === 'card') {
    const cell = fbCellAt(x, y);
    if (cell < 0) return;
    const res = deployFactory(drag.factoryId, cell);
    if (res.ok) factoryBoard.selected = res.unit.uid;
    else showScreenText(res.reason, '', COLORS.fail);
    return;
  }
  if (drag.kind === 'unit') {
    const cell = fbCellAt(x, y);
    if (cell < 0) {
      const res = undeployUnit(drag.uid);
      if (res.ok) {
        showScreenText('已收回 ' + factoryName(res.factoryId), '', COLORS.textDim);
        if (factoryBoard.selected === drag.uid) factoryBoard.selected = null;
      }
      return;
    }
    const res = moveUnit(drag.uid, cell);
    if (!res.ok && res.reason !== 'same') showScreenText(res.reason, '', COLORS.fail);
    return;
  }
  if (drag.kind === 'component' || drag.kind === 'detachedComp') {
    const u = shop.units[factoryBoard.selected];
    if (!u) return;
    const si = fbPickSlot(x, y);
    if (si < 0 || u.slots[si]) return;
    const res = installComponent(u.uid, si, drag.compId);
    if (!res.ok) showScreenText(res.reason, '', COLORS.fail);
    return;
  }
}

function factoryBoardWheel(x, y, delta) {
  if (factoryBoard.shopOpen) {
    factoryBoard.scroll.shop = clamp(factoryBoard.scroll.shop + delta * 46, 0, factoryBoard.maxScroll.shop);
    return;
  }
  if (x >= FB.leftX && x <= FB.leftX + FB.leftW) {
    factoryBoard.scroll.warehouse = clamp(factoryBoard.scroll.warehouse + delta * 46, 0, factoryBoard.maxScroll.warehouse);
  }
}

/* ---- 按钮处理 ---- */
function fbHandleButton(b) {
  if (b.id === 'closeBoard') {
    if (factoryBoard.closeAction) factoryBoard.closeAction();
  } else if (b.id === 'openShop') {
    factoryBoard.shopOpen = true;
    factoryBoard.tabShop = 'factory';
    factoryBoard.scroll.shop = 0;
  } else if (b.id === 'coreUp') {
    const res = applyCoreUpgrade();
    if (!res.ok) showScreenText(res.reason, '', COLORS.fail);
  } else if (b.id === 'buySlot') {
    const u = shop.units[factoryBoard.selected];
    if (u) {
      const res = buySlot(u.uid);
      if (!res.ok) showScreenText(res.reason, '', COLORS.fail);
    }
  } else if (b.id === 'collect') {
    const n = collectAllDrops(b.uid);
    if (n > 0) SFX.coin();
  } else if (b.id === 'undeploy') {
    const u = shop.units[factoryBoard.selected];
    if (u) {
      const res = undeployUnit(u.uid);
      if (res.ok) {
        showScreenText('已收回 ' + factoryName(res.factoryId), '', COLORS.textDim);
        factoryBoard.selected = null;
      }
    }
  }
}
function fbClickSlot(uid, slotIndex) {
  const u = shop.units[uid];
  if (!u || !u.slots[slotIndex]) return;
  const slot = u.slots[slotIndex];
  const cd = findComponentDef(slot.compId);
  if (cd && cd.upgradable && slot.level < cd.maxLevel) {
    const res = upgradeComponent(uid, slotIndex);
    if (!res.ok) showScreenText(res.reason, '', COLORS.fail);
  } else {
    removeComponent(uid, slotIndex);
  }
}
function hitBoardButton(x, y) {
  for (const b of factoryBoard.buttons) {
    if (b.disabled) continue;
    if (pointInRect(x, y, b)) return b;
  }
  return null;
}
function fbPickSlot(x, y) {
  const u = shop.units[factoryBoard.selected];
  if (!u) return -1;
  for (let i = 0; i < u.slots.length; i++) {
    if (pointInRect(x, y, fbDetailSlotRect(i))) return i;
  }
  return -1;
}

/* ---- 绘制 ---- */
function factoryBoardDraw(g, opts) {
  const o = opts || {};
  factoryBoard.visible = true;
  factoryBoard.buttons = [];

  /* 半透明底 */
  if (o.dim) {
    g.save();
    g.fillStyle = 'rgba(10,8,6,0.55)';
    g.fillRect(0, 0, W, H);
    g.restore();
    uiPanel(g, FB.leftX - 8, FB.top - 12, FB.gridX + FB.gridW + FB.rightW - FB.leftX + 40, FB.bottom - FB.top + 20, {
      r: 18, color: COLORS.panelDark,
    });
  }

  drawLeftWarehouse(g);
  drawGridBoard(g);
  fbDrawDrops(g);
  drawRightDetail(g);
  drawBoardGhost(g);

  if (factoryBoard.shopOpen) drawShopModal(g);

  if (o.showClose) {
    const r = { x: W - 132, y: FB.top - 10, w: 112, h: 38 };
    uiButton(g, Object.assign({ id: 'closeBoard', label: '关闭', size: 15, accent: COLORS.textDim }, r));
    factoryBoard.buttons.push(Object.assign({ id: 'closeBoard' }, r));
  }
}

/* 左栏: 仓库(标签) */
function drawLeftWarehouse(g) {
  uiPanel(g, FB.leftX, FB.top, FB.leftW, FB.bottom - FB.top, { r: 14 });
  const labels = ['工厂卡', '组件', '背包'];
  const keys = ['factory', 'component', 'backpack'];
  for (let i = 0; i < 3; i++) {
    const r = fbTabRect(i);
    const active = factoryBoard.tabWarehouse === keys[i];
    drawCard(g, r.x, r.y, r.w, r.h, 8, active);
    drawText(g, labels[i], r.x + r.w / 2, r.y + r.h / 2, {
      size: 15, weight: 700, align: 'center', color: active ? COLORS.goldLight : COLORS.cream,
    });
  }

  const area = { x: FB.leftX + 4, y: FB.top + 56, w: FB.leftW - 8, h: FB.bottom - FB.top - 66 };
  g.save();
  g.beginPath();
  g.rect(area.x, area.y, area.w, area.h);
  g.clip();

  if (factoryBoard.tabWarehouse === 'factory') drawWarehouseFactories(g);
  else if (factoryBoard.tabWarehouse === 'component') drawWarehouseComponents(g);
  else drawBackpackTab(g);

  g.restore();
  drawScrollBar(g, area, factoryBoard.scroll.warehouse, factoryBoard.maxScroll.warehouse);
}

function warehouseFactoryIds() {
  return Object.keys(shop.factoryBag).filter((id) => shop.factoryBag[id] > 0);
}
function warehouseCompIds() {
  return Object.keys(shop.components).filter((id) => shop.components[id] > 0);
}

function drawWarehouseFactories(g) {
  const ids = warehouseFactoryIds();
  factoryBoard.maxScroll.warehouse = Math.max(0, ids.length * 52 - (FB.bottom - FB.top - 80));
  if (!ids.length) {
    drawText(g, '（空）去下面「商店」买工厂卡', FB.leftX + 16, FB.top + 110, { size: 14, color: 'rgba(179,155,120,0.7)' });
  }
  ids.forEach((fid, i) => {
    const def = findFactoryDef(fid);
    const r = fbWarehouseRowRect(i);
    if (r.y + r.h < FB.top + 56 || r.y > FB.bottom) return;
    const dragging = factoryBoard.drag && factoryBoard.drag.kind === 'card' && factoryBoard.drag.factoryId === fid;
    const sr = fbWarehouseSellRect(i);
    g.save();
    g.globalAlpha = dragging ? 0.4 : 1;
    drawCard(g, r.x, r.y, r.w, r.h, 9, false);
    drawProductDot(g, r.x + 20, r.y + 23, def);
    drawText(g, def ? def.name : fid, r.x + 36, r.y + 16, { size: 15, weight: 600, color: COLORS.cream, maxWidth: r.w - 90 });
    drawText(g, '仓库 x' + shop.factoryBag[fid] + ' · 拖到网格上场', r.x + 36, r.y + 34, {
      size: 12, color: COLORS.textDim,
    });
    fillRoundRect(g, sr.x, sr.y, sr.w, sr.h, 5, 'rgba(208,90,78,0.85)');
    drawText(g, '卖', sr.x + sr.w / 2, sr.y + sr.h / 2, { size: 12, align: 'center', color: COLORS.cream });
    g.restore();
  });
}

function drawWarehouseComponents(g) {
  const ids = warehouseCompIds();
  factoryBoard.maxScroll.warehouse = Math.max(0, ids.length * 52 - (FB.bottom - FB.top - 80));
  if (!ids.length) {
    drawText(g, '（空）等特殊客人掉落或商店购买', FB.leftX + 16, FB.top + 110, { size: 14, color: 'rgba(179,155,120,0.7)' });
  }
  ids.forEach((cid, i) => {
    const cd = findComponentDef(cid);
    if (!cd) return;
    const r = fbWarehouseRowRect(i);
    if (r.y + r.h < FB.top + 56 || r.y > FB.bottom) return;
    const dragging = factoryBoard.drag && (factoryBoard.drag.kind === 'component' || factoryBoard.drag.kind === 'detachedComp') && factoryBoard.drag.compId === cid;
    const sr = fbWarehouseSellRect(i);
    g.save();
    g.globalAlpha = dragging ? 0.4 : 1;
    fillRoundRect(g, r.x, r.y, r.w, r.h, 9, 'rgba(50,32,20,0.94)');
    strokeRoundRect(g, r.x, r.y, r.w, r.h, 9, cd.type === 'special' ? COLORS.goldLight : 'rgba(217,164,65,0.5)', 1.5);
    drawSprite(g, cd.icon, r.x + 6, r.y + 6, 34, 34);
    drawText(g, cd.name, r.x + 46, r.y + 16, { size: 15, weight: 600, color: COLORS.cream, maxWidth: r.w - 100 });
    drawText(g, (cd.factoryId ? '专属' : '通用') + ' · ' + componentEffectText(cd) + ' · x' + shop.components[cid],
      r.x + 46, r.y + 34, { size: 12, color: cd.factoryId ? COLORS.warn : COLORS.textDim, maxWidth: r.w - 100 });
    fillRoundRect(g, sr.x, sr.y, sr.w, sr.h, 5, cd.buyable ? 'rgba(208,90,78,0.85)' : 'rgba(80,60,45,0.7)');
    drawText(g, '卖', sr.x + sr.w / 2, sr.y + sr.h / 2, { size: 12, align: 'center', color: COLORS.cream });
    g.restore();
  });
}

function drawBackpackTab(g) {
  let y = FB.top + 76;
  const kinds = [
    { kind: 'crust', defs: typeof CRUSTS !== 'undefined' ? CRUSTS : [] },
    { kind: 'filling', defs: typeof FILLINGS !== 'undefined' ? FILLINGS : [] },
  ];
  for (const group of kinds) {
    const got = group.defs.filter((d) => backpackCount(group.kind, d.id) > 0);
    if (!got.length) continue;
    drawText(g, group.kind === 'crust' ? '饼皮' : '馅料', FB.leftX + 16, y, { size: 14, weight: 700, color: COLORS.goldLight });
    y += 26;
    for (const d of got) {
      fillRoundRect(g, FB.leftX + 12, y - 15, FB.leftW - 24, 36, 8, 'rgba(42,24,16,0.9)');
      g.fillStyle = d.color || COLORS.cream;
      g.beginPath();
      g.arc(FB.leftX + 28, y + 3, 10, 0, Math.PI * 2);
      g.fill();
      drawText(g, d.name, FB.leftX + 46, y + 3, { size: 14, weight: 600, color: COLORS.cream });
      drawText(g, 'x' + backpackCount(group.kind, d.id), FB.leftX + FB.leftW - 24, y + 3, {
        size: 15, weight: 700, align: 'right', color: COLORS.gold,
      });
      y += 44;
    }
    y += 8;
  }
  if (y === FB.top + 76) {
    drawText(g, '背包是空的', FB.leftX + 16, FB.top + 110, { size: 14, color: 'rgba(179,155,120,0.7)' });
    drawText(g, '点网格工厂上的「产物」徽标收集', FB.leftX + 16, FB.top + 136, { size: 12, color: 'rgba(179,155,120,0.55)' });
  }
}

/* 中栏: 网格 */
function drawGridBoard(g) {
  const powered = poweredUnitIds();
  const cap = coreCapacity();
  const used = Object.keys(powered).length;

  for (let cell = 0; cell < GRID.size * GRID.size; cell++) {
    const r = fbCellRect(cell);
    if (isCoreCell(cell)) {
      drawCoreCell(g, r, used, cap);
      continue;
    }
    const u = unitAtCell(cell);
    if (!u) {
      fillRoundRect(g, r.x, r.y, r.w, r.h, 10, 'rgba(24,18,12,0.5)');
      g.save();
      g.strokeStyle = 'rgba(179,155,120,0.25)';
      g.setLineDash([6, 6]);
      roundRect(g, r.x, r.y, r.w, r.h, 10);
      g.stroke();
      g.restore();
      continue;
    }
    drawUnitCard(g, u, r, !!powered[u.uid], factoryBoard.selected === u.uid);
  }
}

function drawCoreCell(g, r, used, cap) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const full = used >= cap;
  fillRoundRect(g, r.x, r.y, r.w, r.h, 12, 'rgba(217,164,65,0.18)');
  strokeRoundRect(g, r.x, r.y, r.w, r.h, 12, full ? COLORS.warn : COLORS.goldLight, 2.5);
  g.save();
  g.globalAlpha = 0.25 + (Math.sin(performance.now() / 500) + 1) / 4;
  g.fillStyle = COLORS.goldLight;
  g.beginPath();
  g.arc(cx, cy, 26, 0, Math.PI * 2);
  g.fill();
  g.restore();
  drawText(g, '能源核心', cx, cy - 22, { size: 15, weight: 700, align: 'center', color: COLORS.goldLight });
  drawText(g, 'Lv.' + coreLevel(), cx, cy + 4, { size: 20, weight: 700, align: 'center', color: COLORS.cream });
  drawText(g, '电量 ' + used + '/' + cap, cx, cy + 30, {
    size: 14, weight: 600, align: 'center', color: full ? COLORS.warn : COLORS.ok,
  });
}

function drawUnitCard(g, u, r, on, sel) {
  const def = findFactoryDef(u.factoryId);
  const dragging = factoryBoard.drag && factoryBoard.drag.kind === 'unit' && factoryBoard.drag.uid === u.uid;
  g.save();
  g.globalAlpha = dragging ? 0.4 : 1;
  fillRoundRect(g, r.x, r.y, r.w, r.h, 10, on ? 'rgba(52,42,24,0.97)' : 'rgba(38,28,20,0.97)');
  strokeRoundRect(g, r.x, r.y, r.w, r.h, 10, sel ? COLORS.goldLight : on ? COLORS.ok : 'rgba(179,155,120,0.5)', sel ? 3 : 2);

  drawProductDot(g, r.x + 14, r.y + 14, def);
  drawText(g, def ? def.name : u.factoryId, r.x + 26, r.y + 14, {
    size: 12, weight: 600, color: COLORS.cream, maxWidth: r.w - 34,
  });

  /* 槽位小格 */
  const sw = 15;
  const gp = 4;
  const total = u.slots.length;
  const startX = r.x + (r.w - (total * sw + (total - 1) * gp)) / 2;
  for (let i = 0; i < total; i++) {
    const sx = startX + i * (sw + gp);
    const sy = r.y + 30;
    fillRoundRect(g, sx, sy, sw, sw, 4, u.slots[i] ? 'rgba(217,164,65,0.9)' : 'rgba(20,16,12,0.8)');
    strokeRoundRect(g, sx, sy, sw, sw, 4, u.slots[i] ? COLORS.goldLight : 'rgba(179,155,120,0.4)', 1);
  }

  /* 进度条(吸料塔显示自动吸料) */
  const barX = r.x + 8;
  const barY = r.y + r.h - 26;
  const barW = r.w - 16;
  const isUtil = def && def.kind === 'util';
  if (isUtil) {
    uiBarMini(g, barX, barY, barW, 8, on ? 1 : 0, on ? COLORS.icy : 'rgba(179,155,120,0.5)');
    drawText(g, on ? '自动吸料中' : '断电', r.x + 8, barY - 8, {
      size: 11, color: on ? COLORS.icy : COLORS.fail,
    });
  } else {
    uiBarMini(g, barX, barY, barW, 8, u.progress || 0, on ? COLORS.ok : 'rgba(179,155,120,0.5)');
    const pct = Math.floor((u.progress || 0) * 100);
    drawText(g, on ? '生产 ' + pct + '%' : '断电', r.x + 8, barY - 8, {
      size: 11, color: on ? COLORS.textDim : COLORS.fail,
    });
  }

  /* 待捡提示 */
  if (u.drops > 0) {
    drawText(g, '待捡 ×' + u.drops, r.x + r.w - 8, r.y + 14, {
      size: 11, weight: 700, align: 'right', color: u.drops >= PRODUCE.maxDrops ? COLORS.warn : COLORS.ok,
    });
  }
  g.restore();
}

/* 右栏: 详情 + 背包/商店/核心 按钮 */
function drawRightDetail(g) {
  uiPanel(g, FB.rightX, FB.top, FB.rightW, FB.bottom - FB.top, { r: 14 });

  const u = shop.units[factoryBoard.selected];
  if (!u) {
    drawText(g, '点网格上的工厂查看', FB.rightX + 16, FB.top + 28, { size: 16, weight: 700, color: COLORS.goldLight });
    drawText(g, '能源核心 Lv.' + coreLevel() + '　总电量 ' + coreCapacity(), FB.rightX + 16, FB.top + 56, {
      size: 14, color: COLORS.cream,
    });
    drawText(g, '每座工厂耗 1 电，多出来的工厂会断电', FB.rightX + 16, FB.top + 80, {
      size: 12, color: COLORS.textDim,
    });
  } else {
    const def = findFactoryDef(u.factoryId);
    const on = isUnitPowered(u.uid);
    drawText(g, (def ? def.name : u.factoryId) + (on ? ' ⚡' : ' ⚡断电'), FB.rightX + 16, FB.top + 26, {
      size: 18, weight: 700, color: on ? COLORS.goldLight : COLORS.textDim,
    });
    drawText(g, '速度 ' + u.speed.toFixed(1) + '/s　品质 ' + u.quality.toFixed(1) + '　待捡 ' + u.drops,
      FB.rightX + 16, FB.top + 54, { size: 13, color: COLORS.textDim });

    drawText(g, '槽位（从左边组件仓库拖入 · 点已装升级/卸下）', FB.rightX + 16, FB.top + 148, {
      size: 12, weight: 600, color: COLORS.textDim,
    });
    u.slots.forEach((slot, i) => {
      const r = fbDetailSlotRect(i);
      if (slot) {
        const cd = findComponentDef(slot.compId);
        const top = cd && cd.upgradable && slot.level < cd.maxLevel;
        fillRoundRect(g, r.x, r.y, r.w, r.h, 9, 'rgba(60,40,24,0.95)');
        strokeRoundRect(g, r.x, r.y, r.w, r.h, 9, cd && cd.type === 'special' ? COLORS.goldLight : COLORS.gold, 2);
        drawSprite(g, cd ? cd.icon : 'icon_unlock', r.x + 8, r.y + 10, 36, 36);
        drawText(g, cd ? cd.name : '?', r.x + 50, r.y + 22, { size: 12, weight: 600, color: COLORS.cream, maxWidth: r.w - 58 });
        drawText(g, 'Lv.' + slot.level + (top ? ' ↑可升级' : ''), r.x + 50, r.y + 42, {
          size: 11, color: top ? COLORS.ok : COLORS.textDim,
        });
        drawText(g, componentEffectText(cd), r.x + 8, r.y + r.h - 8, {
          size: 9, color: COLORS.textDim, maxWidth: r.w - 16,
        });
      } else {
        fillRoundRect(g, r.x, r.y, r.w, r.h, 9, 'rgba(24,18,12,0.9)');
        g.save();
        g.strokeStyle = 'rgba(179,155,120,0.4)';
        g.setLineDash([6, 6]);
        roundRect(g, r.x, r.y, r.w, r.h, 9);
        g.stroke();
        g.restore();
        drawText(g, '空槽', r.x + r.w / 2, r.y + r.h / 2, { size: 13, align: 'center', color: COLORS.textDim });
      }
    });
    /* 开槽 / 收回 */
    const bw = (FB.rightW - 32) / 2;
    const by = FB.top + 340;
    if (u.slots.length < MAX_SLOTS) {
      const cost = slotCost(u.slots.length);
      const afford = shop.coins >= cost;
      uiButton(g, {
        id: 'buySlot', x: FB.rightX + 12, y: by, w: bw, h: 40,
        label: '开槽 ' + formatNum(cost), size: 13,
        accent: afford ? COLORS.gold : COLORS.textDim, disabled: !afford,
      });
      factoryBoard.buttons.push({ id: 'buySlot', x: FB.rightX + 12, y: by, w: bw, h: 40, disabled: !afford });
    } else {
      drawText(g, '槽位已满', FB.rightX + 12, by + 20, { size: 13, color: COLORS.textDim });
    }
    uiButton(g, {
      id: 'undeploy', x: FB.rightX + 20 + bw, y: by, w: bw, h: 40,
      label: '收回仓库', size: 13, accent: COLORS.textDim,
    });
    factoryBoard.buttons.push({ id: 'undeploy', x: FB.rightX + 20 + bw, y: by, w: bw, h: 40 });

    /* 收集全部产物 */
    if (u.drops > 0) {
      const cr = { x: FB.rightX + 12, y: by + 48, w: FB.rightW - 24, h: 38 };
      uiButton(g, Object.assign({
        id: 'collect', label: '收集产物 ×' + u.drops, size: 14, accent: COLORS.ok,
      }, cr));
      factoryBoard.buttons.push(Object.assign({ id: 'collect', uid: u.uid, x: cr.x, y: cr.y, w: cr.w, h: cr.h }));
    }
  }

  /* 底部: 商店 / 升级核心 */
  const sr = fbShopButtonRect();
  uiButton(g, Object.assign({ id: 'openShop', label: '商店', size: 16, accent: COLORS.gold }, sr));
  factoryBoard.buttons.push(Object.assign({ id: 'openShop' }, sr));

  const cr = fbCoreButtonRect();
  const cost = coreUpgradeCost();
  const afford = cost != null && shop.coins >= cost;
  uiButton(g, Object.assign({
    id: 'coreUp', label: cost == null ? '核心已满级' : '升级核心 💰' + formatNum(cost), size: 13,
    accent: cost == null ? COLORS.textDim : afford ? COLORS.ok : COLORS.textDim, disabled: cost == null || !afford,
  }, cr));
  if (cost != null) factoryBoard.buttons.push(Object.assign({ id: 'coreUp', disabled: !afford }, cr));
}

/* 商店弹窗 */
function fbShopRows() {
  if (factoryBoard.tabShop === 'factory') return FACTORIES;
  return COMPONENT_TYPES.filter((c) => c.buyable);
}
function drawShopModal(g) {
  const p = fbShopRect();
  g.save();
  g.fillStyle = 'rgba(8,6,4,0.55)';
  g.fillRect(0, 0, W, H);
  g.restore();
  uiPanel(g, p.x, p.y, p.w, p.h, { r: 18, color: COLORS.panelDark });

  drawText(g, '商店', p.x + 18, p.y + 28, { size: 22, weight: 700, color: COLORS.goldLight });
  const labels = ['工厂', '组件'];
  for (let i = 0; i < 2; i++) {
    const r = fbShopTabRect(i);
    const active = (i === 0) === (factoryBoard.tabShop === 'factory');
    drawCard(g, r.x, r.y, r.w, r.h, 8, active);
    drawText(g, labels[i], r.x + r.w / 2, r.y + r.h / 2, {
      size: 15, weight: 700, align: 'center', color: active ? COLORS.goldLight : COLORS.cream,
    });
  }
  const close = { x: p.x + p.w - 96, y: p.y + 12, w: 84, h: 34 };
  uiButton(g, Object.assign({ id: 'shopClose', label: '关闭', size: 14, accent: COLORS.textDim }, close));

  const rows = fbShopRows();
  const isFactory = factoryBoard.tabShop === 'factory';
  const area = { x: p.x + 8, y: p.y + 58, w: p.w - 16, h: p.h - 66 };
  const nrows = Math.ceil(rows.length / FB_SHOP.cols);
  factoryBoard.maxScroll.shop = Math.max(0, nrows * (FB_SHOP.cellH + FB_SHOP.gapY) - FB_SHOP.gapY - area.h);

  g.save();
  g.beginPath();
  g.rect(area.x, area.y, area.w, area.h);
  g.clip();
  rows.forEach((def, i) => {
    const r = fbShopCellRect(i);
    if (r.y + r.h < area.y || r.y > area.y + area.h) return;
    const cost = def.cost;
    const afford = shop.coins >= cost;

    drawCard(g, r.x, r.y, r.w, r.h, 12, afford);

    if (isFactory) {
      const kindLabel = def.kind === 'crust' ? '饼皮工厂' : def.kind === 'util' ? '自动设施（吸相邻4格）' : '馅料工厂';
      const iconKey = def.kind === 'crust' ? 'factory_crust' : def.kind === 'filling' ? 'factory_filling' : null;
      if (iconKey && img(iconKey)) {
        drawSprite(g, iconKey, r.x + 10, r.y + 16, 56, 56);
        drawText(g, def.name, r.x + 74, r.y + 26, { size: 15, weight: 700, color: COLORS.cream, maxWidth: r.w - 86 });
        drawText(g, kindLabel, r.x + 74, r.y + 48, { size: 11, color: COLORS.textDim });
      } else {
        drawProductDot(g, r.x + 28, r.y + 30, def);
        drawText(g, def.name, r.x + 48, r.y + 22, { size: 15, weight: 700, color: COLORS.cream, maxWidth: r.w - 60 });
        drawText(g, kindLabel, r.x + 48, r.y + 44, { size: 11, color: COLORS.textDim });
      }
    } else {
      drawSprite(g, def.icon, r.x + 12, r.y + 14, 44, 44);
      drawText(g, def.name, r.x + 64, r.y + 22, { size: 15, weight: 700, color: COLORS.cream, maxWidth: r.w - 74 });
      drawText(g, componentEffectText(def), r.x + 64, r.y + 44, { size: 12, weight: 600, color: COLORS.goldLight, maxWidth: r.w - 74 });
      drawText(g, def.desc, r.x + 64, r.y + 64, { size: 10, color: COLORS.textDim, maxWidth: r.w - 74 });
    }

    drawText(g, '💰' + cost, r.x + r.w - 14, r.y + r.h - 18, {
      size: 17, weight: 700, align: 'right', color: afford ? COLORS.gold : COLORS.fail,
    });
    drawText(g, afford ? '点击购买' : '金币不足', r.x + 14, r.y + r.h - 18, {
      size: 11, color: afford ? COLORS.textDim : COLORS.fail,
    });
    factoryBoard.buttons.push({ id: 'buyShopCell', value: def.id, x: r.x, y: r.y, w: r.w, h: r.h, disabled: !afford });
  });
  g.restore();
  drawScrollBar(g, area, factoryBoard.scroll.shop, factoryBoard.maxScroll.shop);
}

/* 拖拽鬼影 */
function drawBoardGhost(g) {
  const drag = factoryBoard.drag;
  if (!drag) return;
  g.save();
  g.globalAlpha = 0.9;
  if (drag.kind === 'card') {
    const def = findFactoryDef(drag.factoryId);
    drawProductDot(g, drag.x - 12, drag.y, def);
    drawText(g, def ? def.name : drag.factoryId, drag.x - 2, drag.y, { size: 14, weight: 700, color: COLORS.goldLight });
    for (let cell = 0; cell < GRID.size * GRID.size; cell++) {
      if (isCoreCell(cell) || unitAtCell(cell)) continue;
      const r = fbCellRect(cell);
      g.globalAlpha = 0.35 + Math.sin(performance.now() / 200) * 0.2;
      strokeRoundRect(g, r.x, r.y, r.w, r.h, 10, COLORS.ok, 3);
    }
  } else if (drag.kind === 'unit') {
    const u = shop.units[drag.uid];
    if (u) {
      const def = findFactoryDef(u.factoryId);
      drawProductDot(g, drag.x - 12, drag.y, def);
      drawText(g, def ? def.name : u.factoryId, drag.x - 2, drag.y, { size: 14, weight: 700, color: COLORS.goldLight });
    }
  } else if (drag.kind === 'component' || drag.kind === 'detachedComp') {
    const cd = findComponentDef(drag.compId);
    drawSprite(g, cd ? cd.icon : 'icon_unlock', drag.x - 22, drag.y - 22, 44, 44);
    const u = shop.units[factoryBoard.selected];
    if (u && drag.kind === 'component') {
      u.slots.forEach((slot, i) => {
        if (slot) return;
        const r = fbDetailSlotRect(i);
        g.globalAlpha = 0.5 + Math.sin(performance.now() / 200) * 0.25;
        strokeRoundRect(g, r.x, r.y, r.w, r.h, 9, COLORS.ok, 3);
      });
    }
  }
  g.restore();
}

/* ---- 小工具 ---- */
function uiBarMini(g, x, y, w, h, ratio, color) {
  fillRoundRect(g, x, y, w, h, h / 2, 'rgba(20,16,12,0.8)');
  const r = clamp(ratio, 0, 1);
  if (r > 0) fillRoundRect(g, x, y, Math.max(h, w * r), h, h / 2, color);
}
function drawProductDot(g, x, y, def) {
  let color = COLORS.cream;
  if (def) {
    if (def.kind === 'util') color = COLORS.icy;
    else {
      const p = def.kind === 'crust' ? findCrustDef(def.productId) : findFillingDef(def.productId);
      if (p) color = p.color;
    }
  }
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, 9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  g.stroke();
}
function factoryName(fid) {
  const def = findFactoryDef(fid);
  return def ? def.name : fid;
}
function compName(cid) {
  const def = findComponentDef(cid);
  return def ? def.name : cid;
}
function drawScrollBar(g, area, scroll, maxScroll) {
  if (maxScroll <= 0) return;
  const trackH = area.h;
  const barH = Math.max(40, trackH * (trackH / (trackH + maxScroll)));
  const y = area.y + (trackH - barH) * (scroll / maxScroll);
  fillRoundRect(g, area.x + area.w - 8, y, 6, barH, 3, 'rgba(217,164,65,0.5)');
}
