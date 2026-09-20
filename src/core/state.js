'use strict';

/* 全局游戏状态: game(流程)/player(工坊)/interact(互动解锁)/rankState(排行榜) */

/* global COLORS, LAYOUT */

/* 工坊经营数据(会被云存档持久化) */
const shop = {
  day: 1,
  coins: 200,
  reputation: 0, // 口碑, 影响客流
  bestScore: 0, // 单笔最佳评分(榜位 2)
  totalStars: 0, // 累计星级
  units: {}, // 已上场的工厂实例 { uid: unit }
  factoryBag: {}, // 工厂仓库: { factoryId: 张数 }
  nextUnitId: 1, // 工厂实例自增 id
  backpack: { crust: {}, filling: {} }, // 背包: 从工厂捡来的产物(组装时就地取用)
  components: {}, // 组件仓库: { compId 数量 }
  ovenLevel: 1, // 烤位等级(决定 run.oven 数量)
  coreLevel: 1, // 能源核心等级(决定总电量)
  autoSlots: [], // 已升级为「自动」的制作台槽位下标
  welcomeGift: false, // 是否已发过开局启动材料(每档只发一次)
  counter: { boiler: 0, tray: 0, cart: 0, autoBake: 0 }, // 柜台升级等级
  items: [], // 持有的特殊道具
  stats: {
    served: 0,
    failed: 0,
    perfect: 0,
    totalCoins: 0,
  },
};

/* 当前营业流程(多客人并发) */
const run = {
  scene: 'boot', // 当前场景键
  customers: [], // 同屏客人 [{ def, order, patienceLeft, patienceMax, state }]
  spawnQueue: [], // 今天还没到店的客人
  spawnTimer: 0, // 下一位客人到店倒计时
  slots: [], // 制作台托盘位
  oven: [], // 烤炉位
  dayTotal: 0, // 今天总客人数
  dayServed: 0, // 今天已服务
  dayLost: 0, // 今天流失
  combo: 0, // 连续完美
  paused: false, // 是否暂停(菜单/结算)
  factoryOpen: false, // 工厂面板是否打开(不暂停游戏)
  money: [], // 撒在柜台上的金币 [{ x,y,vx,vy,value,life,rest,spin }]
  cart: { x: 640, dir: 1 }, // 收银小车的位置/方向(柜台升级解锁后生效)
  powerOn: false, // 是否开业通电(只有营业中为 true, 工厂才生产)
  pendingPlan: null, // (旧)备货时预生成的今日客人计划
  orderPool: null, // 今日菜单: { crusts:[id], fillings:[id] }, 顾客只点这些
  dayTimeLeft: 0, // 今日剩余营业时间(秒)
};

/* 场景系统 */
const scenes = {
  registry: {},
  current: null,
  currentKey: '',

  register(key, scene) {
    this.registry[key] = scene;
  },

  goto(key, payload) {
    if (this.current && this.current.exit) this.current.exit();
    this.currentKey = key;
    run.scene = key;
    this.current = this.registry[key];
    if (!this.current) {
      console.error('[scene] not found: ' + key);
      return;
    }
    if (this.current.enter) this.current.enter(payload || {});
  },

  update(dt) {
    if (this.current && this.current.update) this.current.update(dt);
  },

  draw() {
    if (this.current && this.current.draw) this.current.draw();
  },

  resize() {
    if (this.current && this.current.resize) this.current.resize();
  },
};

/* 输入状态 */
const input = {
  keys: Object.create(null),
  pointer: { x: 0, y: 0, down: false, active: false },
  dragged: null, // 当前拖拽对象 { id, x, y, ... }
};

/* 全局时钟 */
const clock = {
  time: 0, // 游戏内累计时间(秒)
  dt: 0,
};

/* 互动解锁状态(B站) */
const interact = {
  liked: false,
  coin: false,
  fav: false,
  following: false,
  checked: false,
};

/* 排行榜状态 */
const rankState = {
  board: 1, // 当前查看的榜位
  loading: false,
  list: null,
  my: null,
  error: '',
};

/* 屏幕中央大字提示 */
const screenMsg = { text: '', sub: '', life: 0, maxLife: 2.4, color: COLORS.cream };
function showScreenText(text, sub, color) {
  screenMsg.text = text;
  screenMsg.sub = sub || '';
  screenMsg.life = screenMsg.maxLife;
  screenMsg.color = color || COLORS.cream;
}

/* 浮动文字(金币/评分飘字) */
const floaters = [];
function addFloater(text, x, y, color, life) {
  floaters.push({
    text,
    x,
    y,
    color: color || COLORS.gold,
    life: life || 1.2,
    maxLife: life || 1.2,
    vy: -46,
  });
}
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.y += f.vy * dt;
    f.vy *= 0.94;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}
function drawFloaters(g) {
  for (const f of floaters) {
    const a = Math.min(1, f.life / (f.maxLife * 0.6));
    g.save();
    g.globalAlpha = a;
    drawText(g, f.text, f.x, f.y, { size: 26, weight: 700, color: f.color, align: 'center' });
    g.restore();
  }
}

/* 屏幕震动 */
const shake = { t: 0, power: 0 };
function addShake(power) {
  shake.power = Math.max(shake.power, power);
  shake.t = 0.3;
}

/* 指针事件分发: input.js 调用
 * 全局背包浮窗最优先, 其次才转发给当前场景 */
function handlePointerDown(x, y) {
  if (typeof benchUpgradeHandleDown === 'function' && benchUpgradeHandleDown(x, y)) return;
  if (typeof stockingHandleDown === 'function' && stockingHandleDown(x, y)) return;
  if (typeof backpackHandleDown === 'function' && backpackHandleDown(x, y)) return;
  if (typeof debugHandleDown === 'function' && debugHandleDown(x, y)) return;
  const s = scenes.current;
  if (s && s.onDown) s.onDown(x, y);
}
function handlePointerMove(x, y) {
  if (typeof benchUpgradeHandleMove === 'function' && benchUpgradeHandleMove(x, y)) return;
  if (typeof stockingHandleMove === 'function' && stockingHandleMove(x, y)) return;
  if (typeof backpackHandleMove === 'function' && backpackHandleMove(x, y)) return;
  const s = scenes.current;
  if (s && s.onMove) s.onMove(x, y);
}
function handlePointerUp(x, y) {
  if (typeof benchUpgradeHandleUp === 'function' && benchUpgradeHandleUp(x, y)) return;
  if (typeof stockingHandleUp === 'function' && stockingHandleUp(x, y)) return;
  if (typeof backpackHandleUp === 'function' && backpackHandleUp(x, y)) return;
  const s = scenes.current;
  if (s && s.onUp) s.onUp(x, y);
}
function handleWheel(x, y, delta) {
  if (typeof benchUpgradeHandleWheel === 'function' && benchUpgradeHandleWheel(x, y, delta)) return;
  if (typeof stockingHandleWheel === 'function' && stockingHandleWheel(x, y, delta)) return;
  if (typeof backpackHandleWheel === 'function' && backpackHandleWheel(x, y, delta)) return;
  const s = scenes.current;
  if (s && s.onWheel) s.onWheel(x, y, delta);
}
function onKeyDown(e) {
  if (e.key === 'Escape') {
    /* 工厂面板打开时, Esc 先关面板, 不退出营业 */
    if (run.factoryOpen) {
      run.factoryOpen = false;
      return;
    }
    if (run.scene !== 'menu' && run.scene !== 'loading' && run.scene !== 'boot') scenes.goto('menu');
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMute();
  }
}
