'use strict';

/* 排行榜: 三个榜位(金币/评分/口碑) 总榜 + 我的排名 */

/* global scenes, makeScene, ctx, W, H, COLORS, shop, rankState, BOARD, Toy, uiHeader,
   uiPanel, uiButton, drawText, hitButton, pointInRect, SFX, drawBg, drawFallbackBg,
   formatNum, SAVE_KEYS, interact */

const rankTabs = [
  { board: BOARD.coins, label: '金币榜', suffix: '' },
  { board: BOARD.score, label: '评分榜', suffix: '分' },
  { board: BOARD.rep, label: '口碑榜', suffix: '' },
];

scenes.register(
  'rank',
  makeScene({
    enter() {
      rankState.buttons = [];
      rankState.hover = null;
      rankState.active = null;
      loadRank(rankState.board || BOARD.coins);
    },

    onDown(x, y) {
      const b = hitButton(rankState.buttons, x, y);
      rankState.active = b;
      if (b) b.pressed = true;
      if (!b) return;
      SFX.click();

      if (b.id === 'tab') {
        rankState.board = b.value;
        loadRank(b.value);
      } else if (b.id === 'back') {
        scenes.goto('menu');
      } else if (b.id === 'submit') {
        Toy.submitScore(rankState.board, currentScore(rankState.board)).then(() => loadRank(rankState.board));
        showScreenText('已上报成绩');
      }
    },

    onMove(x, y) {
      rankState.hover = hitButton(rankState.buttons, x, y);
      for (const btn of rankState.buttons) btn.hover = btn === rankState.hover;
    },

    onUp() {
      rankState.active = null;
      for (const b of rankState.buttons) b.pressed = false;
    },

    draw() {
      if (typeof drawBg === 'function') drawBg(ctx, 'bg_menu');
      else drawFallbackBg(ctx);

      uiHeader(ctx, { title: '排行榜' });

      /* 标签页 */
      const tabW = 200;
      const tabY = 120;
      rankTabs.forEach((t, i) => {
        const tx = W / 2 - (rankTabs.length * tabW) / 2 + i * tabW;
        const sel = rankState.board === t.board;
        uiPanel(ctx, tx + 6, tabY, tabW - 12, 56, {
          r: 12,
          color: sel ? 'rgba(217,164,65,0.25)' : 'rgba(42,24,16,0.85)',
          borderColor: sel ? COLORS.gold : 'rgba(217,164,65,0.3)',
          shadow: false,
        });
        drawText(ctx, t.label, tx + tabW / 2, tabY + 28, {
          size: 18,
          weight: 700,
          align: 'center',
          color: sel ? COLORS.goldLight : COLORS.textDim,
        });
        rankState.buttons.push({ id: 'tab', value: t.board, x: tx + 6, y: tabY, w: tabW - 12, h: 56, label: '' });
      });

      /* 榜单列表 */
      const lx = W / 2 - 340;
      const ly = 196;
      const lw = 680;
      const lh = 420;
      uiPanel(ctx, lx, ly, lw, lh, { r: 18 });

      drawText(ctx, '名次', lx + 30, ly + 34, { size: 14, color: COLORS.textDim });
      drawText(ctx, '玩家', lx + 120, ly + 34, { size: 14, color: COLORS.textDim });
      drawText(ctx, '成绩', lx + lw - 30, ly + 34, { size: 14, align: 'right', color: COLORS.textDim });
      ctx.strokeStyle = 'rgba(217,164,65,0.25)';
      ctx.beginPath();
      ctx.moveTo(lx + 20, ly + 54);
      ctx.lineTo(lx + lw - 20, ly + 54);
      ctx.stroke();

      if (rankState.loading) {
        drawText(ctx, '加载中…', lx + lw / 2, ly + 200, { size: 20, align: 'center', color: COLORS.textDim });
      } else if (rankState.error) {
        drawText(ctx, rankState.error, lx + lw / 2, ly + 200, { size: 18, align: 'center', color: COLORS.fail });
      } else if (!rankState.list || !rankState.list.length) {
        drawText(ctx, '暂无数据（在 B站 Toy 内可看到全服排行）', lx + lw / 2, ly + 200, {
          size: 16,
          align: 'center',
          color: COLORS.textDim,
        });
      } else {
        rankState.list.slice(0, 12).forEach((it, i) => {
          const ry = ly + 76 + i * 28;
          const mine = rankState.my && rankState.my.rank === it.rank && it.nickname === (rankState.my.nickname || it.nickname);
          if (mine) fillRoundRect(ctx, lx + 12, ry - 13, lw - 24, 26, 8, 'rgba(217,164,65,0.15)');
          const medal = ['🥇', '🥈', '🥉'][it.rank - 1] || String(it.rank);
          drawText(ctx, medal, lx + 44, ry, { size: 16, weight: 700, align: 'center', color: COLORS.cream });
          drawText(ctx, it.nickname || '匿名', lx + 120, ry, { size: 16, color: COLORS.cream });
          drawText(ctx, formatNum(it.score) + (rankTabs.find((t) => t.board === rankState.board).suffix || ''), lx + lw - 30, ry, {
            size: 16,
            weight: 600,
            align: 'right',
            color: COLORS.goldLight,
          });
        });
      }

      /* 我的成绩 */
      const myY = ly + lh + 16;
      uiPanel(ctx, lx, myY, lw, 74, { r: 14, shadow: false });
      const myLabel = rankState.my && rankState.my.ranked ? '我的排名：第 ' + rankState.my.rank + ' 名' : '我的成绩';
      drawText(ctx, myLabel, lx + 30, myY + 26, { size: 18, weight: 700, color: COLORS.goldLight });
      drawText(ctx, formatNum(currentScore(rankState.board)), lx + 30, myY + 52, {
        size: 14,
        color: COLORS.textDim,
      });

      rankState.buttons.push({
        id: 'submit',
        x: lx + lw - 220,
        y: myY + 14,
        w: 190,
        h: 46,
        label: '上报我的成绩',
        size: 15,
        accent: COLORS.ok,
      });
      rankState.buttons.push({ id: 'back', x: 32, y: H - 74, w: 130, h: 50, label: '返回', size: 16, accent: COLORS.textDim });

      for (const b of rankState.buttons) {
        if (b.label) uiButton(ctx, b);
      }
    },
  }),
);

function currentScore(board) {
  if (board === BOARD.coins) return Math.floor(shop.coins);
  if (board === BOARD.score) return shop.bestScore;
  if (board === BOARD.rep) return shop.reputation;
  return 0;
}

async function loadRank(board) {
  rankState.board = board;
  rankState.loading = true;
  rankState.error = '';
  const list = await Toy.getRankList(board, 50);
  const my = await Toy.getMyRank(board);
  rankState.loading = false;
  if (!list) {
    rankState.list = [];
    rankState.error = Toy.available() ? '读取失败，请稍后重试' : '';
  } else {
    rankState.list = list;
  }
  rankState.my = my;
}
