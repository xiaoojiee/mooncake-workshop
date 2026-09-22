'use strict';

/* 订单流程(多客人并发): 生成当天客人计划, 到店, 耐心衰减, 结算与流失 */

/* global shop, run, ORDER_TEMPLATES, CUSTOMERS, CRUSTS, FILLINGS, ASSEMBLY, DAY,
   moonQuality, findCrustDef, findFillingDef,
   findItemDef, isUnlocked, unlockedCrusts, addFloater, SFX, showScreenText, submitScores,
   saveGame, starOf, scoreServe, pick, rand, clamp, rollComponentDrop, COLORS ,
   rabbitGift, freeUpgradeGift , playSound , RATING */

/* 生成当天客人的到店计划(不立即入场) */
function buildDayPlan(day) {
  const total = Math.round(clamp(DAY.customerMin + (day - 1) * 0.9, DAY.customerMin, DAY.customerMax));
  const plan = [];
  for (let i = 0; i < total; i++) {
    const custDef = randomCustomer(day);
    plan.push(makeCustomer(custDef, day));
  }
  return plan;
}

/* 今日菜单(开业前备货选的食材); 没设则退回已解锁 */
function menuFillings() {
  if (run.orderPool && run.orderPool.fillings && run.orderPool.fillings.length) {
    return FILLINGS.filter((f) => run.orderPool.fillings.indexOf(f.id) >= 0);
  }
  return unlockedFillings();
}
function menuCrusts() {
  if (run.orderPool && run.orderPool.crusts && run.orderPool.crusts.length) {
    return CRUSTS.filter((c) => run.orderPool.crusts.indexOf(c.id) >= 0);
  }
  return unlockedCrusts();
}

/* 从今日菜单里按权重挑一个馅料(基础馅料更常见) */
function randomFillingId() {
  const pool = menuFillings();
  if (!pool.length) return FILLINGS[0].id;
  /* 五仁/莲蓉权重更高(基础馅料), 其他均等 */
  const weighted = [];
  for (const f of pool) {
    const w = f.id === 'wuren' || f.id === 'lianrong' ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(f.id);
  }
  return pick(weighted);
}

/* 按天数生成一组馅料(可能重复, 层数随天数增长) */
function rollFillings(day) {
  const rules = ORDER_RULES;
  const idx = clamp(day - 1, 0, rules.layersPerDay.length - 1);
  /* 期望层数 ± 低概率 +1 */
  let layers = rules.layersPerDay[idx];
  if (Math.random() < 0.3 && layers < rules.maxLayers) layers += 1;
  layers = clamp(layers, 1, rules.maxLayers);

  const repeatIdx = clamp(day - 1, 0, rules.repeatChance.length - 1);
  const repeatP = rules.repeatChance[repeatIdx];

  const out = [];
  for (let i = 0; i < layers; i++) {
    /* 一定概率重复上一层(「多放点这个」) */
    if (i > 0 && out.length && Math.random() < repeatP) {
      out.push(out[out.length - 1]);
    } else {
      out.push(randomFillingId());
    }
  }
  return out;
}

/* 按天数生成数量(一次要几块) */
function rollQty(day) {
  const rules = ORDER_RULES;
  const idx = clamp(day - 1, 0, rules.qtyPerDay.length - 1);
  return clamp(rules.qtyPerDay[idx], 1, rules.maxQty);
}

/* 从今日菜单里随机挑一个饼皮 */
function randomCrustId() {
  const pool = menuCrusts();
  if (!pool.length) return CRUSTS[0].id;
  return pick(pool).id;
}

/* ---- 店铺评分(外卖软件那套) ---- */

/* 平均星级(0~5); 评价人数不够(≤ RATING.minCount)时返回 null(还没分数) */
function shopRating() {
  const n = shop.ratingCount || 0;
  if (n <= RATING.minCount) return null;
  return (shop.ratingSum || 0) / n;
}

/* 评分榜上报值: 平均星级 × 10^小数位, 取整(B站 submitScore 只收整数) */
function ratingSubmitValue() {
  const r = shopRating();
  if (r == null) return null;
  return Math.round(r * Math.pow(10, RATING.decimals));
}

/* 把榜单上的整数还原成「4.8523」这种显示文本 */
function formatRating(v) {
  return (v / Math.pow(10, RATING.decimals)).toFixed(RATING.decimals);
}

/* 顶栏那一行的评分文本(外卖软件那种) */
function ratingHeaderText() {
  const r = shopRating();
  if (r == null) return '暂无评分';
  return '评分 ' + r.toFixed(RATING.decimals);
}

/* 还差几位客人才能上榜 */
function ratingNeedMore() {
  return Math.max(0, RATING.minCount + 1 - (shop.ratingCount || 0));
}

/* 按权重随机客人(随着天数推移, 可能出现的客人更多) */
function randomCustomer(day) {
  const pool = CUSTOMERS.filter((c) => c.kind !== 'special' && (c.minDay == null || c.minDay <= day));
  let cust = pick(pool.length ? pool : CUSTOMERS);
  /* 特殊客人小概率出现: 在有资格的几位里随机抽 */
  const specials = CUSTOMERS.filter((c) => c.kind === 'special' && (c.minDay == null || c.minDay <= day));
  if (specials.length && Math.random() < (DAY.specialChance || 0.1)) cust = pick(specials);
  return cust;
}

/* 按客人规则生成订单(普通客人随机; 特殊客人有怪癖, 见 defs.js 的 order.kind) */
function buildOrder(custDef, day) {
  const crustId = randomCrustId();
  const pool = menuFillings().map((f) => f.id);
  const hasRot = pool.indexOf('furou') >= 0; // 腐肉是否已上场(进了今日菜单)
  const base = rollFillings(day);
  const kind = custDef.order ? custDef.order.kind : null;
  const cap = ASSEMBLY.maxFillings;

  /* 刘华强: 30 份西瓜馅 -> 远超层数上限, 根本做不出来, 只能反复点击赶走 */
  if (kind === 'melon30') return { crustId: crustId, fillings: new Array(30).fill('xigua'), qty: 1 };

  /* 史蒂夫: 只要腐肉; 没上场腐肉就只要一张饼皮 */
  if (kind === 'rotOnly') {
    return { crustId: crustId, fillings: hasRot ? new Array(Math.min(base.length, cap)).fill('furou') : [], qty: 1 };
  }

  /* 良子: 馅料是普通客人的 3 倍; 菜单里有腐肉就全点腐肉 */
  if (kind === 'tripleRot') {
    if (hasRot) return { crustId: crustId, fillings: new Array(Math.min(base.length * 3, cap)).fill('furou'), qty: 1 };
    const out = [];
    for (let i = 0; i < 3 && out.length < cap; i++) {
      for (const f of base) {
        if (out.length >= cap) break;
        out.push(f);
      }
    }
    return { crustId: crustId, fillings: out, qty: 1 };
  }

  /* 月兔 / 普通客人: 常规随机 */
  return { crustId: crustId, fillings: base, qty: rollQty(day) };
}

/* 构造客人实例 */
function makeCustomer(custDef, day) {
  const order = buildOrder(custDef, day);
  const fillings = order.fillings;
  const qty = order.qty;

  /* 耐心: 层数越多、数量越多, 给的时间越充裕(否则不可能完成) */
  const work = Math.min(fillings.length, ASSEMBLY.maxFillings) + (qty - 1) * 0.6;
  let patience =
    DAY.patienceBase - (day - 1) * DAY.patienceDecay + work * DAY.patiencePerLayer;
  patience = Math.max(DAY.patienceMin, patience);
  if (custDef.kind === 'special') patience *= DAY.specialPatience;
  if (custDef.harass) patience *= 2.2; // 找茬的: 给足时间让玩家点走他
  patience = Math.round(patience);
  /* 找茬的刘华强: 耐心无限(只能靠驯服的耄耋赶走) */
  const endless = !!custDef.harass;
  if (endless) patience = Infinity;

  return {
    def: custDef,
    order,
    /* 立绘格子: 有 npcRandom 的(月兔)每次随机挑一个颜色 */
    npcIndex: custDef.npcRandom
      ? Math.floor(rand(custDef.npcRandom[0], custDef.npcRandom[1] + 1))
      : (custDef.npcIndex || 0),
    patienceMax: patience,
    patienceLeft: patience,
    state: 'waiting', // waiting | served | angry
    bob: Math.random() * Math.PI * 2, // 待机动画相位
    enterT: 0, // 入场动画(从右侧走进来)
    leaveT: 0, // 离场动画
    dispSlot: 0, // 当前显示站位(浮点, 会滑向目标)
    leaveSlot: null, // 离场时冻结的站位
    targetSlot: 0,
  };
}

/* 今天是否还有客人要来/还在店里(时间制: 营业时间没到就一直可能来) */
function hasMoreCustomers() {
  return (run.dayTimeLeft || 0) > 0 || run.customers.some((c) => c.state === 'waiting');
}

/* 到店一位客人: 现做一位(时间制), 排到队尾从右侧走进来 */
function spawnCustomer() {
  const waiting = run.customers.filter((c) => c.state === 'waiting').length;
  if (waiting >= DAY.maxOnScreen) return null;
  const c = makeCustomer(randomCustomer(shop.day), shop.day);
  c.enterT = 0;
  c.leaveT = 0;
  c.leaveSlot = null;
  c.dispSlot = waiting;
  c.targetSlot = waiting;
  run.customers.push(c);
  /* 客人自带的音效(如史蒂夫每提一次要求播一次) */
  if (c.def && c.def.sound && typeof playSound === 'function') playSound(c.def.sound);
  return c;
}

/* 更新所有客人的耐心; 返回今天流失的客人列表 */
function updateCustomers(dt) {
  const lost = [];
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (c.enterT < 1) c.enterT = Math.min(1, c.enterT + dt * 3);
    /* 月兔安抚: 有效期间耐心掉得更慢 */
    const calm = (c.calmT || 0) > 0 ? (c.calmRate || 0) : 0;
    if (isFinite(c.patienceLeft)) c.patienceLeft -= dt * Math.max(0.05, 1 - calm); // 无限耐心不衰减
    if (c.calmT > 0) c.calmT -= dt;
    c.bob += dt * 2.4;
    if (c.patienceLeft <= 0) {
      c.patienceLeft = 0;
      c.state = 'angry';
      lost.push(c);
    }
  }
  return lost;
}

/* 客人流失惩罚 */
function onCustomerLost(customer) {
  run.dayLost += 1;
  run.combo = 0;
  shop.coins = Math.max(0, shop.coins - DAY.leaveCoinPenalty);
  /* 跑单 = 一条差评(0 星), 评分自然被拉低 */
  shop.ratingSum = (shop.ratingSum || 0) + 0;
  shop.ratingCount = (shop.ratingCount || 0) + 1;
  shop.stats.failed += 1;
  SFX.fail();
  addShake(7);
  addFloater('-' + DAY.leaveCoinPenalty, 640, 300, COLORS.fail, 1.4);
}

/* 月饼售价里的「原料价值」: 皮 + 馅, 并结算各自的特殊功能
 * 皮: rich 奶黄×1.15 / fresh 抹茶(含莲蓉或豆沙)×1.25 / bitter 巧克力 每层+3
 * 馅: lotus 莲蓉 价值×层数 / sweet 豆沙 与蛋黄同场×1.3 /
 *     golden 蛋黄 只此一层×1.5 / melon 西瓜 随机×0.9~1.5 /
 *     rot 腐肉 每多一种其他馅料 ×0.7 */
function moonValue(moon) {
  const crust = findCrustDef(moon.crustId);
  const fillings = moon.fillings || [];
  const layers = fillings.length;
  let base = crust ? (crust.value || 0) : 0;
  let mult = 1;
  let hasLotus = false;
  let hasDousha = false;
  let hasDanhuang = false;
  let hasXigua = false;
  let hasRot = false;
  let hasNutty = false;
  let nuttyCount = 0;
  let others = 0;

  for (const f of fillings) {
    const fd = findFillingDef(f);
    if (!fd) continue;
    let v = fd.value || 5;
    if (fd.effect === 'lotus') {
      v *= Math.max(1, layers);
      hasLotus = true;
    }
    base += v;
    if (fd.effect === 'sweet') hasDousha = true;
    else if (fd.effect === 'golden') hasDanhuang = true;
    else if (fd.effect === 'melon') hasXigua = true;
    else if (fd.effect === 'rot') hasRot = true;
    else {
      others += 1;
      if (fd.effect === 'nutty') {
        hasNutty = true;
        nuttyCount += 1;
      }
    }
  }

  /* 饼皮特效 */
  if (crust && crust.effect === 'rich') mult *= 1.15;
  if (crust && crust.effect === 'fresh' && (hasLotus || hasDousha)) mult *= 1.25;
  if (crust && crust.effect === 'bitter') base += 3 * layers;

  /* 馅料特效 */
  if (hasDousha && hasDanhuang) mult *= 1.3;
  if (hasDanhuang && layers === 1) mult *= 1.5;
  if (hasNutty && layers > nuttyCount) mult *= 1.1; // 五仁: 百搭坚果, 有别的馅料同场时加成
  if (hasXigua) mult *= rand(0.9, 1.4);
  if (hasRot) mult *= Math.pow(0.7, others); // 腐肉: 每多一种其他馅料 ×0.7

  return Math.max(0, Math.round(base * mult));
}

/* 出餐: 把做好的月饼交给某位客人
 * moon: { crustId, fillings, bakeTime, burnt } */
function serveCustomer(customer, moon) {
  if (customer.state !== 'waiting') return null;
  const r = scoreServe(customer, moon);
  const stars = starOf(r.score);
  const perfect = r.score >= 0.9;

  customer.state = 'served';
  SFX.eat(); // 客人开吃

  const qty = 1;
  const bonus = moonValue(moon); // 皮+馅 的价值(含特殊功能)
  /* 馅料品质: 按「产出该馅料的工厂」加权, 提高出餐金币 */
  const q = moonQuality(moon);
  let coins = (customer.def.reward + bonus) * qty * (0.5 + r.score) * q.price;
  if (customer.def.kind === 'special') coins *= DAY.specialReward;
  if (customer.def.coinMul > 1) coins *= customer.def.coinMul; // 良子: 工钱翻倍
  if (perfect) {
    run.combo = Math.min(run.combo + 1, 5); // 连击有上限, 免得金币滚雪球
    coins += 12 + run.combo * 6;
  } else {
    run.combo = 0;
  }
  coins = Math.round(coins);

  /* 粗心惩罚: 做错的月饼(皮错 / 用了订单外的馅) 顾客按每处扣 10% 成交价 */
  let wrong = 0;
  if (moon.crustId !== customer.order.crustId) wrong += 1;
  for (const f of moon.fillings || []) {
    if (customer.order.fillings.indexOf(f) < 0) wrong += 1;
  }
  const penalty = Math.min(0.5, 0.1 * wrong);
  if (penalty > 0) coins = Math.max(0, Math.round(coins * (1 - penalty)));
  customer.wrongPenalty = penalty;

  /* 金币不直接入账: 由 shop 场景把钱撒到柜台上, 玩家点击捡起才结算 */
  shop.stats.served += 1;
  run.dayServed += 1;
  if (perfect) shop.stats.perfect += 1;

  const scorePct = Math.round(r.score * 100);
  if (scorePct > shop.bestScore) shop.bestScore = scorePct;

  /* 店铺评分(外卖式): 这次出餐的得分折算成 0~5 星, 累加进平均分 */
  shop.ratingSum = (shop.ratingSum || 0) + r.score * RATING.stars;
  shop.ratingCount = (shop.ratingCount || 0) + 1;

  /* 特殊客人奖励: 道具 + 组件掉落 */
  const rewards = [];
  if (customer.def.rewardItem && shop.items.indexOf(customer.def.rewardItem) < 0) {
    shop.items.push(customer.def.rewardItem);
    const it = findItemDef(customer.def.rewardItem);
    rewards.push((it ? it.name : customer.def.rewardItem));
  }
  if (customer.def.kind === 'special') {
    /* 高评价才必掉, 否则概率掉 */
    if (r.score >= 0.7 || Math.random() < 0.5) {
      const def = rollComponentDrop(true);
      if (def) rewards.push('组件「' + def.name + '」');
    }
  }
  if (rewards.length) {
    showScreenText('获得 ' + rewards.join(' + '), '', COLORS.gold);
    SFX.unlock();
  }

  /* 特殊客人效果(可以挂多条):
   *   restorePatience 月兔 -> 恢复所有客人耐心
   *   rabbitGift      月兔 -> 有几率送一只月兔 / 给现有月兔升 1 级
   *   freeUpgrade     史蒂夫 -> 随机白送一项升级(月兔除外) */
  const onServe = customer.def.onServe;
  const effects = Array.isArray(onServe) ? onServe : (onServe ? [onServe] : []);
  for (const eff of effects) {
    if (eff === 'restorePatience') {
      for (const c of run.customers) {
        if (c.state === 'waiting') c.patienceLeft = c.patienceMax;
      }
      showScreenText('月兔的祝福', '所有客人的耐心已恢复', COLORS.ok);
      SFX.unlock();
    } else if (eff === 'rabbitGift') {
      rabbitGift();
    } else if (eff === 'freeUpgrade') {
      freeUpgradeGift();
    }
  }

  /* (评分飘字已按需求去掉, 评分本身照常算) */

  return { score: r.score, stars, coins, perfect, bonus, parts: r };
}

/* 客人离场(已服务/已发怒), 清出屏幕 */
function reapCustomers(dt) {
  for (let i = run.customers.length - 1; i >= 0; i--) {
    const c = run.customers[i];
    if (c.state === 'waiting') continue;
    c.leaveT = (c.leaveT || 0) + dt;
    /* 被击飞的: 抛物线 + 翻滚, 飞得久一点 */
    if (c.fly) {
      const f = c.fly;
      f.t += dt;
      f.vy += 2200 * dt; // 重力
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
    }
    if (c.leaveT > (c.fly ? 1.35 : 0.8)) run.customers.splice(i, 1);
  }
}
