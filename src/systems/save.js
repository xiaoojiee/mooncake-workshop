'use strict';

/* 存档: 优先 Toy 云存储(跨设备, 不弹数据确认), 不可用时降级 localStorage
 * 云存储限制: value <= 1024 字节, key <= 128 字节
 * 因此拆成 meta / factory / progress 三个 key; localStorage 存整份 */

/* global shop, run, Toy, SAVE_KEYS, LOCAL_SAVE_KEY, SAVE_VERSION, FACTORIES, initFactories,
   BOARD, rankState, COMPONENT_TYPES, GRID , ratingSubmitValue , CRUSTS, FILLINGS, backpackAdd, RABBIT, makeRabbit, rabbitAbil, pick,
   TOY_REWARD, interact, showScreenText, SFX, COLORS */

/* 组件 id -> 下标(存档里用下标省字节) */
function compIndexOf(id) {
  if (typeof COMPONENT_TYPES === 'undefined') return id;
  const i = COMPONENT_TYPES.findIndex((c) => c.id === id);
  return i >= 0 ? i : id;
}
function compIdAt(v) {
  if (typeof v === 'string') return v;
  const c = typeof COMPONENT_TYPES !== 'undefined' ? COMPONENT_TYPES[v] : null;
  return c ? c.id : null;
}

let saveTimer = 0;
let cloudAvailable = null; // null=未知, true/false=已探测

/* 序列化: 拆分, 避免单 value 超 1024 字节 */
function buildSaveParts() {
  const meta = {
    v: SAVE_VERSION,
    toyRewards: shop.toyRewards || {}, // B站互动奖励领取记录
    savedAt: Date.now(), // 时间戳: 读档时用来判断云端/本地哪份更新
    day: shop.day,
    coins: Math.floor(shop.coins),

    bestScore: shop.bestScore,
    ratingSum: Math.round((shop.ratingSum || 0) * 10000) / 10000,
    ratingCount: shop.ratingCount || 0,
    items: shop.items,
    ovenLevel: shop.ovenLevel || 1,
    coreLevel: shop.coreLevel || 1,
    counter: shop.counter || { boiler: 0, tray: 0 },
    rabbits: (shop.rabbits || []).map((r) => ({ art: r.art, abil: r.abil })),
    stats: shop.stats,
  welcomeGift: shop.welcomeGift === true,
  lastMenu: shop.lastMenu || null,
  catHits: shop.catHits || 0,
  catTamed: shop.catTamed === true,
  };
  /* 已上场的工厂实例 */
  /* 工厂实例: 用紧凑字段(云存档单 key ≤1024 字节, 字段名要短)
   *   f 工厂id / c 格子 / s 槽位[[组件下标, 等级] 或 0] / p 进度 / d 掉落
   * speed/capacity/quality 都是算出来的, 不存(读档时 refreshAllFactories 会重算) */
  const units = {};
  for (const uid in shop.units) {
    const u = shop.units[uid];
    units[uid] = {
      f: typeof FACTORIES !== 'undefined' ? Math.max(0, FACTORIES.findIndex((x) => x.id === u.factoryId)) : u.factoryId,
      c: u.cell, // 格子就是个网格下标(数字), 原样存
      /* 槽位压成一个数字: 0=空, 其它 = 组件下标*8 + 等级(等级 1~7) */
      s: (u.slots || []).map((s) => {
        if (!s || !s.compId) return 0;
        const ci = compIndexOf(s.compId);
        return (typeof ci === 'number' ? ci : 0) * 8 + (s.level || 1);
      }),
      p: Math.round((u.progress || 0) * 100) / 100,
      d: u.drops || 0,
    };
  }
  /* 背包(捡来的产物) */
  const backpack = {
    crust: shop.backpack ? shop.backpack.crust : {},
    filling: shop.backpack ? shop.backpack.filling : {},
    hardware: shop.backpack ? shop.backpack.hardware : {},
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

  shop.bestScore = meta.bestScore || 0;
  shop.ratingSum = meta.ratingSum || 0;
  shop.ratingCount = meta.ratingCount || 0;
  shop.toyRewards = meta.toyRewards || {};
  shop.items = meta.items || [];
  shop.ovenLevel = meta.ovenLevel || 1;
  shop.coreLevel = meta.coreLevel || 1;
  shop.counter = meta.counter || { boiler: 0, tray: 0 };
  shop.rabbits = (meta.rabbits || []).map((r) => makeRabbit(r.art, r.abil));
  shop.stats = meta.stats || { served: 0, failed: 0, perfect: 0, totalCoins: 0 };
  shop.catHits = meta.catHits || 0;
  shop.catTamed = meta.catTamed === true;
  shop.welcomeGift = meta.welcomeGift === true; // 老存档没有该字段 -> false(会补发一次启动材料)
  shop.lastMenu = meta.lastMenu || null;
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
/* 存档时间戳: 没有该字段的老档退回用天数当权重 */
function saveStamp(parts) {
  if (!parts || !parts.meta) return -1;
  try {
    const m = JSON.parse(parts.meta);
    return m.savedAt || m.day || 0;
  } catch (_) {
    return -1;
  }
}

async function loadGame() {
  initFactories(null);

  /* 云端 */
  let cloudParts = null;
  try {
    const cloud = await Toy.getCloudStorage([SAVE_KEYS.meta, SAVE_KEYS.factory, SAVE_KEYS.progress]);
    if (cloud) {
      cloudAvailable = true;
      cloudParts = {
        meta: cloud[SAVE_KEYS.meta],
        factory: cloud[SAVE_KEYS.factory],
        progress: cloud[SAVE_KEYS.progress],
      };
    } else {
      cloudAvailable = false;
    }
  } catch (_) {
    cloudAvailable = false;
  }

  /* 本地 */
  let localParts = null;
  try {
    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    if (raw) localParts = JSON.parse(raw);
  } catch (_) {}

  return applyBestSave(cloudParts, localParts);
}

/* 云端/本地两份里挑「更新的那份」应用
 * (云写入可能因为单 key 超 1024 字节而失败, 云端会停在上一次成功的老档,
 *  以前直接优先云端 -> 本地的新进度(金钱/组件)会被老档盖掉) */
function applyBestSave(cloudParts, localParts) {
  const useCloud = !!cloudParts && saveStamp(cloudParts) >= saveStamp(localParts);
  const winner = useCloud ? cloudParts : localParts;
  const other = useCloud ? localParts : cloudParts;

  if (winner && applySaveParts(winner)) {
    /* 本地比云端新 -> 顺手把云端补上, 下次两边一致 */
    if (!useCloud && cloudParts && cloudAvailable !== false) saveGame();
    return true;
  }
  if (other && applySaveParts(other)) return true;
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
    /* 云存储单 value ≤1024 字节: 有一个超了就整批不写(免得云端留下残缺档),
     * 只留本地 —— 读档时会比时间戳, 本地更新的那份不会被云端老档盖掉 */
    let tooBig = false;
    for (const k in items) if (items[k] && items[k].length > 1024) tooBig = true;
    if (tooBig) {
      if (typeof console !== 'undefined') console.warn('[save] 云存档单 key 超 1024 字节, 本次只写本地');
    } else {
      Toy.setCloudStorage(items)
        .then((ok) => {
          if (ok) cloudAvailable = true;
        })
        .catch(() => {}); // 云端不可用/超限: 本地已存好, 忽略
    }
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
  shop.lastMenu = null;
  initFactories(null);
  shop.day = 1;
  shop.coins = 200;

  shop.bestScore = 0;
  shop.ratingSum = 0;
  shop.ratingCount = 0;
  shop.items = [];
  shop.toyRewards = {};
  shop.ovenLevel = 1;
  shop.coreLevel = 1;
  shop.counter = { boiler: 0, tray: 0 };
  shop.rabbits = [];
  shop.cat = null;
  shop.catHits = 0;
  shop.catTamed = false;
  shop.stats = { served: 0, failed: 0, perfect: 0, totalCoins: 0 };

  /* 运行期状态也要清: 否则旧槽位数量会被 menuDisplayInit 保留(它只在数组为空时重建) */
  run.slots = [];
  run.oven = [];
  run.customers = [];
  run.money = [];
  run.plates = [];
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
  saveGame();
}

/* 上报榜位: 金币 / 评分(外卖式平均星级) */
async function submitScores() {
  await Toy.submitScore(BOARD.coins, Math.floor(shop.coins));
  /* 评分榜: 外卖式平均星级(整数上报, 显示时再除回来); 评价人数不够就不上报 */
  const rv = typeof ratingSubmitValue === 'function' ? ratingSubmitValue() : null;
  if (rv != null) await Toy.submitScore(BOARD.score, rv);

}

/* 刷新互动状态(B站点赞/投币/收藏/关注) */
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

  /* 达成了就发奖励(每项只发一次) */
  grantToyRewards();
  saveGame();
}

/* ---- B站互动奖励(每项只发一次) ----
 *   点赞 -> 启动材料各 N 份
 *   投币 -> N 金币
 *   收藏 -> 随机通用组件 ×N
 *   关注 -> 一只月兔(满员则给现有月兔随机升 1 级) */
function grantToyRewards() {
  if (!shop.toyRewards) shop.toyRewards = {};
  const got = [];
  const claim = (key) => {
    if (shop.toyRewards[key] || !interact[key]) return false;
    shop.toyRewards[key] = true;
    return true;
  };

  if (claim('liked')) {
    for (const c of CRUSTS) if (!c.unlock) backpackAdd('crust', c.id, TOY_REWARD.mats);
    for (const f of FILLINGS) if (!f.unlock) backpackAdd('filling', f.id, TOY_REWARD.mats);
    got.push('启动材料各 ' + TOY_REWARD.mats + ' 份');
  }
  if (claim('coin')) {
    shop.coins += TOY_REWARD.coins;
    got.push(TOY_REWARD.coins + ' 金币');
  }
  if (claim('fav')) {
    const pool = COMPONENT_TYPES.filter((c) => c.factoryId == null);
    for (let i = 0; i < TOY_REWARD.comps; i++) {
      const c = pick(pool);
      if (!c) break;
      shop.components[c.id] = (shop.components[c.id] || 0) + 1;
      got.push(c.name);
    }
  }
  if (claim('following')) {
    if ((shop.rabbits || []).length < RABBIT.max) {
      shop.rabbits.push(makeRabbit());
      got.push('月兔 ×1');
    } else {
      /* 满员: 随机给一只月兔升 1 级(没满的能力) */
      const cands = [];
      shop.rabbits.forEach((r, i) => {
        for (const key in RABBIT.abil) {
          if (rabbitAbil(r, key) < RABBIT.abil[key].max) cands.push({ i: i, key: key });
        }
      });
      const p = pick(cands);
      if (p) {
        shop.rabbits[p.i].abil[p.key] = rabbitAbil(shop.rabbits[p.i], p.key) + 1;
        got.push('月兔「' + (RABBIT.abil[p.key].label || p.key) + '」+1');
      }
    }
  }

  if (got.length) {
    showScreenText('B站互动奖励', got.join(' + '), COLORS.gold);
    SFX.unlock();
  }
  return got;
}
