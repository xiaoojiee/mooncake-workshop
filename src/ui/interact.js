'use strict';

/* B站互动界面(对齐 demo1): UP 主卡片 + 视频卡片 + 四项互动奖励
 *   - 点赞 / 投币 / 收藏 -> 打开视频
 *   - 关注 -> 访问主页
 *   - 每项奖励只发一次, 领到后状态变「已领取」
 * 由 state.js 的指针分发拦截, main.js 统一绘制 */

/* global W, H, COLORS, Toy, shop, TOY_REWARDS, uiPanel, uiButton, drawText, fillRoundRect,
   strokeRoundRect, pointInRect, showScreenText, refreshUnlocks, SFX, clamp, formatNum , coinIconPos, ctx, LAYOUT, run, interact, pointInRect */

const interactUI = { open: false, hover: null, msg: '', msgT: 0 };

const IA = { w: 860, h: 574, pad: 22, cardH: 150, rowH: 62, rowGap: 10 };

function interactPanelRect() {
  return { x: (W - IA.w) / 2, y: (H - IA.h) / 2, w: IA.w, h: IA.h };
}
function iaCloseRect() {
  const p = interactPanelRect();
  return { x: p.x + p.w - 104, y: p.y + 16, w: 84, h: 36 };
}
function iaRefreshRect() {
  const p = interactPanelRect();
  return { x: p.x + p.w - 208, y: p.y + 16, w: 96, h: 36 };
}
/* 左: UP 主卡片; 右: 视频卡片 */
function iaUpCardRect() {
  const p = interactPanelRect();
  const w = (p.w - IA.pad * 3) / 2;
  return { x: p.x + IA.pad, y: p.y + 68, w: w, h: IA.cardH };
}
function iaVideoCardRect() {
  const p = interactPanelRect();
  const w = (p.w - IA.pad * 3) / 2;
  return { x: p.x + IA.pad * 2 + w, y: p.y + 68, w: w, h: IA.cardH };
}

/* 四项奖励行 */
function iaRowRect(i) {
  const p = interactPanelRect();
  const y0 = p.y + 68 + IA.cardH + 16;
  return { x: p.x + IA.pad, y: y0 + i * (IA.rowH + IA.rowGap), w: p.w - IA.pad * 2, h: IA.rowH };
}
function iaRowBtnRect(i) {
  const r = iaRowRect(i);
  return { x: r.x + r.w - 132, y: r.y + (r.h - 36) / 2, w: 118, h: 36 };
}
/* 模拟模式下的开关(端外测试用) */
function iaMockRect(i) {
  const r = iaRowRect(i);
  return { x: r.x + r.w - 272, y: r.y + (r.h - 32) / 2, w: 118, h: 32 };
}

const IA_KEYS = ['liked', 'coin', 'fav', 'following'];

/* 顶栏金币旁边的互动入口(图标, 不放文字)
 * 只在开始界面/排行榜这种非营业界面出现 */
function interactEntryVisible() {
  return run && (run.scene === 'menu' || run.scene === 'rank');
}
/* 顶栏按钮: 排在「金币数字 + 金币图标」左边的空白处, 不会压到金钱显示 */
function interactIconRect() {
  const g = typeof ctx !== 'undefined' ? ctx : null;
  let x = W - 340;
  if (g && typeof coinIconPos === 'function') {
    const ip = coinIconPos(g);
    const moneyLeft = ip.x - 17 - (ip.numW || 0); // 金钱数字的左边缘
    x = Math.max(64, moneyLeft - 16 - 46);
  }
  const size = 46;
  return { x: x, y: LAYOUT_HEADER() / 2 - size / 2, w: size, h: size };
}
function LAYOUT_HEADER() {
  return typeof LAYOUT !== 'undefined' && LAYOUT.headerH ? LAYOUT.headerH : 70;
}
/* 有没有「已达成但还没领」的奖励 -> 图标上点个小圆点 */
function interactHasClaimable() {
  const got = shop.toyRewards || {};
  for (const k of IA_KEYS) {
    if (got[k]) continue;
    if (typeof interact !== 'undefined' && interact[k]) return true;
  }
  return false;
}
function interactEntryDown(x, y) {
  if (!interactEntryVisible()) return false;
  if (!pointInRect(x, y, interactIconRect())) return false;
  interactToggle();
  return true;
}

/* 顶栏那个互动按钮: 和全局背包按钮同一层(main.js 的挂件区), 指针指上去会亮 */
function drawInteractButton(g) {
  if (!interactEntryVisible()) return;
  const ir = interactIconRect();
  const p = typeof input !== 'undefined' && input.pointer ? input.pointer : null;
  const hover = !!(p && pointInRect(p.x, p.y, ir));
  uiButton(g, Object.assign({
    id: 'interact', label: '', accent: COLORS.gold, hover: hover,
    pressed: hover && !!(p && p.down),
  }, ir));
  const pad = 9;
  drawSprite(g, 'interact_icon', ir.x + pad, ir.y + pad, ir.w - pad * 2, ir.h - pad * 2);
  if (interactHasClaimable()) {
    g.save();
    g.fillStyle = COLORS.fail;
    g.beginPath();
    g.arc(ir.x + ir.w - 7, ir.y + 7, 6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

function interactOpen() {
  interactUI.open = true;
  interactUI.hover = null;
  interactUI.msg = '';
  interactUI.msgT = 0;
  /* 打开时拉一次封面/标题/头像(SDK 没到就等它 onload 再拉) */
  if (typeof Toy !== 'undefined' && Toy.loadMedia) Toy.loadMedia();
  /* 打开时顺手刷一次(可能刚点完赞回来) */
  if (typeof refreshUnlocks === 'function') refreshUnlocks();
}
function interactClose() {
  interactUI.open = false;
}
function interactToggle() {
  if (interactUI.open) interactClose();
  else interactOpen();
}

function iaDone(key) {
  return !!(shop.toyRewards && shop.toyRewards[key]);
}
function iaLabel(key) {
  const d = TOY_REWARDS[key];
  return d ? d.label : key;
}
function iaRewardText(key) {
  const d = TOY_REWARDS[key];
  return d ? d.text : '';
}
/* 状态文案 */
function iaStatusText(key) {
  if (iaDone(key)) return '已领取';
  const got = { liked: 'liked', coin: 'coin', fav: 'fav', following: 'following' }[key];
  if (typeof interact !== 'undefined' && interact[got]) return '可领取';
  return '未达成';
}
/* 点「去完成」: 关注跳主页, 其余跳视频 */
function iaGo(key) {
  SFX.click();
  if (key === 'following') Toy.openAuthor();
  else Toy.openVideo();
  interactUI.msg = '去 B站 完成后再回来点「刷新」';
  interactUI.msgT = 3.5;
}

/* ---- 输入(由 state.js 分发) ---- */
function interactHandleDown(x, y) {
  if (!interactUI.open) return false;
  const p = interactPanelRect();
  if (!pointInRect(x, y, p)) return false; // 面板外的点击交回场景
  for (const b of iaButtons()) {
    if (!pointInRect(x, y, b)) continue;
    SFX.click();
    if (b.id === 'close') interactClose();
    else if (b.id === 'refresh') {
      if (typeof refreshUnlocks === 'function') refreshUnlocks();
      interactUI.msg = '已刷新互动状态';
      interactUI.msgT = 2.5;
    } else if (b.id === 'home') Toy.openAuthor();
    else if (b.id === 'video') Toy.openVideo();
    else if (b.id === 'go') iaGo(b.value);
    else if (b.id === 'mock') {
      if (window.__toyMock) window.__toyMock.toggle(b.value);
    }
    return true;
  }
  return true; // 点在面板空白处: 吃掉, 不漏到场景
}
function interactHandleMove(x, y) {
  if (!interactUI.open) return false;
  interactUI.hover = null;
  for (const b of iaButtons()) {
    if (pointInRect(x, y, b)) { interactUI.hover = b.id + ':' + (b.value || ''); break; }
  }
  return pointInRect(x, y, interactPanelRect());
}
function interactUpdate(dt) {
  if (interactUI.msgT > 0) {
    interactUI.msgT -= dt;
    if (interactUI.msgT <= 0) interactUI.msg = '';
  }
}

function iaButtons() {
  const list = [];
  const p = interactPanelRect();
  list.push(Object.assign({ id: 'close', label: '关闭' }, iaCloseRect()));
  list.push(Object.assign({ id: 'refresh', label: '刷新' }, iaRefreshRect()));
  /* 点卡片本身也能跳: 点 UP 主卡片 -> 主页, 点视频卡片 -> 视频 */
  const upc = iaUpCardRect();
  const vcc = iaVideoCardRect();
  list.push({ id: 'home', x: upc.x, y: upc.y, w: upc.w, h: upc.h, label: '' });
  list.push({ id: 'video', x: vcc.x, y: vcc.y, w: vcc.w, h: vcc.h, label: '' });
  for (let i = 0; i < IA_KEYS.length; i++) {
    const r = iaRowBtnRect(i);
    list.push({ id: 'go', value: IA_KEYS[i], x: r.x, y: r.y, w: r.w, h: r.h, label: '' });
    if (Toy.isMock && Toy.isMock()) {
      const m = iaMockRect(i);
      list.push({ id: 'mock', value: IA_KEYS[i], x: m.x, y: m.y, w: m.w, h: m.h, label: '' });
    }
  }
  return list;
}

/* 圆形裁剪画头像 */
function iaDrawAvatar(g, cx, cy, r) {
  const im = Toy.avatar && Toy.avatar();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = COLORS.panelInner;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (im && (im.naturalWidth || im.width)) {
    const iw = im.naturalWidth || im.width;
    const ih = im.naturalHeight || im.height;
    const s = Math.max((r * 2) / iw, (r * 2) / ih);
    g.drawImage(im, cx - (iw * s) / 2, cy - (ih * s) / 2, iw * s, ih * s);
  }
  g.restore();
  strokeRoundRect(g, cx - r, cy - r, r * 2, r * 2, r, COLORS.panelBorder, 2);
}

/* 封面(圆角裁剪) */
function iaDrawCover(g, r) {
  const im = Toy.cover && Toy.cover();
  g.save();
  g.beginPath();
  roundRectPath(g, r.x, r.y, r.w, r.h, 10);
  g.clip();
  g.fillStyle = 'rgba(38,26,16,0.9)';
  g.fillRect(r.x, r.y, r.w, r.h);
  if (im && (im.naturalWidth || im.width)) {
    const iw = im.naturalWidth || im.width;
    const ih = im.naturalHeight || im.height;
    const s = Math.max(r.w / iw, r.h / ih);
    g.drawImage(im, r.x + (r.w - iw * s) / 2, r.y + (r.h - ih * s) / 2, iw * s, ih * s);
  }
  g.restore();
  strokeRoundRect(g, r.x, r.y, r.w, r.h, 10, COLORS.panelBorder, 2);
  /* 播放三角 */
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(cx, cy, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.cream;
  g.beginPath();
  g.moveTo(cx - 6, cy - 10);
  g.lineTo(cx - 6, cy + 10);
  g.lineTo(cx + 10, cy);
  g.closePath();
  g.fill();
  g.restore();
}
function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
}

/* ---- 绘制(由 main.js 统一调用) ---- */
function drawInteractWindow(g) {
  if (!interactUI.open) return;
  const p = interactPanelRect();
  uiPanel(g, p.x, p.y, p.w, p.h, { r: 18 });

  drawText(g, 'B站互动', p.x + 24, p.y + 22, { size: 22, weight: 700, color: COLORS.panelTitle });
  uiButton(g, Object.assign({ id: 'refresh', label: '刷新', size: 15, accent: COLORS.textDim }, iaRefreshRect()));
  uiButton(g, Object.assign({ id: 'close', label: '关闭', size: 15, accent: COLORS.textDim }, iaCloseRect()));

  /* UP 主卡片 */
  const up = iaUpCardRect();
  fillRoundRect(g, up.x, up.y, up.w, up.h, 14, COLORS.panelInner);
  strokeRoundRect(g, up.x, up.y, up.w, up.h, 14, 'rgba(196,158,86,0.5)', 1.5);
  drawText(g, 'UP主', up.x + 16, up.y + 10, { size: 13, color: COLORS.textDim });
  iaDrawAvatar(g, up.x + 58, up.y + 74, 34);
  drawText(g, Toy.authorName(), up.x + 106, up.y + 56, { size: 19, weight: 700, color: COLORS.panelInk });

  /* 视频卡片 */
  const vc = iaVideoCardRect();
  fillRoundRect(g, vc.x, vc.y, vc.w, vc.h, 14, COLORS.panelInner);
  strokeRoundRect(g, vc.x, vc.y, vc.w, vc.h, 14, 'rgba(196,158,86,0.5)', 1.5);
  drawText(g, '视频', vc.x + 16, vc.y + 10, { size: 13, color: COLORS.textDim });
  iaDrawCover(g, { x: vc.x + 16, y: vc.y + 34, w: 138, h: 84 });
  drawText(g, Toy.videoTitle(), vc.x + 166, vc.y + 48, {
    size: 15, weight: 600, color: COLORS.panelInk, maxWidth: vc.w - 186,
  });

  /* 四项互动奖励 */
  for (let i = 0; i < IA_KEYS.length; i++) {
    const key = IA_KEYS[i];
    const r = iaRowRect(i);
    const done = iaDone(key);
    fillRoundRect(g, r.x, r.y, r.w, r.h, 12, done ? 'rgba(103,153,75,0.16)' : 'rgba(196,158,86,0.14)');
    strokeRoundRect(g, r.x, r.y, r.w, r.h, 12, done ? 'rgba(103,153,75,0.6)' : 'rgba(196,158,86,0.45)', 1.5);
    drawText(g, iaLabel(key), r.x + 18, r.y + 20, { size: 17, weight: 700, color: COLORS.panelInk });
    drawText(g, iaRewardText(key), r.x + 18 + 92, r.y + 22, { size: 15, color: COLORS.panelTitle });
    drawText(g, iaStatusText(key), r.x + r.w - 148, r.y + 22, {
      size: 15, weight: 700, align: 'right', color: done ? COLORS.ok : COLORS.textDim,
    });
    if (Toy.isMock && Toy.isMock()) {
      const m = iaMockRect(i);
      const on = !!(window.__toyMock && window.__toyMock.state && window.__toyMock.state[key]);
      uiButton(g, Object.assign({
        id: 'mock', label: on ? '已达成' : '未达成', size: 13,
        accent: on ? COLORS.ok : COLORS.textDim,
      }, m));
    }
    uiButton(g, Object.assign({
      id: 'go', label: done ? '已领取' : (key === 'following' ? '去关注' : '去完成'), size: 14,
      accent: done ? COLORS.textDim : COLORS.gold,
      disabled: done,
    }, iaRowBtnRect(i)));
  }

  if (interactUI.msg) {
    drawText(g, interactUI.msg, p.x + p.w / 2, p.y + p.h - 26, {
      size: 14, align: 'center', color: COLORS.textDim,
    });
  } else if (Toy.isMock && Toy.isMock()) {
    drawText(g, '模拟模式：点「未达成」可直接切换互动状态', p.x + p.w / 2, p.y + p.h - 26, {
      size: 13, align: 'center', color: COLORS.textDim,
    });
  }
}
