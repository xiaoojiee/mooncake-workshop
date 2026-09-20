'use strict';

/* 工坊主场景(营业): 多客人并发 + 拖拽组装 + 烤炉 + 工厂面板(不暂停)
 *
 * 屏幕布局(沙威玛式):
 *   上排: 客人(只露上半身)站在柜台后的固定站位, 从右侧走进来; 头顶是订单气泡+耐心条
 *   中部: 柜台横贯画面(counterY), 挡住客人下半身, 台面上会落金币
 *   柜台面: 左侧原料架 / 中部制作台(托盘) / 右侧烤炉
 *   底部: 提示 + 打开工厂面板按钮
 *
 * 操作(自由拖拽, 松手判定):
 *   原料架 → 空托盘: 放面皮
 *   原料架 → 有皮的托盘: 叠馅料
 *   托盘(已组装) → 空闲烤位: 送烤
 *   烤位(烤好) → 客人: 出餐, 结算金币会撒到柜台上
 *   点击台面上的金币: 捡起入账(不捡会消失)
 *   拖到别处松手: 自动退回, 不消耗
 */

/* global scenes, makeScene, ctx, W, H, COLORS, shop, run, LAYOUT, ASSEMBLY, OVEN, BAKE_NAME,
   buildDayPlan, spawnCustomer, updateCustomers, onCustomerLost, serveCustomer, reapCustomers,
   hasMoreCustomers, createSlot, clearSlot, placeCrust, placeFilling, undoFilling, slotReady,
   createOvenSlot, ovenPut, ovenTake, ovenDone, ovenBurnt, bakeGrade, drawSlotMoon,
   drawFillingBubble, drawCrustPart, drawFillingIcon, drawNpc, fillingIndexOf,
   findCrustDef, findFillingDef, CRUSTS, FILLINGS, isUnlocked, uiHeader, uiPanel, uiButton,
   uiBar, drawText, wrapText, hitButton, pointInRect, dist, SFX, drawBg, drawFallbackBg, addShake, BG,
   showScreenText, formatNum, formatTime, saveGame, backpackCount, backpackTake, backpackAdd,
   applyOvenUpgrade, upgradesFor, interact,
   findComponentDef, COMPONENT_TYPES, buySlot, installComponent, removeComponent,
   upgradeComponent, buyComponent, slotCost, MAX_SLOTS, unlockLabel,
   MONEY, COUNTER, COUNTER_LABEL, DAY, touching, rand, randInt, clamp, img, addFloater,
   benchSlotCount, moveComponent, ovenBakeTime, ovenBurnTime, counterLevel,
   slotAutoLevel,
   applyCounterUpgrade, counterUpgradeCost, isComponentAllowed, componentRestrictLabel,
   poweredUnitIds, isUnitPowered,
   factoryBoard, factoryBoardReset, factoryBoardDraw, factoryBoardDown, factoryBoardMove,
   factoryBoardUp, factoryBoardWheel, factoryBoardUpdate, factoryBoardSweep, input,
   benchUpgradeToggle, benchUpgradeUI */

const game = {
  buttons: [],
  hover: null,
  active: null,
  drag: null, // { kind:'crust'|'filling'|'slot'|'oven', ... , x, y }
  toast: null, // { text, color, life }
  dayEnd: false,
  dayEndT: 0,
  result: null, // 最近一次出餐结果
  resultT: 0,
  lastFetchT: 0,
  holdFetch: null, // 长按连取的工厂 id
  factorySel: null, // 工厂面板当前选中工厂
  pendingCompDrag: null, // 按住已装组件但还没拖动(区分点击/拖拽)
  ovenScroll: 0, // 烤位面板滚动偏移
  hotbarScroll: 0, // 快捷栏滚动偏移
  hotbarPress: null, // 按住快捷栏条目但还没决定是滚动还是拖拽
  hotbarDrag: null, // 快捷栏滚动条/内容拖动
};

/* 点击已装组件格: 可升级则升级, 否则卸下回背包 */
function handleSlotClick(uid, slotIndex) {
  const u = shop.units[uid];
  if (!u || !u.slots[slotIndex]) return;
  const slot = u.slots[slotIndex];
  const cd = findComponentDef(slot.compId);
  if (cd && cd.upgradable && slot.level < cd.maxLevel) {
    const res = upgradeComponent(uid, slotIndex);
    if (!res.ok) {
      game.toast = { text: res.reason, color: COLORS.fail, life: 1.2 };
      SFX.fail();
    } else {
      SFX.coin();
    }
  } else {
    removeComponent(uid, slotIndex);
    SFX.click();
    game.toast = { text: '已卸下 ' + compName(slot.compId), color: COLORS.textDim, life: 1.1 };
  }
}

function compName(compId) {
  const d = findComponentDef(compId);
  return d ? d.name : compId;
}

/* 拖拽来源类型 */
const DRAG = { CRUST: 'crust', FILLING: 'filling', SLOT: 'slot', OVEN: 'oven', COMPONENT: 'component' };

scenes.register(
  'shop',
  makeScene({
    enter(payload) {
      const o = payload || {};
      if (o.fresh || !run.slots.length) {
        startDay();
      }
      run.powerOn = true; // 开业通电
      game.buttons = [];
      game.hover = null;
      game.active = null;
      game.drag = null;
      game.dayEnd = false;
      game.dayEndT = 0;
      game.result = null;
      game.resultT = 0;
      game.pendingCompDrag = null;
      run.money = [];
      /* 共享工厂面板: 关闭按钮就是收起面板 */
      factoryBoardReset();
      factoryBoard.closeAction = function () {
        run.factoryOpen = false;
      };
    },

    exit() {
      game.drag = null;
      game.pendingCompDrag = null;
      run.powerOn = false; // 离开营业断电
    },

    update(dt) {
      if (game.dayEnd) {
        game.dayEndT += dt;
        return;
      }

      /* 工厂面板里的掉落产物 */
      if (run.factoryOpen) factoryBoardUpdate(dt);

      /* 营业倒计时(时间制): 时间到了就不再冒新客人 */
      if (run.dayTimeLeft > 0) {
        run.dayTimeLeft = Math.max(0, run.dayTimeLeft - dt);
        run.spawnTimer -= dt;
        if (run.spawnTimer <= 0) {
          const spawned = spawnCustomer();
          const interval = Math.max(DAY.spawnMin, DAY.spawnBase - (shop.day - 1) * DAY.spawnDecay);
          run.spawnTimer = spawned ? interval : 1.0;
        }
      }

      /* 客人耐心 + 流失 */
      const lost = updateCustomers(dt);
      for (const c of lost) onCustomerLost(c);
      reapCustomers(dt);

      /* 队形补位: 前面的走了, 后面的滑上来 */
      updateQueueSlots(dt);

      /* 柜台上的金币 */
      updateMoney(dt);
      updateCart(dt);

      /* 自动制作台 */
      updateAutoBench(dt);

      /* 烤炉进度 */
      for (const os of run.oven) {
        if (os.state !== 'baking') continue;
        os.bake += dt;
        if (os.bake >= ovenBurnTime() && !os.burntWarned) {
          os.burntWarned = true;
          addShake(4);
          SFX.fail();
        }
      }

      /* 提示淡出 */
      if (game.toast) {
        game.toast.life -= dt;
        if (game.toast.life <= 0) game.toast = null;
      }
      if (game.resultT > 0) game.resultT -= dt;

      /* 收尾判定: 没客人了、都离场了、台面上也没待捡的金币 */
      if (!hasMoreCustomers() && !run.customers.length && !run.money.length && !game.dayEnd) {
        finishDay();
      }
    },

    onDown(x, y) {
      /* 日终界面: 只响应结算按钮 -> 回到开业前的界面(不直接下一天) */
      if (game.dayEnd) {
        const nb = dayEndButtonRect();
        if (pointInRect(x, y, nb)) {
          SFX.click();
          shop.day += 1;
          saveGame();
          scenes.goto('menu');
        }
        return;
      }

      /* 捡金币: 按住碰到就收(工厂面板打开时台面被面板挡住, 不捡) */
      if (!run.factoryOpen) {
        if (collectMoneyAround(x, y) > 0) return;
      }

      /* 工厂面板: 复用共享网格面板(营业不暂停) */
      if (run.factoryOpen) {
        factoryBoardDown(x, y);
        return;
      }

      const b = hitButton(game.buttons, x, y);
      game.active = b;
      if (b) b.pressed = true;

      if (b && b.id === 'factory') {
        SFX.click();
        factoryBoardReset();
        run.factoryOpen = true;
        return;
      }
      if (b && b.id === 'bench') {
        SFX.click();
        benchUpgradeUI.focus = null;
        benchUpgradeToggle(true);
        return;
      }
      if (b && b.id === 'upgBench') {
        SFX.click();
        benchUpgradeUI.focus = { kind: 'bench', index: b.value };
        benchUpgradeToggle(true);
        return;
      }
      if (b && b.id === 'upgOven') {
        SFX.click();
        benchUpgradeUI.focus = { kind: 'oven', index: b.value };
        benchUpgradeToggle(true);
        return;
      }

      /* 快捷栏滚动条拖动 */
      const hbThumb = hotbarBarThumb();
      if (hbThumb && pointInRect(x, y, { x: hbThumb.x - 6, y: hbThumb.y, w: hbThumb.w + 12, h: hbThumb.h })) {
        game.hotbarDrag = { mode: 'bar', grab: y - hbThumb.y };
        return;
      }
      /* 快捷栏条目: 按住先决定是滚动还是拖拽 */
      const hbItem = hotbarItemAt(x, y);
      if (hbItem) {
        game.hotbarPress = { kind: hbItem.kind, id: hbItem.id, x, y, startScroll: game.hotbarScroll };
        return;
      }
      /* 快捷栏空白: 按住拖动滚动 */
      if (pointInRect(x, y, hotbarPanelArea()) && hotbarMaxScroll() > 0) {
        game.hotbarDrag = { mode: 'content', startY: y, startScroll: game.hotbarScroll };
        return;
      }

      /* 先判断是否点在可拖拽对象上 */
      const src = pickDraggable(x, y);
      if (src) {
        game.drag = src;
        src.x = x;
        src.y = y;
        SFX.click();
        return;
      }
    },

    onMove(x, y) {
      if (run.factoryOpen) {
        factoryBoardMove(x, y);
        if (input.pointer.down) factoryBoardSweep(x, y);
        return;
      }
      /* 按住扫过金币就收 */
      if (input.pointer.down) collectMoneyAround(x, y);

      /* 快捷栏滚动 */
      if (game.hotbarDrag) {
        const a = hotbarPanelArea();
        if (game.hotbarDrag.mode === 'bar') {
          const thumbH = Math.max(28, a.h * (a.h / hotbarContentH()));
          const t = clamp((y - game.hotbarDrag.grab - a.y) / Math.max(1, a.h - thumbH), 0, 1);
          game.hotbarScroll = t * hotbarMaxScroll();
        } else {
          game.hotbarScroll = game.hotbarDrag.startScroll - (y - game.hotbarDrag.startY);
        }
        clampHotbarScroll();
        return;
      }
      if (game.hotbarPress) {
        const p = game.hotbarPress;
        const dx = x - p.x;
        const dy = y - p.y;
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          game.hotbarScroll = p.startScroll - dy;
          clampHotbarScroll();
          game.hotbarDrag = { mode: 'content', startY: y, startScroll: game.hotbarScroll };
          game.hotbarPress = null;
          return;
        }
        if (Math.hypot(dx, dy) > 10) {
          game.drag = { kind: p.kind === 'crust' ? DRAG.CRUST : DRAG.FILLING, productId: p.id, x, y };
          game.hotbarPress = null;
          return;
        }
        return;
      }

      /* 按住已装组件: 移动超过阈值才升级为拖拽 */
      if (game.pendingCompDrag) {
        const p = game.pendingCompDrag;
        if (dist(x, y, p.x, p.y) > 10) {
          game.drag = {
            kind: DRAG.COMPONENT, compId: p.compId, fromSlot: p.slotIndex, x, y, factoryId: p.factoryId,
          };
          game.pendingCompDrag = null;
        }
        return;
      }
      if (game.drag) {
        game.drag.x = x;
        game.drag.y = y;
        return;
      }
      game.hover = hitButton(game.buttons, x, y);
      for (const btn of game.buttons) btn.hover = btn === game.hover;
    },

    onUp(x, y) {
      if (run.factoryOpen) {
        factoryBoardUp(x, y);
        return;
      }
      for (const btn of game.buttons) btn.pressed = false;
      game.holdFetch = null;
      game.hotbarPress = null;
      game.hotbarDrag = null;

      /* 没拖动过的按下: 视为点击(升级/卸下) */
      if (game.pendingCompDrag) {
        const p = game.pendingCompDrag;
        game.pendingCompDrag = null;
        handleSlotClick(p.factoryId, p.slotIndex);
      }

      if (game.drag) {
        dropDragged(game.drag, x, y);
        game.drag = null;
      }
      game.active = null;
    },

    onWheel(x, y, delta) {
      if (run.factoryOpen) {
        factoryBoardWheel(x, y, delta);
        return;
      }
      if (pointInRect(x, y, LAYOUT.backpack) && hotbarMaxScroll() > 0) {
        game.hotbarScroll += delta * 48;
        clampHotbarScroll();
      }
      if (pointInRect(x, y, LAYOUT.oven) && ovenMaxScroll() > 0) {
        game.ovenScroll += delta * 48;
        clampOvenScroll();
      }
    },

    draw() {
      if (typeof drawBg === 'function') drawBg(ctx, img('bg_open') ? 'bg_open' : 'bg_counter');
      else drawFallbackBg(ctx);

      drawCustomers(ctx);
      drawCounter(ctx);
      drawMoney(ctx);
      drawCart(ctx);
      drawHotbar(ctx);
      drawBench(ctx);
      drawOven(ctx);

      /* 底部栏(与左侧快捷栏齐底) */
      uiPanel(ctx, LAYOUT.bench.x, LAYOUT.bottomY, W - LAYOUT.bench.x - 16, LAYOUT.bottomH, { r: 14 });
      drawText(ctx, hintText(), LAYOUT.bench.x + 28, LAYOUT.bottomY + 44, {
        size: 17, color: COLORS.textDim, maxWidth: 440,
      });
      drawText(ctx, '剩余营业 ' + formatTime(run.dayTimeLeft) + '　已服务 ' + run.dayServed + '　流失 ' + run.dayLost, LAYOUT.bench.x + 28, LAYOUT.bottomY + 88, {
        size: 15, color: COLORS.panelInk, maxWidth: 440,
      });

      game.buttons = [
        {
          id: 'bench',
          x: W - 532,
          y: LAYOUT.bottomY + (LAYOUT.bottomH - 68) / 2,
          w: 220,
          h: 68,
          label: '⚙ 制作台升级',
          size: 17,
          accent: COLORS.gold,
        },
        {
          id: 'factory',
          x: W - 300,
          y: LAYOUT.bottomY + (LAYOUT.bottomH - 68) / 2,
          w: 268,
          h: 68,
          label: run.factoryOpen ? '🏭 工厂面板已打开' : '🏭 工厂 / 能源核心',
          size: 18,
          accent: run.factoryOpen ? COLORS.ok : COLORS.gold,
        },
      ];
      /* 每个制作台/烤位右上角的小升级按钮(共享给开始界面) */
      for (const b of slotUpgradeButtons()) game.buttons.push(b);
      for (const b of game.buttons) uiButton(ctx, b);

      /* 工厂面板(共享网格 UI, 半透明, 不暂停) */
      if (run.factoryOpen) factoryBoardDraw(ctx, { dim: true, showClose: true });

      /* 拖拽物跟随 */
      if (game.drag) drawDragGhost(ctx, game.drag);

      /* 出餐结果飘出 */
      if (game.resultT > 0 && game.result) drawServeResult(ctx, game.result);

      /* toast */
      if (game.toast) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, game.toast.life);
        drawText(ctx, game.toast.text, W / 2, LAYOUT.bottomY - 16, {
          size: 16, weight: 600, align: 'center', color: game.toast.color,
        });
        ctx.restore();
      }

      uiHeader(ctx, { title: '月饼工坊 · 第 ' + shop.day + ' 天' });

      /* 日终 */
      if (game.dayEnd) drawDayEnd(ctx);
    },
  }),
);

/* ---- 开局/结束 ---- */

function startDay() {
  run.spawnQueue = [];
  run.customers = [];
  run.spawnTimer = 1.2;
  run.dayTimeLeft = DAY.duration; // 时间制: 每天固定营业时长
  run.dayTotal = 0;
  run.dayServed = 0;
  run.dayLost = 0;
  run.combo = 0;
  run.factoryOpen = false;
  run.money = [];
  run.cart = { x: W / 2, dir: 1 };
  game.dayEnd = false;

  /* 制作台托盘 */
  run.slots = [];
  for (let i = 0; i < benchSlotCount(); i++) run.slots.push(createSlot());
  for (let i = 0; i < run.slots.length; i++) {
    run.slots[i].autoLevel = slotAutoLevel(i);
    run.slots[i].auto = run.slots[i].autoLevel > 0;
  }

  /* 烤炉 */
  run.oven = [];
  const slots = shop.ovenLevel || OVEN.slots;
  for (let i = 0; i < slots; i++) run.oven.push(createOvenSlot());
}

function finishDay() {
  game.dayEnd = true;
  game.dayEndT = 0;
  run.powerOn = false; // 打烊断电
  saveGame();
}

/* 制作台自动化: 每个间隔只走一步 —— 先放饼皮, 之后每隔一段时间叠一层馅
 * 例: 3 秒发一张皮, 再 3 秒放一个馅, 如此类推(送烤/出餐仍手动) */
function updateAutoBench(dt) {
  const autoSlots = run.slots ? run.slots.filter((s) => s.auto) : [];

  if (autoSlots.length) {
    /* 已被其它自动制作台盯上的客人 */
    const taken = [];
    for (const s of autoSlots) if (s.autoCust) taken.push(s.autoCust);

    for (const slot of autoSlots) {
      const lv = slot.autoLevel || 1;
      const interval = (COUNTER.auto.interval[Math.min(lv, COUNTER.auto.interval.length) - 1]) || 3.0;
      slot.autoT = (slot.autoT || 0) + dt;
      if (slot.autoT < interval) continue;
      slot.autoT = 0;

      /* 空托盘: 挑一个没人做、等最久的客人, 放一张皮 */
      if (!slot.crustId) {
        let cust = null;
        for (const c of run.customers) {
          if (c.state !== 'waiting') continue;
          if (taken.indexOf(c) >= 0) continue;
          if (!cust || c.patienceLeft < cust.patienceLeft) cust = c;
        }
        if (!cust) continue;
        if (backpackCount('crust', cust.order.crustId) < 1) continue;
        backpackTake('crust', cust.order.crustId, 1);
        placeCrust(slot, cust.order.crustId);
        slot.autoCust = cust;
        taken.push(cust);
        slot.autoOrder = cust.order.fillings.slice();
        slot.autoDone = 0;
        SFX.stamp();
        continue;
      }

      /* 有皮了: 每次叠一层馅 */
      if (slot.autoOrder && slot.autoDone < slot.autoOrder.length) {
        const f = slot.autoOrder[slot.autoDone];
        if (backpackCount('filling', f) < 1) continue; // 没货, 等下一间隔
        backpackTake('filling', f, 1);
        placeFilling(slot, f, ASSEMBLY.maxFillings);
        slot.autoDone += 1;
        SFX.stamp();
      }
    }
  }

  /* 自动烤制: 自动制作台装好的月饼自动送进空烤位 */
  if (counterLevel('autoBake') > 0) {
    for (const slot of run.slots) {
      if (!slot.auto || !slotReady(slot)) continue;
      const freeOven = run.oven.find((os) => os.state === 'idle');
      if (!freeOven) break;
      const moon = {
        crustId: slot.crustId,
        fillings: slot.fillings.slice(),
        bakeTime: 0,
        burnt: false,
      };
      if (ovenPut(freeOven, moon).ok) {
        clearSlot(slot);
        slot.autoOrder = null;
        slot.autoCust = null;
        slot.autoDone = 0;
        SFX.click();
      }
    }
  }
}

/* ---- 拖拽源识别 ---- */

function pickDraggable(x, y) {
  /* 制作台上的托盘(已放皮, 可拖走整块去烤) */
  run.slots.forEach((slot, i) => {
    const r = slotRect(i);
    if (pointInRect(x, y, r) && slot.crustId && slotReady(slot)) {
      /* 点在月饼圆内才算拖月饼 */
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2 - 20;
      if (dist(x, y, cx, cy) <= 62) {
        game.dragSlotIndex = i;
      }
    }
  });
  if (game.dragSlotIndex != null) {
    const i = game.dragSlotIndex;
    game.dragSlotIndex = null;
    return { kind: DRAG.SLOT, index: i, x, y };
  }

  /* 烤位里已烤好的 */
  for (let i = 0; i < run.oven.length; i++) {
    const os = run.oven[i];
    if (os.state !== 'baking') continue;
    const r = ovenRect(i);
    if (pointInRect(x, y, r)) {
      return { kind: DRAG.OVEN, index: i, x, y };
    }
  }

  return null;
}

/* 松手判定 */
function dropDragged(drag, x, y) {
  if (drag.kind === DRAG.CRUST || drag.kind === DRAG.FILLING) {
    /* 落到某个托盘 */
    for (let i = 0; i < run.slots.length; i++) {
      const r = slotRect(i);
      if (!pointInRect(x, y, r)) continue;
      const slot = run.slots[i];
      if (drag.kind === DRAG.CRUST) {
        if (!backpackTake('crust', drag.productId, 1)) return fail('背包没有面皮了');
        const res = placeCrust(slot, drag.productId);
        if (!res.ok) {
          backpackAdd('crust', drag.productId, 1); // 退回
          return fail(res.reason);
        }
        SFX.stamp();
      } else {
        if (!backpackTake('filling', drag.productId, 1)) return fail('背包没有这个馅料了');
        const res = placeFilling(slot, drag.productId, ASSEMBLY.maxFillings);
        if (!res.ok) {
          backpackAdd('filling', drag.productId, 1); // 退回
          return fail(res.reason);
        }
        SFX.stamp();
      }
      return;
    }
    fail('要拖到制作台上'); // 没命中任何托盘, 不消耗
    return;
  }

  if (drag.kind === DRAG.SLOT) {
    /* 送到烤位 */
    const slot = run.slots[drag.index];
    if (!slotReady(slot)) return;
    for (let i = 0; i < run.oven.length; i++) {
      const r = ovenRect(i);
      if (!pointInRect(x, y, r)) continue;
      const moon = {
        crustId: slot.crustId,
        fillings: slot.fillings.slice(),
        bakeTime: 0,
        burnt: false,
        srcSlot: drag.index,
      };
      const res = ovenPut(run.oven[i], moon);
      if (!res.ok) return fail(res.reason);
      clearSlot(slot);
      SFX.click();
      return;
    }
    /* 拖回制作台其他位置: 无事发生(保持原样) */
    return;
  }

  if (drag.kind === DRAG.OVEN) {
    const os = run.oven[drag.index];
    /* 递给出餐区最近的客人 */
    const cust = pickCustomerAt(x, y);
    if (cust) {
      const moon = ovenTake(os);
      if (!moon) return;
      const res = serveCustomer(cust, moon);
      if (res) {
        /* 结算金币以撒钱形式落到柜台上, 玩家点击捡起才入账 */
        spawnMoneyForCustomer(cust, res.coins);
        game.result = res;
        game.resultT = 1.6;
        SFX.success();
      }
      return;
    }
    /* 拖到制作台空位: 取出放凉(其实直接取出丢掉)
     * 这里设计为「拖到客人身上」才出餐, 否则提示 */
    fail('把烤好的月饼拖给客人');
    return;
  }

  if (drag.kind === DRAG.COMPONENT) {
    const sel = game.factorySel;
    const rt = shop.units[sel];
    if (!rt) return;
    const si = pickSlotIndex(x, y);

    /* 从槽位拖出的组件: 落到别的空槽=换位; 拖到别处=卸下回背包 */
    if (drag.fromSlot != null) {
      if (si === drag.fromSlot) return;
      if (si >= 0) {
        if (rt.slots[si]) return fail('这个槽位已经有组件了');
        const mv = moveComponent(sel, drag.fromSlot, si);
        if (mv.ok) {
          SFX.stamp();
          game.toast = { text: '已移动 ' + compName(drag.compId), color: COLORS.ok, life: 1.1 };
        } else {
          fail(mv.reason);
        }
        return;
      }
      const rm = removeComponent(sel, drag.fromSlot);
      if (rm.ok) {
        SFX.click();
        game.toast = { text: '已卸下 ' + compName(drag.compId), color: COLORS.textDim, life: 1.1 };
      }
      return;
    }

    /* 从背包拖出: 装到空槽 */
    if (si >= 0) {
      if (rt.slots[si]) return fail('这个槽位已经有组件了');
      const res = installComponent(sel, si, drag.compId);
      if (res.ok) {
        SFX.stamp();
        game.toast = { text: '装上 ' + compName(drag.compId), color: COLORS.ok, life: 1.2 };
      } else {
        fail(res.reason);
      }
      return;
    }
    /* 拖回背包/别处: 自动退回, 无损失 */
    if (pointInRect(x, y, factoryPanelRect())) return;
    return fail('拖到空槽位上才能装上');
  }
}

function fail(text) {
  game.toast = { text, color: COLORS.fail, life: 1.3 };
  SFX.fail();
}

/* ---- 命中区域 ---- */

function slotRect(i) {
  const b = LAYOUT.bench;
  const gap = b.gap;
  const total = benchSlotCount();
  const slotW = Math.min(b.slotW, (b.w - gap * (total - 1)) / total);
  /* 托盘整体居中 */
  const groupW = total * slotW + (total - 1) * gap;
  const x0 = b.x + (b.w - groupW) / 2;
  return {
    x: x0 + i * (slotW + gap),
    y: b.y,
    w: slotW,
    h: b.h,
  };
}

/* 烤位面板: 槽位多了就滚动, 不超出面板 */
const OVEN_SLOT_H = 92;
const OVEN_SLOT_GAP = 10;
function ovenPanelArea() {
  const o = LAYOUT.oven;
  return { x: o.x + 4, y: o.y + 44, w: o.w - 8, h: o.h - 50 };
}
function ovenContentH() {
  return run.oven.length * (OVEN_SLOT_H + OVEN_SLOT_GAP) + 8;
}
function ovenMaxScroll() {
  return Math.max(0, ovenContentH() - ovenPanelArea().h);
}
function clampOvenScroll() {
  game.ovenScroll = clamp(game.ovenScroll || 0, 0, ovenMaxScroll());
}
function ovenRect(i) {
  const o = LAYOUT.oven;
  const pad = 14;
  return {
    x: o.x + pad,
    y: o.y + 50 + i * (OVEN_SLOT_H + OVEN_SLOT_GAP) - (game.ovenScroll || 0),
    w: o.w - pad * 2,
    h: OVEN_SLOT_H,
  };
}

/* 槽位右上角的升级按钮 */
function slotUpgradeRect(i) {
  const r = slotRect(i);
  return { x: r.x + r.w - 38, y: r.y + 6, w: 30, h: 30 };
}
function ovenUpgradeRect(i) {
  const r = ovenRect(i);
  return { x: r.x + r.w - 38, y: r.y + 6, w: 30, h: 30 };
}

/* 制作台/烤位右上角的升级按钮列表(营业场景与开始界面共用) */
function slotUpgradeButtons() {
  const list = [];
  for (let i = 0; i < run.slots.length; i++) {
    list.push(Object.assign({
      id: 'upgBench', value: i, label: '⬆', size: 15,
      accent: run.slots[i].auto ? COLORS.ok : COLORS.goldLight,
    }, slotUpgradeRect(i)));
  }
  const oArea = ovenPanelArea();
  for (let i = 0; i < run.oven.length; i++) {
    const ur = ovenUpgradeRect(i);
    /* 滚出可视区就不画, 免得按钮跑到面板外 */
    if (ur.y < oArea.y || ur.y + ur.h > oArea.y + oArea.h) continue;
    list.push(Object.assign({ id: 'upgOven', value: i, label: '⬆', size: 15, accent: COLORS.goldLight }, ur));
  }
  return list;
}

/* 客人站位矩形(柜台后的一排固定站位); 可传客人对象(用它的 standSlot)或直接传站位序号 */
function customerRect(c) {
  const s = LAYOUT.stand;
  const slot = typeof c === 'number' ? c : (c.dispSlot != null ? c.dispSlot : 0);
  return {
    x: s.x + slot * s.slotW,
    y: s.top,
    w: s.slotW,
    h: s.baseY - s.top,
  };
}

function pickCustomerAt(x, y) {
  for (const c of run.customers) {
    if (c.state !== 'waiting') continue;
    if (pointInRect(x, y, customerRect(c))) return c;
  }
  return null;
}

/* 队形: 等位客人按顺序占 0,1,2...; 有人走了后面的滑上来; 离场的冻结在原地 */
function updateQueueSlots(dt) {
  let idx = 0;
  for (const c of run.customers) {
    if (c.state === 'waiting') {
      c.targetSlot = idx++;
    } else {
      if (c.leaveSlot == null) c.leaveSlot = c.dispSlot != null ? c.dispSlot : idx;
      c.targetSlot = c.leaveSlot;
    }
    if (c.dispSlot == null) c.dispSlot = c.targetSlot;
    c.dispSlot += (c.targetSlot - c.dispSlot) * Math.min(1, dt * 8);
  }
}

/* ---- 制作台快捷栏(营业常驻, 单列滚动列表; 与全局「总背包」浮窗并存) ---- */
const HOTBAR_GAP = 6;
function hotbarPanelArea() {
  const s = LAYOUT.backpack;
  return { x: s.x + 4, y: s.y + 38, w: s.w - 8, h: s.h - 44 };
}
function hotbarUnlockedCount() {
  let n = 0;
  for (const d of CRUSTS) if (isUnlocked(d) || backpackCount('crust', d.id) > 0) n += 1;
  for (const d of FILLINGS) if (isUnlocked(d) || backpackCount('filling', d.id) > 0) n += 1;
  return n;
}
function hotbarContentH() {
  return hotbarUnlockedCount() * (LAYOUT.backpack.itemH + HOTBAR_GAP) + 8;
}
function hotbarMaxScroll() {
  return Math.max(0, hotbarContentH() - hotbarPanelArea().h);
}
function clampHotbarScroll() {
  game.hotbarScroll = clamp(game.hotbarScroll || 0, 0, hotbarMaxScroll());
}
function hotbarBarThumb() {
  const a = hotbarPanelArea();
  const maxS = hotbarMaxScroll();
  if (maxS <= 0) return null;
  const thumbH = Math.max(28, a.h * (a.h / hotbarContentH()));
  const y = a.y + (a.h - thumbH) * ((game.hotbarScroll || 0) / maxS);
  return { x: a.x + a.w - 8, y, w: 8, h: thumbH };
}
function hotbarItems() {
  const s = LAYOUT.backpack;
  const off = game.hotbarScroll || 0;
  const defs = [];
  for (const def of CRUSTS) {
    if (isUnlocked(def) || backpackCount('crust', def.id) > 0) defs.push({ kind: 'crust', id: def.id });
  }
  for (const def of FILLINGS) {
    if (isUnlocked(def) || backpackCount('filling', def.id) > 0) defs.push({ kind: 'filling', id: def.id });
  }
  return defs.map((d, i) => ({
    kind: d.kind,
    id: d.id,
    rect: {
      x: s.x + 10,
      y: s.y + 46 + i * (s.itemH + HOTBAR_GAP) - off,
      w: s.w - 30,
      h: s.itemH,
    },
  }));
}
function hotbarItemAt(x, y) {
  if (!pointInRect(x, y, hotbarPanelArea())) return null;
  for (const it of hotbarItems()) {
    if (pointInRect(x, y, it.rect) && backpackCount(it.kind, it.id) > 0) return it;
  }
  return null;
}

/* ---- 绘制: 柜台(横贯中部, 挡住客人下半身) ---- */
function drawCounter(g) {
  const edge = LAYOUT.counterY; // 柜台前沿
  const surfaceTop = edge - 26; // 台面后沿
  const slabBot = edge + 46; // 柜台前沿立面的底

  /* 有柜台贴图: 整条只画一次, 铺满宽度(下半部分正好当制作台背景, 不再平铺)
   * BG.counterProcedural = true 时改用下面的程序化柜台(暂代美术) */
  const cimg = img('counter');
  if (cimg && BG.counterProcedural !== true) {
    const iw = cimg.naturalWidth || cimg.width;
    const ih = cimg.naturalHeight || cimg.height;
    const w = W * 1.12; // 稍微放大(两侧裁掉一点)
    const h = ih * (w / iw);
    const x = -(w - W) / 2;
    g.save();
    /* 先垫一层木色底铺到画面底, 免得下半部分(制作台下方)露出背景图 */
    const back = g.createLinearGradient(0, surfaceTop - 8, 0, H);
    back.addColorStop(0, COLORS.panelDark);
    back.addColorStop(1, '#341f16');
    g.fillStyle = back;
    g.fillRect(0, surfaceTop - 8, W, H - (surfaceTop - 8));
    g.drawImage(cimg, x, surfaceTop - 8, w, h);
    g.restore();
    return;
  }

  g.save();
  const OUT = 'rgba(96,60,31,0.5)'; // 卡通描边色

  /* 1) 地板底色: 从台面往下铺满, 免得露出星空 */
  const floor = g.createLinearGradient(0, surfaceTop - 10, 0, H);
  floor.addColorStop(0, '#a4662e');
  floor.addColorStop(0.28, '#8b5223');
  floor.addColorStop(1, '#5d3416');
  g.fillStyle = floor;
  g.fillRect(0, surfaceTop - 10, W, H - (surfaceTop - 10));

  /* 2) 柜台面上的投影(客人/物品压在台面上) */
  const shade = g.createLinearGradient(0, surfaceTop - 10, 0, edge);
  shade.addColorStop(0, 'rgba(60,30,10,0.34)');
  shade.addColorStop(1, 'rgba(60,30,10,0)');
  g.fillStyle = shade;
  g.fillRect(0, surfaceTop - 10, W, edge - (surfaceTop - 10));

  /* 3) 台面: 圆角长条, 木色, 顶亮底暗 + 顶面高光 */
  const topY = surfaceTop - 8;
  const topH = edge - topY + 16;
  const topGrd = g.createLinearGradient(0, topY, 0, topY + topH);
  topGrd.addColorStop(0, '#e8cfa2');
  topGrd.addColorStop(0.35, '#d9b17a');
  topGrd.addColorStop(1, '#b9834a');
  fillRoundRect(g, -28, topY, W + 56, topH, 18, topGrd);
  g.save();
  g.globalAlpha = 0.4; // 顶面一道高光
  fillRoundRect(g, -20, topY + 4, W + 40, 9, 6, '#fff3d6');
  g.restore();
  /* 木纹竖线(稀疏, 暗示木板拼接) */
  g.save();
  g.globalAlpha = 0.12;
  g.strokeStyle = '#6b3f1c';
  g.lineWidth = 2;
  for (let x = 60; x < W; x += 168) {
    g.beginPath();
    g.moveTo(x, topY + 6);
    g.lineTo(x, topY + topH - 4);
    g.stroke();
  }
  g.restore();

  /* 4) 前沿粗包边(琥珀金属) */
  const edgeGrd = g.createLinearGradient(0, edge - 4, 0, edge + 16);
  edgeGrd.addColorStop(0, '#f0d79a');
  edgeGrd.addColorStop(0.35, COLORS.panelBorder);
  edgeGrd.addColorStop(1, '#a76c1f');
  fillRoundRect(g, -28, edge - 4, W + 56, 20, 10, edgeGrd);
  g.save();
  g.globalAlpha = 0.45;
  fillRoundRect(g, -22, edge - 1, W + 44, 4, 2, '#fff6dd');
  g.restore();

  /* 5) 前沿立面 + 竖向木板缝 + 底部渐深 */
  const grd2 = g.createLinearGradient(0, edge + 16, 0, slabBot + 40);
  grd2.addColorStop(0, '#8a4f22');
  grd2.addColorStop(0.5, '#6f3d19');
  grd2.addColorStop(1, '#4a2811');
  g.fillStyle = grd2;
  g.fillRect(0, edge + 16, W, H - (edge + 16));
  g.save();
  g.globalAlpha = 0.3;
  g.strokeStyle = '#3a1f0d';
  g.lineWidth = 3;
  for (let x = 120; x < W; x += 240) {
    g.beginPath();
    g.moveTo(x, edge + 18);
    g.lineTo(x, H);
    g.stroke();
  }
  g.restore();
  g.save();
  g.globalAlpha = 0.25;
  g.strokeStyle = '#c08542';
  g.lineWidth = 1.5;
  for (let x = 121; x < W; x += 240) {
    g.beginPath();
    g.moveTo(x, edge + 18);
    g.lineTo(x, H);
    g.stroke();
  }
  g.restore();

  /* 6) 卡通轮廓线: 台面 + 前沿各描一圈 */
  g.save();
  g.globalAlpha = 0.5;
  strokeRoundRect(g, -28, topY, W + 56, topH, 18, OUT, 2.5);
  strokeRoundRect(g, -28, edge - 4, W + 56, 20, 10, OUT, 2);
  g.restore();
  g.restore();
}

/* ---- 绘制: 客人(柜台后的固定站位, 只露上半身, 从右侧走进来) ---- */
function drawCustomers(g) {
  for (const c of run.customers) {
    const r = customerRect(c);
    const cx = r.x + r.w / 2;
    const enterP = clamp(c.enterT, 0, 1);
    const leaveP = c.state === 'waiting' ? 0 : clamp((c.leaveT || 0) / 0.8, 0, 1);
    /* 从右侧滑入; 服务完/发怒后向右滑走 */
    const easeEnter = 1 - Math.pow(1 - enterP, 3);
    const offX = (1 - easeEnter) * 300 + leaveP * 340;
    const alpha = enterP * (1 - leaveP * leaveP);
    if (alpha <= 0.01) continue;

    g.save();
    g.globalAlpha = alpha;
    g.translate(offX, 0);

    const baseY = LAYOUT.counterY + 44; // 脚被柜台挡住
    const h = LAYOUT.stand.headH;
    const bobY = c.state === 'waiting' ? Math.sin(c.bob) * 3 : 0;
    const shakeX = c.state === 'angry' ? Math.sin(c.bob * 6) * 3 : 0;

    g.save();
    g.translate(shakeX, bobY);
    drawCustomerFigure(g, c, cx, baseY, h);
    g.restore();

    /* 订单气泡 + 独立耐心条(略加宽以容纳放大的馅料图标) */
    drawOrderBubble(g, c, r.x - 4, r.y + 6, r.w + 8);

    g.restore();
  }
}

/* 客人立绘(npc.png); 缺图时画一个人形占位(上半身) */
function drawCustomerFigure(g, c, cx, baseY, h) {
  if (drawNpc(g, c.def.npcIndex || 0, cx, baseY, h)) return;

  const headR = h * 0.2;
  const headY = baseY - h + headR;
  const special = c.def.kind === 'special';
  g.save();
  fillRoundRect(g, cx - h * 0.26, headY + headR * 0.6, h * 0.52, h, h * 0.16, special ? 'rgba(196,158,86,0.35)' : 'rgba(67,48,34,0.95)');
  g.beginPath();
  g.arc(cx, headY, headR, 0, Math.PI * 2);
  g.fillStyle = special ? COLORS.gold : COLORS.panelLight;
  g.fill();
  g.strokeStyle = special ? COLORS.goldLight : 'rgba(196,158,86,0.5)';
  g.lineWidth = special ? 3 : 2;
  g.stroke();
  g.restore();

  drawText(
    g,
    c.state === 'angry' ? '😡' : c.patienceLeft / c.patienceMax < 0.3 ? '😰' : '🙂',
    cx,
    headY,
    { size: Math.round(headR * 1.1), align: 'center' },
  );
}

/* 客人订单气泡: 名字 + 数量 + 面皮/馅料缩略 + 耐心条 */
function drawOrderBubble(g, c, x, y, w) {
  const h = 116;
  const special = c.def.kind === 'special';
  const bg = special ? 'rgba(72,51,28,0.94)' : 'rgba(35,25,18,0.94)';
  uiPanel(g, x, y, w, h, {
    r: 12,
    color: bg,
    borderColor: special ? COLORS.goldLight : 'rgba(196,158,86,0.5)',
    shadow: false,
  });

  /* 指向客人的小尖角 */
  g.save();
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(x + w / 2 - 8, y + h - 1);
  g.lineTo(x + w / 2 + 8, y + h - 1);
  g.lineTo(x + w / 2, y + h + 9);
  g.closePath();
  g.fill();
  g.restore();

  drawText(g, c.def.name, x + 10, y + 16, {
    size: 13, weight: 700, color: special ? COLORS.goldLight : COLORS.cream, maxWidth: w - 56,
  });
  drawText(g, 'x' + c.order.qty, x + w - 10, y + 16, {
    size: 13, weight: 700, align: 'right', color: COLORS.gold,
  });
  drawMiniOrder(g, c.order, x + 8, y + 26, w - 16);

  const urgency = clamp(c.patienceLeft / c.patienceMax, 0, 1);
  const col = c.state === 'angry' ? COLORS.fail : urgency > 0.5 ? COLORS.ok : urgency > 0.25 ? COLORS.warn : COLORS.fail;
  uiBar(g, x + 10, y + h - 15, w - 20, 9, urgency, col);
}

/* ---- 撒钱: 客人把结算金币撒到柜台上, 点击才入账 ---- */

/* 把某位客人的结算金币拆成若干枚散落到柜台台面 */
function spawnMoneyForCustomer(customer, total) {
  const r = customerRect(customer);
  const cx = r.x + r.w / 2;
  const originY = LAYOUT.counterY - 96;
  const n = Math.max(1, randInt(MONEY.perCustomer[0], MONEY.perCustomer[1]));
  let left = Math.max(0, Math.round(total));
  for (let i = 0; i < n; i++) {
    const value = i === n - 1 ? left : Math.round(total / n);
    left -= value;
    run.money.push({
      x: cx + rand(-34, 34),
      y: originY + rand(-14, 14),
      vx: rand(MONEY.scatterVx[0], MONEY.scatterVx[1]),
      vy: rand(MONEY.scatterVy[0], MONEY.scatterVy[1]),
      value: Math.max(0, value),
      life: MONEY.life,
      rest: false,
      spin: Math.random() * Math.PI * 2,
    });
  }
}

function moneyRestY() {
  return LAYOUT.counterY - MONEY.restAboveCounter;
}

function updateMoney(dt) {
  const restY = moneyRestY();
  for (let i = run.money.length - 1; i >= 0; i--) {
    const m = run.money[i];
    m.life -= dt;
    m.spin += dt * 5;
    if (m.life <= 0) {
      run.money.splice(i, 1);
      continue;
    }
    if (m.rest) continue;
    m.vy += MONEY.gravity * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x < 60) { m.x = 60; m.vx = Math.abs(m.vx) * 0.5; }
    if (m.x > W - 60) { m.x = W - 60; m.vx = -Math.abs(m.vx) * 0.5; }
    if (m.y >= restY && m.vy > 0) {
      m.y = restY;
      m.vx *= 0.6;
      m.vy = -m.vy * MONEY.bounce;
      if (Math.abs(m.vy) < 70) {
        m.vy = 0;
        m.vx = 0;
        m.rest = true;
      }
    }
  }
}

function drawMoney(g) {
  const coinImg = img('ui_coin');
  for (const m of run.money) {
    g.save();
    if (m.life <= MONEY.blinkAt) {
      g.globalAlpha = Math.floor(m.life * 8) % 2 === 0 ? 0.25 : 0.95;
    }
    if (m.rest) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.ellipse(m.x, m.y + 15, 17, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    const spin = 0.4 + 0.6 * Math.abs(Math.sin(m.spin));
    const w = 34 * spin;
    if (coinImg) {
      g.drawImage(coinImg, m.x - w / 2, m.y - 17, w, 34);
    } else {
      g.fillStyle = COLORS.gold;
      g.beginPath();
      g.ellipse(m.x, m.y, w / 2, 17, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = COLORS.goldLight;
      g.lineWidth = 2;
      g.stroke();
      drawText(g, '¥', m.x, m.y, { size: 15, weight: 700, align: 'center', color: '#50391c' });
    }
    g.restore();
  }
}

/* 命中最近的一枚金币(拾取半径内) */
function pickMoneyAt(x, y) {
  const radius = MONEY.pickupRadius + (touching() ? MONEY.touchExtra : 0);
  let best = null;
  let bestD = Infinity;
  for (const m of run.money) {
    const d = dist(x, y, m.x, m.y);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function collectMoney(coin) {
  const i = run.money.indexOf(coin);
  if (i < 0) return;
  run.money.splice(i, 1);
  shop.coins += coin.value;
  shop.stats.totalCoins += coin.value;
  addFloater('+' + coin.value, coin.x, coin.y - 18, COLORS.gold, 0.9);
  SFX.coin();
}

/* 按住指针扫过: 收掉范围内所有金币, 返回收集数 */
function collectMoneyAround(x, y) {
  const radius = MONEY.pickupRadius + (touching() ? MONEY.touchExtra : 0);
  let n = 0;
  for (let i = run.money.length - 1; i >= 0; i--) {
    const m = run.money[i];
    if (dist(x, y, m.x, m.y) <= radius) {
      collectMoney(m);
      n += 1;
    }
  }
  return n;
}

/* ---- 收银小车(柜台升级解锁): 在柜台上来回移动, 自动捡起沿途金币 ---- */
function updateCart(dt) {
  const lv = counterLevel('cart');
  if (lv <= 0) return;
  if (!run.cart) run.cart = { x: W / 2, dir: 1 };

  const speed = COUNTER.cart.speed[Math.min(lv, COUNTER.cart.speed.length) - 1];
  const minX = 90;
  const maxX = W - 90;
  run.cart.x += run.cart.dir * speed * dt;
  if (run.cart.x <= minX) {
    run.cart.x = minX;
    run.cart.dir = 1;
  } else if (run.cart.x >= maxX) {
    run.cart.x = maxX;
    run.cart.dir = -1;
  }

  /* 自动捡起落地的金币 */
  const radius = COUNTER.cart.radius[Math.min(lv, COUNTER.cart.radius.length) - 1];
  const cy = moneyRestY();
  for (let i = run.money.length - 1; i >= 0; i--) {
    const m = run.money[i];
    if (!m.rest) continue;
    if (dist(run.cart.x, cy, m.x, m.y) <= radius) collectMoney(m);
  }
}

function drawCart(g) {
  if (counterLevel('cart') <= 0 || !run.cart) return;
  const coinImg = img('ui_coin');
  g.save();
  g.translate(run.cart.x, moneyRestY());
  /* 影子 */
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(0, 16, 26, 7, 0, 0, Math.PI * 2);
  g.fill();
  /* 轮子 */
  g.fillStyle = '#20150d';
  g.beginPath();
  g.arc(-13, 7, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(13, 7, 6, 0, Math.PI * 2);
  g.fill();
  /* 车身 */
  fillRoundRect(g, -24, -24, 48, 30, 8, '#7e5b3e');
  fillRoundRect(g, -20, -20, 40, 12, 5, '#b78a5d');
  /* 车上的硬币堆 */
  for (let i = 0; i < 3; i++) {
    const cx = -8 + i * 8;
    const cy = -28 - (i % 2) * 3;
    if (coinImg) {
      g.drawImage(coinImg, cx - 7, cy - 7, 14, 14);
    } else {
      g.fillStyle = COLORS.gold;
      g.beginPath();
      g.arc(cx, cy, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/* 客人订单(文字): 皮 + 馅 */
function drawOrderText(g, order, x, y, w) {
  const crust = findCrustDef(order.crustId);
  drawText(g, '皮:' + (crust ? crust.name : order.crustId), x, y + 8, {
    size: 13, weight: 600, color: COLORS.goldLight, maxWidth: w,
  });
  const parts = [];
  for (const f of order.fillings) {
    const fd = findFillingDef(f);
    parts.push(fd ? fd.name : f);
  }
  wrapText(g, '馅:' + parts.join('·'), x, y + 24, w, 16, { size: 12, color: COLORS.cream });
}

/* 订单缩略: 饼皮色块 + 馅料图标 */
function drawMiniOrder(g, order, x, y, w) {
  const iconSize = 64; // 馅料图标放大(原来 32)
  const cy = y + iconSize / 2;
  const crust = findCrustDef(order.crustId);
  g.fillStyle = crust ? crust.color : COLORS.crust;
  g.beginPath();
  g.arc(x + 16, cy, 14, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.stroke();

  const n = order.fillings.length;
  const step = n > 0 ? Math.min(iconSize, (w - 52) / n) : iconSize;
  for (let i = 0; i < n; i++) {
    const ix = x + 34 + i * step + iconSize / 2;
    if (!drawFillingIcon(g, fillingIndexOf(order.fillings[i]), ix, cy, iconSize)) {
      const f = findFillingDef(order.fillings[i]);
      g.fillStyle = f ? f.color : COLORS.cream;
      g.beginPath();
      g.arc(ix, cy, 20, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/* ---- 绘制: 快捷背包栏(营业常驻, 大行滚动列表) ---- */
function drawHotbar(g) {
  const s = LAYOUT.backpack;
  uiPanel(g, s.x, s.y, s.w, s.h, { r: 14 });
  drawText(g, '快捷栏 · 拖动取用', s.x + 14, s.y + 24, { size: 16, weight: 700, color: COLORS.panelTitle });

  clampHotbarScroll();
  const a = hotbarPanelArea();
  g.save();
  g.beginPath();
  g.rect(a.x, a.y, a.w, a.h);
  g.clip();

  const items = hotbarItems();
  if (!items.length) {
    drawText(g, '背包空：点下方「背包」按钮', s.x + 14, s.y + 78, { size: 13, color: COLORS.textDim });
  }
  for (const it of items) {
    const r = it.rect;
    if (r.y + r.h < a.y || r.y > a.y + a.h) continue;
    const cnt = backpackCount(it.kind, it.id);
    const def = it.kind === 'crust' ? findCrustDef(it.id) : findFillingDef(it.id);
    const empty = cnt <= 0;
    const cy = r.y + r.h / 2;

    g.save();
    g.globalAlpha = empty ? 0.45 : 1;
    fillRoundRect(g, r.x, r.y, r.w, r.h, 10, empty ? '#e7dac0' : COLORS.panelLight);

    let drew = false;
    if (it.kind === 'crust') drew = drawCrustPart(g, def.col, 'raw', r.x + 8, cy - 22, 44, 44);
    else drew = drawFillingIcon(g, def.index, r.x + 32, cy, 52);
    if (!drew) {
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(r.x + 30, cy, 18, 0, Math.PI * 2);
      g.fill();
    }

    drawText(g, def.name, r.x + 62, cy - 8, {
      size: 16, weight: 600, color: COLORS.panelInk, maxWidth: r.w - 120,
    });
    drawText(g, '售价 💰' + (def.value || 0), r.x + 62, cy + 14, {
      size: 12, weight: 600, color: COLORS.gold,
    });
    drawText(g, 'x' + Math.floor(cnt), r.x + r.w - 10, cy, {
      size: 18, weight: 700, align: 'right', color: empty ? COLORS.fail : COLORS.gold,
    });
    g.restore();
  }
  g.restore();

  const thumb = hotbarBarThumb();
  if (thumb) {
    fillRoundRect(g, a.x + a.w - 8, a.y, 8, a.h, 4, 'rgba(19,16,13,0.5)');
    fillRoundRect(g, thumb.x, thumb.y, thumb.w, thumb.h, 4, 'rgba(196,158,86,0.75)');
  }
}

/* ---- 绘制: 制作台 ---- */
function drawBench(g) {
  const b = LAYOUT.bench;
  uiPanel(g, b.x, b.y, b.w, b.h, { r: 14 });
  drawText(g, '制作台（拖面皮 → 拖馅料叠加）', b.x + 14, b.y + 24, { size: 15, weight: 700, color: COLORS.panelTitle });

  run.slots.forEach((slot, i) => {
    const r = slotRect(i);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 + 10;

    fillRoundRect(g, r.x + 6, r.y + 40, r.w - 12, r.h - 52, 12, 'rgba(181,148,103,0.22)');
    drawSlotMoon(g, slot, cx, cy, 64);

    /* 层数/完成度提示 */
    if (slot.crustId) {
      drawText(g, slot.fillings.length + ' 层馅', cx, r.y + r.h - 12, {
        size: 12,
        align: 'center',
        color: slotReady(slot) ? COLORS.ok : COLORS.textDim,
      });
    }
  });
}

/* ---- 绘制: 烤炉 ---- */
function drawOven(g) {
  const o = LAYOUT.oven;
  uiPanel(g, o.x, o.y, o.w, o.h, { r: 14 });
  drawText(g, '烤炉（拖入烘烤 · 滚轮滚动）', o.x + 14, o.y + 26, { size: 15, weight: 700, color: COLORS.panelTitle });

  clampOvenScroll();
  const area = ovenPanelArea();
  g.save();
  g.beginPath();
  g.rect(area.x, area.y, area.w, area.h);
  g.clip();

  for (let i = 0; i < run.oven.length; i++) {
    const os = run.oven[i];
    const r = ovenRect(i);
    if (r.y + r.h < area.y || r.y > area.y + area.h) continue;

    const done = ovenDone(os);
    const burnt = ovenBurnt(os);
    const border = burnt ? COLORS.fail : done ? COLORS.ok : os.state === 'baking' ? COLORS.warn : 'rgba(196,158,86,0.3)';
    fillRoundRect(g, r.x, r.y, r.w, r.h, 10, '#ecddc0');
    strokeRoundRect(g, r.x, r.y, r.w, r.h, 10, border, 2);

    if (os.state === 'baking' && os.moon) {
      /* 月饼小图(包好成品) + 馅料气泡 */
      const cx = r.x + 44;
      const cy = r.y + r.h / 2;
      const oc = findCrustDef(os.moon.crustId);
      if (!drawCrustPart(g, oc ? oc.col : 0, 'done', cx - 26, cy - 26, 52, 52)) {
        drawSprite(g, 'ui_plate', cx - 26, cy - 26, 52, 52, COLORS.crust);
      }
      drawFillingBubble(g, os.moon.fillings, cx, cy - 26, 26);

      /* 进度条(右端留出升级 ⬆ 的位置) */
      const ratio = clamp(os.bake / ovenBakeTime(), 0, 1);
      uiBar(g, r.x + 84, r.y + 24, r.w - 140, 12, ratio, burnt ? COLORS.fail : done ? COLORS.ok : COLORS.warn);
      drawText(g, burnt ? '烤糊了！' : done ? '✔ 可以出了' : BAKE_NAME[bakeGrade(os.bake)], r.x + 84, r.y + 58, {
        size: 13,
        color: burnt ? COLORS.fail : done ? COLORS.ok : COLORS.textDim,
      });
    } else {
      drawText(g, '空烤位', r.x + r.w / 2, r.y + r.h / 2, { size: 14, align: 'center', color: COLORS.textDim });
    }
  }

  g.restore();

  if (!run.oven.length) {
    drawText(g, '还没有烤位', o.x + o.w / 2, o.y + o.h / 2, { size: 14, align: 'center', color: COLORS.textDim });
  }

  /* 滚动条 */
  const maxS = ovenMaxScroll();
  if (maxS > 0) {
    const thumbH = Math.max(28, area.h * (area.h / ovenContentH()));
    const ty = area.y + (area.h - thumbH) * ((game.ovenScroll || 0) / maxS);
    fillRoundRect(g, area.x + area.w - 7, area.y, 7, area.h, 4, 'rgba(19,16,13,0.5)');
    fillRoundRect(g, area.x + area.w - 7, ty, 7, thumbH, 4, 'rgba(196,158,86,0.75)');
  }
}

/* ---- 工厂面板几何(绘制与命中共用, 避免漂移) ----
 * 面板布局(1180x560, 内边距 20):
 *   左列 x:20  w:320  工厂列表
 *   中列 x:356 w:480  槽位 + 开槽 + 取货
 *   右列 x:852 w:308  组件背包(上半) + 购买(下半) + 烤位
 */

function factoryPanelRect() {
  const pw = 1180;
  const ph = 560;
  return { x: (W - pw) / 2, y: 92, w: pw, h: ph };
}
function closeFactoryRect() {
  const p = factoryPanelRect();
  return { x: p.x + p.w - 116, y: p.y + 18, w: 92, h: 42 };
}

/* 已上场工厂的 kind */
function unitKind(u) {
  const d = findFactoryDef(u.factoryId);
  return d ? d.kind : 'crust';
}
function crustUnitCount() {
  let n = 0;
  for (const uid in shop.units) {
    if (unitKind(shop.units[uid]) === 'crust') n += 1;
  }
  return n;
}

/* 左列: 已上场工厂的列表(2 列排布, 按饼皮/馅料分组, 组间留标题位)
 * 返回该工厂的矩形(绘制与命中共用), index 是 factoryListOrder() 的下标 */
function factoryListItemRect(index) {
  const p = factoryPanelRect();
  const colW = 158;
  const itemH = 38;
  const gap = 6;
  const crustCount = crustUnitCount();
  const crustRows = Math.ceil(crustCount / 2);
  const headerH = 20; // 分组标题高度

  const isCrust = index < crustCount;
  const col = index % 2;
  const row = Math.floor(index / 2);
  /* 馅料组整体下移: 饼皮行数 + 一个标题 */
  const yOffset = isCrust ? 0 : crustRows * (itemH + gap) + headerH;

  return {
    x: p.x + 20 + col * (colW + 6),
    y: p.y + 104 + yOffset + row * (itemH + gap),
    w: colW,
    h: itemH,
  };
}
/* 有序的已上场工厂 uid 列表(饼皮在前, 馅料在后) */
function factoryListOrder() {
  const crusts = [];
  const fillings = [];
  for (const uid in shop.units) {
    (unitKind(shop.units[uid]) === 'crust' ? crusts : fillings).push(uid);
  }
  return crusts.concat(fillings);
}

/* 中列: 槽位格 (最多 4 个一行) */
function slotBoxRect(i) {
  const p = factoryPanelRect();
  const bx = p.x + 356;
  const by = p.y + 152;
  const bw = 108;
  const bh = 92;
  const col = i % 4;
  return { x: bx + col * (bw + 8), y: by, w: bw, h: bh };
}
/* 中列: 开槽按钮 */
function buySlotRect() {
  const p = factoryPanelRect();
  return { x: p.x + 356, y: p.y + 300, w: 232, h: 50 };
}
/* 中列: 取货按钮 */
function panelFetchRect() {
  const p = factoryPanelRect();
  return { x: p.x + 356, y: p.y + 362, w: 232, h: 50 };
}
/* 中列: 组装效果说明区 */
function statsBoxRect() {
  const p = factoryPanelRect();
  return { x: p.x + 356, y: p.y + 424, w: 478, h: 104 };
}

/* 右列: 组件背包格 (2 列, 最多 3 行 = 6 个) */
function componentBoxRect(i) {
  const p = factoryPanelRect();
  const bx = p.x + 852;
  const by = p.y + 132;
  const bw = 150;
  const bh = 50;
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { x: bx + col * (bw + 8), y: by + row * (bh + 6), w: bw, h: bh };
}
/* 右列: 购买列表项 (最多 5 项) */
function buyCompRect(i) {
  const p = factoryPanelRect();
  return { x: p.x + 852, y: p.y + 356 + i * 34, w: 308, h: 30 };
}

/* ---- 绘制: 工厂面板(半透明, 不暂停) ---- */
function drawFactoryPanel(g) {
  const p = factoryPanelRect();
  const px = p.x;
  const py = p.y;

  g.save();
  g.fillStyle = 'rgba(9,8,7,0.4)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, px, py, p.w, p.h, { r: 20, color: COLORS.panelLight });

  drawText(g, '工厂 · 槽位与组件（营业继续中，客人还在等）', px + 24, py + 32, {
    size: 20, weight: 700, color: COLORS.panelTitle,
  });
  drawText(g, '开槽 → 装组件 → 升级组件　|　Esc / 关闭按钮 退出', px + 24, py + 58, {
    size: 13, color: COLORS.textDim,
  });
  const cr = closeFactoryRect();
  uiButton(g, Object.assign({ id: 'closeFactory', label: '关闭', size: 14, accent: COLORS.textDim }, cr));

  drawFactoryList(g);
  drawSelectedFactory(g);
  drawComponentBag(g);
}

/* 左列: 工厂列表(2 列, 按饼皮/馅料分组) */
function drawFactoryList(g) {
  const p = factoryPanelRect();
  const ids = factoryListOrder();
  if (!ids.length) {
    game.factorySel = null;
    drawText(g, '还没有工厂上场', p.x + 20, p.y + 120, { size: 13, color: COLORS.textDim });
    drawText(g, '去「工厂管理」把工厂拖到网格上', p.x + 20, p.y + 144, { size: 11, color: COLORS.textDim });
    return;
  }
  const sel = shop.units[game.factorySel] ? game.factorySel : ids[0];
  game.factorySel = sel;

  drawText(g, '已上场工厂', p.x + 20, p.y + 84, { size: 13, weight: 600, color: COLORS.textDim });

  /* 分组标题: 饼皮 / 馅料 */
  const crustCount = crustUnitCount();
  if (crustCount > 0) {
    drawText(g, '饼皮', p.x + 20, factoryListItemRect(0).y - 9, { size: 11, weight: 700, color: COLORS.panelTitle });
  }
  if (crustCount < ids.length) {
    const fr0 = factoryListItemRect(crustCount);
    drawText(g, '馅料', p.x + 20, fr0.y - 9, { size: 11, weight: 700, color: COLORS.panelTitle });
    g.strokeStyle = 'rgba(196,158,86,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(p.x + 20, fr0.y - 16);
    g.lineTo(p.x + 20 + 158 * 2 + 6, fr0.y - 16);
    g.stroke();
  }

  const powered = poweredUnitIds();
  ids.forEach((uid, i) => {
    const u = shop.units[uid];
    if (!u) return;
    const def = findFactoryDef(u.factoryId);
    const product = unitKind(u) === 'crust' ? findCrustDef(keyProductId(u)) : findFillingDef(keyProductId(u));
    const productOk = !product || isUnlocked(product);
    const on = !!powered[uid];
    const r = factoryListItemRect(i);
    const active = uid === sel;

    fillRoundRect(g, r.x, r.y, r.w, r.h, 8, active ? 'rgba(196,158,86,0.22)' : COLORS.panelInner);
    if (active) strokeRoundRect(g, r.x, r.y, r.w, r.h, 8, COLORS.gold, 2);

    g.fillStyle = product ? product.color : COLORS.panelInk;
    g.beginPath();
    g.arc(r.x + 13, r.y + r.h / 2, 6, 0, Math.PI * 2);
    g.fill();

    drawText(g, (def ? def.name : u.factoryId) + (on ? '' : ' ⚡断'), r.x + 24, r.y + 13, {
      size: 11, weight: 600, color: on ? (productOk ? COLORS.panelInk : COLORS.textDim) : COLORS.textDim, maxWidth: r.w - 30,
    });
    drawText(g, u.slots.length + '槽 ' + Math.floor(u.stock) + '份' + (productOk ? '' : ' 🔒'),
      r.x + 24, r.y + 28,
      { size: 10, color: productOk ? COLORS.textDim : COLORS.warn });
  });
}

/* 工厂产出的食材 id */
function keyProductId(u) {
  const d = findFactoryDef(u.factoryId);
  return d ? d.productId : '';
}

/* 中列: 选中工厂的槽位与操作 */
function drawSelectedFactory(g) {
  const p = factoryPanelRect();
  const sel = game.factorySel;
  const u = shop.units[sel];
  if (!u) return;
  const def = findFactoryDef(u.factoryId);
  const product = unitKind(u) === 'crust' ? findCrustDef(keyProductId(u)) : findFillingDef(keyProductId(u));
  const productOk = !product || isUnlocked(product);
  const on = isUnitPowered(u.uid);

  const cx = p.x + 356;

  drawText(g, (def ? def.name : u.factoryId) + (on ? ' ⚡' : ' ⚡断'), cx, p.y + 80, {
    size: 17, weight: 700, color: on ? COLORS.panelTitle : COLORS.textDim,
  });
  drawText(g, '速度 ' + u.speed.toFixed(1) + '/s　品质 ' + u.quality.toFixed(1) + '　上限 ' + u.capacity,
    cx, p.y + 104, { size: 12, color: COLORS.textDim });

  /* 食材解锁状态 */
  if (product && product.unlock) {
    drawText(g, productOk ? '✔ ' + product.name + ' 已解锁' : '🔒 ' + unlockLabel(product),
      cx + 478, p.y + 80, { size: 12, weight: 600, align: 'right', color: productOk ? COLORS.ok : COLORS.warn });
  }

  /* 槽位格 */
  drawText(g, '槽位（从右侧拖组件到空格 · 点已装可升级/卸下）', cx, p.y + 138, {
    size: 12, weight: 600, color: COLORS.textDim,
  });
  u.slots.forEach((slot, i) => {
    const r = slotBoxRect(i);
    if (slot) {
      const cd = findComponentDef(slot.compId);
      fillRoundRect(g, r.x, r.y, r.w, r.h, 10, 'rgba(55,41,29,0.95)');
      strokeRoundRect(g, r.x, r.y, r.w, r.h, 10, cd && cd.type === 'special' ? COLORS.goldLight : COLORS.gold, 2);
      drawSprite(g, cd ? cd.icon : 'icon_unlock', r.x + r.w / 2 - 18, r.y + 10, 36, 36);
      drawText(g, cd ? cd.name : '?', r.x + r.w / 2, r.y + 58, { size: 12, weight: 600, align: 'center', color: COLORS.panelInk });
      drawText(g, 'Lv.' + slot.level, r.x + r.w / 2, r.y + 76, { size: 11, align: 'center', color: COLORS.gold });
    } else {
      fillRoundRect(g, r.x, r.y, r.w, r.h, 10, COLORS.panelInner);
      g.save();
      g.strokeStyle = 'rgba(171,153,128,0.45)';
      g.setLineDash([6, 6]);
      roundRect(g, r.x, r.y, r.w, r.h, 10);
      g.stroke();
      g.restore();
      drawText(g, '空槽', r.x + r.w / 2, r.y + r.h / 2, { size: 12, align: 'center', color: COLORS.textDim });
    }
  });

  /* 开槽按钮 */
  const br = buySlotRect();
  if (u.slots.length < MAX_SLOTS) {
    const cost = slotCost(u.slots.length);
    const afford = shop.coins >= cost;
    uiButton(g, Object.assign({
      id: 'buySlot', label: '开新槽位', sublabel: '💰' + formatNum(cost),
      size: 14, accent: afford ? COLORS.gold : COLORS.textDim, disabled: !afford,
    }, br));
    game.buttons.push(Object.assign({ id: 'buySlot', disabled: !afford }, br));
  } else {
    uiPanel(g, br.x, br.y, br.w, br.h, { r: 10, shadow: false });
    drawText(g, '槽位已满（' + MAX_SLOTS + '）', br.x + br.w / 2, br.y + br.h / 2, {
      size: 13, align: 'center', color: COLORS.textDim,
    });
  }

  /* 取货按钮 */
  const fr = panelFetchRect();
  const canFetch = u.stock >= 1;
  uiButton(g, Object.assign({
    id: 'fetch', label: '取货到原料架', sublabel: '库存 ' + Math.floor(u.stock) + ' 份',
    size: 14, accent: canFetch ? COLORS.ok : COLORS.textDim, disabled: !canFetch,
  }, fr));

  /* 组装效果汇总 + 烤位 */
  const sb = statsBoxRect();
  uiPanel(g, sb.x, sb.y, sb.w, sb.h, { r: 10, shadow: false });
  drawText(g, '组装效果', sb.x + 12, sb.y + 18, { size: 13, weight: 600, color: COLORS.panelTitle });
  const effects = collectFactoryEffects(u);
  drawText(g, effects || '（空槽）', sb.x + 12, sb.y + 42, {
    size: 11, color: effects ? COLORS.panelInk : COLORS.textDim, maxWidth: sb.w - 200,
  });
  /* 烤位在右下角小按钮 */
  const ups = upgradesFor('oven');
  const nextUp = ups.find((up, i) => (shop.ovenLevel || 1) === OVEN.slots + i);
  if (nextUp) {
    const afford = shop.coins >= nextUp.cost;
    const r = { x: sb.x + sb.w - 176, y: sb.y + sb.h - 40, w: 164, h: 30 };
    uiButton(g, Object.assign({
      id: 'ovenUpgrade', value: nextUp.id, label: '烤位 ' + run.oven.length + '→' + (run.oven.length + 1),
      sublabel: '💰' + formatNum(nextUp.cost), size: 12,
      accent: afford ? COLORS.gold : COLORS.textDim, disabled: !afford,
    }, r));
    game.buttons.push(Object.assign({ id: 'ovenUpgrade', value: nextUp.id, disabled: !afford }, r));
  } else {
    drawText(g, '烤位已满（' + OVEN.maxSlots + '）', sb.x + sb.w - 12, sb.y + sb.h - 24, {
      size: 11, align: 'right', color: COLORS.textDim,
    });
  }
}

/* 汇总工厂组件提供的效果文案 */
function collectFactoryEffects(rt) {
  const parts = [];
  const speed = [];
  const quality = [];
  const unlocks = [];
  for (const slot of rt.slots) {
    if (!slot) continue;
    const cd = findComponentDef(slot.compId);
    if (!cd) continue;
    const e = cd.effect;
    if (e.speed) speed.push(cd.name + '+' + (e.speed * slot.level).toFixed(1));
    if (e.quality) quality.push(cd.name + '+' + (e.quality * slot.level).toFixed(1));
    if (e.unlock) unlocks.push(cd.name);
  }
  if (speed.length) parts.push('速度：' + speed.join(' '));
  if (quality.length) parts.push('品质：' + quality.join(' '));
  if (unlocks.length) parts.push('解锁：' + unlocks.join(' '));
  return parts.join('　');
}

/* 右列: 组件背包 + 购买 */
function drawComponentBag(g) {
  const p = factoryPanelRect();
  const bx = p.x + 852;

  /* 背包 */
  drawText(g, '组件背包（拖到左侧空槽）', bx, p.y + 104, { size: 13, weight: 600, color: COLORS.textDim });
  const owned = Object.keys(shop.components).filter((id) => shop.components[id] > 0);
  if (!owned.length) {
    drawText(g, '背包为空，去下方购买', bx + 4, p.y + 158, { size: 12, color: COLORS.textDim });
  }
  owned.slice(0, 6).forEach((compId, i) => {
    const cd = findComponentDef(compId);
    if (!cd) return;
    const r = componentBoxRect(i);
    const dragging = game.drag && game.drag.kind === DRAG.COMPONENT && game.drag.compId === compId;
    g.save();
    g.globalAlpha = dragging ? 0.4 : 1;
    fillRoundRect(g, r.x, r.y, r.w, r.h, 8, 'rgba(46,33,24,0.9)');
    strokeRoundRect(g, r.x, r.y, r.w, r.h, 8, cd.type === 'special' ? COLORS.goldLight : 'rgba(196,158,86,0.4)', 1.5);
    drawSprite(g, cd.icon, r.x + 6, r.y + 8, 34, 34);
    drawText(g, cd.name, r.x + 46, r.y + 18, { size: 11, weight: 600, color: COLORS.panelInk, maxWidth: 80 });
    if (cd.factoryId) {
      drawText(g, '专属', r.x + 46, r.y + 34, { size: 9, color: COLORS.warn });
    }
    drawText(g, 'x' + shop.components[compId], r.x + r.w - 8, r.y + 34, {
      size: 11, align: 'right', color: COLORS.gold,
    });
    g.restore();
  });
  if (owned.length > 6) {
    drawText(g, '共 ' + owned.length + ' 种（仅显示前 6）', bx, p.y + 300, { size: 10, color: COLORS.textDim });
  }

  /* 购买 */
  drawText(g, '购买组件', bx, p.y + 336, { size: 13, weight: 600, color: COLORS.panelTitle });
  const buyable = COMPONENT_TYPES.filter((c) => c.buyable).slice(0, 5);
  buyable.forEach((cd, i) => {
    const r = buyCompRect(i);
    const afford = shop.coins >= cd.cost;
    fillRoundRect(g, r.x, r.y, r.w, r.h, 8, afford ? 'rgba(55,41,29,0.9)' : '#e9dac3');
    drawText(g, cd.name, r.x + 10, r.y + r.h / 2, { size: 12, weight: 600, color: COLORS.panelInk });
    drawText(g, '💰' + cd.cost, r.x + r.w - 10, r.y + r.h / 2, {
      size: 12, weight: 600, align: 'right', color: afford ? COLORS.gold : COLORS.fail,
    });
    game.buttons.push({ id: 'buyComp', value: cd.id, x: r.x, y: r.y, w: r.w, h: r.h, label: '', disabled: !afford });
  });
}

/* 工厂面板命中: 取货 */
function pickFactoryFetch(x, y) {
  const sel = game.factorySel;
  if (sel && pointInRect(x, y, panelFetchRect())) return sel;
  return null;
}

/* 命中: 购买项 -> 返回组件 id */
function pickBuyComp(x, y) {
  const buyable = COMPONENT_TYPES.filter((c) => c.buyable).slice(0, 5);
  for (let i = 0; i < buyable.length; i++) {
    if (pointInRect(x, y, buyCompRect(i))) return buyable[i].id;
  }
  return null;
}

/* 命中: 工厂列表项 -> 返回 fid */
function pickFactoryListItem(x, y) {
  const ids = factoryListOrder();
  for (let i = 0; i < ids.length; i++) {
    if (pointInRect(x, y, factoryListItemRect(i))) return ids[i];
  }
  return null;
}

/* 命中: 槽位 -> 返回 index, 或 -1 */
function pickSlotIndex(x, y) {
  const sel = game.factorySel;
  const u = shop.units[sel];
  if (!u) return -1;
  for (let i = 0; i < u.slots.length; i++) {
    if (pointInRect(x, y, slotBoxRect(i))) return i;
  }
  return -1;
}

/* 命中: 组件背包项 -> 返回 compId */
function pickComponentBagItem(x, y) {
  const owned = Object.keys(shop.components).filter((id) => shop.components[id] > 0);
  for (let i = 0; i < owned.length; i++) {
    if (pointInRect(x, y, componentBoxRect(i))) return owned[i];
  }
  return null;
}

/* ---- 绘制: 拖拽跟随 ---- */
function drawDragGhost(g, drag) {
  g.save();
  g.globalAlpha = 0.9;
  if (drag.kind === DRAG.CRUST) {
    const cd = findCrustDef(drag.productId);
    if (!drawCrustPart(g, cd ? cd.col : 0, 'raw', drag.x - 40, drag.y - 40, 80, 80)) {
      drawSprite(g, 'ui_plate', drag.x - 40, drag.y - 40, 80, 80, COLORS.crust);
    }
  } else if (drag.kind === DRAG.FILLING) {
    const fi = fillingIndexOf(drag.productId);
    if (!drawFillingIcon(g, fi, drag.x, drag.y, 56)) {
      const f = findFillingDef(drag.productId);
      g.fillStyle = f ? f.color : COLORS.cream;
      g.beginPath();
      g.arc(drag.x, drag.y, 26, 0, Math.PI * 2);
      g.fill();
    }
  } else if (drag.kind === DRAG.SLOT) {
    const slot = run.slots[drag.index];
    if (slot) drawSlotMoon(g, slot, drag.x, drag.y, 46);
  } else if (drag.kind === DRAG.OVEN) {
    const os = run.oven[drag.index];
    if (os && os.moon) {
      const oc = findCrustDef(os.moon.crustId);
      drawCrustPart(g, oc ? oc.col : 0, 'done', drag.x - 34, drag.y - 34, 68, 68);
      drawFillingBubble(g, os.moon.fillings, drag.x, drag.y - 34, 34);
    }
  } else if (drag.kind === DRAG.COMPONENT) {
    const cd = findComponentDef(drag.compId);
    /* 图标跟随 + 高亮可落槽位 */
    drawSprite(g, cd ? cd.icon : 'icon_unlock', drag.x - 26, drag.y - 26, 52, 52);
    const rt = shop.units[game.factorySel];
    if (rt) {
      rt.slots.forEach((slot, i) => {
        if (slot) return;
        const r = slotBoxRect(i);
        g.save();
        g.globalAlpha = 0.5 + Math.sin(performance.now() / 200) * 0.25;
        g.strokeStyle = COLORS.ok;
        g.lineWidth = 3;
        g.setLineDash([7, 6]);
        roundRect(g, r.x, r.y, r.w, r.h, 10);
        g.stroke();
        g.setLineDash([]);
        g.restore();
      });
    }
  }
  g.restore();
}

/* 出餐结果飘字 */
function drawServeResult(g, res) {
  const x = W / 2;
  const y = 300;
  g.save();
  g.globalAlpha = Math.min(1, game.resultT / 0.4);
  const fx = res.perfect || res.stars >= 3 ? 'fx_success' : res.stars <= 1 ? 'fx_fail' : null;
  if (fx && img(fx)) g.drawImage(img(fx), x - 140, y - 190, 280, 280);
  uiPanel(g, x - 160, y - 60, 320, 120, { r: 16 });
  drawText(g, res.perfect ? '完美！' : res.stars >= 3 ? '不错！' : '一般', x, y - 24, {
    size: 24, weight: 700, align: 'center', color: res.perfect ? COLORS.ok : COLORS.goldLight,
  });
  drawText(g, '★'.repeat(res.stars) + '☆'.repeat(5 - res.stars), x, y + 8, {
    size: 20, align: 'center', color: COLORS.gold,
  });
  drawText(g, '+' + formatNum(res.coins), x, y + 40, { size: 22, weight: 700, align: 'center', color: COLORS.gold });
  g.restore();
}

/* 提示文字 */
function hintText() {
  if (!run.customers.length) return '等待客人进店…';
  return '拖面皮到托盘 → 拖馅料叠加 → 拖到烤炉 → 拖给客人';
}

/* ---- 日终界面几何 ---- */
function dayEndButtonRect() {
  return { x: W / 2 - 150, y: 470, w: 300, h: 62 };
}

/* ---- 日终结算 ---- */
function drawDayEnd(g) {
  g.save();
  g.fillStyle = 'rgba(9,8,7,0.8)';
  g.fillRect(0, 0, W, H);
  g.restore();

  uiPanel(g, W / 2 - 280, 150, 560, 400, { r: 20 });
  drawText(g, '第 ' + shop.day + ' 天 营业结束', W / 2, 200, { size: 28, weight: 700, align: 'center', color: COLORS.panelTitle });

  const rows = [
    ['服务客人', run.dayServed + ' 位'],
    ['流失客人', run.dayLost + ' 位'],
    ['累计口碑', shop.reputation],
    ['当前金币', formatNum(shop.coins)],
  ];
  rows.forEach((r, i) => {
    const ry = 260 + i * 44;
    drawText(g, r[0], W / 2 - 220, ry, { size: 17, color: COLORS.textDim });
    drawText(g, r[1], W / 2 + 220, ry, { size: 19, weight: 700, align: 'right', color: COLORS.panelInk });
  });

  const r = dayEndButtonRect();
  uiButton(g, Object.assign({
    id: 'nextDay', label: '回到店门口', sublabel: '准备第 ' + (shop.day + 1) + ' 天', size: 20, accent: COLORS.gold,
  }, r));
}
