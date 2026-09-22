'use strict';

/* 图集(Sprite Sheet)切割: 把一张大图按行列切成若干子区域绘制
 *
 * 用法:
 *   drawAtlas(g, 'crust_sheet', col, row, cols, rows, x, y, w, h)
 *       -> 从图集第 (col,row) 格取出, 画到 (x,y,w,h)
 *
 * 图集规格(与美术交付一致):
 *   crust_sheet.png   3 行 x 4 列   行: 生面团 / 包好成品 / 摊开饼皮 ; 列: 饼皮种类
 *   filling_sheet.png 3 行 x 3 列(中间格空)  五仁/莲蓉/豆沙 蛋黄/-/西瓜 螺丝/砖头/腐肉
 *   npc.png           2 行(第一排3人, 第二排2人) 5 个客人
 */

/* global img, ICON_SCALE */

/* 取某一格的源矩形(像素) */
function atlasSrcRect(image, col, row, cols, rows) {
  const cw = image.naturalWidth / cols;
  const ch = image.naturalHeight / rows;
  return { sx: col * cw, sy: row * ch, sw: cw, sh: ch };
}

/* 把图集某一格画到目标矩形; 缺图返回 false */
function drawAtlas(g, key, col, row, cols, rows, x, y, w, h) {
  const image = img(key);
  if (!image) return false;
  const s = atlasSrcRect(image, col, row, cols, rows);
  g.drawImage(image, s.sx, s.sy, s.sw, s.sh, x, y, w, h);
  return true;
}

/* 把图集某一格按原比例缩放居中画到以 (cx,cy) 为中心、最大边长 maxSize 的框内 */
function drawAtlasFit(g, key, col, row, cols, rows, cx, cy, maxSize) {
  const image = img(key);
  if (!image) return false;
  const s = atlasSrcRect(image, col, row, cols, rows);
  const scale = Math.min(maxSize / s.sw, maxSize / s.sh) * (ICON_SCALE || 1);
  const w = s.sw * scale;
  const h = s.sh * scale;
  g.drawImage(image, s.sx, s.sy, s.sw, s.sh, cx - w / 2, cy - h / 2, w, h);
  return true;
}

/* 客人图集源矩形
 * - 正方形图 -> 2×2 四宫格(新顾客图), index 0..3, 超出回绕
 * - 宽图 -> 旧版: 上排 4 等分取前 3, 下排 2 个居中(0..4) */
/* 立绘图集规格: 3×3 九宫格, 中间格(4)留空 -> 每张图 8 个立绘
 * index 是「逻辑序号」(0..7), 会跳过中间空格映射到实际格子 */
const NPC_SHEET_SPEC = {
  npc_normal: { cols: 3, rows: 3, skip: [4] }, // 普通顾客 8 位
  npc_special: { cols: 3, rows: 3, skip: [4] }, // 特殊客人: 0良子 1刘华强 2史蒂夫, 其余是不同颜色的月兔
};

function npcCellRect(image, index, spec) {
  const W = image.naturalWidth || image.width;
  const H = image.naturalHeight || image.height;
  const cw = W / spec.cols;
  const ch = H / spec.rows;
  const cells = [];
  for (let i = 0; i < spec.cols * spec.rows; i++) {
    if (!spec.skip || spec.skip.indexOf(i) < 0) cells.push(i);
  }
  const n = cells.length || 1;
  const cell = cells[((index % n) + n) % n];
  return {
    sx: (cell % spec.cols) * cw,
    sy: Math.floor(cell / spec.cols) * ch,
    sw: cw,
    sh: ch,
  };
}

/* 旧规则(等宽/四宫格), 没有 spec 的图集走这里 */
function npcSrcRect(image, index) {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  if (W / H < 1.6) {
    const i = index % 4;
    const cw = W / 2;
    const ch = H / 2;
    return { sx: (i % 2) * cw, sy: Math.floor(i / 2) * ch, sw: cw, sh: ch };
  }
  const colW = W / 4; // 上排 4 等分里用前 3 格
  const rowH = H / 2;
  if (index < 3) {
    return { sx: index * colW, sy: 0, sw: colW, sh: rowH };
  }
  /* 下排 2 个居中: 分别位于 1/4 与 3/4 处 */
  const i2 = index - 3;
  const sx = (i2 + 0.5) * colW;
  return { sx, sy: rowH, sw: colW, sh: rowH };
}

/* 画某位 npc 立绘(以脚底中心对齐 x, baseY, 高度 h) */
function drawNpc(g, index, cx, baseY, h, key) {
  const k = key || 'npc_normal';
  const image = img(k);
  if (!image) return false;
  const spec = NPC_SHEET_SPEC[k];
  const s = spec ? npcCellRect(image, index, spec) : npcSrcRect(image, index);
  const hh = h * (ICON_SCALE || 1);
  const w = (s.sw / s.sh) * hh;
  g.drawImage(image, s.sx, s.sy, s.sw, s.sh, cx - w / 2, baseY - hh, w, hh);
  return true;
}

/* 饼图集: 行 0=生面团, 1=包好成品, 2=摊开饼皮 */
const CRUST_ROW = { raw: 0, done: 1, flat: 2 };
const CRUST_COLS = 4;
const CRUST_ROWS = 3;

function drawCrustPart(g, col, rowName, x, y, w, h) {
  const k = ICON_SCALE || 1;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const nw = w * k;
  const nh = h * k;
  return drawAtlas(g, 'crust_sheet', col, CRUST_ROW[rowName] || 0, CRUST_COLS, CRUST_ROWS, cx - nw / 2, cy - nh / 2, nw, nh);
}

/* 馅料图标: 加载时已按 assets.js 的 boxes 切成 filling_0..7(紧贴内容)
 * 顺序不变: 0五仁 1莲蓉 2豆沙 3蛋黄 4西瓜 5螺丝 6砖头 7腐肉
 * 缩放: 8 个图标共用「同一个比例」(size / 最大那张的尺寸),
 *       不做逐张归一化 —— 这样美术画的相对大小能保留 */
const FILLING_SCALE = 0.5; // 馅料整体缩到一半(和美术给的相对大小一起用)
let fillingRefSize = 0;
function fillingRef() {
  if (fillingRefSize > 0) return fillingRefSize;
  let m = 0;
  for (let i = 0; i < 8; i++) {
    const im = img('filling_' + i);
    if (!im) continue;
    m = Math.max(m, im.naturalWidth || im.width, im.naturalHeight || im.height);
  }
  if (m > 0) fillingRefSize = m; // 素材没加载好就先不缓存
  return m || 1;
}

function drawFillingIcon(g, index, cx, cy, size) {
  const i = ((index % 8) + 8) % 8;
  const image = img('filling_' + i);
  if (image) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const k = (size / fillingRef()) * FILLING_SCALE; // 统一比例 + 整体缩小
    const w = iw * k;
    const h = ih * k;
    g.drawImage(image, 0, 0, iw, ih, cx - w / 2, cy - h / 2, w, h);
    return true;
  }
  /* 兜底: 旧的 filling_a / filling_b 两张 2×2 图集 */
  const key = index < 4 ? 'filling_a' : 'filling_b';
  const j = index < 4 ? index : index - 4;
  return drawAtlasFit(g, key, j % 2, Math.floor(j / 2), 2, 2, cx, cy, size);
}
