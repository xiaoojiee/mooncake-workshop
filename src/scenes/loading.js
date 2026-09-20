'use strict';

/* Loading: 加载素材 + 存档 + 互动解锁, 完成后进入主菜单 */

/* global scenes, makeScene, loadAssets, assetsProgress, loadGame, refreshUnlocks, Toy,
   drawText, COLORS, W, H, fillRoundRect, strokeRoundRect, setFont, formatTime */

let loadingState = {
  phase: 'assets', // assets -> save -> done
  progress: 0,
  error: '',
  elapsed: 0,
};

scenes.register(
  'loading',
  makeScene({
    enter() {
      loadingState = { phase: 'assets', progress: 0, error: '', elapsed: 0 };

      loadAssets()
        .then(() => {
          loadingState.progress = 1;
          loadingState.phase = 'save';
          return loadGame();
        })
        .then(() => {
          loadingState.phase = 'unlock';
          return refreshUnlocks();
        })
        .then(() => {
          loadingState.phase = 'done';
        })
        .catch((err) => {
          loadingState.error = String(err);
          loadingState.phase = 'done';
        });
    },

    update(dt) {
      loadingState.elapsed += dt;
      if (loadingState.phase === 'assets') loadingState.progress = assetsProgress;
      /* 进入 done 后稍作停留, 避免闪屏 */
      if (loadingState.phase === 'done' && loadingState.elapsed > 0.45) {
        scenes.goto('menu');
      }
    },

    draw() {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);

      drawText(ctx, '月饼工坊', W / 2, H / 2 - 90, {
        size: 56,
        weight: 700,
        color: COLORS.gold,
        align: 'center',
      });
      drawText(ctx, 'MONOCAKE WORKSHOP', W / 2, H / 2 - 38, {
        size: 14,
        color: COLORS.textDim,
        align: 'center',
      });

      const bw = 440;
      const bh = 16;
      const bx = (W - bw) / 2;
      const by = H / 2 + 30;
      const p = loadingState.phase === 'assets' ? loadingState.progress : 1;

      fillRoundRect(ctx, bx, by, bw, bh, bh / 2, 'rgba(20,16,12,0.85)');
      fillRoundRect(ctx, bx, by, Math.max(bh, bw * p), bh, bh / 2, COLORS.gold);
      strokeRoundRect(ctx, bx, by, bw, bh, bh / 2, 'rgba(217,164,65,0.35)', 2);

      const label =
        loadingState.phase === 'assets'
          ? '载入素材 ' + Math.round(p * 100) + '%'
          : loadingState.phase === 'save'
            ? '读取存档…'
            : loadingState.phase === 'unlock'
              ? '同步账号数据…'
              : '准备完成';

      drawText(ctx, label, W / 2, by + 46, { size: 15, color: COLORS.textDim, align: 'center' });
      drawText(ctx, '缺失素材会自动占位, 不影响试玩', W / 2, by + 74, {
        size: 12,
        color: 'rgba(179,155,120,0.6)',
        align: 'center',
      });

      if (loadingState.error) {
        drawText(ctx, '警告: ' + loadingState.error, W / 2, H - 40, {
          size: 13,
          color: COLORS.fail,
          align: 'center',
        });
      }
    },
  }),
);
