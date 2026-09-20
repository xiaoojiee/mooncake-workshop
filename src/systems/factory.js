'use strict';

/* 后厂经济 v3: 5×5 网格 + 能源核心(电量有限) + 进度条产物 + 背包
 *
 * 数据:
 *   shop.factoryBag  { factoryId: 张数 }   —— 工厂仓库(还没上场的卡片)
 *   shop.units       { uid: unit }         —— 已上场的工厂实例
 *   shop.components  { compId: 数量 }      —— 组件仓库
 *   shop.backpack    { crust:{}, filling:{} } —— 背包(捡来的产物)
 *   shop.coreLevel                          —— 能源核心等级(决定总电量)
 *
 * 生产:
 *   通电工厂按 speed 累积进度; 进度满 1 → 生成一个「掉落产物」
 *   工厂旁堆满 PRODUCE.maxDrops 个未捡产物就停产
 *   点击产物 → 收进背包
 *
 * 供电:
 *   能源核心在中心格; 工厂必须与核心「直接/间接(上下左右串起来)」相连
 *   每座工厂耗 1 格电; 电量不够时离核心近的优先, 远的断电
 */

/* global shop, run, FACTORIES, UPGRADES, STOCK_START_RATIO, FACTORY_TICK, FETCH, COLORS,
   OVEN, ASSEMBLY, COUNTER, COUNTER_LABEL, CORE, PRODUCE, createOvenSlot, createSlot,
   addFloater, SFX, saveGame, findComponentDef, findFactoryDef, isComponentAllowed,
   componentRestrictLabel, computeFactoryStats, slotCost, componentUpgradeCost, MAX_SLOTS */

/* ---- 5×5 网格 ---- */
const GRID = { size: 5, core: 12 };

function gridRow(cell) {
  return Math.floor(cell / GRID.size);
}
function gridCol(cell) {
  return cell % GRID.size;
}
function cellIndex(r, c) {
  return r * GRID.size + c;
}
function isCoreCell(cell) {
  return cell === GRID.core;
}
function cellInGrid(cell) {
  return typeof cell === 'number' && cell >= 0 && cell < GRID.size * GRID.size;
}
function neighborsOf(cell) {
  const r = gridRow(cell);
  const c = gridCol(cell);
  const out = [];
  if (r > 0) out.push(cellIndex(r - 1, c));
  if (r < GRID.size - 1) out.push(cellIndex(r + 1, c));
  if (c > 0) out.push(cellIndex(r, c - 1));
  if (c < GRID.size - 1) out.push(cellIndex(r, c + 1));
  return out;
}

/* ---- 开局家底: 三座工厂已挨着核心上场, 仓库里再给两张卡 ---- */
const STARTER_UNITS = [
  { factoryId: 'factory_crust_guangshi', cell: 7 },
  { factoryId: 'factory_filling_wuren', cell: 11 },
  { factoryId: 'factory_filling_lianrong', cell: 17 },
];
const STARTER_CARDS = { factory_filling_dousha: 1, factory_filling_danhuang: 1 };

/* ---- 工厂实例 ---- */

function addUnit(factoryId, cell) {
  const def = findFactoryDef(factoryId);
  if (!def) return null;
  const uid = 'u' + (shop.nextUnitId || 1);
  shop.nextUnitId = (shop.nextUnitId || 1) + 1;
  shop.units[uid] = {
    uid,
    factoryId,
    cell,
    slots: [null],
    progress: 0, // 0..1 生产进度条
    drops: 0, // 待捡产物数量
    capacity: def.baseCapacity,
    quality: def.baseQuality,
    speed: def.baseSpeed,
  };
  return shop.units[uid];
}

function initFactories(saved) {
  shop.units = {};
  shop.factoryBag = {};
  shop.nextUnitId = 1;
  shop.components = shop.components || {};
  shop.coreLevel = shop.coreLevel || 1;
  shop.backpack = { crust: {}, filling: {} };

  for (const s of STARTER_UNITS) addUnit(s.factoryId, s.cell);
  for (const fid in STARTER_CARDS) shop.factoryBag[fid] = STARTER_CARDS[fid];
  /* 背包从空开始: 开业前用「备货」自己买, 不再白送工厂产物 */

  if (saved) applyFactorySave(saved);
  refreshAllFactories();
}

function normalizeSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return [null];
  return slots.slice(0, MAX_SLOTS).map((s) => {
    if (!s || !s.compId) return null;
    return { compId: s.compId, level: s.level || 1 };
  });
}

function applyFactorySave(saved) {
  if (!saved) return;
  if (saved.units && !Array.isArray(saved.units)) {
    shop.units = {};
    shop.nextUnitId = saved.nextUnitId || 1;
    for (const uid in saved.units) {
      const s = saved.units[uid];
      if (!s || !findFactoryDef(s.factoryId) || !cellInGrid(s.cell) || isCoreCell(s.cell)) continue;
      shop.units[uid] = {
        uid,
        factoryId: s.factoryId,
        cell: s.cell,
        slots: normalizeSlots(s.slots),
        progress: s.progress != null ? s.progress : 0,
        drops: s.drops != null ? s.drops : 0,
        capacity: s.capacity != null ? s.capacity : 0,
        quality: s.quality != null ? s.quality : 1,
        speed: s.speed != null ? s.speed : 0,
      };
      const n = parseInt(String(uid).replace(/^u/, ''), 10);
      if (Number.isFinite(n) && n >= shop.nextUnitId) shop.nextUnitId = n + 1;
    }
  }
  if (saved.bag) shop.factoryBag = saved.bag;
  if (saved.components) shop.components = saved.components;
  if (saved.coreLevel) shop.coreLevel = saved.coreLevel;
  if (saved.backpack) {
    shop.backpack.crust = saved.backpack.crust || {};
    shop.backpack.filling = saved.backpack.filling || {};
  }
}

function getUnit(uid) {
  return shop.units[uid] || null;
}
function unitAtCell(cell) {
  for (const uid in shop.units) {
    if (shop.units[uid].cell === cell) return shop.units[uid];
  }
  return null;
}
function unitsList() {
  const out = [];
  for (const uid in shop.units) out.push(shop.units[uid]);
  return out;
}

function refreshUnit(uid) {
  const u = shop.units[uid];
  if (!u) return;
  const def = findFactoryDef(u.factoryId);
  if (!def) return;
  const stats = computeFactoryStats(def, u);
  u.speed = stats.finalSpeed;
  u.quality = stats.quality;
  u.capacity = Math.round(def.baseCapacity * (1 + (u.slots.length - 1) * 0.3));
}

function refreshAllFactories() {
  for (const uid in shop.units) refreshUnit(uid);
}

/* ---- 能源核心 ---- */
function coreLevel() {
  return Math.min(Math.max(shop.coreLevel || 1, 1), CORE.maxLevel);
}
function coreCapacity() {
  return CORE.capacity[coreLevel() - 1];
}
function coreUpgradeCost() {
  const lv = coreLevel();
  return lv >= CORE.maxLevel ? null : CORE.cost[lv - 1];
}
function applyCoreUpgrade() {
  const cost = coreUpgradeCost();
  if (cost == null) return { ok: false, reason: '能源核心已满级' };
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  shop.coreLevel = coreLevel() + 1;
  addFloater('能源核心 Lv.' + shop.coreLevel + ' (+' + coreCapacity() + '电)', 1100, 340, COLORS.ok, 1.5);
  SFX.unlock();
  saveGame();
  return { ok: true, level: shop.coreLevel, cost };
}

/* ---- 连通 + 供电分配 ---- */
/* 先找出与核心串起来的工厂, 再按离核心远近分配电量(近的优先) */
function poweredUnitIds() {
  /* 只有开业(营业中)才通电; 菜单/工厂管理/结算时全部断电 */
  if (!run.powerOn) return {};
  const byCell = {};
  for (const uid in shop.units) byCell[shop.units[uid].cell] = uid;

  const depth = { [GRID.core]: 0 };
  const seen = { [GRID.core]: true };
  const queue = [GRID.core];
  const connected = [];
  while (queue.length) {
    const cell = queue.shift();
    for (const nb of neighborsOf(cell)) {
      if (seen[nb]) continue;
      const uid = byCell[nb];
      if (!uid) continue; // 只能通过工厂串起来
      seen[nb] = true;
      depth[nb] = depth[cell] + 1;
      connected.push({ uid, d: depth[nb], cell: nb });
      queue.push(nb);
    }
  }
  connected.sort((a, b) => a.d - b.d || a.cell - b.cell);
  const cap = coreCapacity();
  const powered = {};
  for (let i = 0; i < connected.length && i < cap; i++) powered[connected[i].uid] = true;
  return powered;
}
function isUnitPowered(uid) {
  return !!poweredUnitIds()[uid];
}

/* ---- 工厂卡片: 买 / 卖 / 上场 / 下场 / 移动 ---- */

function buyFactory(factoryId) {
  const def = findFactoryDef(factoryId);
  if (!def) return { ok: false, reason: '工厂不存在' };
  const cost = def.cost || 0;
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  shop.factoryBag[factoryId] = (shop.factoryBag[factoryId] || 0) + 1;
  SFX.coin();
  saveGame();
  return { ok: true, cost };
}

function sellFactory(factoryId) {
  const def = findFactoryDef(factoryId);
  if (!def || !(shop.factoryBag[factoryId] > 0)) return { ok: false, reason: '仓库里没有这张卡' };
  const price = Math.max(1, Math.floor((def.cost || 0) * 0.5));
  shop.factoryBag[factoryId] -= 1;
  if (shop.factoryBag[factoryId] <= 0) delete shop.factoryBag[factoryId];
  shop.coins += price;
  SFX.coin();
  saveGame();
  return { ok: true, price };
}

function deployFactory(factoryId, cell) {
  if (!findFactoryDef(factoryId)) return { ok: false, reason: '工厂不存在' };
  if (!cellInGrid(cell) || isCoreCell(cell)) return { ok: false, reason: '这里放不了' };
  if (unitAtCell(cell)) return { ok: false, reason: '这格已经有工厂了' };
  if (!(shop.factoryBag[factoryId] > 0)) return { ok: false, reason: '仓库里没有这张工厂卡' };
  shop.factoryBag[factoryId] -= 1;
  if (shop.factoryBag[factoryId] <= 0) delete shop.factoryBag[factoryId];
  const u = addUnit(factoryId, cell);
  SFX.stamp();
  saveGame();
  return { ok: true, unit: u };
}

function undeployUnit(uid) {
  const u = shop.units[uid];
  if (!u) return { ok: false };
  /* 产物先落背包, 不丢 */
  collectAllDrops(uid);
  /* 已装组件退回组件仓库, 别跟着工厂一起消失 */
  for (const slot of u.slots || []) {
    if (slot && slot.compId) {
      shop.components[slot.compId] = (shop.components[slot.compId] || 0) + 1;
    }
  }
  shop.factoryBag[u.factoryId] = (shop.factoryBag[u.factoryId] || 0) + 1;
  delete shop.units[uid];
  SFX.click();
  saveGame();
  return { ok: true, factoryId: u.factoryId };
}

function moveUnit(uid, cell) {
  const u = shop.units[uid];
  if (!u) return { ok: false };
  if (!cellInGrid(cell) || isCoreCell(cell)) return { ok: false, reason: '这里放不了' };
  if (unitAtCell(cell)) return { ok: false, reason: '这格已经有工厂了' };
  u.cell = cell;
  SFX.click();
  saveGame();
  return { ok: true };
}

/* ---- 产物掉落 ---- */
function collectDrop(uid, quiet) {
  const u = shop.units[uid];
  if (!u || u.drops <= 0) return null;
  const def = findFactoryDef(u.factoryId);
  u.drops -= 1;
  if (def) backpackAdd(def.kind, def.productId, PRODUCE.dropValue);
  if (!quiet) SFX.coin();
  return def;
}

/* 找一座有待捡产物的工厂(供吸料塔) */
function firstUnitWithDrop() {
  for (const uid in shop.units) {
    const u = shop.units[uid];
    if (u.drops > 0) return u;
  }
  return null;
}
function collectAllDrops(uid) {
  const u = shop.units[uid];
  if (!u) return 0;
  const n = u.drops;
  for (let i = 0; i < n; i++) collectDrop(uid);
  return n;
}

/* ---- 槽位操作 ---- */

function buySlot(uid) {
  const u = shop.units[uid];
  if (!u) return { ok: false, reason: '工厂不存在' };
  if (u.slots.length >= MAX_SLOTS) return { ok: false, reason: '槽位已满' };
  const cost = slotCost(u.slots.length);
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  u.slots.push(null);
  refreshUnit(uid);
  addFloater('新槽位！', 900, 340, COLORS.ok, 1.4);
  SFX.unlock();
  saveGame();
  return { ok: true, cost };
}

function installComponent(uid, slotIndex, compId) {
  const u = shop.units[uid];
  if (!u) return { ok: false, reason: '工厂不存在' };
  if (slotIndex < 0 || slotIndex >= u.slots.length) return { ok: false, reason: '槽位无效' };
  if (u.slots[slotIndex]) return { ok: false, reason: '该槽位已有组件' };
  if (!(shop.components[compId] > 0)) return { ok: false, reason: '组件仓库里没有这个组件' };

  const def = findComponentDef(compId);
  if (!isComponentAllowed(def, u.factoryId)) {
    return {
      ok: false,
      reason: '「' + (def ? def.name : compId) + '」是专属组件，只能装在' + componentRestrictLabel(def),
    };
  }

  shop.components[compId] -= 1;
  if (shop.components[compId] <= 0) delete shop.components[compId];
  u.slots[slotIndex] = { compId, level: 1 };
  refreshUnit(uid);
  SFX.stamp();
  saveGame();
  return { ok: true };
}

function moveComponent(uid, fromIndex, toIndex) {
  const u = shop.units[uid];
  if (!u || !u.slots[fromIndex]) return { ok: false };
  if (toIndex < 0 || toIndex >= u.slots.length) return { ok: false, reason: '槽位无效' };
  if (fromIndex === toIndex) return { ok: false, reason: 'same' };
  if (u.slots[toIndex]) return { ok: false, reason: '该槽位已有组件' };
  u.slots[toIndex] = u.slots[fromIndex];
  u.slots[fromIndex] = null;
  refreshUnit(uid);
  saveGame();
  return { ok: true };
}

function removeComponent(uid, slotIndex) {
  const u = shop.units[uid];
  if (!u || !u.slots[slotIndex]) return { ok: false };
  const slot = u.slots[slotIndex];
  shop.components[slot.compId] = (shop.components[slot.compId] || 0) + 1;
  u.slots[slotIndex] = null;
  refreshUnit(uid);
  saveGame();
  return { ok: true, compId: slot.compId };
}

function upgradeComponent(uid, slotIndex) {
  const u = shop.units[uid];
  if (!u || !u.slots[slotIndex]) return { ok: false, reason: '槽位为空' };
  const slot = u.slots[slotIndex];
  const def = findComponentDef(slot.compId);
  if (!def) return { ok: false, reason: '组件不存在' };
  if (!def.upgradable) return { ok: false, reason: '该组件不可升级' };
  if (slot.level >= def.maxLevel) return { ok: false, reason: '已达最高等级' };

  const cost = componentUpgradeCost(def, slot.level);
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  slot.level += 1;
  refreshUnit(uid);
  addFloater(def.name + ' Lv.' + slot.level, 900, 340, COLORS.ok, 1.3);
  SFX.unlock();
  saveGame();
  return { ok: true };
}

/* ---- 组件获取 / 出售 ---- */

function grantComponent(compId, n) {
  shop.components[compId] = (shop.components[compId] || 0) + (n || 1);
  saveGame();
}

function buyComponent(compId) {
  const def = findComponentDef(compId);
  if (!def) return { ok: false, reason: '组件不存在' };
  if (!def.buyable) return { ok: false, reason: '该组件只能靠特殊客人掉落' };
  if (shop.coins < def.cost) return { ok: false, reason: '金币不足' };
  shop.coins -= def.cost;
  grantComponent(compId, 1);
  SFX.coin();
  return { ok: true };
}

function sellComponent(compId) {
  const def = findComponentDef(compId);
  if (!def || !(shop.components[compId] > 0)) return { ok: false, reason: '仓库里没有这个组件' };
  if (!def.buyable || !def.cost) return { ok: false, reason: '这个组件不能卖' };
  const price = Math.max(1, Math.floor(def.cost * 0.5));
  shop.components[compId] -= 1;
  if (shop.components[compId] <= 0) delete shop.components[compId];
  shop.coins += price;
  SFX.coin();
  saveGame();
  return { ok: true, price };
}

function rollComponentDrop(preferSpecial) {
  const specials = COMPONENT_TYPES.filter((c) => c.type === 'special');
  const pool = preferSpecial && specials.length ? specials : COMPONENT_TYPES;
  if (!pool.length) return null;
  const def = pool[Math.floor(Math.random() * pool.length)];
  grantComponent(def.id, 1);
  return def;
}

/* ---- 查询辅助 ---- */

function maxSlotsForFactory(factoryId) {
  let m = 0;
  for (const uid in shop.units) {
    const u = shop.units[uid];
    if (u.factoryId === factoryId) m = Math.max(m, u.slots.length);
  }
  return m;
}

/* 产出某食材的工厂是否已上场(上场=解锁, 不再看槽位/组件) */
function hasFactoryDeployed(factoryId) {
  for (const uid in shop.units) {
    if (shop.units[uid].factoryId === factoryId) return true;
  }
  return false;
}
function factoryBagCount(factoryId) {
  return shop.factoryBag[factoryId] || 0;
}

/* ---- 实时生产: 通电工厂累积进度 → 掉落产物 ---- */

let factoryAcc = 0;
function updateFactories(dt) {
  factoryAcc += dt;
  if (factoryAcc < FACTORY_TICK) return;
  const step = factoryAcc;
  factoryAcc = 0;
  const powered = poweredUnitIds();

  for (const uid in shop.units) {
    if (!powered[uid]) continue;
    const u = shop.units[uid];
    const def = findFactoryDef(u.factoryId);
    if (!def) continue;
    if (def.kind === 'util') {
      /* 吸料塔: 只吸「上下左右相邻 4 格」里掉落的产物 */
      u.vacAcc = (u.vacAcc || 0) + u.speed * step;
      while (u.vacAcc >= 1) {
        const target = neighborUnitWithDrop(u.cell);
        if (!target) {
          u.vacAcc = 0;
          break;
        }
        collectDrop(target.uid, true); // 静默吸走
        u.vacAcc -= 1;
      }
      continue;
    }
    if (u.drops >= PRODUCE.maxDrops) {
      u.progress = 1;
      continue; // 产物堆满, 停产
    }
    u.progress += u.speed * step;
    while (u.progress >= 1) {
      u.progress -= 1;
      u.drops += 1;
      if (u.drops >= PRODUCE.maxDrops) {
        u.progress = 1;
        break;
      }
    }
  }

}

/* 相邻 4 格里有待捡产物的工厂(供吸料塔) */
function neighborUnitWithDrop(cell) {
  for (const nb of neighborsOf(cell)) {
    const u = unitAtCell(nb);
    if (u && u.drops > 0) return u;
  }
  return null;
}

/* ---- 背包存取(产物) ---- */
function backpackCount(kind, productId) {
  const bucket = kind === 'crust' ? shop.backpack.crust : shop.backpack.filling;
  return bucket[productId] || 0;
}
function backpackAdd(kind, productId, n) {
  const bucket = kind === 'crust' ? shop.backpack.crust : shop.backpack.filling;
  bucket[productId] = (bucket[productId] || 0) + n;
}
function backpackTake(kind, productId, n) {
  const bucket = kind === 'crust' ? shop.backpack.crust : shop.backpack.filling;
  if ((bucket[productId] || 0) < n) return false;
  bucket[productId] -= n;
  return true;
}

/* ---- 烤位升级 ---- */
function upgradesFor(factoryId) {
  return UPGRADES.filter((u) => u.factoryId === factoryId);
}

function applyOvenUpgrade(upgradeId) {
  const def = UPGRADES.find((u) => u.id === upgradeId);
  if (!def || def.type !== 'oven') return false;
  if (shop.coins < def.cost) return false;
  if ((shop.ovenLevel || 1) >= OVEN.maxSlots) return false;
  shop.coins -= def.cost;
  shop.ovenLevel = (shop.ovenLevel || 1) + 1;
  run.oven.push(createOvenSlot());
  addFloater('烤位 +1', 1100, 320, COLORS.ok, 1.4);
  SFX.unlock();
  saveGame();
  return true;
}

/* ---- 柜台升级 ---- */

function counterLevel(track) {
  return (shop.counter && shop.counter[track]) || 0;
}

function counterUpgradeCost(track) {
  const c = COUNTER[track];
  if (!c) return null;
  const lv = counterLevel(track);
  if (lv >= c.max) return null;
  return c.cost[lv];
}

function applyCounterUpgrade(track) {
  const c = COUNTER[track];
  if (!c) return { ok: false, reason: '没有这个升级' };
  const lv = counterLevel(track);
  if (lv >= c.max) return { ok: false, reason: '已满级' };
  const cost = c.cost[lv];
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };

  shop.coins -= cost;
  if (!shop.counter) shop.counter = { boiler: 0, tray: 0, cart: 0 };
  shop.counter[track] = lv + 1;

  if (track === 'tray') {
    while (run.slots && run.slots.length < benchSlotCount()) run.slots.push(createSlot());
  }

  addFloater((COUNTER_LABEL[track] || track) + ' Lv.' + shop.counter[track], 1100, 340, COLORS.ok, 1.4);
  SFX.unlock();
  saveGame();
  return { ok: true, level: shop.counter[track], cost };
}

function benchSlotCount() {
  return Math.min(ASSEMBLY.benchtopSlots + counterLevel('tray'), COUNTER.tray.slots);
}

function ovenBakeTime() {
  return OVEN.bakeTime * Math.max(0.5, 1 - COUNTER.boiler.bakeFactor * counterLevel('boiler'));
}
function ovenBurnTime() {
  return OVEN.burnTime * (1 + COUNTER.boiler.burnFactor * counterLevel('boiler'));
}

/* ---- 制作台自动化(按槽位, 分级) ---- */
function slotAutoLevel(index) {
  return (shop.autoSlots && shop.autoSlots[index]) || 0;
}
function slotAutoEnabled(index) {
  return slotAutoLevel(index) > 0;
}
/* 下一级花费; 满级返回 null */
function slotAutoCost(index) {
  const lv = slotAutoLevel(index);
  return lv >= COUNTER.auto.max ? null : COUNTER.auto.cost[lv];
}
/* 升级该制作台的自动装配速度(第 1 级即开启自动化) */
function upgradeSlotAuto(index) {
  if (!run.slots || !run.slots[index]) return { ok: false, reason: '没有这个制作台' };
  const lv = slotAutoLevel(index);
  if (lv >= COUNTER.auto.max) return { ok: false, reason: '已满级' };
  const cost = COUNTER.auto.cost[lv];
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  if (!shop.autoSlots) shop.autoSlots = [];
  shop.autoSlots[index] = lv + 1;
  run.slots[index].auto = true;
  run.slots[index].autoLevel = lv + 1;
  addFloater('自动装配 Lv.' + (lv + 1), 700, 360, COLORS.ok, 1.4);
  SFX.unlock();
  saveGame();
  return { ok: true, level: lv + 1, cost };
}

/* 背包是否够做某个订单 */
function canAssemble(order) {
  if (backpackCount('crust', order.crustId) < 1) return false;
  for (const f of order.fillings) {
    if (backpackCount('filling', f) < 1) return false;
  }
  return true;
}
