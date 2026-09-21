'use strict';

/* 图集(Sprite Sheet)切割: 把一张大图按行列切成若干子区域绘制
 *
 * 用法:
 *   drawAtlas(g, 'crust_sheet', col, row, cols, rows, x, y, w, h)
 *       -> 从图集第 (col,row) 格取出, 画到 (x,y,w,h)
 *
 * 图集规格(与美术交付一致):
 *   crust_sheet.png   3 行 x 4 列   行: 生面团 / 包好成品 / 摊开饼皮 ; 列: 饼皮种类
 *   filling_a.png     2 行 x 2 列   五仁 / 莲蓉 / 豆沙 / 蛋黄
 *   filling_b.png     2 行 x 2 列   西瓜 / 螺丝 / 砖头 / 腐肉
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

/* 馅料图集: index 0..3 -> filling_a, 4..7 -> filling_b */
function drawFillingIcon(g, index, cx, cy, size) {
  const key = index < 4 ? 'filling_a' : 'filling_b';
  const i = index < 4 ? index : index - 4;
  return drawAtlasFit(g, key, i % 2, Math.floor(i / 2), 2, 2, cx, cy, size);
}
