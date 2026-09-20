'use strict';

/* 开始界面 = 营业画面 + 前面挂一块「翻转牌子」
 * 翻到「营业中」这一面就开门营业(进入 shop 场景)
 * 后厂 / 排行榜 / 重新开始 收进底部小按钮 */

/* global scenes, makeScene, ctx, W, H, COLORS, shop, run, LAYOUT, OVEN, interact, Toy,
   drawText, uiButton, uiPanel, drawSprite, img, hitButton, SFX, resetGame, formatNum,
   pointInRect, clamp, uiHeader, createSlot, createOvenSlot, benchSlotCount,
   drawCustomers, drawCounter, drawMoney, drawCart, drawHotbar, drawBench, drawOven,
   drawBg, drawFallbackBg, hintText, fillRoundRect, strokeRoundRect, benchUpgradeToggle,
   stockingUI, stockingOpen, benchUpgradeUI, slotUpgradeButtons */

const menuState = {
  buttons: [],
  hover: null,
  active: null,
  sign: { phase: 0, target: 0 }, // phase 0=休息 1=营业
};

function goShop() {
  scenes.goto('shop', { fresh: true });
}

/* 翻牌子 -> 备货窗; 确认后开门, 取消则翻回休息面 */
function openStocking() {
  stockingOpen();
  stockingUI.onConfirm = goShop;
  stockingUI.onCancel = function () {
    menuState.sign.target = 0;
  };
}

/* 让开始界面直接呈现与营业一致的画面(空客人/空托盘/空烤位) */
function menuDisplayInit() {
  run.customers = [];
  run.money = [];
  run.factoryOpen = false;
  if (!run.slots || !run.slots.length) {
    run.slots = [];
    for (let i = 0; i < benchSlotCount(); i++) run.slots.push(createSlot());
  }
  if (!run.oven || !run.oven.length) {
    run.oven = [];
    const n = shop.ovenLevel || OVEN.slots;
    for (let i = 0; i < n; i++) run.oven.push(createOvenSlot());
  }
}

/* 牌子立在柜台后面: 从 HUD 下方吊下来, 底端越过柜台前沿(被柜台挡住) */
const SIGN = { w: 250, h: 142, cy: 214 };

function signRect() {
  return { x: W / 2 - SIGN.w / 2, y: SIGN.cy - SIGN.h / 2, w: SIGN.w, h: SIGN.h };
}

scenes.register(
  'menu',
  makeScene({
    enter() {
      menuState.hover = null;
      menuState.active = null;
      menuState.slotButtons = [];
      menuState.sign = { phase: 0, target: 0 };
      menuDisplayInit();

      const bw = 176;
      const bh = 56;
      const by = LAYOUT.bottomY + (LAYOUT.bottomH - bh) / 2;
      const gap = 12;
      const x0 = W - 20 - (bw * 4 + gap * 3);
      menuState.buttons = [
        { id: 'bench', x: x0, y: by, w: bw, h: bh, label: '制作台', size: 17, accent: COLORS.gold },
        { id: 'factory', x: x0 + (bw + gap), y: by, w: bw, h: bh, label: '后厂', size: 17, accent: COLORS.ok },
        { id: 'rank', x: x0 + (bw + gap) * 2, y: by, w: bw, h: bh, label: '排行榜', size: 17, accent: COLORS.warn },
        { id: 'reset', x: x0 + (bw + gap) * 3, y: by, w: bw, h: bh, label: '重新开始', size: 17, accent: COLORS.textDim },
      ];
    },

    update(dt) {
      const sgn = menuState.sign;
      if (sgn.phase < sgn.target) {
        sgn.phase = Math.min(sgn.target, sgn.phase + dt * 2.2);
        /* 翻到「营业中」-> 弹备货窗, 确认后才真正开门 */
        if (sgn.phase >= 1 && sgn.target === 1 && !stockingUI.open) openStocking();
      } else if (sgn.phase > sgn.target) {
        sgn.phase = Math.max(sgn.target, sgn.phase - dt * 2.2);
      }
    },

    onDown(x, y) {
      if (x > 280 && x < 700 && y > LAYOUT.bottomY + 104 && y < LAYOUT.bottomY + 138) {
        Toy.openVideo();
        return;
      }
      /* 翻牌子 */
      if (pointInRect(x, y, signRect()) && menuState.sign.phase !== 1) {
        menuState.sign.target = menuState.sign.target === 1 ? 0 : 1;
        SFX.click();
        return;
      }
      /* 槽位升级按钮 */
      const sb = hitButton(menuState.slotButtons || [], x, y);
      if (sb) {
        benchUpgradeUI.focus = sb.id === 'upgBench' ? { kind: 'bench', index: sb.value } : { kind: 'oven', index: sb.value };
        benchUpgradeToggle(true);
        return;
      }

      const b = hitButton(menuState.buttons, x, y);
      menuState.active = b;
      if (b) b.pressed = true;
      if (b) SFX.click();
    },

    onMove(x, y) {
      menuState.hover = hitButton(menuState.buttons, x, y);
      for (const b of menuState.buttons) b.hover = b === menuState.hover;
    },

    onUp(x, y) {
      const b = menuState.active;
      menuState.active = null;
      for (const btn of menuState.buttons) btn.pressed = false;
      if (!b || !pointInRect(x, y, b)) return;
      if (b.id === 'bench') {
        benchUpgradeUI.focus = null;
        benchUpgradeToggle(true);
      }
      else if (b.id === 'factory') scenes.goto('factory');
      else if (b.id === 'rank') scenes.goto('rank');
      else if (b.id === 'reset') {
        resetGame();
        scenes.goto('menu');
      }
    },

    draw() {
      /* ---- 与营业一致的画面 ---- */
      if (typeof drawBg === 'function') drawBg(ctx, img('bg_closed') ? 'bg_closed' : 'bg_counter');
      else drawFallbackBg(ctx);

      drawCustomers(ctx);
      drawFlipSign(ctx); // 牌子挂在柜台后面(会被柜台挡住下半截)
      drawCounter(ctx);
      drawMoney(ctx);
      drawCart(ctx);
      drawHotbar(ctx);
      drawBench(ctx);
      drawOven(ctx);

      /* 底部栏(与左侧快捷栏齐底) */
      uiPanel(ctx, LAYOUT.bench.x, LAYOUT.bottomY, W - LAYOUT.bench.x - 16, LAYOUT.bottomH, { r: 14 });
      drawText(ctx, '翻牌子开门营业 →', LAYOUT.bench.x + 28, LAYOUT.bottomY + 44, {
        size: 17, color: COLORS.textDim, maxWidth: 210,
      });
      drawText(ctx, '第 ' + shop.day + ' 天　金币 ' + formatNum(shop.coins) + '　口碑 ' + shop.reputation,
        LAYOUT.bench.x + 28, LAYOUT.bottomY + 88, { size: 15, color: COLORS.panelInk, maxWidth: 210 });

      for (const b of menuState.buttons) uiButton(ctx, b);

      /* 制作台/烤位右上角的升级按钮(休息时也能升级) */
      menuState.slotButtons = slotUpgradeButtons();
      for (const b of menuState.slotButtons) uiButton(ctx, b);

      uiHeader(ctx, { title: '月饼工坊 · 开始营业' });

      /* 作者/视频入口 + 互动解锁状态(贴栏底) */
      drawText(ctx, '作者：' + getAuthorName() + '  ·  点击打开视频', LAYOUT.bench.x + 28, LAYOUT.bottomY + 120, {
        size: 13, color: COLORS.textDim,
      });
      const un = '互动解锁：赞' + (interact.liked ? '✔' : '✘') + ' 币' + (interact.coin ? '✔' : '✘')
        + ' 藏' + (interact.fav ? '✔' : '✘') + ' 关注' + (interact.following ? '✔' : '✘');
      drawText(ctx, un, W - 28, LAYOUT.bottomY + 120, { size: 13, align: 'right', color: COLORS.textDim });
    },
  }),
);

/* 翻牌子: 横轴翻转, 0~0.5 面=休息, 0.5~1 面=营业 */
function drawFlipSign(g) {
  const r = signRect();
  const cx = W / 2;
  const top = r.y;
  const phase = menuState.sign.phase;
  const target = menuState.sign.target;

  const open = phase >= 0.5;
  const sx = Math.max(0.02, Math.abs(Math.cos(phase * Math.PI)));

  g.save();
  g.translate(cx, SIGN.cy);
  g.scale(sx, 1);
  g.translate(-cx, -SIGN.cy);

  /* 吊绳: 放在翻转变换里, 跟着牌子一起翻 */
  g.save();
  g.strokeStyle = 'rgba(217,164,65,0.75)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(cx - SIGN.w / 2 + 40, 70);
  g.lineTo(cx - SIGN.w / 2 + 40, top);
  g.moveTo(cx + SIGN.w / 2 - 40, 70);
  g.lineTo(cx + SIGN.w / 2 - 40, top);
  g.stroke();
  g.restore();

  /* 牌面 */
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 22;
  g.shadowOffsetY = 8;
  fillRoundRect(g, r.x, r.y, r.w, r.h, 16, open ? COLORS.panelBorder : COLORS.panelDark);
  g.restore();
  strokeRoundRect(g, r.x, r.y, r.w, r.h, 16, open ? '#ffe9a8' : COLORS.panelBorder, 4);

  if (open) {
    drawText(g, '营业中', cx, r.y + 40, { size: 32, weight: 700, align: 'center', color: '#3a2408' });
    drawText(g, '第 ' + shop.day + ' 天 · 开门！', cx, r.y + 74, { size: 12, weight: 600, align: 'center', color: '#5a3a12' });
    drawText(g, '🥮', cx, r.y + 102, { size: 20, align: 'center' });
  } else {
    drawText(g, '今日休息', cx, r.y + 40, { size: 29, weight: 700, align: 'center', color: COLORS.panelTitle });
    drawText(g, '点击翻牌子 · 开门营业', cx, r.y + 74, {
      size: 12, weight: 600, align: 'center', color: COLORS.textDim,
    });
    drawText(g, '🌙', cx, r.y + 102, { size: 19, align: 'center' });
  }
  g.restore();

  /* 未翻转时轻微呼吸提示 */
  if (phase === 0 && target === 0) {
    const a = (Math.sin(performance.now() / 400) + 1) / 2;
    g.save();
    g.globalAlpha = 0.25 + a * 0.35;
    strokeRoundRect(g, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 20, COLORS.goldLight, 3);
    g.restore();
  }
}

function getAuthorName() {
  return (typeof TOY_AUTHOR_NAME !== 'undefined' && TOY_AUTHOR_NAME) || '作者';
}
