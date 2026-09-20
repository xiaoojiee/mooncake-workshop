'use strict';

/* 场景基类 + 桩函数: 所有场景共享的生命周期 */

function makeScene(handlers) {
  return {
    enter: handlers.enter || function () {},
    exit: handlers.exit || function () {},
    update: handlers.update || function () {},
    draw: handlers.draw || function () {},
    resize: handlers.resize || function () {},
    /* 指针事件(可选) */
    onDown: handlers.onDown || null,
    onMove: handlers.onMove || null,
    onUp: handlers.onUp || null,
    onWheel: handlers.onWheel || null,
    /* 按钮收集: 场景可提供, 供通用交互使用 */
    buttons: handlers.buttons || null,
  };
}
