'use strict';

/* 制作台升级浮层: 制作台数量 / 烤炉数量 / 烤炉速度 / 收银小车 / 制作台自动化
 * 全局浮层: 开始界面与营业中都能打开, 营业中打开不打断当天
 * 由 state.js 指针分发最优先拦截, main.js 统一绘制 */

/* global W, H, COLORS, shop, run, OVEN, COUNTER, COUNTER_LABEL, benchSlotCount, counterLevel,
   counterUpgradeCost, applyCounterUpgrade, upgradesFor, applyOvenUpgrade, formatNum,
   drawText, uiPanel, uiButton, pointInRect, fillRoundRect, strokeRoundRect, SFX,
   showScreenText, slotAutoEnabled, slotAutoLevel, slotAutoCost, upgradeSlotAuto */

const benchUpgradeUI = { open: false, focus: null }; // focus: { kind:'bench'|'oven', index }

function benchUpgradeToggle(force) {
  benchUpgradeUI.open = force == null ? !benchUpgradeUI.open : !!force;
  SFX.click();
}

function benchUpgradePanelRect() {
  const n = benchUpgradeRows().length;
  const w = 880;
  const h = 96 + n * 86 + 12; // 高度跟着行数走, 只显示相关升级
  return { x: (W - w) / 2, y: (H - h) / 2 - 8, w, h };
}
function benchUpgradeCloseRect() {
  const p = benchUpgradePanelRect();
  return { x: p.x + p.w - 108, y: p.y + 16, w: 88, h: 36 };
}
function benchUpgradeRowRect(i) {
  const p = benchUpgradePanelRect();
  return { x: p.x + 24, y: p.y + 96 + i * 86, w: p.w - 48, h: 74 };
}
function benchUpgradeBtnRect(i) {
  const r = benchUpgradeRowRect(i);
  return { x: r.x + r.w - 232, y: r.y + 13, w: 208, h: 48 };
}

/* 每行: id / 名称 / 当前值 / 说明 / 花费(满级为 null) / 应用函数
 * 按点击的部位过滤: 制作台槽位只显示制作台相关; 烤位只显示烤炉相关; 通用按钮显示全部 */
function benchUpgradeRows() {
  const focus = benchUpgradeUI.focus;
  const benchIdx = focus && focus.kind === 'bench' ? focus.index : null;
  const slot = benchIdx != null && run.slots ? run.slots[benchIdx] : null;
  const ovenLv = shop.ovenLevel || 1;
  const ups = upgradesFor('oven');
  const nextOven = ups.find((u, i) => ovenLv === OVEN.slots + i);

  const tray = {
    id: 'tray', name: '制作台数量',
    value: benchSlotCount() + ' / ' + COUNTER.tray.slots,
    desc: '每级 +1 个制作台托盘，能同时做更多月饼',
    cost: counterUpgradeCost('tray'),
    apply: () => applyCounterUpgrade('tray'),
  };
  const oven = {
    id: 'oven', name: '烤炉数量',
    value: ovenLv + ' / ' + OVEN.maxSlots,
    desc: '每级 +1 个烤位（烤位是真正的瓶颈）',
    cost: nextOven ? nextOven.cost : null,
    apply: () => (nextOven ? applyOvenUpgrade(nextOven.id) : false),
  };
  const boiler = {
    id: 'boiler', name: '烤炉速度',
    value: 'Lv.' + counterLevel('boiler') + ' / ' + COUNTER.boiler.max,
    desc: '缩短烘烤时间、延后烤糊，出餐更稳',
    cost: counterUpgradeCost('boiler'),
    apply: () => applyCounterUpgrade('boiler'),
  };
  const cart = {
    id: 'cart', name: '收银小车',
    value: 'Lv.' + counterLevel('cart') + ' / ' + COUNTER.cart.max,
    desc: '小车在柜台上来回移动，自动捡起金币',
    cost: counterUpgradeCost('cart'),
    apply: () => applyCounterUpgrade('cart'),
  };
  const lv = slot ? slotAutoLevel(benchIdx) : 0;
  const auto = {
    id: 'auto', name: '自动装配速度',
    value: slot ? ('Lv.' + lv + ' / ' + COUNTER.auto.max) : '—',
    desc: slot
      ? '第 ' + (benchIdx + 1) + ' 个制作台自动取皮+馅组装；等级越高每步越快（第 1 级即开启）'
      : '从营业画面「某个制作台」右上角的 ⬆ 进入，可指定要自动化的制作台',
    cost: slot ? slotAutoCost(benchIdx) : null,
    apply: () => (slot ? upgradeSlotAuto(benchIdx) : { ok: false, reason: '请从制作台槽位进入' }),
  };
  const autoBake = {
    id: 'autoBake', name: '自动烤制',
    value: counterLevel('autoBake') > 0 ? '已开启' : '未开启',
    desc: '自动制作台装好的月饼，自动送进空闲烤位（出餐仍手动）',
    cost: counterUpgradeCost('autoBake'),
    apply: () => applyCounterUpgrade('autoBake'),
  };

  if (focus && focus.kind === 'bench') return [tray, auto];
  if (focus && focus.kind === 'oven') return [oven, boiler, autoBake];
  return [tray, oven, boiler, autoBake, cart, auto];
}

/* ---- 指针分发(营业/开始界面都能用) ---- */
function benchUpgradeHandleDown(x, y) {
  if (!benchUpgradeUI.open) return false;
  if (pointInRect(x, y, benchUpgradeCloseRect())) {
    benchUpgradeToggle(false);
    return true;
  }
  const rows = benchUpgradeRows();
  for (let i = 0; i < rows.length; i++) {
    if (!pointInRect(x, y, benchUpgradeBtnRect(i))) continue;
    const row = rows[i];
    if (row.cost == null) {
      showScreenText('「' + row.name + '」已满级', '', COLORS.textDim);
      return true;
    }
    if (shop.coins < row.cost) {
      showScreenText('金币不足', '', COLORS.fail);
      SFX.fail();
      return true;
    }
    const res = row.apply();
    if (res && res.ok === false) showScreenText(res.reason, '', COLORS.fail);
    else SFX.unlock();
    return true;
  }
  return true; // 打开时吞掉指针
}
function benchUpgradeHandleMove() {
  return benchUpgradeUI.open;
}
function benchUpgradeHandleUp() {
  return benchUpgradeUI.open;
}
function benchUpgradeHandleWheel() {
  return benchUpgradeUI.open;
}

/* ---- 绘制 ---- */
function drawBenchUpgradeWindow(g) {
  const p = benchUpgradePanelRect();
  g.save();
  g.fillStyle = 'rgba(8,6,4,0.6)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, p.x, p.y, p.w, p.h, { r: 20, color: COLORS.panelDark });
  const focus = benchUpgradeUI.focus;
  let title = '制作台升级';
  if (focus && focus.kind === 'bench') title = '制作台升级 · 第 ' + (focus.index + 1) + ' 个制作台';
  else if (focus && focus.kind === 'oven') title = '烤炉升级 · 第 ' + (focus.index + 1) + ' 个烤位';
  drawText(g, title, p.x + 28, p.y + 38, { size: 26, weight: 700, color: COLORS.goldLight });
  drawText(g, '金币 ' + formatNum(shop.coins), p.x + p.w - 140, p.y + 38, {
    size: 18, weight: 700, align: 'right', color: COLORS.gold,
  });
  const cr = benchUpgradeCloseRect();
  uiButton(g, Object.assign({ id: 'benchClose', label: '关闭', size: 15, accent: COLORS.textDim }, cr));

  const rows = benchUpgradeRows();
  rows.forEach((row, i) => {
    const r = benchUpgradeRowRect(i);
    const full = row.cost == null;
    const afford = !full && shop.coins >= row.cost;
    drawCard(g, r.x, r.y, r.w, r.h, 12, !full);

    drawText(g, row.name, r.x + 20, r.y + 26, { size: 19, weight: 700, color: COLORS.cream });
    drawText(g, row.value, r.x + 20, r.y + 52, { size: 15, weight: 600, color: COLORS.goldLight });
    drawText(g, row.desc, r.x + 210, r.y + 40, {
      size: 13, color: COLORS.textDim, maxWidth: r.w - 470,
    });

    const br = benchUpgradeBtnRect(i);
    if (full) {
      uiButton(g, Object.assign({ label: '已满级', size: 16, accent: COLORS.ok, disabled: true }, br));
    } else {
      uiButton(g, Object.assign({
        label: '升级', sublabel: '💰' + formatNum(row.cost), size: 16,
        accent: afford ? COLORS.gold : COLORS.textDim, disabled: !afford,
      }, br));
    }
  });
}
