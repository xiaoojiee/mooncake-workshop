'use strict';

/* 可滚动列表组件: 用于工厂列表 / 组件背包等超出可视区的列表
 *
 * 用法:
 *   const sc = makeScroll(area)          // area = { x, y, w, h }
 *   sc.measure(contentH)                 // 告诉它内容总高(每次绘制前)
 *   const cy = sc.offsetY(0)             // 第 0 项相对内容的 y
 *   ... 绘制内容 ...
 *   sc.drawBar(g)                        // 画滚动条
 *   sc.onWheel(dy)                       // 滚轮
 *   sc.onDragStart(x,y) / onDragMove / onDragEnd  // 拖动条
 *
 * 屏幕外的项由调用方用 sc.visibleTop/Bottom 判断是否跳过绘制 */

/* global clamp, fillRoundRect */

function makeScroll(area) {
  return {
    area,
    contentH: 0,
    scrollY: 0,
    dragging: false,
    dragGrabDy: 0,
    /* 触摸拖动内容(移动端无滚轮时用) */
    contentDrag: false,
    contentStartY: 0,
    contentStartScroll: 0,
    moved: false,

    /* 内容总高变化时调用; 自动夹住 scrollY */
    measure(contentH) {
      this.contentH = Math.max(0, contentH);
      this.clampScroll();
    },

    maxScroll() {
      return Math.max(0, this.contentH - this.area.h);
    },

    clampScroll() {
      this.scrollY = clamp(this.scrollY, 0, this.maxScroll());
    },

    /* 内容坐标: 传入内容内 y(0 为内容顶部), 返回屏幕 y */
    offsetY(contentY) {
      return this.area.y + contentY - this.scrollY;
    },

    /* 可视范围(内容坐标) */
    visibleTop() {
      return this.scrollY;
    },
    visibleBottom() {
      return this.scrollY + this.area.h;
    },

    /* 滚轮: delta 为 0~1 比例 */
    onWheel(delta) {
      this.scrollY += delta * this.area.h * 0.9;
      this.clampScroll();
    },

    /* 拖动条几何 */
    barRect() {
      const barW = 8;
      const x = this.area.x + this.area.w - barW - 2;
      const maxS = this.maxScroll();
      if (maxS <= 0) return { x, y: this.area.y, w: barW, h: this.area.h, thumb: null };
      const trackH = this.area.h;
      const thumbH = Math.max(30, (this.area.h / this.contentH) * trackH);
      const t = this.scrollY / maxS;
      const thumbY = this.area.y + t * (trackH - thumbH);
      return { x, y: this.area.y, w: barW, h: trackH, thumb: { x, y: thumbY, w: barW, h: thumbH } };
    },

    /* 点是否在滚动条上 */
    hitBar(x, y) {
      const b = this.barRect();
      if (!b.thumb) return false;
      return x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y && y <= b.y + b.h;
    },

    onDragStart(x, y) {
      const b = this.barRect();
      if (!b.thumb) return false;
      if (y >= b.thumb.y && y <= b.thumb.y + b.thumb.h) {
        this.dragging = true;
        this.dragGrabDy = y - b.thumb.y;
      } else {
        /* 点击轨道: 直接跳到该处 */
        this.dragging = true;
        this.dragGrabDy = b.thumb.h / 2;
        this.onDragMove(x, y);
      }
      return true;
    },

    onDragMove(x, y) {
      if (!this.dragging) return;
      const b = this.barRect();
      if (!b.thumb) return;
      const trackH = this.area.h;
      const t = clamp((y - this.dragGrabDy - this.area.y) / Math.max(1, trackH - b.thumb.h), 0, 1);
      this.scrollY = t * this.maxScroll();
      this.clampScroll();
    },

    onDragEnd() {
      this.dragging = false;
    },

    /* 点是否在滚动区内容上 */
    hitArea(x, y) {
      const a = this.area;
      return x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;
    },

    /* 开始拖动内容(触摸滚动) */
    onContentDown(x, y) {
      if (!this.hitArea(x, y)) return false;
      this.contentDrag = true;
      this.moved = false;
      this.contentStartY = y;
      this.contentStartScroll = this.scrollY;
      return true;
    },

    onContentMove(x, y) {
      if (!this.contentDrag) return;
      const dy = y - this.contentStartY;
      if (Math.abs(dy) > 4) this.moved = true;
      this.scrollY = this.contentStartScroll - dy;
      this.clampScroll();
    },

    onContentUp() {
      const wasDrag = this.moved;
      this.contentDrag = false;
      this.moved = false;
      return wasDrag; // 返回 true 表示这是一次滚动而非点击
    },

    drawBar(g) {
      if (this.maxScroll() <= 0) return;
      const b = this.barRect();
      fillRoundRect(g, b.x, b.y, b.w, b.h, b.w / 2, 'rgba(20,16,12,0.5)');
      fillRoundRect(g, b.thumb.x, b.thumb.y, b.thumb.w, b.thumb.h, b.w / 2, 'rgba(217,164,65,0.7)');
    },
  };
}
