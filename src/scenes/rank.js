'use strict';

/* 排行榜: 两个榜位(金币/评分) 总榜 + 我的排名 */

/* global scenes, makeScene, ctx, W, H, COLORS, shop, rankState, BOARD, Toy, uiHeader,
   uiPanel, uiButton, drawText, hitButton, pointInRect, SFX, drawBg, drawFallbackBg,
   formatNum, SAVE_KEYS, interact , ratingSubmitValue, formatRating, shopRating, ratingNeedMore */

const rankTabs = [
  { board: BOARD.coins, label: '金币榜', suffix: '' },
  { board: BOARD.score, label: '评分榜', suffix: '分' },
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
        if (b.disabled) {
          showScreenText('评价人数不足，还不能上报');
          return;
        }
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
          color: sel ? 'rgba(196,158,86,0.25)' : COLORS.panelInner,
          borderColor: sel ? COLORS.gold : 'rgba(196,158,86,0.3)',
          shadow: false,
        });
        drawText(ctx, t.label, tx + tabW / 2, tabY + 28, {
          size: 18,
          weight: 700,
          align: 'center',
          color: sel ? COLORS.panelTitle : COLORS.textDim,
        });
        rankState.buttons.push({ id: 'tab', value: t.board, x: tx + 6, y: tabY, w: tabW - 12, h: 56, label: '' });
      });

      /* 榜单列表: 前 50 名, 分两列紧凑排 */
      const lx = W / 2 - 340;
      const ly = 186;
      const lw = 680;
      const lh = 440;
      uiPanel(ctx, lx, ly, lw, lh, { r: 18 });

      drawText(ctx, '名次', lx + 30, ly + 34, { size: 14, color: COLORS.textDim });
      drawText(ctx, '玩家', lx + 120, ly + 34, { size: 14, color: COLORS.textDim });
      drawText(ctx, '成绩', lx + lw - 30, ly + 34, { size: 14, align: 'right', color: COLORS.textDim });
      ctx.strokeStyle = 'rgba(196,158,86,0.25)';
      ctx.beginPath();
      ctx.moveTo(lx + 20, ly + 54);
      ctx.lineTo(lx + lw - 20, ly + 54);
      ctx.stroke();

      if (rankState.loading) {
        drawText(ctx, '加载中…', lx + lw / 2, ly + 200, { size: 20, align: 'center', color: COLORS.textDim });
      } else if (rankState.error) {
        drawText(ctx, rankState.error, lx + lw / 2, ly + 200, { size: 18, align: 'center', color: COLORS.fail });
      } else if (!rankState.list || !rankState.list.length) {
        drawText(ctx, '暂无数据 · 在 B站 Toy 内可看到全服排行', lx + lw / 2, ly + 200, {
          size: 16,
          align: 'center',
          color: COLORS.textDim,
        });
      } else {
        const TOP_N = 50;
        const top = rankState.list.slice(0, TOP_N);
        const half = Math.ceil(top.length / 2);
        const colW = (lw - 28) / 2;
        const rowH = 14;
        top.forEach((it, i) => {
          const col = i < half ? 0 : 1;
          const row = i < half ? i : i - half;
          const rx = lx + 14 + col * colW;
          const ry = ly + 66 + row * rowH;
          const mine = rankState.my && rankState.my.rank === it.rank && it.nickname === (rankState.my.nickname || it.nickname);
          if (mine) fillRoundRect(ctx, rx - 4, ry - 2, colW - 8, rowH + 2, 6, 'rgba(196,158,86,0.18)');
          const medal = ['🥇', '🥈', '🥉'][it.rank - 1] || String(it.rank);
          drawText(ctx, medal, rx + 12, ry, { size: 12, weight: 700, align: 'center', color: COLORS.panelInk });
          drawText(ctx, it.nickname || '匿名', rx + 30, ry, {
            size: 12, color: COLORS.panelInk, maxWidth: colW - 118,
          });
          drawText(ctx, scoreText(rankState.board, it.score) + (rankTabs.find((t) => t.board === rankState.board).suffix || ''),
            rx + colW - 14, ry, { size: 12, weight: 600, align: 'right', color: COLORS.panelTitle });
        });
        if (rankState.list.length > TOP_N) {
          drawText(ctx, '只显示前 ' + TOP_N + ' 名', lx + lw - 20, ly + 44, {
            size: 12, align: 'right', color: COLORS.textDim,
          });
        }
      }

      /* 我的成绩 */
      const myY = ly + lh + 16;
      uiPanel(ctx, lx, myY, lw, 74, { r: 14, shadow: false });
      const myLabel = rankState.my && rankState.my.ranked ? '我的排名：第 ' + rankState.my.rank + ' 名' : '我的成绩';
      drawText(ctx, myLabel, lx + 30, myY + 26, { size: 18, weight: 700, color: COLORS.panelTitle });
      drawText(ctx, myScoreText(rankState.board), lx + 30, myY + 52, {
        size: 14,
        color: COLORS.textDim,
      });

      /* 评分榜: 评价人数不够时不给上报 */
      const canSubmit = rankState.board !== BOARD.score || (typeof shopRating === 'function' && shopRating() != null);
      rankState.buttons.push({
        id: 'submit',
        x: lx + lw - 220,
        y: myY + 14,
        w: 190,
        h: 46,
        label: canSubmit ? '上报我的成绩' : '评价不足，暂不上报',
        size: 15,
        accent: canSubmit ? COLORS.ok : COLORS.textDim,
        disabled: !canSubmit,
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
  /* 评分榜: 外卖式平均星级(整数上报); 评价人数不够 -> 没有分数 */
  if (board === BOARD.score) {
    const v = typeof ratingSubmitValue === 'function' ? ratingSubmitValue() : null;
    return v == null ? 0 : v;
  }
  return 0;
}

/* 榜单上的成绩怎么显示: 评分榜按小数位还原成「4.8523 分」 */
function scoreText(board, value) {
  if (board === BOARD.score) {
    const v = typeof formatRating === 'function' ? formatRating(value) : String(value);
    return v + ' 分';
  }
  return formatNum(value);
}

/* 我的成绩那行: 评分榜要显示评价人数 / 还差几位 */
function myScoreText(board) {
  if (board !== BOARD.score) return formatNum(currentScore(board));
  const r = typeof shopRating === 'function' ? shopRating() : null;
  const n = shop.ratingCount || 0;
  if (r == null) {
    return '评价不足 · 已评 ' + n + ' 位，还差 ' + (typeof ratingNeedMore === 'function' ? ratingNeedMore() : 1) + ' 位';
  }
  return formatRating(currentScore(board)) + ' 分 · ' + n + ' 位客人评分';
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
