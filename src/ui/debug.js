'use strict';

/* 调试按钮: 左上角「+💰」点一下加金币, 方便测试
 * 由 state.js 指针分发拦截, main.js 统一绘制 */

/* global COLORS, shop, uiButton, pointInRect, SFX, showScreenText */

const DEBUG = { on: true, amount: 1000 };

function debugButtonRect() {
  return { x: 156, y: 13, w: 76, h: 44 };
}
function debugHandleDown(x, y) {
  if (!DEBUG.on) return false;
  if (pointInRect(x, y, debugButtonRect())) {
    shop.coins += DEBUG.amount;
    SFX.coin();
    showScreenText('调试 +' + DEBUG.amount + ' 金币', '', COLORS.gold);
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
}
