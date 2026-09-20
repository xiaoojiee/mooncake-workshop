'use strict';

/* 指针输入: 统一鼠标与触屏(Pointer Events), 换算为逻辑坐标
 * 触屏时判定容差放宽, 见 TOUCH_TOLERANCE */

/* global screenToLogical, input, W, H */

let isTouchDevice = false;

function initInput() {
  isTouchDevice =
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (navigator.maxTouchPoints || 0) > 0;

  const onDown = (e) => {
    const p = screenToLogical(e.clientX, e.clientY);
    input.pointer.x = p.x;
    input.pointer.y = p.y;
    input.pointer.down = true;
    input.pointer.active = true;
    handlePointerDown(p.x, p.y);
  };
  const onMove = (e) => {
    const p = screenToLogical(e.clientX, e.clientY);
    input.pointer.x = p.x;
    input.pointer.y = p.y;
    handlePointerMove(p.x, p.y);
  };
  const onUp = (e) => {
    const p = screenToLogical(e.clientX, e.clientY);
    input.pointer.x = p.x;
    input.pointer.y = p.y;
    input.pointer.down = false;
    handlePointerUp(p.x, p.y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onDown(e);
  });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', () => {
    input.pointer.down = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* 滚轮: 转发给当前场景的 onWheel(逻辑坐标 + 归一化滚动量) */
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = screenToLogical(e.clientX, e.clientY);
      const delta = e.deltaY / 120; // 一格约 1
      if (typeof handleWheel === 'function') handleWheel(p.x, p.y, delta);
    },
    { passive: false },
  );

  /* 键盘: 快捷键(Esc 返回 / M 静音 / F1 隐藏 UI) */
  window.addEventListener('keydown', (e) => {
    input.keys[e.key] = true;
    if (typeof onKeyDown === 'function') onKeyDown(e);
  });
  window.addEventListener('keyup', (e) => {
    input.keys[e.key] = false;
  });
}

/* 触屏判定容差系数 */
function tolerance() {
  return isTouchDevice ? TOUCH_TOLERANCE : 1;
}
function touching() {
  return isTouchDevice;
}
