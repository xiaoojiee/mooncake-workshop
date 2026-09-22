'use strict';

/* Boot: 初始化程序化资源(蒙板 Path2D 等)与容器方向, 然后进入 loading */

/* global scenes, Toy, makeScene, initSounds */

scenes.register(
  'boot',
  makeScene({
    enter() {
      /* 请求横屏 + 沉浸(仅 App 内生效; 手机不支持"横屏且非沉浸") */
      Toy.requestLandscape();
      /* 监听容器尺寸/安全区变化 */
      Toy.onContainerChange((state) => {
        /* 按容器给的可用尺寸(扣安全区)重排画布 */
        if (typeof applyContainerSize === 'function') applyContainerSize(state);
        else if (typeof resize === 'function') resize();
      });
      /* 预加载音效(没有 Audio 的环境会自己跳过) */
      try { if (typeof initSounds === 'function') initSounds(); } catch (_) {}
      /* 拉 UP 头像 / 视频封面标题(拿不到会自动退回 config 兜底) */
      try { if (Toy && Toy.loadMedia) Toy.loadMedia(); } catch (_) {}
      scenes.goto('loading');
    },
  }),
);
