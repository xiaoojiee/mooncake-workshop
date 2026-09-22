'use strict';

/* 月兔系统
 *
 * 规则很简单, 就三条:
 *   1) 每只月兔同一时间只有「一个任务」, 一个任务占住一种资源:
 *        托盘(tray) / 烤位(oven) / 客人(cust)
 *      —— 别的月兔看到资源被占就绕开, 所以多只月兔不会抢同一件事
 *   2) 干活要「走过去」: 到快捷栏取料 -> 搬到工作台 -> 端进烤炉 -> 送给客人
 *      手上拿的东西会吸附在它身上
 *   3) 干完一件活休息一会儿(休息时长 = 用的那项能力的间隔), 再找下一件
 *
 * 6 项能力(每只独立升级):
 *   calm    安抚   -> 碰到客人, 那位客人耐心暂时掉得更慢
 *   speed   速度   -> 跑得更快
 *   cashier 收银   -> 自动捡柜台上的金币
 *   cook    做月饼 -> 取料 + 搬到工作台
 *   bake    入炉   -> 把工作台上做好的月饼端进烤炉
 *   serve   送餐   -> 把烤炉里烤好的月饼端给客人(没完全对上的就找最接近的)
 *   fix     纠错   -> 托盘做错了 -> 把不对的馅料拿走(退回背包) */

/* global shop, run, W, VW, LAYOUT, RABBIT, rabbitAbilValue, canAssemble, backpackCount,
   backpackTake, backpackAdd, placeCrust, placeFilling, clearSlot, slotReady, ovenPut,
   ovenTake, ovenDone, serveCustomer, spawnMoneyForCustomer, collectMoney, hotbarItems,
   customerRect, slotCenter, ovenRect, placeOnCounter,
   ovenAnchorPoint, shelfAnchorPoint,
   showScreenText, SFX, addFloater, game, clamp, rand, dist, saveGame, COLORS, ASSEMBLY,
   pick, DAY */

/* 月兔贴图: 特殊npc 图集里的 4 种颜色(逻辑格 4..7) */
const RABBIT_ART_NPC = [4, 5, 6, 7];
/* 干活的分工(角色): 先送餐, 再纠错, 再入炉, 最后才开新工
 * 多只月兔会按「哪种活还缺人」自动分工, 并且尽量保持自己原来的角色 */
/* 优先级: 送餐 > 纠错 > 入炉 > 做月饼 > 安抚巡逻(安抚永远排最后, 只有闲下来才去) */
const RABBIT_ROLE_ORDER = ['serve', 'fix', 'bake', 'cook', 'calm'];

function rabbitAbil(rabbit, key) {
  return (rabbit.abil && rabbit.abil[key]) || 0;
}
function rabbitValue(rabbit, key) {
  return rabbitAbilValue(key, rabbitAbil(rabbit, key));
}

function makeRabbit(art, abil) {
  return {
    art: art != null ? (((art % 4) + 4) % 4) : Math.floor(Math.random() * 4),
    x: rand(RABBIT.roam.x0, RABBIT.roam.x1),
    y: rand(RABBIT.roam.y0, RABBIT.roam.y1),
    vx: 0,
    vy: 0,
    dir: Math.random() < 0.5 ? -1 : 1,
    turnT: rand(0.4, 1.6),
    hop: rand(0, Math.PI * 2),
    tx: 0,
    ty: 0,
    hasTarget: false,
    carry: null, // 手上拿的: { kind:'crust'|'filling', id } 或 { kind:'moon', moon }
    task: null, // 正在干的任务(见 rabbitTaskArrange)
    role: null, // 上一轮干的活(尽量不换岗)
    restT: 0, // 歇多久再找活
    cashT: 0,
    abil: Object.assign({ calm: 0, speed: 0, cashier: 0, cook: 0, bake: 0, serve: 0, fix: 0 }, abil || {}),
  };
}

/* ---- 买月兔 ---- */
/* 月兔客人的谢礼: 有几率送一只新月兔, 或给现有月兔随机升 1 级(免费) */
function rabbitGift() {
  const list = shop.rabbits || [];
  const maxed = list.length >= RABBIT.max;
  if (Math.random() > (DAY.rabbitGiftChance || 0.7)) {
    showScreenText('月兔的谢礼', '这次没带礼物', COLORS.textDim);
    return false;
  }
  /* 没兔子 -> 一定送一只; 没满员时 50% 送新的, 否则升级 */
  const wantNew = list.length === 0 || (!maxed && Math.random() < 0.5);
  if (wantNew && !maxed) {
    shop.rabbits.push(makeRabbit());
    showScreenText('月兔的谢礼', '又多了一位帮手!', COLORS.ok);
    SFX.unlock();
    saveGame();
    return true;
  }
  /* 随机一只月兔的随机一项「没满级」的能力 +1 */
  const cands = [];
  list.forEach((r, i) => {
    for (const key in RABBIT.abil) {
      if (rabbitAbil(r, key) < RABBIT.abil[key].max) cands.push({ i: i, key: key });
    }
  });
  if (!cands.length) {
    showScreenText('月兔的谢礼', '帮手都满级了', COLORS.textDim);
    return false;
  }
  const p = pick(cands);
  const r = list[p.i];
  r.abil[p.key] = rabbitAbil(r, p.key) + 1; // 免费升 1 级
  showScreenText('月兔的谢礼', '第 ' + (p.i + 1) + ' 只的「' + (RABBIT.abil[p.key].label || p.key) + '」+1', COLORS.ok);
  SFX.unlock();
  saveGame();
  return true;
}

function rabbitBuyCost() {
  const n = (shop.rabbits || []).length;
  if (n >= RABBIT.max) return null;
  return RABBIT.buyCost[n];
}
function buyRabbit() {
  const cost = rabbitBuyCost();
  if (cost == null) return { ok: false, reason: '月兔已经养满了' };
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  shop.rabbits.push(makeRabbit());
  SFX.unlock();
  showScreenText('领养了一只月兔', '它会到处跑，去面板训练它', COLORS.ok);
  saveGame();
  return { ok: true, cost };
}

/* ---- 能力升级 ---- */
function rabbitAbilCost(key, level) {
  const a = RABBIT.abil[key];
  if (!a || level >= a.max) return null;
  return Math.round(a.cost * Math.pow(RABBIT.costMul, level));
}
function upgradeRabbit(index, key) {
  const r = (shop.rabbits || [])[index];
  if (!r) return { ok: false, reason: '没有这只月兔' };
  const lv = rabbitAbil(r, key);
  const cost = rabbitAbilCost(key, lv);
  if (cost == null) return { ok: false, reason: '已满级' };
  if (shop.coins < cost) return { ok: false, reason: '金币不足' };
  shop.coins -= cost;
  r.abil[key] = lv + 1;
  SFX.unlock();
  saveGame();
  return { ok: true, level: lv + 1, cost };
}

/* ---- 月饼 / 订单的匹配 ---- */

/* 这块月饼和这位客人的订单完全一致吗 */
function rabbitMoonMatches(moon, order) {
  if (order.crustId !== moon.crustId) return false;
  if (order.fillings.length !== moon.fillings.length) return false;
  for (let i = 0; i < order.fillings.length; i++) {
    if (order.fillings[i] !== moon.fillings[i]) return false;
  }
  return true;
}
/* 排队优先级: 耐心越少越急; 无限耐心(找茬的刘华强)永远排最后 */
function patienceKey(c) {
  return c && isFinite(c.patienceLeft) ? c.patienceLeft : Infinity;
}

/* 完全对得上的客人(好几位都能要 -> 先给最急的那位) */
function findCustomerForMoon(moon) {
  let best = null;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (!rabbitMoonMatches(moon, c.order)) continue;
    if (!best || patienceKey(c) < patienceKey(best)) best = c;
  }
  return best;
}
/* 有多像(越大越像): 皮对上给大分, 馅「位置对」比「种类对」分高 */
function rabbitSimilarity(moon, order) {
  let s = order.crustId === moon.crustId ? 2 : 0;
  const F = moon.fillings || [];
  const n = Math.min(F.length, order.fillings.length);
  for (let i = 0; i < n; i++) {
    if (order.fillings[i] === F[i]) s += 1.2;
    else if (order.fillings.indexOf(F[i]) >= 0) s += 0.5;
  }
  return s;
}
/* 最接近的客人(实在做错了就用他兜底) */
function findClosestCustomer(moon) {
  let best = null;
  let bestScore = 0;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    const s = rabbitSimilarity(moon, c.order);
    /* 相似度更高优先; 一样像就挑更急的 */
    if (s > bestScore || (s === bestScore && s > 0 && best && patienceKey(c) < patienceKey(best))) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}
/* 该送给谁: 完全对得上优先, 否则最接近的 */
function rabbitPickCustomer(moon) {
  return findCustomerForMoon(moon) || findClosestCustomer(moon);
}

/* 托盘上的月饼做错了没: null(没做错) / { all:true }(整块没用了) / { fillings:n }(拆最后 n 层)
 * 判定: 在「皮对得上」的客人里找前缀最长的; 对不上的那几层就是坏馅料
 *       连皮都没人要 -> 整块拿走 */
function rabbitWrongTray(slot) {
  if (!slot || !slot.crustId) return null;
  const F = slot.fillings || [];
  const cands = run.customers.filter((c) => c.state === 'waiting' && c.order.crustId === slot.crustId);
  if (!cands.length) return { all: true };
  let best = 0;
  for (const c of cands) {
    let L = 0;
    while (L < F.length && L < c.order.fillings.length && F[L] === c.order.fillings[L]) L += 1;
    if (L > best) best = L;
  }
  const bad = F.length - best;
  return bad > 0 ? { fillings: bad } : null;
}

/* ---- 资源占用: 一个任务占住 托盘 / 烤位 / 客人 ---- */
function rabbitClaimed(kind, value, self) {
  for (const r of shop.rabbits || []) {
    if (r === self || !r.task) continue;
    if (kind === 'tray' && r.task.tray === value) return true;
    if (kind === 'oven' && r.task.oven === value) return true;
    if (kind === 'cust' && r.task.cust === value) return true;
  }
  return false;
}
/* 这位客人的月饼是不是「已经有人在做了/做好了」:
 * 托盘里 / 烤炉里(正在烤) / 柜台上摆着 / 别的月兔手上端着
 * —— 有的话就别再给他做第二块了 */
function customerHasWork(c) {
  for (const slot of run.slots) {
    if (!slot.crustId) continue;
    if (rabbitMoonMatches({ crustId: slot.crustId, fillings: slot.fillings }, c.order)) return true;
  }
  for (const os of run.oven) {
    if (os.moon && rabbitMoonMatches(os.moon, c.order)) return true;
  }
  for (const p of run.plates || []) {
    if (p.moon && rabbitMoonMatches(p.moon, c.order)) return true;
  }
  for (const r of shop.rabbits || []) {
    if (r.carry && r.carry.kind === 'moon' && rabbitMoonMatches(r.carry.moon, c.order)) return true;
  }
  return false;
}
function freeTrayIndex(self) {
  for (let i = 0; i < run.slots.length; i++) {
    if (!run.slots[i].crustId && !rabbitClaimed('tray', i, self)) return i;
  }
  return -1;
}
function freeOvenIndex(self) {
  for (let i = 0; i < run.oven.length; i++) {
    if (run.oven[i].state === 'idle' && !rabbitClaimed('oven', i, self)) return i;
  }
  return -1;
}

/* ---- 分工: 每种活还缺几个人干(需求 - 已经在干的) ---- */
function rabbitRoleNeed(self) {
  const doing = { serve: 0, fix: 0, bake: 0, cook: 0, calm: 0 };
  for (const r of shop.rabbits || []) {
    if (r === self || !r.task) continue;
    if (doing[r.task.type] != null) doing[r.task.type] += 1;
  }

  /* 送餐: 烤好且有人要的 */
  let serve = 0;
  for (const os of run.oven) {
    if (os.state === 'idle' || !os.moon || !ovenDone(os)) continue;
    if (rabbitPickCustomer(os.moon)) serve += 1;
  }
  /* 纠错 / 入炉: 遍历托盘 */
  let fix = 0;
  let bake = 0;
  let freeTrays = 0;
  for (const slot of run.slots) {
    if (!slot.crustId) { freeTrays += 1; continue; }
    const moon = { crustId: slot.crustId, fillings: slot.fillings };
    const wrong = rabbitWrongTray(slot);
    if (wrong) fix += 1; // 做错了 -> 需要有人来拆
    /* 正好有人要 -> 需要有人烤; 实在做错但有人能凑合要 -> 也算需要烤 */
    if (slotReady(slot) && (findCustomerForMoon(moon) || (wrong && rabbitPickCustomer(moon)))) bake += 1;
  }
  /* 做月饼: 空托盘 + 料齐 + 这位客人的月饼还没人在做 */
  let cookable = 0;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (!canAssemble(c.order)) continue;
    if (customerHasWork(c)) continue;
    cookable += 1;
  }

  /* 安抚: 有人耐心告急 -> 派月兔去守(最多 calmMax 只) */
  let urgent = 0;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    const ratio = c.patienceMax > 0 ? c.patienceLeft / c.patienceMax : 1;
    if (ratio < RABBIT.calmBelow) urgent += 1;
  }
  const calm = Math.min(urgent, RABBIT.calmMax || 1);

  return {
    serve: serve - doing.serve,
    fix: fix - doing.fix,
    bake: bake - doing.bake,
    cook: Math.min(freeTrays, cookable) - doing.cook,
    calm: calm - doing.calm,
  };
}

/* 还有没有「正事」要干(安抚不算正事, 有正事就得让位) */
function rabbitRealNeed(self) {
  const n = rabbitRoleNeed(self);
  return n.serve > 0 || n.fix > 0 || n.bake > 0 || n.cook > 0;
}

/* 挑一位最该安抚的客人: 耐心越少越优先, 别人守着的/刚守过的降权(好让它来回走动) */
function rabbitPickCalmCustomer(self) {
  const prev = self.task && self.task.cust;
  let best = null;
  let bestScore = -Infinity;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    const ratio = c.patienceMax > 0 ? c.patienceLeft / c.patienceMax : 1;
    let score = 1 - ratio; // 越急越优先
    if ((c.calmT || 0) > 0) score -= 0.55; // 正被安抚着(包括自己刚守的) -> 先去看别人
    const b = customerRect(c);
    for (const o of shop.rabbits || []) {
      if (o === self) continue;
      if (Math.abs(o.x - (b.x + b.w / 2)) <= b.w / 2 + RABBIT.touch.x &&
          Math.abs(o.y - (LAYOUT.counterY - 60)) <= RABBIT.touch.y + 40) {
        score -= 0.5; // 已经有别的月兔守着了
        break;
      }
    }
    if (c === prev) score -= 0.1; // 轻微倾向换人(别原地打转)
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/* ---- 挑一个具体目标开工(按角色) ---- */
function rabbitTakeTask(r, role) {
  if (role === 'calm') {
    const cust = rabbitPickCalmCustomer(r);
    if (!cust) return false;
    r.task = { type: 'calm', cust: cust, holdT: RABBIT.calmHold };
    rabbitGoCustomer(r);
    return true;
  }

  if (role === 'serve') {
    /* 多炉都烤好时: 先送给「最急」的那位, 不是按烤位顺序 */
    let bestI = -1;
    let bestCust = null;
    let bestKey = Infinity;
    for (let i = 0; i < run.oven.length; i++) {
      const os = run.oven[i];
      if (os.state === 'idle' || !os.moon || !ovenDone(os)) continue;
      if (rabbitClaimed('oven', i, r)) continue;
      const cust = rabbitPickCustomer(os.moon);
      if (!cust) continue;
      const key = patienceKey(cust);
      if (key < bestKey) { bestKey = key; bestI = i; bestCust = cust; }
    }
    if (bestI < 0) return false;
    r.task = { type: 'serve', step: 'toSrc', oven: bestI, cust: bestCust };
    rabbitGoOven(r);
    return true;
  }

  if (role === 'fix') {
    for (let i = 0; i < run.slots.length; i++) {
      if (!rabbitWrongTray(run.slots[i])) continue;
      if (rabbitClaimed('tray', i, r)) continue;
      r.task = { type: 'fix', step: 'toSrc', tray: i };
      rabbitGoTray(r, i);
      return true;
    }
    return false;
  }

  if (role === 'bake') {
    /* 多盘都做好时: 先烤「最急」的那盘 */
    let bestI = -1;
    let bestKey = Infinity;
    for (let i = 0; i < run.slots.length; i++) {
      const slot = run.slots[i];
      if (!slotReady(slot)) continue;
      if (rabbitClaimed('tray', i, r)) continue;
      const moon = { crustId: slot.crustId, fillings: slot.fillings.slice() };
      /* 正好有人要 -> 烤; 实在做错了也有人能凑合要 -> 也烤(别浪费); 做了一半的先别烤 */
      const exact = findCustomerForMoon(moon);
      if (!exact && !(rabbitWrongTray(slot) && rabbitPickCustomer(moon))) continue;
      const cust = exact || rabbitPickCustomer(moon);
      const key = cust ? patienceKey(cust) : Infinity;
      if (key < bestKey) { bestKey = key; bestI = i; }
    }
    if (bestI < 0) return false;
    r.task = { type: 'bake', step: 'toSrc', tray: bestI };
    rabbitGoTray(r, bestI);
    return true;
  }

  if (role === 'cook') {
    const idx = freeTrayIndex(r);
    if (idx < 0) return false;
    /* 挑「最急」且还能做的客人(不是数组里第一个) */
    let cust = null;
    let bestKey = Infinity;
    for (const c of run.customers) {
      if (c.state !== 'waiting') continue;
      if (!canAssemble(c.order)) continue;
      if (customerHasWork(c)) continue; // 托盘/烤炉/柜台/别的兔子已经在做这块了
      if (rabbitClaimed('cust', c, r)) continue;
      const key = patienceKey(c);
      if (key < bestKey) { bestKey = key; cust = c; }
    }
    if (!cust) return false;
    r.task = {
      type: 'cook',
      step: 'toSrc',
      tray: idx,
      cust: cust,
      need: [{ kind: 'crust', id: cust.order.crustId }]
        .concat(cust.order.fillings.slice(0, ASSEMBLY.maxFillings).map((f) => ({ kind: 'filling', id: f }))),
    };
    rabbitGoSource(r);
    return true;
  }
  return false;
}

/* ---- 找活: 先看自己上一轮的角色还缺不缺人, 再按优先级挑 ---- */
function rabbitTaskArrange(r) {
  if (r.task || r.carry) return;
  const need = rabbitRoleNeed(r);
  const order = [];
  if (r.role && need[r.role] > 0) order.push(r.role); // 尽量不换岗
  for (const role of RABBIT_ROLE_ORDER) {
    if (role !== r.role && need[role] > 0) order.push(role);
  }
  for (const role of order) {
    if (rabbitAbil(r, role) <= 0) continue; // 没训练这项能力
    if (rabbitTakeTask(r, role)) {
      r.role = role;
      r.restT = 0; // 开工了就把休息计时清零(免得闲着太久攒出很大的负数)
      return;
    }
  }
  /* 没活可干: 下一帧再看 */
  r.role = null;
}

/* ---- 目标点 ---- */

/* 快捷栏里某种食材那一行的中心(去那儿取料) */
function rabbitHotbarPoint(kind, id) {
  const items = typeof hotbarItems === 'function' ? hotbarItems() : [];
  /* x 跟着那一行(左右稳定), y 用原料架固定位置 —— 不跟滚动偏移, 免得一滚就跑偏 */
  const anchor = typeof shelfAnchorPoint === 'function' ? shelfAnchorPoint() : { x: LAYOUT.backpack.x + LAYOUT.backpack.w / 2, y: LAYOUT.backpack.y + 120 };
  for (const it of items) {
    if (it.kind === kind && it.id === id) return { x: it.rect.x + it.rect.w / 2, y: anchor.y };
  }
  return { x: anchor.x, y: anchor.y };
}
function rabbitGoTray(r, index) {
  const c = slotCenter(index);
  r.tx = c.x;
  r.ty = c.y - 14;
  r.hasTarget = true;
}
function rabbitGoOven(r) {
  /* 用烤炉面板的固定锚点: 烤位滚出可视区也能站到位把月饼送进去 */
  const p = typeof ovenAnchorPoint === 'function' ? ovenAnchorPoint() : (() => {
    const b = ovenRect(r.task && r.task.oven != null ? r.task.oven : 0);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  })();
  r.tx = p.x;
  r.ty = p.y;
  r.hasTarget = true;
}
function rabbitGoCustomer(r) {
  const b = customerRect(r.task.cust);
  r.tx = b.x + b.w / 2;
  r.ty = LAYOUT.counterY - 30;
  r.hasTarget = true;
}
function rabbitGoSource(r) {
  const need = r.task && r.task.need && r.task.need[0];
  if (!need) {
    r.task = null; // 没料要拿了(理论上不会), 收工
    return;
  }
  const p = rabbitHotbarPoint(need.kind, need.id);
  r.tx = p.x;
  r.ty = p.y;
  r.hasTarget = true;
}

/* 抱着拆下来的料, 送回快捷栏那一行 */
/* 安抚巡逻: 守够时间, 换下一位急的客人 */
function rabbitCalmRepick(r) {
  const cust = rabbitPickCalmCustomer(r);
  if (!cust) { rabbitEndTask(r, 'calm'); return; }
  r.task.cust = cust;
  r.task.holdT = RABBIT.calmHold;
  rabbitGoCustomer(r);
}

function rabbitGoHotbar(r, kind, id) {
  const p = rabbitHotbarPoint(kind, id);
  r.tx = p.x;
  r.ty = p.y;
  r.hasTarget = true;
}

/* ---- 走到目标 ---- */
function rabbitWalkTo(r, dt, sp) {
  const dx = r.tx - r.x;
  const dy = r.ty - r.y;
  const d = Math.hypot(dx, dy);
  if (!isFinite(d)) { r.stuckT = 0; r.lastD = null; return true; } // 目标坏了: 当到达处理
  if (d < 1) { r.stuckT = 0; r.lastD = null; return true; }
  /* 卡住看门狗: 2.5 秒没能靠近目标(够不着/被挡住) -> 放弃这个任务, 绝不永久卡死 */
  if (r.lastD != null && d > r.lastD - 2) r.stuckT = (r.stuckT || 0) + dt;
  else r.stuckT = 0;
  r.lastD = d;
  if (r.stuckT > 2.5) {
    r.stuckT = 0;
    r.lastD = null;
    rabbitDropCarry(r);
    rabbitEndTask(r, r.task ? r.task.type : 'calm');
    r.restT = 0.5;
    return false;
  }
  const step = Math.min(d, sp * dt);
  r.x += (dx / d) * step;
  r.y += (dy / d) * step;
  if (Math.abs(dx) > 3) r.dir = dx > 0 ? 1 : -1;
  r.hop += dt * (7 + sp / 18);
  return d <= RABBIT.arrive;
}

/* ---- 手上东西的收尾(任务中断时退回) ---- */
function rabbitDropCarry(r) {
  const c = r.carry;
  r.carry = null;
  if (!c) return;
  if (c.kind === 'moon') {
    if (typeof placeOnCounter === 'function') placeOnCounter(c.moon, W / 2);
  } else {
    backpackAdd(c.kind, c.id, 1);
  }
}
function rabbitEndTask(r, type) {
  r.task = null;
  r.hasTarget = false;
  r.restT = Math.max(0.3, rabbitValue(r, type) || 0.6); // 休息时长 = 刚用的那项能力
}

/* ---- 到目标点之后干活 ---- */
function rabbitArrive(r) {
  const t = r.task;
  if (!t) { r.hasTarget = false; return; }
  r.hasTarget = false;

  if (t.type === 'calm') {
    /* 站定安抚: 计时, 到点由 updateRabbits 换下一位客人 */
    t.holdT = RABBIT.calmHold;
    return;
  }

  if (t.type === 'cook') {
    if (t.step === 'toSrc') {
      const need = t.need[0];
      if (!need || !backpackTake(need.kind, need.id, 1)) return rabbitEndTask(r, 'cook');
      t.need.shift();
      r.carry = need;
      t.step = 'toDst';
      rabbitGoTray(r, t.tray);
      return;
    }
    /* 放到工作台 */
    const slot = run.slots[t.tray];
    const c = r.carry;
    r.carry = null;
    if (!slot) {
      if (c) backpackAdd(c.kind, c.id, 1);
      return rabbitEndTask(r, 'cook');
    }
    const res = c.kind === 'crust' ? placeCrust(slot, c.id) : placeFilling(slot, c.id, ASSEMBLY.maxFillings);
    if (!res.ok) backpackAdd(c.kind, c.id, 1); // 放不下就还回背包
    else SFX.stamp();
    if (t.need.length) {
      t.step = 'toSrc';
      rabbitGoSource(r);
    } else {
      rabbitEndTask(r, 'cook');
    }
    return;
  }

  if (t.type === 'fix') {
    /* 到托盘: 拆一件下来「吸附」在头顶 */
    if (t.step === 'toSrc') {
      const slot = run.slots[t.tray];
      const info = rabbitWrongTray(slot);
      if (!slot || !info) return rabbitEndTask(r, 'fix');
      /* 先搬错的馅料, 最后搬饼皮; 一次搬一件 */
      let item = null;
      if (slot.fillings.length) item = { kind: 'filling', id: slot.fillings[slot.fillings.length - 1] };
      else if (info.all && slot.crustId) item = { kind: 'crust', id: slot.crustId };
      if (!item) return rabbitEndTask(r, 'fix');
      if (item.kind === 'crust') clearSlot(slot);
      else slot.fillings.pop();
      r.carry = item;
      t.step = 'toDst';
      rabbitGoHotbar(r, item.kind, item.id);
      return;
    }
    /* 到快捷栏: 把料收进原料架(搬回原位) */
    const c = r.carry;
    r.carry = null;
    if (c) {
      backpackAdd(c.kind, c.id, 1);
      SFX.stamp();
      addFloater('月兔拆解 -1', r.x, r.y - 30, COLORS.warn, 1.0);
    }
    /* 还有错的就再跑一趟 */
    const info2 = rabbitWrongTray(run.slots[t.tray]);
    if (info2) {
      t.step = 'toSrc';
      rabbitGoTray(r, t.tray);
    } else {
      rabbitEndTask(r, 'fix');
    }
    return;
  }

  if (t.type === 'bake') {
    if (t.step === 'toSrc') {
      const slot = run.slots[t.tray];
      if (!slot || !slotReady(slot)) return rabbitEndTask(r, 'bake');
      r.carry = { kind: 'moon', moon: { crustId: slot.crustId, fillings: slot.fillings.slice(), bakeTime: 0, burnt: false } };
      clearSlot(slot);
      t.step = 'toDst';
      rabbitGoOven(r);
      return;
    }
    /* 放进烤炉 */
    const c = r.carry;
    r.carry = null;
    rabbitEndTask(r, 'bake');
    if (!c) return;
    const free = run.oven.find((o) => o.state === 'idle');
    if (free && ovenPut(free, c.moon).ok) SFX.stamp();
    else rabbitDropCarry({ carry: c }); // 没空位就摆柜台上
    return;
  }

  if (t.type === 'serve') {
    if (t.step === 'toSrc') {
      const os = run.oven[t.oven];
      if (!os || os.state === 'idle' || !os.moon) return rabbitEndTask(r, 'serve');
      const moon = ovenTake(os);
      if (!moon) return rabbitEndTask(r, 'serve');
      r.carry = { kind: 'moon', moon: moon };
      t.step = 'toDst';
      rabbitGoCustomer(r);
      return;
    }
    /* 递给客人 */
    const c = r.carry;
    r.carry = null;
    const cust = t.cust && t.cust.state === 'waiting' ? t.cust : null;
    rabbitEndTask(r, 'serve');
    if (!c) return;
    const target = cust || rabbitPickCustomer(c.moon);
    if (!target) return rabbitDropCarry({ carry: c });
    const res = serveCustomer(target, c.moon);
    if (res) {
      spawnMoneyForCustomer(target, res.coins);
      game.result = res;
      game.resultT = 1.6;
      SFX.success();
    }
  }
}

/* ---- 溜达 / 边界 / 安抚 / 收银 ---- */
/* 休息溜达时别往底栏/原料架里钻(会被面板挡住) */
function rabbitRestSteer(r, sp) {
  const z = RABBIT.restRoam;
  if (!z) return;
  const s = Math.max(60, sp || 70);
  if (r.y > z.y1) r.vy = -s; // 直接往上走回台面
  else if (r.y < z.y0) r.vy = s;
  if (r.x < z.x0) r.vx = s;
  else if (r.x > z.x1) r.vx = -s;
}
function rabbitWander(r, dt, sp) {
  r.turnT -= dt;
  if (r.turnT <= 0) {
    r.turnT = rand(1.1, 2.8);
    if (Math.random() < 0.3) r.dir = -r.dir;
    const ang = r.dir > 0 ? rand(-0.5, 0.5) : Math.PI + rand(-0.5, 0.5);
    r.vx = Math.cos(ang) * sp;
    r.vy = Math.sin(ang) * sp * 0.6;
  }
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  rabbitRestSteer(r, sp);
  r.hop += dt * (5 + sp / 22);
}
function rabbitClampRoam(r) {
  /* 坐标坏了(目标 NaN 之类)就地救回来, 不然这只兔子就废了 */
  if (!isFinite(r.x) || !isFinite(r.y)) {
    r.x = VW / 2;
    r.y = LAYOUT.counterY + 120;
    r.vx = 0;
    r.vy = 0;
  }
  const z = RABBIT.roam;
  if (r.x < z.x0) { r.x = z.x0; r.vx = Math.abs(r.vx); r.dir = 1; }
  if (r.x > z.x1) { r.x = z.x1; r.vx = -Math.abs(r.vx); r.dir = -1; }
  if (r.y < z.y0) { r.y = z.y0; r.vy = Math.abs(r.vy); }
  if (r.y > z.y1) { r.y = z.y1; r.vy = -Math.abs(r.vy); }
}
function rabbitCalm(r) {
  const lv = rabbitAbil(r, 'calm');
  if (lv <= 0) return;
  const rate = rabbitValue(r, 'calm');
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    const b = customerRect(c);
    const dx = Math.abs(r.x - (b.x + b.w / 2));
    const dy = Math.abs(r.y - (LAYOUT.counterY - 60));
    if (dx > b.w / 2 + RABBIT.touch.x || dy > RABBIT.touch.y + 40) continue;
    c.calmT = RABBIT.calmTime;
    c.calmRate = Math.max(c.calmRate || 0, rate);
  }
}
function rabbitCashier(r, dt) {
  const lv = rabbitAbil(r, 'cashier');
  if (lv <= 0) return;
  r.cashT -= dt;
  if (r.cashT > 0) return;
  r.cashT = 0.25;
  const rad = rabbitValue(r, 'cashier');
  for (let i = run.money.length - 1; i >= 0; i--) {
    const m = run.money[i];
    if (!m.rest) continue;
    if (dist(r.x, r.y, m.x, m.y) <= rad) collectMoney(m);
  }
}

/* ---- 每帧 ---- */
function updateRabbits(dt) {
  for (const r of shop.rabbits || []) {
    if (r.held) continue; // 被玩家拖着的时候不动
    const sp = rabbitValue(r, 'speed');

    if (r.hasTarget) {
      if (rabbitWalkTo(r, dt, sp)) rabbitArrive(r);
    } else if (r.task && r.task.type === 'calm') {
      /* 站着安抚: 一有正事马上让位; 守够了就换下一位客人(在客人之间来回移动) */
      if (rabbitRealNeed(r)) {
        rabbitEndTask(r, 'calm');
        r.restT = 0.25; // 有正事, 立刻换岗
      } else {
        r.task.holdT -= dt;
        if (r.task.holdT <= 0) rabbitCalmRepick(r);
      }
    } else if (r.task) {
      rabbitDropCarry(r); // 任务断了: 手上的东西退回, 收工
      rabbitEndTask(r, r.task.type);
    } else {
      rabbitWander(r, dt, sp);
      r.restT -= dt;
      if (r.restT <= 0) rabbitTaskArrange(r);
    }

    rabbitClampRoam(r);
    rabbitCalm(r);
    rabbitCashier(r, dt);
  }
}
