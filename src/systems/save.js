'use strict';

/* 存档: 优先 Toy 云存储(跨设备, 不弹数据确认), 不可用时降级 localStorage
 * 云存储限制: value <= 1024 字节, key <= 128 字节
 * 因此拆成 meta / factory / progress 三个 key; localStorage 存整份 */

/* global shop, run, Toy, SAVE_KEYS, LOCAL_SAVE_KEY, SAVE_VERSION, FACTORIES, initFactories,
   BOARD, rankState */

let saveTimer = 0;
let cloudAvailable = null; // null=未知, true/false=已探测

/* 序列化: 拆分, 避免单 value 超 1024 字节 */
function buildSaveParts() {
  const meta = {
    v: SAVE_VERSION,
    day: shop.day,
    coins: Math.floor(shop.coins),
    reputation: shop.reputation,
    bestScore: shop.bestScore,
    totalStars: shop.totalStars,
    items: shop.items,
    ovenLevel: shop.ovenLevel || 1,
    coreLevel: shop.coreLevel || 1,
    autoSlots: shop.autoSlots || [],
    counter: shop.counter || { boiler: 0, tray: 0, cart: 0, autoBake: 0 },
    stats: shop.stats,
    welcomeGift: shop.welcomeGift === true,
  };
  /* 已上场的工厂实例 */
  const units = {};
  for (const uid in shop.units) {
    const u = shop.units[uid];
    units[uid] = {
      factoryId: u.factoryId,
      cell: u.cell,
      slots: (u.slots || []).map((s) => (s ? { compId: s.compId, level: s.level } : null)),
      progress: Math.round((u.progress || 0) * 100) / 100,
      drops: u.drops || 0,
      capacity: u.capacity,
      quality: u.quality,
      speed: u.speed,
    };
  }
  /* 背包(捡来的产物) */
  const backpack = {
    crust: shop.backpack ? shop.backpack.crust : {},
    filling: shop.backpack ? shop.backpack.filling : {},
  };
  /* 组件仓库 */
  const components = shop.components || {};
  return {
    meta: JSON.stringify(meta),
    factory: JSON.stringify({ backpack: backpack, components: components }),
    progress: JSON.stringify({
      units: units,
      bag: shop.factoryBag || {},
      nextUnitId: shop.nextUnitId || 1,
    }),
  };
}

function applySaveParts(parts) {
  if (!parts) return false;
  let meta = null;
  let factory = null;
  let progress = null;
  try {
    if (parts.meta) meta = JSON.parse(parts.meta);
    if (parts.factory) factory = JSON.parse(parts.factory);
    if (parts.progress) progress = JSON.parse(parts.progress);
  } catch (_) {
    return false;
  }
  if (!meta || meta.v !== SAVE_VERSION) return false;

  shop.day = meta.day || 1;
  shop.coins = meta.coins || 0;
  shop.reputation = meta.reputation || 0;
  shop.bestScore = meta.bestScore || 0;
  shop.totalStars = meta.totalStars || 0;
  shop.items = meta.items || [];
  shop.ovenLevel = meta.ovenLevel || 1;
  shop.coreLevel = meta.coreLevel || 1;
  shop.autoSlots = meta.autoSlots || [];
  shop.counter = meta.counter || { boiler: 0, tray: 0, cart: 0, autoBake: 0 };
  shop.stats = meta.stats || { served: 0, failed: 0, perfect: 0, totalCoins: 0 };
  shop.welcomeGift = meta.welcomeGift === true; // 老存档没有该字段 -> false(会补发一次启动材料)
  initFactories({
    backpack: factory ? factory.backpack : null,
    components: factory ? factory.components : null,
    units: progress ? progress.units : null,
    bag: progress ? progress.bag : null,
    nextUnitId: progress ? progress.nextUnitId : null,
    coreLevel: meta.coreLevel || null,
  });
  return true;
}

/* 载入: 云 -> 本地 */
async function loadGame() {
  initFactories(null);

  const cloud = await Toy.getCloudStorage([SAVE_KEYS.meta, SAVE_KEYS.factory, SAVE_KEYS.progress]);
  if (cloud) {
    cloudAvailable = true;
    if (
      applySaveParts({
        meta: cloud[SAVE_KEYS.meta],
        factory: cloud[SAVE_KEYS.factory],
        progress: cloud[SAVE_KEYS.progress],
      })
    )
      return true;
  } else {
    cloudAvailable = false;
  }

  /* 本地兜底 */
  try {
    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (applySaveParts(data)) return true;
    }
  } catch (_) {}

  return false;
}

/* 保存: 始终写本地(防丢), 云可用时同步写云 */
function saveGame() {
  const parts = buildSaveParts();

  try {
    const merged = {
      meta: parts.meta,
      factory: parts.factory,
      progress: parts.progress,
    };
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(merged));
  } catch (_) {}

  if (cloudAvailable !== false) {
    const items = {};
    items[SAVE_KEYS.meta] = parts.meta;
    items[SAVE_KEYS.factory] = parts.factory;
    items[SAVE_KEYS.progress] = parts.progress;
    Toy.setCloudStorage(items).then((ok) => {
      if (ok) cloudAvailable = true;
    });
  }
}

/* 节流保存(避免频繁写云) */
function saveGameThrottled(dt) {
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    saveGame();
  }
}

function resetGame() {
  try {
    localStorage.removeItem(LOCAL_SAVE_KEY);
  } catch (_) {}
  shop.components = {};
  shop.welcomeGift = false; // 必须在 initFactories 之前清, 否则新档发不出启动材料
  initFactories(null);
  shop.day = 1;
  shop.coins = 200;
  shop.reputation = 0;
  shop.bestScore = 0;
  shop.totalStars = 0;
  shop.items = [];
  shop.ovenLevel = 1;
  shop.coreLevel = 1;
  shop.autoSlots = [];
  shop.counter = { boiler: 0, tray: 0, cart: 0, autoBake: 0 };
  shop.stats = { served: 0, failed: 0, perfect: 0, totalCoins: 0 };

  /* 运行期状态也要清: 否则旧槽位数量会被 menuDisplayInit 保留(它只在数组为空时重建) */
  run.slots = [];
  run.oven = [];
  run.customers = [];
  run.money = [];
  run.spawnQueue = [];
  run.spawnTimer = 0;
  run.combo = 0;
  run.dayServed = 0;
  run.dayLost = 0;
  run.dayTotal = 0;
  run.dayTimeLeft = 0;
  run.orderPool = null;
  run.factoryOpen = false;
  run.powerOn = false;
  run.paused = false;
  run.cart = { x: 640, dir: 1 };
  saveGame();
}

/* 上报三个榜位: 金币/最佳评分/口碑 */
async function submitScores() {
  await Toy.submitScore(BOARD.coins, Math.floor(shop.coins));
  await Toy.submitScore(BOARD.score, shop.bestScore);
  await Toy.submitScore(BOARD.rep, shop.reputation);
}

/* 刷新互动解锁状态(B站点赞/投币/收藏/关注) */
async function refreshUnlocks() {
  const acts = await Toy.getVideoActions();
  if (acts) {
    interact.liked = acts.liked;
    interact.coin = acts.coin;
    interact.fav = acts.fav;
  }
  const rel = await Toy.getAuthorRelation();
  if (rel) interact.following = rel.following;
  interact.checked = true;

  /* 互动后可能出现新解锁内容 */
  saveGame();
}
