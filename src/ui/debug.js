'use strict';

/* 测试用按钮 + 键盘快捷键
 *   左上角「+💰」点一下加金币
 *   键盘: + / = -> 加金币;  1~5 -> 立刻来一位特殊客人;  0 -> 立刻打烊
 * 由 state.js 拦截指针/按键, main.js 统一绘制 */

/* global COLORS, shop, run, uiButton, pointInRect, drawText, SFX, showScreenText,
   CUSTOMERS, makeCustomer */

/* ⚠️ 发布版: 关掉调试按钮/键盘测试键(想自测就临时改成 true) */
const DEBUG = { on: false, amount: 1000 };

/* 键盘提示(画在按钮下方) */
const DEBUG_HINT = '+:金币  1-5:特殊客  0:打烊';

function debugAddCoins() {
  shop.coins += DEBUG.amount;
  SFX.coin();
  showScreenText('测试 +' + DEBUG.amount + ' 金币', '', COLORS.gold);
  return true;
}

/* 立刻来一位特殊客人(1~5 -> 数组下标 0~4) */
function debugSpawnSpecial(i) {
  if (!run || run.scene !== 'shop') return false;
  const specials = CUSTOMERS.filter((c) => c.kind === 'special');
  const def = specials[i];
  if (!def) return false;
  const c = makeCustomer(def, shop.day);
  const waiting = run.customers.filter((x) => x.state === 'waiting').length;
  c.enterT = 0;
  c.leaveT = 0;
  c.leaveSlot = null;
  c.dispSlot = waiting;
  c.targetSlot = waiting;
  run.customers.push(c);
  SFX.click();
  showScreenText('测试：来了 ' + def.name, def.quip || '', COLORS.warn);
  return true;
}

/* 立刻打烊(跳到日终结算) */
function debugSkipDay() {
  if (!run || run.scene !== 'shop') return false;
  run.dayTimeLeft = 0;
  SFX.click();
  showScreenText('测试：立刻打烊', '', COLORS.warn);
  return true;
}

/* 键盘测试键; 返回 true 表示已处理 */
function debugHandleKey(key) {
  if (!DEBUG.on || !key) return false;
  if (key === '+' || key === '=') return debugAddCoins();
  if (key >= '1' && key <= '5') return debugSpawnSpecial(Number(key) - 1);
  if (key === '0') return debugSkipDay();
  return false;
}

function debugButtonRect() {
  return { x: 156, y: 13, w: 76, h: 44 };
}
function debugHandleDown(x, y) {
  if (!DEBUG.on) return false;
  if (pointInRect(x, y, debugButtonRect())) {
    debugAddCoins();
    return true;
  }
  return false;
}
function debugHandleMove() {
  return false;
}
function debugHandleUp() {
  return false;
}
function debugHandleWheel() {
  return false;
}
function drawDebugButton(g) {
  if (!DEBUG.on) return;
  uiButton(g, Object.assign({ label: '+💰', size: 17, accent: COLORS.warn }, debugButtonRect()));
  drawText(g, DEBUG_HINT, 156, 64, {
    size: 10, weight: 600, color: COLORS.cream, stroke: 'rgba(120,70,20,0.8)', strokeWidth: 2.5,
  });
}
