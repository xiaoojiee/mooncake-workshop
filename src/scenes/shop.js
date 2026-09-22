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
   findComponentDef, hasComponentInstalled, COMPONENT_TYPES, buySlot, installComponent, removeComponent,
   upgradeComponent, buyComponent, slotCost, MAX_SLOTS, unlockLabel,
   MONEY, COUNTER, COUNTER_LABEL, DAY, touching, rand, randInt, clamp, lerp, img, addFloater,
   benchSlotCount, moveComponent, ovenBakeTime, ovenBurnTime, counterLevel,
   updateRabbits, rabbitOpen, RABBIT_ART_NPC, RABBIT, drawNpc, spawnCoinFly,
   updateCat, drawCat, catActive, CAT, catKnockOut, catIsTamed,
   applyCounterUpgrade, counterUpgradeCost, isComponentAllowed, componentRestrictLabel,
   poweredUnitIds, isUnitPowered,
   factoryBoard, factoryBoardReset, factoryBoardDraw, factoryBoardDown, factoryBoardMove,
   factoryBoardUp, factoryBoardWheel, factoryBoardUpdate, factoryBoardSweep, input,
   benchUpgradeToggle, benchUpgradeUI, HARDWARE, findProductDef,
drawSprite, strokeRoundRect , shopRating, ratingSubmitValue, formatRating, RATING */

const game = {
  buttons: [],
  hover: null,
  active: null,
  drag: null, // { kind:'crust'|'filling'|'slot'|'oven', ... , x, y }
  toast: null, // { text, color, life }
  impact: null, // 击飞冲击特效 { x, y, t }
  smashItem: null, // 已选中的五金月饼 id(点客人砸飞)
  smashFrom: null, // 拿起五金月饼的位置(投掷起点)
  throws: [], // 飞行中的五金月饼 [{ t, dur, x0, y0, x1, y1, spin, target }]
  dayEnd: false,
  dayEndT: 0,
  result: null, // 最近一次出餐结果
  resultT: 0,
  lastFetchT: 0,
  holdFetch: null, // 长按连取的工厂 id
  factorySel: null, // 工厂面板当前选中工厂
  pendingCompDrag: null, // 按住已装组件但还没拖动(区分点击/拖拽)
  ovenScroll: 0, // 烤位面板滚动偏移
  ovenDrag: null, // 烤位面板触摸拖动(手机没有滚轮)
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
const DRAG = {
  CRUST: 'crust', FILLING: 'filling', SLOT: 'slot', OVEN: 'oven',
  PLATE: 'plate', // 柜台上已摆好的月饼
  RABBIT: 'rabbit', // 月兔(可以拖着挪位置)
  CAT: 'cat', // 流浪猫耄耋(可以拖着挪位置)
  COMPONENT: 'component',
};

/* 柜台上可以摆月饼的那条台面(送烤/摆盘/砸钱都在这一带) */
const PLATE_R = 26; // 摆盘月饼的半径
const MAX_PLATES = 8; // 台面上最多摆几块
function counterDropArea() {
  const top = counterTopY();
  return { x: 0, y: top, w: W, h: LAYOUT.counterY + 26 - top };
}
function plateCenterY() {
  return counterTopY() + 26;
}

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

      /* 安全网: 拖拽状态已经没了(松手事件丢了/拖到画布外), 就别让它们粘着鼠标不动了 */
      if (!game.drag || game.drag.kind !== DRAG.RABBIT) {
        for (const rb of shop.rabbits || []) if (rb.held) rb.held = false;
      }
      if ((!game.drag || game.drag.kind !== DRAG.CAT) && shop.cat && shop.cat.held) shop.cat.held = false;

      /* 月兔: 溜达 + 安抚/收银/做月饼/入炉/送餐 */
      updateRabbits(dt);

      /* 流浪猫「耄耋」: 溜达 + 扑客人/偷吃 */
      updateCat(dt);

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
      if (game.impact) {
        game.impact.t += dt;
        if (game.impact.t > 0.6) game.impact = null;
      }
      updateThrows(dt);
      updateFlyingItems(dt);

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
      if (b && b.id === 'rabbit') {
        SFX.click();
        rabbitOpen();
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

      /* 烤位面板: 手机没有滚轮, 所以也能按住拖(滚动条 / 空白处)
       * 注意: 按在「有月饼的烤位」上要留给拖拽取出, 不能吃掉 */
      const ovThumb = ovenBarThumb();
      if (ovThumb && pointInRect(x, y, { x: ovThumb.x - 8, y: ovThumb.y, w: ovThumb.w + 16, h: ovThumb.h })) {
        game.ovenDrag = { mode: 'bar', grab: y - ovThumb.y };
        return;
      }
      if (pointInRect(x, y, ovenPanelArea()) && ovenMaxScroll() > 0) {
        let onMoon = false;
        for (let i = 0; i < run.oven.length; i++) {
          const os = run.oven[i];
          if (!os || !os.moon) continue;
          if (pointInRect(x, y, ovenRect(i))) { onMoon = true; break; }
        }
        if (!onMoon) {
          game.ovenDrag = { mode: 'content', startY: y, startScroll: game.ovenScroll };
          return;
        }
      }

      /* 五金月饼已选中: 点客人 = 投出去砸飞(命中才结算); 点耄耋 = 打飞它 */
      if (game.smashItem) {
        const from = game.smashFrom || { x: LAYOUT.backpack.x + 40, y: LAYOUT.backpack.y + 60 };
        const catNow = shop.cat;
        if (catNow && !catNow.gone && !catNow.flung &&
            Math.abs(x - catNow.x) <= 56 && Math.abs(y - catNow.y) <= 72) {
          if (throwHardware(null, from.x, from.y, catNow.x, catNow.y)) return;
        }
        const victim = pickCustomerAt(x, y);
        if (victim) {
          throwHardware(victim, from.x, from.y, x, y);
          return;
        }
        if (!pointInRect(x, y, hotbarPanelArea())) game.smashItem = null;
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

      /* 烤位滚动(触摸拖动) */
      if (game.ovenDrag) {
        const oa = ovenPanelArea();
        if (game.ovenDrag.mode === 'bar') {
          const thumbH = Math.max(28, oa.h * (oa.h / ovenContentH()));
          const t = clamp((y - game.ovenDrag.grab - oa.y) / Math.max(1, oa.h - thumbH), 0, 1);
          game.ovenScroll = t * ovenMaxScroll();
        } else {
          game.ovenScroll = game.ovenDrag.startScroll - (y - game.ovenDrag.startY);
        }
        clampOvenScroll();
        return;
      }

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
          if (p.kind === 'hardware') return; // 道具只能点击选中, 不能拖
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
        /* 拖月兔时让它跟手 */
        if (game.drag.kind === DRAG.RABBIT) {
          const rb = (shop.rabbits || [])[game.drag.index];
          if (rb) {
            rb.held = true;
            rb.x = clamp(x, RABBIT.roam.x0, RABBIT.roam.x1);
            rb.y = clamp(y, RABBIT.roam.y0, RABBIT.roam.y1);
          }
        }
        /* 拖耄耋: 挪位置, 拖着的时候它不干活 */
        if (game.drag.kind === DRAG.CAT && shop.cat) {
          shop.cat.held = true;
          shop.cat.x = clamp(x, CAT.roam.x0, CAT.roam.x1);
          shop.cat.y = clamp(y, CAT.roam.y0, CAT.roam.y1);
        }
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
      const hbPress = game.hotbarPress; // 没拖走 -> 算点击
      game.hotbarPress = null;
      game.hotbarDrag = null;
      game.ovenDrag = null;
      if (hbPress && hbPress.kind === 'hardware') {
        toggleSmashItem(hbPress.id, hbPress.x, hbPress.y);
        game.active = null;
        return;
      }

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
  drawPlates(ctx);
  drawImpact(ctx);
  drawMoney(ctx);
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
          id: 'rabbit',
          x: W - 392,
          y: LAYOUT.bottomY + (LAYOUT.bottomH - 68) / 2,
          w: 100,
          h: 68,
          label: '🐰 月兔',
          size: 17,
          accent: COLORS.ok,
        },
        {
          id: 'factory',
          x: W - 284,
          y: LAYOUT.bottomY + (LAYOUT.bottomH - 68) / 2,
          w: 252,
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

      /* 月兔/耄耋: 画在所有面板之上(否则会被底栏/原料架挡住)
       * 但工厂面板打开时不画 —— 那是个铺满屏幕的半透明弹层, 助手会跑到面板上 */
      if (!run.factoryOpen) drawRabbits(ctx);
      if (!run.factoryOpen) drawCat(ctx);

      /* 投出的五金月饼 + 飞行的食材: 同样画在面板之上 */
      drawThrows(ctx);
      drawFlyingItems(ctx);

      /* 拖拽物跟随 */
      if (game.drag) drawDragGhost(ctx, game.drag);


      /* (出餐评分特效已按需求去掉: 结算逻辑照常, 只是不弹那块评分板了) */

      /* toast(只在真出错时用: 没材料 / 台面满 / 烤位被占 之类) */
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
  run.plates = []; // 柜台上摆的月饼(每天清空)
  game.dayEnd = false;
  game.smashItem = null;
  game.smashFrom = null;
  game.throws = [];
  game.flyingItems = [];

  /* 流浪猫「耄耋」: 每天重新安排 —— 没驯服时随机挑个时间溜进来一次 */
  shop.cat = null;
  run.catArriveT = rand(CAT.arriveMin, CAT.arriveMax);

  /* 制作台托�?*/
  run.slots = [];
  for (let i = 0; i < benchSlotCount(); i++) run.slots.push(createSlot());

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

/* 清空自动槽位的「记账」(不动托盘里的料) */
function resetAutoSlot(slot) {
  slot.autoCust = null;
  slot.autoOrder = null;
  slot.autoDone = 0;
  slot.autoT = 0;
  slot.autoPending = false;
}

/* ---- 自动装配特效: 食材从快捷栏飞进托盘 ---- */

/* 该食材在快捷栏里的位置(找不到就退回快捷栏左下角) */
function autoFlightFrom(kind, id) {
  for (const it of hotbarItems()) {
    if (it.kind === kind && it.id === id) {
      return { x: it.rect.x + 30, y: it.rect.y + it.rect.h / 2 };
    }
  }
  return { x: LAYOUT.backpack.x + 40, y: LAYOUT.backpack.y + 60 };
}

/* 起飞: 记一枚飞行中的食材(材料此刻已扣, 落地才真正放进托盘) */
function spawnAutoFlight(slot, index, kind, id, delay) {
  const from = autoFlightFrom(kind, id);
  const to = slotCenter(index);
  game.flyingItems = game.flyingItems || [];
  game.flyingItems.push({
    t: 0,
    delay: delay || 0,
    dur: 0.32,
    x0: from.x,
    y0: from.y,
    x1: to.x,
    y1: to.y,
    spin: 9,
    kind: kind,
    id: id,
    mode: 'in', // 落地才真正放进托盘
    slot: slot,
  });
  slot.autoPending = true;
}

/* 落地: 放进托盘(期间托盘被占了就把材料退回背包) */
function updateFlyingItems(dt) {
  if (!game.flyingItems || !game.flyingItems.length) return;
  for (let i = game.flyingItems.length - 1; i >= 0; i--) {
    const f = game.flyingItems[i];
    f.t += dt;
    if (f.t < (f.delay || 0) + f.dur) continue;
    game.flyingItems.splice(i, 1);
    if (f.mode === 'out') continue; // 飞出只是特效: 材料在起飞时已经退回背包
    const slot = f.slot;
    let landed = false;
    if (f.kind === 'crust') {
      landed = !slot.crustId && placeCrust(slot, f.id).ok;
    } else {
      landed = !!slot.crustId && placeFilling(slot, f.id, ASSEMBLY.maxFillings).ok;
    }
    if (landed) SFX.stamp();
    else backpackAdd(f.kind, f.id, 1); // 没放进去就退料
    slot.autoPending = false;
  }
}

/* 画飞行中的食材(边飞边转) */
function drawFlyingItems(g) {
  if (!game.flyingItems || !game.flyingItems.length) return;
  for (const f of game.flyingItems) {
    const p = clamp((f.t - (f.delay || 0)) / f.dur, 0, 1);
    if (p <= 0) continue; // 还没到起飞时间(错开出场)
    const pos = throwPos(f, p); // 和投掷共用同一条抛物线
    g.save();
    g.translate(pos.x, pos.y);
    g.rotate(p * f.spin);
    if (f.kind === 'crust') {
      const cd = findCrustDef(f.id);
      if (!drawCrustPart(g, cd ? cd.col : 0, 'raw', -24, -24, 48, 48)) {
        g.fillStyle = cd ? cd.color : COLORS.crust;
        g.beginPath();
        g.arc(0, 0, 20, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const fd = findFillingDef(f.id);
      if (!drawFillingIcon(g, fd ? fd.index : 0, 0, 0, 48)) {
        g.fillStyle = fd ? fd.color : COLORS.panelInk;
        g.beginPath();
        g.arc(0, 0, 20, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

/* 托盘中心(飞行起点/终点) */
function slotCenter(index) {
  const r = slotRect(index);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 + 10 };
}

function spawnFlyOut(kind, id, fromX, fromY, delay) {
  const to = autoFlightFrom(kind, id);
  game.flyingItems = game.flyingItems || [];
  game.flyingItems.push({
    t: 0,
    delay: delay || 0,
    dur: 0.3,
    x0: fromX,
    y0: fromY,
    x1: to.x,
    y1: to.y,
    spin: -8,
    kind: kind,
    id: id,
    mode: 'out', // 只画, 落地不改状态(材料已退)
    slot: null,
  });
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

  /* 月兔(拖它可以换位置) */
  for (let i = 0; i < (shop.rabbits || []).length; i++) {
    const rb = shop.rabbits[i];
    /* 抓取范围跟着体型放大(1.5 倍) */
    if (Math.abs(x - rb.x) <= 45 && Math.abs(y - rb.y) <= 60) {
      return { kind: DRAG.RABBIT, index: i, x, y };
    }
  }

  /* 流浪猫耄耋(也能拖着挪位置) */
  const catNow = shop.cat;
  if (catNow && !catNow.gone && !catNow.flung && Math.abs(x - catNow.x) <= 40 && Math.abs(y - catNow.y) <= 56) {
    return { kind: DRAG.CAT, x, y };
  }

  /* 柜台上摆好的月饼 */
  const hitPlate = plateAt(x, y);
  if (hitPlate) return { kind: DRAG.PLATE, index: hitPlate.index, x, y };

  return null;
}

/* ---- 柜台摆盘 ---- */

/* 台面上的某块月饼(命中判定) */
function plateAt(x, y) {
  for (let i = run.plates.length - 1; i >= 0; i--) {
    const p = run.plates[i];
    if (dist(x, y, p.x, p.y) <= PLATE_R + 8) return { plate: p, index: i };
  }
  return null;
}

/* 把烤好的月饼摆到台面上(满了返回 false) */
function placeOnCounter(moon, x) {
  if (run.plates.length >= MAX_PLATES) return false;
  run.plates.push({
    moon: moon,
    x: clamp(x, 48, W - 48),
    y: plateCenterY(),
  });
  return true;
}

/* 从台面拿走一块 */
function takePlate(index) {
  const p = run.plates[index];
  if (!p) return null;
  run.plates.splice(index, 1);
  return p.moon;
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
    /* 拖到空处: 静默退回, 不提示也不响(不消耗) */
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
    /* 放到柜台上: 先把烤位腾出来, 之后可以从台面拿去出餐 */
    if (pointInRect(x, y, counterDropArea())) {
      const moon = ovenTake(os);
      if (!moon) return;
      if (!placeOnCounter(moon, x)) {
        ovenPut(os, moon); // 台面满了, 放回烤位
        return fail('台面摆满了 ' + MAX_PLATES + '/' + MAX_PLATES);
      }
      SFX.stamp();
      return;
    }
    /* 拖到空处: 静默退回 */
    return;
  }

  /* 拖月兔: 松手就停在放下的位置(限制在活动范围内) */
  if (drag.kind === DRAG.RABBIT) {
    const rb = (shop.rabbits || [])[drag.index];
    if (rb) {
      rb.held = false;
      rb.x = clamp(x, RABBIT.roam.x0, RABBIT.roam.x1);
      rb.y = clamp(y, RABBIT.roam.y0, RABBIT.roam.y1);
      rb.vx = 0;
      rb.vy = 0;
      rb.turnT = 0.4;
      SFX.click();
    }
    return;
  }

  /* 拖耄耋: 松手停在那儿 */
  if (drag.kind === DRAG.CAT) {
    if (shop.cat) {
      shop.cat.held = false;
      shop.cat.x = clamp(x, CAT.roam.x0, CAT.roam.x1);
      shop.cat.y = clamp(y, CAT.roam.y0, CAT.roam.y1);
      shop.cat.vx = 0;
      shop.cat.vy = 0;
      shop.cat.turnT = 0.4;
      SFX.click();
    }
    return;
  }

  /* 从柜台拿起再放下/出餐 */
  if (drag.kind === DRAG.PLATE) {
    const moon = takePlate(drag.index);
    if (!moon) return;
    const cust = pickCustomerAt(x, y);
    if (cust) {
      const res = serveCustomer(cust, moon);
      if (res) {
        spawnMoneyForCustomer(cust, res.coins);
        game.result = res;
        game.resultT = 1.6;
        SFX.success();
      } else {
        placeOnCounter(moon, drag.x); // 客人已经走了, 放回台面
      }
      return;
    }
    if (pointInRect(x, y, counterDropArea()) && placeOnCounter(moon, x)) {
      SFX.click();
      return;
    }
    /* 拖到别处 / 台面满了: 放回原处, 不丢 */
    placeOnCounter(moon, drag.x);
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
    return; // 拖到空处: 静默退回
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
/* 烤位滚动条的位置与大小(画和点击命中都用它, 保证对得上) */
function ovenBarThumb() {
  const area = ovenPanelArea();
  const maxS = ovenMaxScroll();
  if (maxS <= 0) return null;
  const thumbH = Math.max(28, area.h * (area.h / ovenContentH()));
  return {
    x: area.x + area.w - 7,
    y: area.y + (area.h - thumbH) * ((game.ovenScroll || 0) / maxS),
    w: 7,
    h: thumbH,
  };
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

/* 月兔/耄耋走路用的「稳定锚点」
 * 不能用 ovenRect / hotbarItems 的 rect: 它们带面板滚动偏移,
 * 玩家一滚, 助手的走路目标就跟着跑偏(滚出可视区还会够不着) */
function ovenAnchorPoint() {
  const o = LAYOUT.oven;
  return { x: o.x + o.w / 2, y: o.y + o.h - 16 };
}
function shelfAnchorPoint() {
  const b = LAYOUT.backpack;
  return { x: b.x + b.w / 2, y: b.y + b.h - 28 };
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
      accent: COLORS.goldLight,
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
  for (const d of HARDWARE) if (isUnlocked(d) || backpackCount('hardware', d.id) > 0) n += 1;
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
  /* 道具(五金月饼): 有货就列出, 点一下选中 */
  for (const def of HARDWARE) {
    if (isUnlocked(def) || backpackCount('hardware', def.id) > 0) defs.push({ kind: 'hardware', id: def.id });
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

/* 柜台上沿(= 天空带下沿): 闭店蒙板/对齐都取这个, 别各自算 */
function counterTopY() {
  return LAYOUT.counterY - 34; // counterY-26(台面后沿) 再减 8(台面厚度)
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
    back.addColorStop(1, COLORS.counterFace3);
    g.fillStyle = back;
    g.fillRect(0, surfaceTop - 8, W, H - (surfaceTop - 8));
    g.drawImage(cimg, x, surfaceTop - 8, w, h);
    g.restore();
    return;
  }

  g.save();
  const OUT = COLORS.counterOutline; // 卡通描边色
  /* 台面可见区很窄(台面被 UI 面板挡住大半), 细节都集中在这一横条上 */
  const topY = counterTopY(); // 台面后沿(可见区上沿)
  const lipTop = edge - 6; // 前沿亮边上沿
  const lipBot = edge + 16; // 前沿亮边下沿

  /* 1) 地板底色: 从台面上沿往下铺满, 免得露出星空
   * 注意: 不要画到 counterTopY() 以上, 否则闭店蒙板会露出一条亮缝 */
  const floor = g.createLinearGradient(0, topY, 0, H);
  floor.addColorStop(0, COLORS.counterFloor1);
  floor.addColorStop(0.3, COLORS.counterFloor2);
  floor.addColorStop(1, COLORS.counterFloor3);
  g.fillStyle = floor;
  g.fillRect(0, topY, W, H - topY);

  /* 2) 台面: 后暗前亮(视线低, 近处受光多) */
  const topGrd = g.createLinearGradient(0, topY, 0, lipTop);
  topGrd.addColorStop(0, COLORS.counterTop3);
  topGrd.addColorStop(0.45, COLORS.counterTop2);
  topGrd.addColorStop(1, COLORS.counterTop1);
  fillRoundRect(g, -28, topY, W + 56, lipTop - topY + 2, 14, topGrd);

  /* 2a) 「映月」柔光: 台面中段一片暖光, 面不至于死板 */
  const sheen = g.createLinearGradient(0, topY, 0, lipTop);
  sheen.addColorStop(0, 'rgba(255,236,190,0)');
  sheen.addColorStop(0.55, 'rgba(255,236,190,0.16)');
  sheen.addColorStop(1, 'rgba(255,236,190,0)');
  g.fillStyle = sheen;
  g.fillRect(0, topY, W, lipTop - topY);

  /* 2b) 木板拼缝: 暗缝 + 亮边, 薄薄一层立体感 */
  for (let x = 96; x < W; x += 176) {
    g.save();
    g.globalAlpha = 0.16;
    g.strokeStyle = COLORS.counterWood;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, topY + 5);
    g.lineTo(x, lipTop - 2);
    g.stroke();
    g.globalAlpha = 0.2;
    g.strokeStyle = COLORS.counterTopHi;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 2, topY + 5);
    g.lineTo(x + 2, lipTop - 2);
    g.stroke();
    g.restore();
  }
  /* 2c) 横向木纹(细丝, 很淡) */
  g.save();
  g.globalAlpha = 0.07;
  g.strokeStyle = COLORS.counterWood;
  g.lineWidth = 1;
  for (let y = topY + 11; y < lipTop - 2; y += 9) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y + 1);
    g.stroke();
  }
  g.restore();

  /* 3) 台面投影: 客人/物品压在台面上(上深下透) */
  const shade = g.createLinearGradient(0, topY, 0, lipTop);
  shade.addColorStop(0, 'rgba(60,30,10,0.3)');
  shade.addColorStop(0.7, 'rgba(60,30,10,0.06)');
  shade.addColorStop(1, 'rgba(60,30,10,0)');
  g.fillStyle = shade;
  g.fillRect(0, topY, W, lipTop - topY);

  /* 4) 前沿亮边(琥珀金属): 上高光 → 下暗 */
  const edgeGrd = g.createLinearGradient(0, lipTop, 0, lipBot);
  edgeGrd.addColorStop(0, COLORS.counterEdge1);
  edgeGrd.addColorStop(0.3, COLORS.panelBorder);
  edgeGrd.addColorStop(1, COLORS.counterEdge3);
  fillRoundRect(g, -28, lipTop, W + 56, lipBot - lipTop, 10, edgeGrd);
  g.save();
  g.globalAlpha = 0.55; // 亮边顶面高光
  fillRoundRect(g, -22, lipTop + 2, W + 44, 3, 1.5, COLORS.counterEdgeHi);
  g.globalAlpha = 0.3; // 亮边下沿暗线
  fillRoundRect(g, -22, lipBot - 4, W + 44, 3, 1.5, COLORS.counterFace3);
  g.restore();

  /* 5) 前沿立面(大部分被 UI 面板挡住): 渐变 + 竖缝 + 亮边投影 */
  const grd2 = g.createLinearGradient(0, lipBot, 0, slabBot + 40);
  grd2.addColorStop(0, COLORS.counterFace1);
  grd2.addColorStop(0.5, COLORS.counterFace2);
  grd2.addColorStop(1, COLORS.counterFace3);
  g.fillStyle = grd2;
  g.fillRect(0, lipBot, W, H - lipBot);
  g.save();
  g.globalAlpha = 0.28;
  g.strokeStyle = COLORS.counterSeam;
  g.lineWidth = 3;
  for (let x = 120; x < W; x += 240) {
    g.beginPath();
    g.moveTo(x, lipBot + 2);
    g.lineTo(x, H);
    g.stroke();
  }
  g.globalAlpha = 0.22;
  g.strokeStyle = COLORS.counterSeamHi;
  g.lineWidth = 1.5;
  for (let x = 121; x < W; x += 240) {
    g.beginPath();
    g.moveTo(x, lipBot + 2);
    g.lineTo(x, H);
    g.stroke();
  }
  g.restore();
  /* 5a) 亮边往下投的阴影: 立面顶部压暗一条 */
  const aoc = g.createLinearGradient(0, lipBot, 0, lipBot + 22);
  aoc.addColorStop(0, 'rgba(40,20,8,0.5)');
  aoc.addColorStop(1, 'rgba(40,20,8,0)');
  g.fillStyle = aoc;
  g.fillRect(0, lipBot, W, 22);

  /* 6) 卡通轮廓线: 台面 + 前沿各描一圈(整体下移一点, 别描到蒙板线以上) */
  g.save();
  g.globalAlpha = 0.45;
  strokeRoundRect(g, -28, topY + 1.5, W + 56, lipTop - topY, 13, OUT, 2.5);
  strokeRoundRect(g, -28, lipTop, W + 56, lipBot - lipTop, 10, OUT, 2);
  g.restore();
  g.restore();
}

/* ---- 绘制: 月兔(在柜台前来回溜达) ---- */
/* 画一只月兔: 有贴图(月兔1~4.png)就用贴图, 没有就退回特殊立绘 */
function drawRabbitFigure(g, art, cx, baseY, h) {
  const key = 'rabbit_' + (art + 1);
  const spr = typeof img === 'function' ? img(key) : null;
  if (spr) {
    const bw = h * ((spr.naturalWidth || spr.width) / (spr.naturalHeight || spr.height));
    drawSprite(g, key, cx - bw / 2, baseY - h, bw, h);
    return;
  }
  drawNpc(g, RABBIT_ART_NPC[art] != null ? RABBIT_ART_NPC[art] : 4, cx, baseY, h, 'npc_special');
}

function drawRabbits(g) {
  for (const r of shop.rabbits || []) {
    const hop = Math.abs(Math.sin(r.hop)) * 7;
    const y = r.y - hop;
    g.save();
    g.globalAlpha = 0.22;
    g.fillStyle = '#3a1f0d';
    g.beginPath();
    g.ellipse(r.x, r.y + 4, 32, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const h = RABBIT.bodyH || 99;
    g.save();
    if (r.dir < 0) {
      g.translate(r.x * 2, 0);
      g.scale(-1, 1);
    }
    drawRabbitFigure(g, r.art, r.x, y, h);
    g.restore();
    /* 手上的东西: 吸附在头顶(取料/搬月饼都看得见)
     * 拾取物放大到 2 倍(原来 h*0.48), 同时抬高免得压住脑袋 */
    if (r.carry) {
      const ix = r.x;
      const iy = y - h * 1.45;
      const sz = h * 0.96;
      if (r.carry.kind === 'moon') {
        const mc = findCrustDef(r.carry.moon ? r.carry.moon.crustId : null);
        if (!drawCrustPart(g, mc ? mc.col : 0, 'done', ix - sz / 2, iy - sz / 2, sz, sz)) {
          g.fillStyle = COLORS.crust;
          g.beginPath();
          g.arc(ix, iy, sz / 2.2, 0, Math.PI * 2);
          g.fill();
        }
      } else if (r.carry.kind === 'crust') {
        const cd = findCrustDef(r.carry.id);
        if (!drawCrustPart(g, cd ? cd.col : 0, 'raw', ix - sz / 2, iy - sz / 2, sz, sz)) {
          g.fillStyle = cd ? cd.color : COLORS.crust;
          g.beginPath();
          g.arc(ix, iy, sz / 2.2, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        const fd = findFillingDef(r.carry.id);
        if (!drawFillingIcon(g, fd ? fd.index : 0, ix, iy, sz)) {
          g.fillStyle = fd ? fd.color : COLORS.panelInk;
          g.beginPath();
          g.arc(ix, iy, sz / 2.2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
}

/* ---- 绘制: 流浪猫「耄耋」(程序化画的灰狸花猫, 没贴图) ---- */
function drawCat(g) {
  const cat = shop.cat;
  if (!cat || !catActive()) return;
  if (cat.gone && !cat.flung) return; // 溜走了/被打飞了
  const hop = Math.abs(Math.sin(cat.hop)) * 4;
  const y = cat.y - hop;
  const eating = cat.state === 'eat';
  const hunting = cat.state === 'go' && cat.task;

  /* 被打飞: 整只甩出去 + 翻滚 */
  g.save();
  if (cat.flung) {
    g.translate(cat.flung.x, cat.flung.y);
    g.translate(cat.x, y);
    g.rotate(cat.flung.rot);
    g.translate(-cat.x, -y);
    g.globalAlpha = clamp(1 - Math.max(0, cat.flung.t - 0.5) / 0.4, 0, 1);
  } else if (cat.dodgeT > 0) {
    g.translate(Math.sin(cat.dodgeT * 50) * 7, 0); // 驯服后挨打时的小躲闪
  }

  g.save();
  g.globalAlpha = 0.22;
  g.fillStyle = '#3a1f0d';
  g.beginPath();
  g.ellipse(cat.x, cat.y + 4, 21, 6.5, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const spr = typeof img === 'function' ? img('cat') : null;
  if (spr) {
    /* 有贴图(耄耋.png): 直接画, 吃东西时上下咀嚼 */
    const chomp = eating ? 1 - 0.05 + Math.abs(Math.sin(cat.hop * 3)) * 0.06 : 1;
    const h = 62 * chomp;
    const bw = h * ((spr.naturalWidth || spr.width) / (spr.naturalHeight || spr.height));
    g.save();
    if (cat.dir < 0) {
      g.translate(cat.x * 2, 0);
      g.scale(-1, 1);
    }
    drawSprite(g, 'cat', cat.x - bw / 2, y - h, bw, h);
    g.restore();
  } else {
    drawCatBody(g, cat, y, eating, hunting);
  }

  /* 驯服标记: 头顶一颗小红心 */
  if (cat.tamed || catIsTamed()) {
    g.save();
    g.fillStyle = '#e2557b';
    g.beginPath();
    g.arc(cat.x - 4, y - 68, 5, 0, Math.PI * 2);
    g.arc(cat.x + 4, y - 68, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cat.x - 9, y - 66);
    g.lineTo(cat.x + 9, y - 66);
    g.lineTo(cat.x, y - 54);
    g.closePath();
    g.fill();
    g.restore();
  }

  /* 目标提示: 扑人时头顶冒个「!」 */
  if (hunting && cat.task.kind === 'attack') {
    g.save();
    setFont(g, 26, 700);
    drawText(g, '!', cat.x, y - 58, {
      size: 26, weight: 700, align: 'center', color: COLORS.fail, stroke: '#3a1f0d', strokeWidth: 4,
    });
    g.restore();
  }
  g.restore(); // 打飞的外层变换
  drawCatPawFx(g);
}

/* 没有猫贴图时的程序化兜底(灰狸花猫) */
function drawCatBody(g, cat, y, eating, hunting) {
  g.save();
  g.translate(cat.x, y);
  if (cat.dir < 0) g.scale(-1, 1);

  /* 尾巴(高兴时翘起来摆) */
  g.strokeStyle = CAT.body;
  g.lineWidth = 5;
  g.lineCap = 'round';
  const wag = Math.sin(cat.hop * 1.4) * 6;
  g.beginPath();
  g.moveTo(-15, -12);
  g.quadraticCurveTo(-32, -20 + wag, -26 - wag * 0.4, -36 + wag);
  g.stroke();

  /* 身体 + 肚皮 */
  g.fillStyle = CAT.body;
  g.beginPath();
  g.ellipse(0, -12, 17, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = CAT.belly;
  g.beginPath();
  g.ellipse(3, -8, 11, 7, 0, 0, Math.PI * 2);
  g.fill();

  /* 头 */
  g.fillStyle = CAT.body;
  g.beginPath();
  g.arc(14, -25, 12, 0, Math.PI * 2);
  g.fill();
  /* 耳朵 */
  g.beginPath();
  g.moveTo(5, -33);
  g.lineTo(8, -45);
  g.lineTo(16, -35);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(20, -35);
  g.lineTo(26, -45);
  g.lineTo(28, -32);
  g.closePath();
  g.fill();

  /* 眼睛: 平时竖瞳, 逮东西/吃东西时眯起来 */
  for (const ex of [9, 20]) {
    g.fillStyle = '#ffe36a';
    g.beginPath();
    g.ellipse(ex, -26, 3.4, hunting || eating ? 2.2 : 3.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1a10';
    g.beginPath();
    g.ellipse(ex, -26, 1.1, hunting || eating ? 2.0 : 3.2, 0, 0, Math.PI * 2);
    g.fill();
  }

  /* 口鼻 + 胡须 */
  g.fillStyle = CAT.belly;
  g.beginPath();
  g.ellipse(20, -20, 6.5, 4.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e08f9a';
  g.beginPath();
  g.arc(24, -21.5, 1.8, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(216,207,196,0.85)';
  g.lineWidth = 1.2;
  for (const dy of [-3, 0, 3]) {
    g.beginPath();
    g.moveTo(24, -20 + dy * 0.5);
    g.lineTo(38, -22 + dy);
    g.stroke();
  }
  /* 吃东西时张着嘴 */
  if (eating) {
    g.fillStyle = '#3a1f0d';
    g.beginPath();
    g.ellipse(23, -18, 3.2, 2.6 + Math.abs(Math.sin(cat.hop * 3)) * 1.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/* ---- 绘制: 客人(柜台后的固定站位, 只露上半身, 从右侧走进来) ---- */
function drawCustomers(g) {
  for (const c of run.customers) {
    const r = customerRect(c);
    const cx = r.x + r.w / 2;
    const enterP = clamp(c.enterT, 0, 1);
    const leaveP = c.state === 'waiting' ? 0 : clamp((c.leaveT || 0) / 0.8, 0, 1);
    const fly = c.fly || null; // 被击飞中
    /* 从右侧滑入; 服务完/发怒后向右滑走; 被击飞的按抛物线甩出去并翻滚 */
    const easeEnter = 1 - Math.pow(1 - enterP, 3);
    let offX = (1 - easeEnter) * 300 + leaveP * 340;
    let offY = 0;
    let alpha = enterP * (1 - leaveP * leaveP);
    let rot = 0;
    if (fly) {
      offX = fly.x;
      offY = fly.y;
      rot = fly.rot;
      alpha = clamp(1 - Math.max(0, fly.t - 0.5) / 0.8, 0, 1); // 飞出去后段淡出
    }
    if (alpha <= 0.01) continue;

    g.save();
    g.globalAlpha = alpha;
    g.translate(offX, offY);
    if (fly) {
      /* 绕身体中段翻滚 */
      const pivotY = LAYOUT.counterY - LAYOUT.stand.headH * 0.45;
      g.translate(cx, pivotY);
      g.rotate(rot);
      g.translate(-cx, -pivotY);
    }

    const baseY = LAYOUT.counterY + 44; // 脚被柜台挡住
    const h = LAYOUT.stand.headH;
    const bobY = c.state === 'waiting' ? Math.sin(c.bob) * 3 : 0;
    const shakeX = c.state === 'angry' && !fly ? Math.sin(c.bob * 6) * 3 : 0;

    g.save();
    g.translate(shakeX, bobY);
    drawCustomerFigure(g, c, cx, baseY, h);
    g.restore();

    /* 订单气泡 + 独立耐心条(略加宽以容纳放大的馅料图标) */
    drawOrderBubble(g, c, r.x - 4, r.y + 6, r.w + 8);

    g.restore();
  }
}

/* 立绘占位: 竖排「顾 / 客」二字(DAY.customerTextPlaceholder, 等美术交付后关掉) */
function drawCustomerPlaceholder(g, c, cx, baseY, h) {
  const special = c.def.kind === 'special';
  const headR = h * 0.2;
  const headY = baseY - h + headR;

  /* 身子 + 头(和缺图占位同一套几何) */
  g.save();
  fillRoundRect(g, cx - h * 0.26, headY + headR * 0.6, h * 0.52, h, h * 0.16,
    special ? 'rgba(196,158,86,0.4)' : 'rgba(67,48,34,0.95)');
  g.beginPath();
  g.arc(cx, headY, headR, 0, Math.PI * 2);
  g.fillStyle = special ? COLORS.gold : COLORS.panelLight;
  g.fill();
  g.strokeStyle = special ? COLORS.goldLight : 'rgba(196,158,86,0.5)';
  g.lineWidth = special ? 3 : 2;
  g.stroke();
  g.restore();

  /* 竖排「顾 / 客」 */
  const size = h * 0.2;
  const ink = special ? COLORS.goldLight : COLORS.cream;
  const outline = 'rgba(38,22,10,0.8)';
  drawText(g, '顾', cx, headY + size * 1.5, {
    size: size, weight: 700, align: 'center', color: ink, stroke: outline, strokeWidth: 3.5,
  });
  drawText(g, '客', cx, headY + size * 2.7, {
    size: size, weight: 700, align: 'center', color: ink, stroke: outline, strokeWidth: 3.5,
  });
}

/* 柜台上摆好的月饼(烤好先摆这里, 腾出烤位) */
function drawPlates(g) {
  const draggingIdx = game.drag && game.drag.kind === DRAG.PLATE ? game.drag.index : -1;
  for (let i = 0; i < run.plates.length; i++) {
    if (i === draggingIdx) continue; // 正在拖的那块不画(跟手)
    const p = run.plates[i];
    /* 台面投影 */
    g.save();
    g.globalAlpha = 0.22;
    g.fillStyle = '#3a1f0d';
    g.beginPath();
    g.ellipse(p.x, p.y + PLATE_R * 0.72, PLATE_R * 0.95, PLATE_R * 0.34, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    drawSlotMoon(g, { crustId: p.moon.crustId, fillings: p.moon.fillings }, p.x, p.y, PLATE_R, { wrapped: true });
    if (p.moon.burnt) {
      drawText(g, '糊', p.x + PLATE_R - 2, p.y - PLATE_R + 2, {
        size: 13, weight: 700, color: COLORS.fail, stroke: 'rgba(40,20,10,0.7)', strokeWidth: 3,
      });
    }
  }
}

/* 击飞冲击: 扩散环 + 放射尖刺 + 「击飞!」大字 */
function drawImpact(g) {
  const im = game.impact;
  if (!im) return;
  const p = clamp(im.t / 0.6, 0, 1);
  g.save();
  g.globalAlpha = 1 - p;
  /* 两圈扩散冲击环 */
  g.strokeStyle = COLORS.cream;
  g.lineWidth = 7 * (1 - p) + 2;
  g.beginPath();
  g.arc(im.x, im.y, 18 + p * 96, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = COLORS.fail;
  g.lineWidth = 4 * (1 - p) + 1;
  g.beginPath();
  g.arc(im.x, im.y, 8 + p * 62, 0, Math.PI * 2);
  g.stroke();
  /* 放射尖刺 */
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + p * 0.5;
    const r0 = 22 + p * 44;
    const r1 = r0 + 36 * (1 - p) + 8;
    g.strokeStyle = COLORS.goldLight;
    g.lineWidth = 6 * (1 - p) + 2;
    g.beginPath();
    g.moveTo(im.x + Math.cos(ang) * r0, im.y + Math.sin(ang) * r0);
    g.lineTo(im.x + Math.cos(ang) * r1, im.y + Math.sin(ang) * r1);
    g.stroke();
  }
  g.restore();
  drawText(g, '击飞!', im.x, im.y - 44 - p * 46, {
    size: 30, weight: 700, align: 'center',
    color: COLORS.goldLight, stroke: 'rgba(60,30,10,0.85)', strokeWidth: 5,
  });
}



/* 客人立绘: 普通客人用「普通顾客」贴图; 特殊客人用竖排「顾客」占位(各有设定)
 * 缺图时退回几何占位(上半身) */
function drawCustomerFigure(g, c, cx, baseY, h) {
  const special = c.def.kind === 'special';
  if (special && DAY.customerTextPlaceholder) {
    drawCustomerPlaceholder(g, c, cx, baseY, h);
    return;
  }
  const idx = c.npcIndex != null ? c.npcIndex : (c.def.npcIndex || 0);
  if (drawNpc(g, idx, cx, baseY, h, special ? 'npc_special' : 'npc_normal')) return;
  if (drawNpc(g, idx, cx, baseY, h, 'npc_normal')) return; // 特殊图缺失时退回普通图集

  /* 兜底: 画个几何人形 + 表情 */
  const headR = h * 0.2;
  const headY = baseY - h + headR;
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

  /* 耐心无限的客人(找茬的刘华强): 画一条金色满格 + ∞ */
  if (!isFinite(c.patienceMax)) {
    uiBar(g, x + 10, y + h - 15, w - 20, 9, 1, COLORS.gold);
    drawText(g, '∞', x + w - 10, y + h - 15, {
      size: 12, weight: 700, align: 'right', color: COLORS.goldLight,
    });
    return;
  }
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
  spawnCoinFly(coin.x, coin.y, coin.value); // 钱飞向顶栏的金币图标
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
  /* 层数太多(如刘华强的 30 层)只画前几个, 免得图标挤成一团 */
  const MAX_ICONS = 6;
  const shown = Math.min(n, MAX_ICONS);
  const step = shown > 0 ? Math.min(iconSize, (w - 52 - (n > shown ? 30 : 0)) / shown) : iconSize;
  for (let i = 0; i < shown; i++) {
    const ix = x + 34 + i * step + iconSize / 2;
    if (!drawFillingIcon(g, fillingIndexOf(order.fillings[i]), ix, cy, iconSize)) {
      const f = findFillingDef(order.fillings[i]);
      g.fillStyle = f ? f.color : COLORS.cream;
      g.beginPath();
      g.arc(ix, cy, 20, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (n > shown) {
    drawText(g, 'x' + n, x + 34 + shown * step + 14, cy, {
      size: 20, weight: 700, align: 'left', color: COLORS.cream, stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3,
    });
  }
}

/* ---- 绘制: 快捷背包栏(营业常驻, 大行滚动列表) ---- */
function drawHotbar(g) {
  const s = LAYOUT.backpack;
  uiPanel(g, s.x, s.y, s.w, s.h, { r: 14 });
  drawText(g, '快捷栏', s.x + 14, s.y + 24, { size: 16, weight: 700, color: COLORS.panelTitle });

  clampHotbarScroll();
  const a = hotbarPanelArea();
  g.save();
  g.beginPath();
  g.rect(a.x, a.y, a.w, a.h);
  g.clip();

  const items = hotbarItems();
  if (!items.length) {
    drawText(g, '背包空', s.x + 14, s.y + 78, { size: 13, color: COLORS.textDim });
  }
  for (const it of items) {
    const r = it.rect;
    if (r.y + r.h < a.y || r.y > a.y + a.h) continue;
    const cnt = backpackCount(it.kind, it.id);
    const def = findProductDef(it.kind, it.id);
    if (!def) continue;
    const empty = cnt <= 0;
    const cy = r.y + r.h / 2;
    const armed = it.kind === 'hardware' && game.smashItem === it.id;

    g.save();
    g.globalAlpha = empty ? 0.45 : 1;
    fillRoundRect(g, r.x, r.y, r.w, r.h, 10, armed ? '#ffe6b0' : empty ? '#e7dac0' : COLORS.panelLight);
    if (armed) strokeRoundRect(g, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 12, COLORS.warn, 3);

    let drew = false;
    if (it.kind === 'crust') drew = drawCrustPart(g, def.col, 'raw', r.x + 8, cy - 22, 44, 44);
    else if (it.kind === 'filling') drew = drawFillingIcon(g, def.index, r.x + 32, cy, 52);
    else if (img('hardware_moon')) {
      drawSprite(g, 'hardware_moon', r.x + 6, cy - 24, 48, 48); // 五金月饼贴图
      drew = true;
    }
    if (!drew) {
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(r.x + 30, cy, 18, 0, Math.PI * 2);
      g.fill();
    }

    drawText(g, def.name, r.x + 62, cy - 8, {
      size: 16, weight: 600, color: COLORS.panelInk, maxWidth: r.w - 120,
    });
    drawText(g, it.kind === 'hardware' ? '点一下选中' : '售价 💰' + (def.value || 0), r.x + 62, cy + 14, {
      size: 12, weight: 600, color: it.kind === 'hardware' ? COLORS.warn : COLORS.gold,
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

  /* 已选中五金月饼: 底部提示 */
  if (game.smashItem) {
    drawText(g, '已选中五金月饼 → 点客人砸飞', s.x + 14, s.y + s.h - 12, {
      size: 12, weight: 700, color: COLORS.fail, maxWidth: s.w - 24,
    });
  }
}

/* 选中/放下五金月饼 */
function toggleSmashItem(id, fromX, fromY) {
  if (game.smashItem === id) {
    game.smashItem = null;
    game.smashFrom = null;
  } else {
    game.smashItem = id;
    game.smashFrom = { x: fromX != null ? fromX : LAYOUT.backpack.x + 40, y: fromY != null ? fromY : LAYOUT.backpack.y + 60 };
  }
  SFX.click();
}

/* 五金月饼投出: 先飞出去, 命中后才结算(击飞/扣口碑) */
function throwHardware(c, fromX, fromY, toX, toY) {
  const id = game.smashItem;
  if (!id) return false;
  if (!backpackTake('hardware', id, 1)) {
    game.smashItem = null;
    fail('没有五金月饼了');
    return false;
  }
  game.throws = game.throws || [];
  game.throws.push({
    t: 0,
    dur: 0.34,
    x0: fromX,
    y0: fromY,
    x1: toX,
    y1: toY,
    spin: 13,
    target: c,
  });
  /* 还有存货就继续拿着, 方便连砸 */
  game.smashItem = backpackCount('hardware', id) > 0 ? id : null;
  SFX.click();
  return true;
}

/* 飞行轨迹: 抛物线(先上后下) */
function throwPos(th, p) {
  return {
    x: lerp(th.x0, th.x1, p),
    y: lerp(th.y0, th.y1, p) - Math.sin(p * Math.PI) * 96,
  };
}

/* 推进飞行中的五金月饼; 命中时结算 */
function updateThrows(dt) {
  if (!game.throws || !game.throws.length) return;
  for (let i = game.throws.length - 1; i >= 0; i--) {
    const th = game.throws[i];
    th.t += dt;
    if (th.t < th.dur) continue;
    game.throws.splice(i, 1);
    /* 砸猫: 落点附近有耄耋 -> 打飞它 */
    const catNow = shop.cat;
    if (catNow && !catNow.gone && !catNow.flung &&
        Math.abs(th.x1 - catNow.x) <= 62 && Math.abs(th.y1 - catNow.y) <= 78) {
      catKnockOut();
      continue;
    }
    const c = th.target;
    if (c && c.state === 'waiting') smashImpact(c, th.x1, th.y1); // 砸人: 还在就结算
  }
}

/* 画飞行中的五金月饼(边飞边转) */
function drawThrows(g) {
  if (!game.throws || !game.throws.length) return;
  for (const th of game.throws) {
    const p = clamp(th.t / th.dur, 0, 1);
    const pos = throwPos(th, p);
    g.save();
    g.translate(pos.x, pos.y);
    g.rotate(p * th.spin);
    if (img('hardware_moon')) drawSprite(g, 'hardware_moon', -30, -30, 60, 60);
    else {
      g.fillStyle = '#b9c0c7';
      g.beginPath();
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

/* 命中结算: 击飞 + (普通客人)掉口碑; 找茬的不掉 */
function smashImpact(c, x, y) {
  const harass = !!c.def.harass;
  c.state = 'angry';
  c.leaveT = 0;
  c.drivenOff = true;
  c.leaveSlot = c.dispSlot != null ? c.dispSlot : 0;
  c.fly = {
    t: 0, x: 0, y: 0,
    vx: 560 + Math.random() * 220,
    vy: -980 - Math.random() * 160,
    rot: 0,
    spin: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 4),
  };
  game.impact = { x: x, y: y, t: 0 };
  addShake(DAY.smashShake || 12);
  SFX.hit(); // 五金月饼命中

  if (harass) {
    /* 打飞找茬的会掉他身上的东西: 刘华强 -> 西瓜刀(只有第一次给, 免得反复刷) */
    const dropId = c.def.dropComponent;
    if (dropId && !hasComponentInstalled(dropId) && !(shop.components[dropId] > 0)) {
      shop.components[dropId] = (shop.components[dropId] || 0) + 1;
      const cd = findComponentDef(dropId);
      showScreenText('获得 组件「' + (cd ? cd.name : dropId) + '」', '', COLORS.gold);
      SFX.unlock();
    }
    SFX.success();
  } else {
    /* (口碑已并入评分: 砸普通客人不再单独扣分, 但也没给他出餐, 自然不会有好评) */
    SFX.fail();
  }
}

/* ---- 绘制: 制作台 ---- */
function drawBench(g) {
  const b = LAYOUT.bench;
  uiPanel(g, b.x, b.y, b.w, b.h, { r: 14 });
  drawText(g, '制作台', b.x + 14, b.y + 24, { size: 15, weight: 700, color: COLORS.panelTitle });

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
  drawText(g, '烤炉', o.x + 14, o.y + 26, { size: 15, weight: 700, color: COLORS.panelTitle });

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

  /* 滚动条(位置统一由 ovenBarThumb 算, 触摸拖动/滚轮都改 ovenScroll) */
  const th2 = ovenBarThumb();
  if (th2) {
    fillRoundRect(g, th2.x, area.y, th2.w, area.h, 4, 'rgba(19,16,13,0.5)');
    fillRoundRect(g, th2.x, th2.y, th2.w, th2.h, 4, 'rgba(196,158,86,0.75)');
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

  drawText(g, '工厂 · 槽位与组件', px + 24, py + 32, {
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
  drawText(g, '槽位', cx, p.y + 138, {
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
    drawText(g, '槽位已满 ' + MAX_SLOTS + '/' + MAX_SLOTS, br.x + br.w / 2, br.y + br.h / 2, {
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
  drawText(g, effects || '空槽', sb.x + 12, sb.y + 42, {
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
    drawText(g, '烤位已满 ' + OVEN.maxSlots + '/' + OVEN.maxSlots, sb.x + sb.w - 12, sb.y + sb.h - 24, {
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
    if (e.speed) speed.push(cd.name + '+' + Math.round(e.speed * slot.level * 100) + '%');
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
  drawText(g, '组件背包', bx, p.y + 104, { size: 13, weight: 600, color: COLORS.textDim });
  const owned = Object.keys(shop.components).filter((id) => shop.components[id] > 0);
  if (!owned.length) {
    drawText(g, '背包为空', bx + 4, p.y + 158, { size: 12, color: COLORS.textDim });
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
    drawText(g, '共 ' + owned.length + ' 种 · 仅显示前 6', bx, p.y + 300, { size: 10, color: COLORS.textDim });
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
  } else if (drag.kind === DRAG.RABBIT || drag.kind === DRAG.CAT) {
    /* 不画替身: 月兔/耄耋本体已经跟着手指走了, 再画一只就是重影 */
  } else if (drag.kind === DRAG.PLATE) {
    const p = run.plates[drag.index];
    if (p) drawSlotMoon(g, { crustId: p.moon.crustId, fillings: p.moon.fillings }, drag.x, drag.y, PLATE_R, { wrapped: true });
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

/* 提示文字 */
function hintText() {
  if (!run.customers.length) return '等待客人进店…';
  return ''; // 不再显示操作教程
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

    ['店铺评分', (typeof shopRating === 'function' && shopRating() != null)
      ? formatRating(ratingSubmitValue()) + ' 分 · ' + (shop.ratingCount || 0) + ' 位客人评分'
      : '评价不足 · ' + (shop.ratingCount || 0) + '/' + (RATING.minCount + 1)],
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
