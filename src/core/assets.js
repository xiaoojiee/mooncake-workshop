'use strict';

/* 材质加载: 核心素材必须加载完才 ready; 缺失素材自动降级为占位, 不阻塞流程
 * 全部素材为可选(P0 缺图也能进游戏), 但会记录缺失列表供调试 */

/* global ASSET_LIST, ICON_SCALE, COLORS, fillRoundRect, roundRect, drawText */

const IMG = {}; // key -> HTMLImageElement
const ASSET_READY = {}; // key -> bool
const ASSET_MISSING = {};
let assetsReady = false;
let assetsProgress = 0;

/* 所有素材声明集中在 config 之后由本文件初始化 */
function initAssets() {
  for (const item of ASSET_LIST) {
    IMG[item.key] = new Image();
    ASSET_READY[item.key] = false;
  }
}
initAssets();

function img(key) {
  const i = IMG[key];
  /* IMG 里可能是 <img>, 也可能是从图集切出来的 <canvas>(用 width 判定) */
  return i && (i.naturalWidth || i.width) ? i : null;
}
function hasAsset(key) {
  return !!img(key);
}

/* ---- UI 图集切格 ----
 * assets/贴图/ui.png 是 3×3: 每格一个 UI 件; 加载后裁掉透明留白, 填回对应的 IMG[key]
 * 这样老的 drawSprite(g,'ui_coin',...) / uiPanel / uiButton 都能直接用上真贴图 */
/* UI 图集里「按行顺序」对应的 key(可多套候选, 按图集实际切出几个来选) */
const UI_SHEET_FULL = [
  { key: 'ui_panel', col: 0, row: 0 },
  { key: 'ui_card', col: 1, row: 0 },
  { key: 'ui_button', col: 2, row: 0 },
  { key: 'ui_button_active', col: 0, row: 1 },
  { key: 'ui_coin', col: 1, row: 1 },
  { key: 'ui_star', col: 2, row: 1 },
  { key: 'ui_plate', col: 0, row: 2 },
  { key: 'ui_box', col: 1, row: 2 },
  { key: 'ui_lock', col: 2, row: 2 },
];
/* 精简版: 实际会被绘制的只有这 3 件(面板/按钮已改成程序化绘制) */
const UI_SHEET_LITE = [
  { key: 'ui_coin', col: 0, row: 0 },
  { key: 'ui_plate', col: 1, row: 0 },
  { key: 'ui_lock', col: 2, row: 0 },
];

/* 裁掉四周透明留白(取不透明像素的包围盒) */
function cropToOpaque(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  let data;
  try {
    data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  } catch (_) {
    return canvas; // 跨域污染等, 原样返回
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // 整格透明
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* 回退: 严格等分网格 + 裁透明留白(元素没对齐时才用) */
/* 要切的图集: key = 图集, keys = 按「行->列」顺序对应的目标 key */
const SHEET_SLICES = [
  /* 默认可不指定: 用连通块自动识别(适合元素分离的图集) */
  /* ui 图集: 9 格(完整) 或 3 格(精简: 金币/托盘/锁) 都支持, 按切出来的数量自动选 */
  {
    key: 'ui_sheet',
    keys: UI_SHEET_FULL.map((m) => m.key),
    variants: [
      { keys: UI_SHEET_FULL.map((m) => m.key) },
      { keys: UI_SHEET_LITE.map((m) => m.key) },
    ],
  },
  { key: 'components_sheet', keys: ['comp_motor', 'comp_gear', 'comp_cooler', 'comp_mold', 'comp_mixer', 'comp_moon', 'comp_melon', 'comp_nut', 'comp_kiln', 'comp_spawner'] },
  /* 图标包: 小闪光/挂件分散 -> 按行等分 + 行内投影分列 */
  { key: 'factory_icons', keys: ['factory_crust', 'factory_filling', 'icon_speed', 'icon_capacity', 'icon_quality', 'icon_unlock'], rows: 2 },
  /* 特效: 大爆炸/金币带辉光粘连 -> 直接给固定比例框(相对宽高 0~1) */
  {
    key: 'fx_sheet',
    keys: ['fx_sparkle', 'fx_steam', 'fx_success', 'fx_fail', 'fx_coin'],
    boxes: [
      [0.039, 0.100, 0.273, 0.530], // 闪光
      [0.320, 0.050, 0.610, 0.550], // 蒸汽
      [0.620, 0.090, 0.990, 0.560], // 成功
      [0.140, 0.560, 0.440, 0.995], // 乌云(失败)
      [0.470, 0.540, 0.840, 0.995], // 金币
    ],
  },
];

/* 按行等分 + 行内投影分列, 行优先分配 key(行内空格跳过) */
function sliceSheetByRows(spec) {
  const sheet = img(spec.key);
  if (!sheet) return;
  const sw = sheet.naturalWidth || sheet.width;
  const sh = sheet.naturalHeight || sheet.height;
  const full = document.createElement('canvas');
  full.width = sw;
  full.height = sh;
  full.getContext('2d').drawImage(sheet, 0, 0);
  let data;
  try {
    data = full.getContext('2d').getImageData(0, 0, sw, sh).data;
  } catch (_) {
    return;
  }
  const rows = spec.rows;
  const bh = Math.floor(sh / rows);
  let ki = 0;
  for (let r = 0; r < rows && ki < spec.keys.length; r++) {
    const y0 = r * bh;
    const y1 = r === rows - 1 ? sh - 1 : (r + 1) * bh - 1;
    const colHas = new Array(sw).fill(false);
    for (let x = 0; x < sw; x++) {
      for (let y = y0; y <= y1; y++) {
        if (data[(y * sw + x) * 4 + 3] > 12) {
          colHas[x] = true;
          break;
        }
      }
    }
    const bands = [];
    let s = -1;
    for (let x = 0; x <= sw; x++) {
      const on = x < sw && colHas[x];
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        bands.push([s, x - 1]);
        s = -1;
      }
    }
    const merged = [];
    for (const b of bands) {
      const last = merged[merged.length - 1];
      if (last && b[0] - last[1] <= 8) last[1] = b[1];
      else merged.push(b.slice());
    }
    for (const [x0, x1] of merged) {
      if (ki >= spec.keys.length) break;
      const cell = document.createElement('canvas');
      cell.width = x1 - x0 + 1;
      cell.height = y1 - y0 + 1;
      cell.getContext('2d').drawImage(sheet, x0, y0, cell.width, cell.height, 0, 0, cell.width, cell.height);
      const cropped = cropToOpaque(cell);
      if (!cropped) continue;
      IMG[spec.keys[ki]] = cropped;
      ASSET_READY[spec.keys[ki]] = true;
      delete ASSET_MISSING[spec.keys[ki]];
      ki++;
    }
  }
}

/* 按固定比例框切(每个框一个元素) */
function sliceSheetByBoxes(spec) {
  const sheet = img(spec.key);
  if (!sheet) return;
  const sw = sheet.naturalWidth || sheet.width;
  const sh = sheet.naturalHeight || sheet.height;
  spec.boxes.forEach((b, i) => {
    if (i >= spec.keys.length) return;
    const x = Math.round(b[0] * sw);
    const y = Math.round(b[1] * sh);
    const w = Math.round((b[2] - b[0]) * sw);
    const h = Math.round((b[3] - b[1]) * sh);
    const cell = document.createElement('canvas');
    cell.width = w;
    cell.height = h;
    cell.getContext('2d').drawImage(sheet, x, y, w, h, 0, 0, w, h);
    const cropped = cropToOpaque(cell) || cell;
    IMG[spec.keys[i]] = cropped;
    ASSET_READY[spec.keys[i]] = true;
    delete ASSET_MISSING[spec.keys[i]];
  });
}
/* 整张只有一个元素: 裁掉透明留白后存成 dst */
const SINGLE_CROPS = [
  { key: 'mold_stamp_sheet', dst: 'mold_stamp' },
  { key: 'counter_sheet', dst: 'counter' },
  { key: 'hardware_sheet', dst: 'hardware_moon' }, // 五金月饼(整张一个元素)
];

/* 通用切法: 不依赖网格 —— 扫出不透明「连通块」, 按 行->列 顺序对应 keys */
function sliceSheet(spec) {
  const sheet = img(spec.key);
  if (!sheet) return;
  let keys = spec.keys || null;
  const sw = sheet.naturalWidth || sheet.width;
  const sh = sheet.naturalHeight || sheet.height;

  const full = document.createElement('canvas');
  full.width = sw;
  full.height = sh;
  full.getContext('2d').drawImage(sheet, 0, 0);
  let data;
  try {
    data = full.getContext('2d').getImageData(0, 0, sw, sh).data;
  } catch (_) {
    return; // 跨域污染, 放弃切图
  }

  const n = sw * sh;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] > 12 ? 1 : 0;

  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (visited[s] || !mask[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    visited[s] = 1;
    let minX = sw, minY = sh, maxX = 0, maxY = 0, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % sw;
      const y = (p - x) / sw;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      area++;
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y < sh - 1 ? y + 1 : sh - 1;
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < sw - 1 ? x + 1 : sw - 1;
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const q = ny * sw + nx;
          if (!visited[q] && mask[q]) {
            visited[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (area > 400) comps.push({ minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  }

  /* 数量对不上时的处理:
   *   variants -> 在候选清单里挑一个「数量正好对上」的(例如 UI 图集 9 格/3 格都支持)
   *   有 rows -> 退回按行等分
   *   否则不切 */
  if (spec.variants) {
    const v = spec.variants.find((x) => x.keys.length === comps.length);
    if (!v) {
      if (spec.rows) sliceSheetByRows(spec);
      return;
    }
    keys = v.keys;
  } else if (comps.length !== keys.length) {
    if (spec.rows) sliceSheetByRows(spec);
    return;
  }

  /* 按行分组(中心 y 接近的算同一行), 行内按 x 排序 */
  comps.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const it of comps) {
    const r = rows[rows.length - 1];
    if (!r || it.cy - r.maxCy > 140) rows.push({ maxCy: it.cy, items: [it] });
    else {
      r.items.push(it);
      r.maxCy = Math.max(r.maxCy, it.cy);
    }
  }
  const ordered = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.cx - b.cx);
    for (const it of r.items) ordered.push(it);
  }
  if (ordered.length !== keys.length) {
    if (spec.rows) sliceSheetByRows(spec);
    return;
  }

  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i];
    const pad = 2;
    const x = Math.max(0, b.minX - pad);
    const y = Math.max(0, b.minY - pad);
    const w = Math.min(sw, b.maxX + pad + 1) - x;
    const h = Math.min(sh, b.maxY + pad + 1) - y;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(sheet, x, y, w, h, 0, 0, w, h);
    IMG[keys[i]] = out;
    ASSET_READY[keys[i]] = true;
    delete ASSET_MISSING[keys[i]];
  }
}

/* 单元素图: 裁透明留白存成 dst */
function cropSingleSheet(sheetKey, dstKey) {
  const sheet = img(sheetKey);
  if (!sheet) return;
  const c = document.createElement('canvas');
  c.width = sheet.naturalWidth || sheet.width;
  c.height = sheet.naturalHeight || sheet.height;
  c.getContext('2d').drawImage(sheet, 0, 0);
  const cropped = cropToOpaque(c);
  if (!cropped) return;
  IMG[dstKey] = cropped;
  ASSET_READY[dstKey] = true;
  delete ASSET_MISSING[dstKey];
}

function sliceAllSheets() {
  for (const s of SHEET_SLICES) {
    if (s.boxes) sliceSheetByBoxes(s);
    else if (s.rows) sliceSheetByRows(s);
    else sliceSheet(s);
  }
  for (const s of SINGLE_CROPS) cropSingleSheet(s.key, s.dst);
}

/* 九宫格绘制: 四角不拉伸, 边缘/中间按比例拉伸
 * 目标边界取整后再算每块宽高, 避免小数坐标重采样导致发糊/接缝 */
function drawNine(g, image, x, y, w, h, insetX, insetY) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const X = Math.round(x);
  const Y = Math.round(y);
  const Wd = Math.round(w);
  const Hh = Math.round(h);

  /* 目标比源图小(任一方向)时, 直接整图缩放:
   * 否则九宫格的中段会被压缩成模糊的横/竖条 */
  if (Wd < iw || Hh < ih) {
    if (Wd > 0 && Hh > 0) g.drawImage(image, 0, 0, iw, ih, X, Y, Wd, Hh);
    return;
  }

  let ix = Math.round(Math.min(insetX != null ? insetX : iw * 0.22, iw / 2, Wd * 0.45));
  let iy = Math.round(Math.min(insetY != null ? insetY : ih * 0.22, ih / 2, Hh * 0.45));
  ix = Math.max(0, ix);
  iy = Math.max(0, iy);

  const sx = [0, ix, iw - ix];
  const sw = [ix, iw - 2 * ix, ix];
  const sy = [0, iy, ih - iy];
  const sh = [iy, ih - 2 * iy, iy];

  const xa = X;
  const xb = X + ix;
  const xc = X + Wd - ix;
  const xd = X + Wd;
  const ya = Y;
  const yb = Y + iy;
  const yc = Y + Hh - iy;
  const yd = Y + Hh;
  const dx = [xa, xb, xc];
  const dw = [xb - xa, xc - xb, xd - xc];
  const dy = [ya, yb, yc];
  const dh = [yb - ya, yc - yb, yd - yc];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (dw[c] <= 0 || dh[r] <= 0 || sw[c] <= 0 || sh[r] <= 0) continue;
      const sxv = sx[c];
      const syv = sy[r];
      const swv = sw[c];
      const shv = sh[r];
      const dxv = dx[c];
      const dyv = dy[r];
      const dwv = dw[c];
      const dhv = dh[r];
      /* 需要放大就 1:1 平铺(保持纹理清晰), 缩小时才平滑拉伸 */
      if (swv <= dwv && shv <= dhv) {
        g.save();
        g.beginPath();
        g.rect(dxv, dyv, dwv, dhv);
        g.clip();
        for (let yy = dyv; yy < dyv + dhv; yy += shv) {
          for (let xx = dxv; xx < dxv + dwv; xx += swv) {
            g.drawImage(image, sxv, syv, swv, shv, xx, yy, swv, shv);
          }
        }
        g.restore();
      } else {
        g.drawImage(image, sxv, syv, swv, shv, dxv, dyv, dwv, dhv);
      }
    }
  }
}

/* 加载单张: 失败记为 missing, 不 reject
 * 优先同目录同名 .webp(体积小得多), 没有该文件时自动回退原图(.png)
 * 这样美术仍只交 PNG, 打包时补一份 .webp 即可 */
function loadOne(item) {
  return new Promise((resolve) => {
    const i = IMG[item.key];
    const candidates = /\.png$/i.test(item.src)
      ? [item.src.replace(/\.png$/i, '.webp'), item.src]
      : [item.src];
    let next = 0;

    const tryNext = () => {
      if (next >= candidates.length) {
        ASSET_READY[item.key] = true;
        ASSET_MISSING[item.key] = true;
        resolve();
        return;
      }
      const src = candidates[next];
      next += 1; // 先自增: onerror 在赋值过程中同步回调也不会重复试同一个
      i.src = src;
    };

    i.onload = () => {
      ASSET_READY[item.key] = true;
      resolve();
    };
    i.onerror = () => tryNext(); // 当前候选失败 -> 换下一个
    tryNext();
  });
}

async function loadAssets(onProgress) {
  let done = 0;
  const total = ASSET_LIST.length;
  await Promise.all(
    ASSET_LIST.map(async (item) => {
      await loadOne(item);
      done++;
      assetsProgress = total ? done / total : 1;
      if (onProgress) onProgress(assetsProgress, item.key);
    }),
  );
  assetsReady = true;
  sliceAllSheets(); // 把各图集切成 ui_* / comp_* / fx_* / factory_* ...
  const missing = Object.keys(ASSET_MISSING);
  if (missing.length) console.warn('[assets] 缺失占位:', missing.join(', '));
}

/* 绘制贴图, 缺失时画虚线占位框(带 key 文字), 便于对齐美术 */
function drawSprite(g, key, x, y, w, h, fallbackColor) {
  const i = img(key);
  if (i) {
    /* 以中心放大, 不改调用方的布局坐标 */
    const k = ICON_SCALE || 1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const nw = w * k;
    const nh = h * k;
    g.drawImage(i, cx - nw / 2, cy - nh / 2, nw, nh);
    return true;
  }
  g.save();
  fillRoundRect(g, x, y, w, h, Math.min(w, h) * 0.06, fallbackColor || 'rgba(60,36,21,0.85)');
  g.strokeStyle = 'rgba(217,164,65,0.4)';
  g.lineWidth = 2;
  g.setLineDash([8, 8]);
  roundRect(g, x, y, w, h, Math.min(w, h) * 0.06);
  g.stroke();
  g.setLineDash([]);
  drawText(g, key, x + w / 2, y + h / 2, {
    size: Math.max(11, Math.min(20, w / 14)),
    color: COLORS.cream,
    align: 'center',
  });
  g.restore();
  return false;
}
