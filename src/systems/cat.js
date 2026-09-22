'use strict';

/* 流浪猫「耄耋」
 * 未驯服(第 CAT.fromDay 天起出现):
 *   1) 随机扑咬客人 -> 客人当场没了(算流失)
 *   2) 随机偷吃烤炉里「还没烤好」的月饼
 *   3) 随机偷吃快捷栏里的材料
 *   干坏事都要「跑到对应位置」; 吃东西时冒碎屑粒子(像 Minecraft)
 *   每干完一件坏事有 CAT.leaveChance 概率溜走, 过一会儿再回来
 *
 * 玩家可以: 直接拖动它挪位置 / 用五金月饼(或含五仁的月饼)打飞它
 *   打飞 CAT.tameHits 次 -> 第二天再来就是「驯服」状态
 *
 * 驯服后: 不再捣乱, 在客人之间来回巡逻大幅降低耐心流失, 还会赶走找茬的刘华强 */

/* global shop, run, LAYOUT, VW, CAT, COLORS, ovenRect, customerRect, hotbarItems, ovenDone,
   ovenTake, backpackCount, backpackTake, onCustomerLost,
   ovenAnchorPoint, shelfAnchorPoint, spawnCrumbs, addFloater, addShake,
   showScreenText, SFX, pick, rand, dist, findCrustDef, findFillingDef, img, drawSprite, clamp , playSound */

/* 扑咬时拍在客人身上的爪印(用 assets/贴图/耄耋攻击.png) */
const catPaws = [];
function spawnCatPaw(x, y) {
  catPaws.push({ x: x, y: y, t: 0, dur: 0.55, rot: rand(-0.35, 0.35) });
}
function updateCatPawFx(dt) {
  for (let i = catPaws.length - 1; i >= 0; i--) {
    catPaws[i].t += dt;
    if (catPaws[i].t >= catPaws[i].dur) catPaws.splice(i, 1);
  }
}
function drawCatPawFx(g) {
  for (const p of catPaws) {
    const k = p.t / p.dur;
    const size = 96 * (0.7 + k * 0.6); // 拍下去放大
    const a = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    if (typeof img === 'function' && img('cat_paw')) {
      drawSprite(g, 'cat_paw', -size / 2, -size / 2, size, size);
    } else {
      g.fillStyle = '#f7d08a';
      g.beginPath();
      g.arc(0, size * 0.18, size * 0.3, 0, Math.PI * 2);
      g.fill();
      for (const dx of [-0.34, 0, 0.34]) {
        g.beginPath();
        g.arc(dx * size, -size * 0.22, size * 0.11, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

function makeCat() {
  return {
    x: rand(CAT.roam.x0, CAT.roam.x1),
    y: rand(CAT.roam.y0, CAT.roam.y1),
    vx: 0,
    vy: 0,
    dir: Math.random() < 0.5 ? -1 : 1,
    hop: rand(0, Math.PI * 2),
    turnT: rand(0.5, 1.5),
    state: 'idle', // idle | go | eat | hold
    task: null, // { kind:'attack'|'eatOven'|'eatStock'|'harass'|'calm', ... }
    tx: 0,
    ty: 0,
    eatT: 0,
    crumbT: 0,
    crumbColor: '#d8c9a3',
    restT: 2.0, // 出场先歇一会儿
    held: false, // 被玩家拖着
    gone: false, // 溜走了/被打飞了(暂时不在场)
    backT: 0, // 还要多久才回来
    flung: null, // 被打飞的抛物线
    tamed: false, // 当前这只猫是不是驯服状态
  };
}

/* 今天猫出现了吗 */
function catActive() {
  return (shop.day || 1) >= CAT.fromDay;
}
/* 当前猫是不是驯服的 */
function catIsTamed() {
  return !!shop.catTamed;
}
/* 打飞了几次 / 还差几次 */
function catHitCount() {
  return shop.catHits || 0;
}

/* 快捷栏里某种材料那一行的中心 */
function catHotbarPoint(kind, id) {
  const items = typeof hotbarItems === 'function' ? hotbarItems() : [];
  /* y 用原料架固定位置, 不跟滚动偏移(否则玩家一滚猫就跑偏) */
  const anchor = typeof shelfAnchorPoint === 'function' ? shelfAnchorPoint() : { x: LAYOUT.backpack.x + LAYOUT.backpack.w / 2, y: LAYOUT.backpack.y + 140 };
  for (const it of items) {
    if (it.kind === kind && it.id === id) return { x: it.rect.x + it.rect.w / 2, y: anchor.y };
  }
  return { x: anchor.x, y: anchor.y };
}

/* 溜走 / 被打飞: 从最近的边缘「走出屏幕」, 当天就这一趟 */
function catLeave(cat) {
  if (cat.state === 'leave') return;
  cat.state = 'leave';
  cat.task = null;
  cat.backT = Infinity;
  const dl = cat.x;
  const dr = VW - cat.x;
  const du = cat.y;
  if (dl <= dr && dl <= du) { cat.tx = -100; cat.ty = cat.y; }
  else if (dr <= du) { cat.tx = VW + 100; cat.ty = cat.y; }
  else { cat.tx = cat.x; cat.ty = -100; }
}

/* 被玩家打飞(五金月饼 / 五仁月饼): 累计次数, 够了就驯服 */
function catKnockOut() {
  const cat = shop.cat;
  if (!cat || cat.gone || cat.held) return false;
  if (cat.flung) return false;
  /* 已经驯服的: 它只是躲开, 不计数也不走(自己人) */
  if (catIsTamed()) {
    addFloater('耄耋躲开了 · 它已经是自己人了', cat.x, cat.y - 46, COLORS.panelInk, 1.3);
    cat.dodgeT = 0.6;
    return true;
  }
  shop.catHits = (shop.catHits || 0) + 1;
  /* 飞出去 */
  cat.flung = { t: 0, x: 0, y: 0, vx: (Math.random() < 0.5 ? -1 : 1) * rand(340, 520), vy: -820, rot: 0, spin: rand(-11, 11) };
  cat.state = 'idle';
  cat.task = null;
  addShake(9);
  SFX.laowu(); // 被打飞: 老吴
  SFX.fail();
  if (shop.catHits >= CAT.tameHits) {
    shop.catTamed = true;

    showScreenText('耄耋被打服了! 明天它会来帮忙', '', COLORS.gold);
  } else {
    addFloater('耄耋被打飞! ' + shop.catHits + '/' + CAT.tameHits, cat.x, cat.y - 46, COLORS.gold, 1.5);
  }
  catLeave(cat); // 今天不来了, 明天再说
  return true;
}

/* 挑一件坏事干(仅未驯服) */
function catPickTask() {
  /* 扑客人(概率) */
  if (Math.random() < CAT.attackChance) {
    let best = null;
    for (const c of run.customers) {
      if (c.state !== 'waiting') continue;
      if (!isFinite(c.patienceLeft)) continue; // 无限耐心的惹不起
      if (!best || c.patienceLeft < best.patienceLeft) best = c; // 挑最急的
    }
    if (best) return { kind: 'attack', cust: best };
  }
  /* 偷吃烤炉里没烤好的 */
  const raw = [];
  for (let i = 0; i < run.oven.length; i++) {
    const os = run.oven[i];
    if (os.state === 'idle' || !os.moon) continue;
    if (ovenDone(os)) continue; // 烤好的不吃
    raw.push(i);
  }
  if (raw.length) return { kind: 'eatOven', oven: pick(raw) };
  /* 偷吃快捷栏的材料 */
  const stock = [];
  for (const it of hotbarItems()) {
    if (backpackCount(it.kind, it.id) > 0) stock.push(it);
  }
  if (stock.length) {
    const it = pick(stock);
    return { kind: 'eatStock', item: { kind: it.kind, id: it.id } };
  }
  /* 没什么可干: 扑客人兜底 */
  for (const c of run.customers) {
    if (c.state === 'waiting' && isFinite(c.patienceLeft)) return { kind: 'attack', cust: c };
  }
  return null;
}

function catItemColor(kind, id) {
  const d = kind === 'crust' ? findCrustDef(id) : findFillingDef(id);
  return d ? d.color : '#d8c9a3';
}
function catItemName(kind, id) {
  const d = kind === 'crust' ? findCrustDef(id) : findFillingDef(id);
  return d ? d.name : '材料';
}

/* 到达目标: 干坏事 */
function catAct(cat) {
  const t = cat.task;
  cat.task = null;
  cat.state = 'idle';
  cat.restT = CAT.restTime;
  if (!t) return;

  if (t.kind === 'attack') {
    const c = t.cust;
    if (!c || c.state !== 'waiting') return;
    /* 扑倒: 客人当场没了 -> 走「流失」那套结算 */
    c.state = 'angry';
    c.leaveT = 0;
    c.leaveSlot = c.dispSlot != null ? c.dispSlot : 0;
    c.fly = { t: 0, x: 0, y: 0, vx: 340, vy: -760, rot: 0, spin: -9 };
    const b = customerRect(c);
    spawnCatPaw(b.x + b.w / 2, b.y + b.h * 0.42); // 拍个爪印
    onCustomerLost(c);
    addFloater('耄耋扑人了！', b.x + b.w / 2, 240, COLORS.fail, 1.4);
    addShake(9);
    SFX.huff(); // 扑人: 哈气声
    SFX.fail();
    catLeave(cat);
    return;
  }

  if (t.kind === 'eatOven') {
    const os = run.oven[t.oven];
    if (!os || os.state === 'idle' || !os.moon) return;
    const moon = ovenTake(os); // 把没烤好的偷走
    cat.crumbColor = catItemColor('crust', moon ? moon.crustId : '');
    cat.state = 'eat';
    cat.eatT = CAT.eatTime;
    cat.crumbT = 0;
    SFX.eat(); // 偷吃也吃出声音
    showScreenText('耄耋偷吃了没烤好的月饼', '', COLORS.warn);
    return;
  }

  if (t.kind === 'eatStock') {
    const it = t.item;
    if (!backpackTake(it.kind, it.id, 1)) return;
    cat.crumbColor = catItemColor(it.kind, it.id);
    cat.state = 'eat';
    cat.eatT = CAT.eatTime;
    cat.crumbT = 0;
    SFX.eat(); // 偷吃也吃出声音
    showScreenText('耄耋偷吃了' + catItemName(it.kind, it.id), '', COLORS.warn);
  }
}

/* 吃完东西之后再掷「溜不溜」 */
function catMaybeLeave(cat) {
  if (Math.random() < CAT.leaveChance) {
    addFloater('耄耋溜了', cat.x, cat.y - 40, COLORS.panelInk, 1.1);
    catLeave(cat);
  }
}

/* 溜达时别往底栏/原料架里钻(会被面板挡住) */
function catRestSteer(cat) {
  const z = CAT.restRoam;
  if (!z) return;
  const s = CAT.speed || 120;
  if (cat.y > z.y1) cat.vy = -s; // 直接往上走回台面
  else if (cat.y < z.y0) cat.vy = s;
  if (cat.x < z.x0) cat.vx = s;
  else if (cat.x > z.x1) cat.vx = -s;
}

function catClampRoam(cat) {
  /* 坐标坏了(目标 NaN 之类)就地救回来, 不然这只猫就废了 */
  if (!isFinite(cat.x) || !isFinite(cat.y)) {
    cat.x = VW / 2;
    cat.y = LAYOUT.counterY + 120;
    cat.vx = 0;
    cat.vy = 0;
  }
  const z = CAT.roam;
  if (cat.x < z.x0) { cat.x = z.x0; cat.vx = Math.abs(cat.vx); cat.dir = 1; }
  if (cat.x > z.x1) { cat.x = z.x1; cat.vx = -Math.abs(cat.vx); cat.dir = -1; }
  if (cat.y < z.y0) { cat.y = z.y0; cat.vy = Math.abs(cat.vy); }
  if (cat.y > z.y1) { cat.y = z.y1; cat.vy = -Math.abs(cat.vy); }
}

/* 走到目标点; 到了返回 true */
function catWalk(cat, dt) {
  const dx = cat.tx - cat.x;
  const dy = cat.ty - cat.y;
  const d = Math.hypot(dx, dy);
  if (!isFinite(d)) return true; // 目标坏了: 当到达处理
  /* 卡住看门狗: 3 秒没能靠近就放弃这个任务 */
  if (cat.lastD != null && d > cat.lastD - 2) cat.stuckT = (cat.stuckT || 0) + dt;
  else cat.stuckT = 0;
  cat.lastD = d;
  if (cat.stuckT > 3) {
    cat.stuckT = 0;
    cat.lastD = null;
    cat.task = null;
    cat.state = 'idle';
    cat.restT = 0.8;
    return false;
  }
  if (d > 1) {
    const step = Math.min(d, CAT.speed * dt);
    cat.x += (dx / d) * step;
    cat.y += (dy / d) * step;
    if (Math.abs(dx) > 3) cat.dir = dx > 0 ? 1 : -1;
    cat.hop += dt * 10;
  }
  catClampRoam(cat);
  return d <= CAT.arrive;
}

/* ---- 驯服后: 在客人之间来回巡逻, 大幅减缓耐心流失; 优先赶走找茬的 ---- */

/* 挑目标: 先刘华强, 再最急的客人 */
function catTamePickTarget(cat) {
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (!c.def || !c.def.harass) continue;
    return { kind: 'harass', cust: c };
  }
  const cust = catPickCalmCustomer(cat);
  if (cust) return { kind: 'calm', cust: cust };
  return null;
}

/* 挑一位最该安抚的客人(耐心最少的优先, 刚守过的换人) */
function catPickCalmCustomer(cat) {
  const prev = cat.task && cat.task.cust;
  let best = null;
  let bestScore = -Infinity;
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (!isFinite(c.patienceLeft)) continue;
    const ratio = c.patienceMax > 0 ? c.patienceLeft / c.patienceMax : 1;
    let score = 1 - ratio;
    if ((c.calmT || 0) > 0) score -= 0.55; // 正被安抚着 -> 先去看别人
    if (c === prev) score -= 0.1;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/* 站在谁旁边就一直给他续安抚 */
function catCalmNearby(cat) {
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (!isFinite(c.patienceLeft)) continue;
    const b = customerRect(c);
    if (dist(cat.x, cat.y, b.x + b.w / 2, LAYOUT.counterY - 60) > CAT.tameReach) continue;
    c.calmT = Math.max(c.calmT || 0, CAT.tameCalmTime);
    c.calmRate = Math.max(c.calmRate || 0, CAT.tameCalm);
  }
}

/* 把找茬的刘华强赶走(玩家不用自己动手) */
function catDriveAway(cat, c) {
  if (!c || c.state !== 'waiting') return;
  c.state = 'angry';
  c.leaveT = 0;
  c.leaveSlot = c.dispSlot != null ? c.dispSlot : 0;
  c.fly = { t: 0, x: 0, y: 0, vx: -420, vy: -700, rot: 0, spin: 10 };
  const b = customerRect(c);
  spawnCatPaw(b.x + b.w / 2, b.y + b.h * 0.42);
  addFloater('耄耋赶走了' + c.def.name + '！', b.x + b.w / 2, 240, COLORS.goldLight, 1.6);

  SFX.stamp();
}

function catTameGoTo(cat, target) {
  cat.task = target;
  cat.task.holdT = CAT.tameHold;
  const b = customerRect(target.cust);
  cat.tx = b.x + b.w / 2;
  cat.ty = LAYOUT.counterY - 44;
  cat.state = 'go';
}

function updateTameCat(cat, dt) {
  /* 站着守/走到目标 */
  if (cat.state === 'go') {
    if (catWalk(cat, dt)) {
      const t = cat.task;
      cat.state = 'hold';
      if (t && t.kind === 'harass') {
        catDriveAway(cat, t.cust);
        cat.task = null;
        cat.restT = 2.0;
        cat.state = 'idle';
      }
    }
    catCalmNearby(cat);
    return;
  }

  catCalmNearby(cat);

  /* 站着: 守够时间就换下一位(在客人之间来回跑) */
  if (cat.state === 'hold' && cat.task) {
    if (cat.task.kind === 'harass') {
      catDriveAway(cat, cat.task.cust);
      cat.task = null;
      cat.state = 'idle';
      cat.restT = 1.5;
      return;
    }
    cat.task.holdT -= dt;
    if (cat.task.holdT > 0) return;
    cat.task = null;
    cat.state = 'idle';
  }

  /* 溜达 + 挑下一位客人 */
  cat.restT -= dt;
  cat.hop += dt * 6;
  if (cat.restT > 0) return;
  const target = catTamePickTarget(cat);
  if (!target) { cat.restT = 1.2; return; }
  catTameGoTo(cat, target);
}

function updateCat(dt) {
  updateCatPawFx(dt);
  if (shop.cat && shop.cat.dodgeT > 0) shop.cat.dodgeT -= dt; // 驯服后躲一下的小动作
  if (!catActive()) return;
  if (!shop.cat) {
    if (catIsTamed()) {
      /* 驯服了: 一早就来上班, 整天都在 */
      shop.cat = makeCat();
      shop.cat.tamed = true;
    } else {
      /* 没驯服: 每天只随机来一次 */
      if (run.catArriveT == null) run.catArriveT = rand(CAT.arriveMin, CAT.arriveMax);
      run.catArriveT -= dt;
      if (run.catArriveT > 0) return;
      shop.cat = makeCat();
      shop.cat.tamed = false;
      addFloater('耄耋溜进店里了…', shop.cat.x, shop.cat.y - 46, COLORS.warn, 1.4);
    }
  }
  const cat = shop.cat;

  /* 被打飞中: 先飞出去(落地时把位移结算到真实坐标, 飞远了就直接离场) */
  if (cat.flung) {
    const f = cat.flung;
    f.t += dt;
    f.vy += 1500 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.spin * dt;
    cat.hop += dt * 12;
    if (f.t > 0.9) {
      cat.x += f.x;
      cat.y += f.y;
      cat.flung = null;
    }
    return;
  }

  /* 溜走: 走出屏幕才算离场 */
  if (cat.state === 'leave') {
    const dx = cat.tx - cat.x;
    const dy = cat.ty - cat.y;
    const d = Math.hypot(dx, dy);
    if (d > 1 && isFinite(d)) {
      const step = Math.min(d, CAT.speed * dt);
      cat.x += (dx / d) * step;
      cat.y += (dy / d) * step;
      if (Math.abs(dx) > 3) cat.dir = dx > 0 ? 1 : -1;
      cat.hop += dt * 11;
    }
    if (!isFinite(cat.x) || !isFinite(cat.y) || cat.x < -60 || cat.x > VW + 60 || cat.y < -60) {
      cat.gone = true;
      cat.flung = null;
    }
    return;
  }

  /* 不在场: 等回场倒计时 */
  if (cat.gone) {
    if (!isFinite(cat.backT)) return; // 今天不来了
    cat.backT -= dt;
    if (cat.backT > 0) return;
    /* 回来了: 换个位置重新登场 */
    cat.gone = false;
    cat.state = 'idle';
    cat.task = null;
    cat.restT = 1.0;
    cat.x = rand(CAT.roam.x0, CAT.roam.x1);
    cat.y = rand(CAT.roam.y0, CAT.roam.y1);
    cat.tamed = catIsTamed();
    if (!cat.tamed) addFloater('耄耋又来了…', cat.x, cat.y - 46, COLORS.warn, 1.3);
    return;
  }

  if (cat.held) return; // 被玩家拖着: 不动

  /* 驯服状态: 帮忙 */
  if (cat.tamed || catIsTamed()) {
    cat.tamed = true;
    updateTameCat(cat, dt);
    return;
  }

  /* 吃东西: 冒粒子, 吃完歇着(并掷「溜不溜」) */
  if (cat.state === 'eat') {
    cat.eatT -= dt;
    cat.hop += dt * 7;
    cat.crumbT -= dt;
    if (cat.crumbT <= 0) {
      cat.crumbT = 0.12;
      spawnCrumbs(cat.x + cat.dir * 12, cat.y - 20, cat.crumbColor, 4, 1);
    }
    if (cat.eatT <= 0) {
      cat.state = 'idle';
      cat.restT = CAT.restTime;
      catMaybeLeave(cat);
    }
    catClampRoam(cat);
    return;
  }

  /* 走过去干坏事 */
  if (cat.state === 'go') {
    if (catWalk(cat, dt)) catAct(cat);
    return;
  }

  /* 溜达 + 歇够了挑坏事 */
  cat.turnT -= dt;
  if (cat.turnT <= 0) {
    cat.turnT = rand(0.9, 2.2);
    if (Math.random() < 0.35) cat.dir = -cat.dir;
    const ang = cat.dir > 0 ? rand(-0.5, 0.5) : Math.PI + rand(-0.5, 0.5);
    cat.vx = Math.cos(ang) * CAT.speed;
    cat.vy = Math.sin(ang) * CAT.speed * 0.6;
  }
  cat.x += cat.vx * dt;
  cat.y += cat.vy * dt;
  catRestSteer(cat);
  cat.hop += dt * 6;
  catClampRoam(cat);

  cat.restT -= dt;
  if (cat.restT > 0) return;
  const task = catPickTask();
  if (!task) { cat.restT = 1.5; return; }
  cat.task = task;
  if (task.kind === 'attack') {
    const b = customerRect(task.cust);
    cat.tx = b.x + b.w / 2;
    cat.ty = LAYOUT.counterY - 44;
  } else if (task.kind === 'eatOven') {
    /* 同样用固定锚点, 不跟烤位滚动 */
    const p = typeof ovenAnchorPoint === 'function' ? ovenAnchorPoint() : (() => {
      const b = ovenRect(task.oven);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    })();
    cat.tx = p.x;
    cat.ty = p.y;
  } else {
    const p = catHotbarPoint(task.item.kind, task.item.id);
    cat.tx = p.x;
    cat.ty = p.y;
  }
  cat.state = 'go';
}
