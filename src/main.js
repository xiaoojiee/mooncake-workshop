'use strict';

/* 主循环: 更新(逻辑/产线/浮动文字) + 绘制(场景/浮动文字/大字提示) */

/* global scenes, clock, input, updateFactories, updateFloaters, drawFloaters, saveGameThrottled,
   screenMsg, floaters, shake, ctx, W, H, COLORS, setFont, drawText, initInput, VW, VH,
   drawBackpackButton, drawBackpackWindow, backpackUI, drawBenchUpgradeWindow, benchUpgradeUI,
   drawStockingWindow, stockingUI, drawDebugButton, drawClosedOverlay, hudChromeVisible */

let lastTime = 0;
let rafId = 0;

function step(now) {
  rafId = requestAnimationFrame(step);

  const t = now / 1000;
  let dt = lastTime ? t - lastTime : 0;
  lastTime = t;
  /* 切后台回来时 dt 会很大, 截断避免数值跳变 */
  dt = Math.min(dt, 0.05);

  clock.time += dt;
  clock.dt = dt;

  /* 逻辑更新 */
  updateFactories(dt);
  updateFloaters(dt);
  scenes.update(dt);
  saveGameThrottled(dt);

  /* 震动衰减 */
  if (shake.t > 0) shake.t = Math.max(0, shake.t - dt);
  if (shake.t <= 0) shake.power = 0;

  /* 大字提示计时 */
  if (screenMsg.life > 0) screenMsg.life = Math.max(0, screenMsg.life - dt);

  /* ---- 绘制 ---- */
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  /* 应用 DPR 与震屏位移 */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let ox = 0;
  let oy = 0;
  if (shake.power > 0) {
    ox = (Math.random() - 0.5) * 2 * shake.power;
    oy = (Math.random() - 0.5) * 2 * shake.power;
  }
  ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

  scenes.draw();

  /* 闭店: 先给场景蒙黑(内部自带场景判断, 加载页/营业不蒙)
   * 必须画在浮窗之前, 否则「今日菜单」「背包」等弹窗会被一起蒙掉 */
  drawClosedOverlay(ctx);

  /* 全局背包(进入游戏后可用; 启动/加载页不显示) —— 画在蒙板之上, 保持明亮可读 */
  if (hudChromeVisible()) {
    drawBackpackButton(ctx);
    drawDebugButton(ctx);
    if (backpackUI.open) drawBackpackWindow(ctx);
    if (stockingUI.open) drawStockingWindow(ctx);
    if (benchUpgradeUI.open) drawBenchUpgradeWindow(ctx);
  }

  drawFloaters(ctx);
  drawScreenMsg();

  input.pointer.downPrev = input.pointer.down;
}

function drawScreenMsg() {
  if (screenMsg.life <= 0 || !screenMsg.text) return;
  const a = Math.min(1, screenMsg.life / 0.5);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(20,16,12,0.65)';
  ctx.fillRect(0, H / 2 - 92, W, 84);
  drawText(ctx, screenMsg.text, W / 2, H / 2 - 62, {
    size: 40,
    weight: 700,
    align: 'center',
    color: screenMsg.color,
  });
  if (screenMsg.sub) {
    drawText(ctx, screenMsg.sub, W / 2, H / 2 - 22, {
      size: 18,
      align: 'center',
      color: COLORS.textDim,
    });
  }
  ctx.restore();
}

function boot() {
  initInput();
  scenes.goto('boot');
  rafId = requestAnimationFrame(step);
}

/* DOM 就绪后启动 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
