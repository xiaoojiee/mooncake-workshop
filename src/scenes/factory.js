'use strict';

/* 工厂管理场景: 直接复用共享工厂面板 factoryBoard
 * (营业中打开的面板也用同一块 UI, 见 shop.js) */

/* global scenes, makeScene, ctx, W, H, COLORS, uiHeader, uiButton, drawBg, drawFallbackBg,
   factoryBoard, factoryBoardReset, factoryBoardDraw, factoryBoardDown, factoryBoardMove,
   factoryBoardUp, factoryBoardWheel, factoryBoardUpdate, pointInRect, SFX */

scenes.register(
  'factory',
  makeScene({
    enter() {
      factoryBoardReset();
      factoryBoard.closeAction = function () {
        scenes.goto('menu');
      };
    },

    exit() {
      factoryBoard.drag = null;
      factoryBoard.pending = null;
    },

    update(dt) {
      factoryBoardUpdate(dt);
    },

    onDown(x, y) {
      /* 商店弹窗开着时, 返回键要藏起来也不响应 */
      if (!factoryBoard.shopOpen) {
        const br = { x: W / 2 - 60, y: H - 50, w: 120, h: 38 };
        if (pointInRect(x, y, br)) {
          SFX.click();
          scenes.goto('menu');
          return;
        }
      }
      factoryBoardDown(x, y);
    },

    onMove(x, y) {
      factoryBoardMove(x, y);
    },

    onUp(x, y) {
      factoryBoardUp(x, y);
    },

    onWheel(x, y, delta) {
      factoryBoardWheel(x, y, delta);
    },

    draw() {
      if (typeof drawBg === 'function') drawBg(ctx, 'bg_factory');
      else drawFallbackBg(ctx);

      uiHeader(ctx, { title: '工厂管理 · 能源核心 / 网格 / 仓库' });
      factoryBoardDraw(ctx, { showClose: false });

      /* 底部返回(商店弹窗开着时不画) */
      if (!factoryBoard.shopOpen) {
        const r = { x: W / 2 - 60, y: H - 50, w: 120, h: 38 };
        uiButton(ctx, Object.assign({ label: '返回', size: 15, accent: COLORS.textDim }, r));
      }
    },
  }),
);
