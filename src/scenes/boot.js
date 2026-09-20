'use strict';

/* Boot: 初始化程序化资源(蒙板 Path2D 等)与容器方向, 然后进入 loading */

/* global scenes, Toy, makeScene */

scenes.register(
  'boot',
  makeScene({
    enter() {
      /* 请求横屏 + 沉浸(仅 App 内生效; 手机不支持"横屏且非沉浸") */
      Toy.requestLandscape();
      /* 监听容器尺寸/安全区变化 */
      Toy.onContainerChange(() => {
        if (typeof resize === 'function') resize();
      });
      scenes.goto('loading');
    },
  }),
);
