'use strict';

/* 组装系统: 拖动拼装月饼 + 出餐评分
 *
 * 流程(自由拖拽, 松手判定):
 *   1. 从原料架拖一张面皮 → 放到制作台某个空托盘
 *   2. 依次从原料架拖馅料 → 叠到该托盘的月饼上(一皮多馅)
 *   3. 拖组装好的月饼 → 烤炉烤位
 *   4. 烤好后拖出 → 递给对应客人
 * 拖错位置时原料自动退回原料架, 不消耗库存。
 *
 * 评分: 面皮正确 0.15 + 馅料正确 0.35 + 火候 0.2 + 出餐速度 0.3
 */

/* global COLORS, img, drawSprite, rgba, findCrustDef, findFillingDef, fillingColorOf,
   fillingIndexOf, drawCrustPart, drawFillingIcon, SCORE_WEIGHT, OVEN, fillRoundRect,
   drawText, clamp, ovenBakeTime, ovenBurnTime, FILLING_STACK */

/* ---- 制作台托盘 ---- */
function createSlot() {
  return { crustId: null, fillings: [], state: 'empty', auto: false }; // empty | assembling
}

/* 清空托盘 */
function clearSlot(slot) {
  slot.crustId = null;
  slot.fillings = [];
  slot.state = 'empty';
}

/* 往托盘放面皮: 已有皮则失败 */
function placeCrust(slot, crustId) {
  if (slot.crustId) return { ok: false, reason: '这个托盘已经有皮了' };
  slot.crustId = crustId;
  slot.state = 'assembling';
  return { ok: true };
}

/* 往托盘叠馅料: 必须先有皮, 且不超过上限 */
function placeFilling(slot, fillingId, maxLayers) {
  if (!slot.crustId) return { ok: false, reason: '要先放面皮' };
  if (slot.fillings.length >= (maxLayers || 4)) return { ok: false, reason: '叠不下了' };
  slot.fillings.push(fillingId);
  return { ok: true, index: slot.fillings.length - 1 };
}

/* 撤回最后一层馅料 */
function undoFilling(slot) {
  if (!slot.fillings.length) return null;
  return slot.fillings.pop();
}

/* 托盘是否可送烤: 只有一张饼皮(没馅)也可以 -> 单饼皮月饼 */
function slotReady(slot) {
  return !!slot.crustId;
}

/* ---- 烤位 ---- */
function createOvenSlot() {
  return { moon: null, bake: 0, state: 'idle' }; // idle | baking | ready | burnt
}

/* 送入烤炉 */
function ovenPut(ovenSlot, moon) {
  if (ovenSlot.state !== 'idle') return { ok: false, reason: '这个烤位被占了' };
  ovenSlot.moon = moon;
  ovenSlot.bake = 0;
  ovenSlot.state = 'baking';
  return { ok: true };
}

/* 烤箱是否熟透 */
function ovenDone(ovenSlot) {
  return ovenSlot.state === 'baking' && ovenSlot.bake >= ovenBakeTime();
}
/* 是否烤糊 */
function ovenBurnt(ovenSlot) {
  return ovenSlot.state === 'baking' && ovenSlot.bake >= ovenBurnTime();
}

/* 取出 */
function ovenTake(ovenSlot) {
  if (ovenSlot.state === 'idle') return null;
  const moon = ovenSlot.moon;
  moon.burnt = ovenSlot.bake >= ovenBurnTime();
  moon.bakeTime = ovenSlot.bake;
  ovenSlot.moon = null;
  ovenSlot.bake = 0;
  ovenSlot.state = 'idle';
  return moon;
}

/* 火候档位(用于显示与评分); 受柜台锅炉影响 */
function bakeGrade(bakeTime) {
  const done = ovenBakeTime();
  if (bakeTime < done * 0.6) return 'light'; // 偏生
  if (bakeTime <= done * 1.25) return 'medium'; // 刚好
  if (bakeTime < ovenBurnTime()) return 'dark'; // 偏焦
  return 'burnt'; // 糊了
}
const BAKE_NAME = { light: '偏生', medium: '正好', dark: '偏焦', burnt: '烤糊' };

/* ---- 评分 ---- */

/* 单笔出餐评分, customer/moon 为对应对象 */
function scoreServe(customer, moon) {
  const order = customer.order;

  /* 面皮 */
  const crustOk = moon.crustId === order.crustId ? 1 : 0;

  /* 馅料: 顺序与种类都要对 */
  const want = order.fillings;
  const got = moon.fillings;
  let fillingScore = 0;
  if (want.length) {
    let hit = 0;
    for (let i = 0; i < want.length; i++) {
      if (got[i] === want[i]) hit += 1;
      else if (got.indexOf(want[i]) >= 0) hit += 0.4; // 种类对但顺序错
    }
    /* 多余层数扣分 */
    const extra = Math.max(0, got.length - want.length);
    fillingScore = clamp(hit / want.length - extra * 0.2, 0, 1);
  } else {
    /* 订单没要馅料(单饼皮): 没多放就是对的 */
    fillingScore = got.length === 0 ? 1 : 0;
  }

  /* 火候 */
  let bakeScore = 0;
  if (moon.burnt) bakeScore = 0;
  else {
    const g = bakeGrade(moon.bakeTime || 0);
    bakeScore = g === 'medium' ? 1 : g === 'dark' ? 0.6 : g === 'light' ? 0.5 : 0;
  }

  /* 速度: 剩余耐心比例 */
  const speedScore = clamp(customer.patienceLeft / customer.patienceMax, 0, 1);

  const score =
    crustOk * SCORE_WEIGHT.crust +
    fillingScore * SCORE_WEIGHT.filling +
    bakeScore * SCORE_WEIGHT.bake +
    speedScore * SCORE_WEIGHT.speed;

  return { score, crustOk, fillingScore, bakeScore, speedScore };
}

/* 星级 0~5 */
function starOf(score) {
  return Math.round(score * 5);
}

/* ---- 绘制 ---- */

/* 画托盘里的月饼
 * 组装中(还没送烤): 显示「摊开饼皮 + 叠上去的馅料图标」, 一眼看清放了什么
 * 已包好/已烤: 显示图集第 2 行「成品月饼」, 上面用气泡标出内含馅料 */
function drawSlotMoon(g, slot, cx, cy, r, opts) {
  const o = opts || {};
  const wrapped = !!o.wrapped; // true=显示包好成品(烤完/待烤确认)

  if (!slot.crustId) {
    /* 空托盘 */
    g.save();
    g.strokeStyle = 'rgba(179,155,120,0.45)';
    g.lineWidth = 2;
    g.setLineDash([8, 8]);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.restore();
    drawTextHint(g, '拖面皮到这里', cx, cy + r + 28);
    return;
  }

  const crust = findCrustDef(slot.crustId);
  const col = crust ? crust.col : 0;
  const n = slot.fillings.length;

  if (wrapped) {
    /* 成品月饼(包起来了, 看不到馅) */
    drawCrustPart(g, col, 'done', cx - r, cy - r, r * 2, r * 2);
    /* 馅料气泡 */
    if (n > 0) drawFillingBubble(g, slot.fillings, cx, cy - r - 14, r);
    return;
  }

  /* 组装中: 摊开的饼皮 + 馅料(从下往上堆叠, 每层错开) */
  drawCrustPart(g, col, 'flat', cx - r, cy - r, r * 2, r * 2);

  const stack = typeof FILLING_STACK !== 'undefined' ? FILLING_STACK : { size: 1.7, offX: 0.26, offY: 0.22 };
  const iconSize = r * stack.size;
  const stepX = r * stack.offX;
  const stepY = r * stack.offY;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    /* i=0 是最底一层(偏下), 越往后越往上, 整体以中心对称铺开 */
    const ix = cx + (i - mid) * stepX;
    const iy = cy - (i - mid) * stepY;
    drawFillingIcon(g, fillingIndexOf(slot.fillings[i]), ix, iy, iconSize);
  }

  /* 层数角标 */
  if (n > 0) {
    fillRoundRect(g, cx - 16, cy - r - 8, 32, 26, 8, 'rgba(20,16,12,0.85)');
    drawText(g, String(n), cx, cy - r + 5, { size: 15, weight: 700, align: 'center', color: COLORS.goldLight });
  }
}

/* 馅料气泡: 显示内部馅料的小图标(最多 4 个 + 溢出计数) */
function drawFillingBubble(g, fillings, cx, cy, r) {
  const shown = fillings.slice(0, 4);
  const size = Math.max(20, r * 0.42);
  const gap = 4;
  const bubbleW = shown.length * (size + gap) + gap;
  const bubbleH = size + gap * 2;
  const bx = cx - bubbleW / 2;
  const by = cy - bubbleH;

  /* 气泡主体 + 小尾巴 */
  fillRoundRect(g, bx, by, bubbleW, bubbleH, bubbleH / 2, 'rgba(246,234,210,0.95)');
  g.fillStyle = 'rgba(246,234,210,0.95)';
  g.beginPath();
  g.moveTo(cx - 6, by + bubbleH - 2);
  g.lineTo(cx, by + bubbleH + 8);
  g.lineTo(cx + 6, by + bubbleH - 2);
  g.closePath();
  g.fill();

  shown.forEach((fid, i) => {
    const ix = bx + gap + size / 2 + i * (size + gap);
    drawFillingIcon(g, fillingIndexOf(fid), ix, by + bubbleH / 2, size * 0.92);
  });

  /* 超过 4 种时提示 */
  if (fillings.length > 4) {
    drawText(g, '+' + (fillings.length - 4), bx + bubbleW + 8, by + bubbleH / 2, {
      size: 12, weight: 700, color: COLORS.goldLight,
    });
  }
}

function drawTextHint(g, text, cx, cy) {
  drawText(g, text, cx, cy, { size: 12, align: 'center', color: 'rgba(179,155,120,0.6)' });
}
