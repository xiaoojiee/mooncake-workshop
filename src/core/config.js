'use strict';

/* 常量与数值配置: 分辨率/配色/解锁条件/排行榜榜位 */

/* ---- 画布 ---- */
const VW = 1280; // 逻辑分辨率宽
const VH = 720; // 逻辑分辨率高
let W = VW;
let H = VH;

/* ---- 全局 UI 缩放(手机适配: 画布按 16:9 缩放, 小屏文字/图标按比例放大更清楚) ---- */
let UI_SCALE = 1.18; // 文字放大系数
let ICON_SCALE = 1.18; // 图标放大系数(以中心缩放, 不改变布局坐标)

/* ---- 配色 ---- */
const COLORS = {
  bg: '#14100c',
  panel: '#793b23', // 面板底色
  panelLight: '#9a4d2e', // 悬停/浅面板
  panelDark: '#5c2c1a', // 外层大面板(和内层区分)
  panelBorder: '#fcc33f', // 面板/按钮包边
  gold: '#d9a441',
  goldLight: '#f2cf7a',
  cream: '#f6ead2',
  text: '#f6ead2',
  textDim: '#b39b78',
  ok: '#7fb069',
  warn: '#e8b33a',
  fail: '#d05a4e',
  lotus: '#c98a4b',
  bean: '#7b3f2e',
  custard: '#e8b33a',
  crust: '#e0a45c',
  icy: '#bcd9e8',
};

/* ---- 操作台尺寸(逻辑坐标) ---- */
const LAYOUT = {
  headerH: 70,

  /* ---- 沙威玛式布局: 上方客人(只露上半身) / 下方柜台(制作台) ----
   * 客人在柜台后面, 从右侧走进来排队; 柜台前沿把下半身挡住 */
  counterY: 322, // 柜台前沿 y: 这条线以上是客人, 以下是柜台面

  /* 客人站位区(柜台后): 从左到右排队, 每位一个站位 */
  stand: {
    top: 70, // 站位区顶部(在 HUD 之下)
    count: 6, // 最多同屏 6 位
    slotW: 190, // 每位客人占的横向宽度
    width: 1240, // 站位区总宽
    x: 20,
    baseY: 322, // 脚(被挡住的)位置 = 柜台前沿
    headH: 180, // 上半身高度(给头顶订单气泡腾地方)
  },

  /* 柜台面(制作台): 背包 / 托盘 / 烤炉 都在柜台上 */
  backpack: { x: 20, y: 350, w: 244, h: 354, itemH: 52 }, // 左侧快捷栏(与制作台同顶同底, 滚动列表)
  bench: { x: 264, y: 350, w: 700, h: 196, slotW: 216, gap: 14 }, // 中部托盘
  oven: { x: 976, y: 350, w: 284, h: 196 }, // 右侧烤炉
  /* 底部操作栏(与左侧快捷栏齐底) */
  bottomY: 560,
  bottomH: 144,
};

/* ---- 背景贴图对位 ----
 * cover 铺满画布(不拉伸变形), 再整体平移对位
 * offsetY / offsetX 为「占贴图自身绘制尺寸的比例」(0.3 = 平移 30%)
 * offsetY 为负 = 整体向上平移; 正 = 向下
 * zoom < 1 会露出边, 一般保持 >= 1 */
const BG = {
  zoom: 1,
  offsetY: -0.3,
  offsetX: 0,
};

/* ---- 组装规则 ----
 * 一皮多馅: 托盘里先放一张面皮, 再往上叠加多个馅料
 * 每层馅料对应订单里的一个 layer(含蒙板造型) */
const ASSEMBLY = {
  maxFillings: 6, // 单个月饼最多叠加几层馅料(后期订单会越来越厚)
  benchtopSlots: 1, // 制作台托盘位数(开局 1 个, 靠「制作台升级」加)
  /* 拖拽松手判定: 托盘命中半径(相对托盘) */
  dropTolerance: 0.6,
};

/* ---- 组装台馅料堆叠(比例均相对托盘月饼半径 r) ----
 * 多种馅料从下往上叠, 每层错开一点, 像一叠牌 */
const FILLING_STACK = {
  size: 2.05, // 馅料图标边长 = size * r(比饼皮略大一点)
  offX: 0.26, // 每层横向偏移 = offX * r
  offY: 0.22, // 每层纵向偏移 = offY * r
};

/* ---- B站信息(接入后按需修改) ---- */
const TOY_BVID = 'BV1XwtB6YECv'; // 绑定的视频 BV 号
const TOY_AUTHOR_UID = '137429365'; // UP 主 uid
const TOY_AUTHOR_NAME = '火山哥哥'; // 作者名兜底
const TOY_VIDEO_TITLE = '月饼工坊'; // 视频标题兜底

/* ---- 排行榜榜位 ---- */
const BOARD = {
  coins: 1, // 总金币榜
  score: 2, // 单笔最佳订单评分榜
  rep: 3, // 累计口碑榜
};

/* ---- 互动解锁 ----
 * 用点赞/投币/收藏/关注解锁限定内容(端内端外均支持, 不弹数据确认)
 * 注: 当前食材表暂未挂互动解锁项, 预留给后续限定食材 */
const UNLOCKS = {
  liked: { name: '月兔印饼皮', label: '点赞解锁' },
  coin: { name: '玉盘纹馅料', label: '投币解锁' },
  fav: { name: '咸蛋黄流心', label: '收藏解锁' },
  following: { name: '冰皮', label: '关注解锁' },
};

/* ---- 游戏节奏(多客人并发) ---- */
const DAY = {
  duration: 90, // 每天营业时长(秒), 时间到就收摊(等店里客人处理完)
  customerMin: 6, // (已改为时间制, 保留仅作参考)
  customerMax: 16,
  /* 客人到店间隔(秒), 随天数缩短 */
  spawnBase: 13,
  spawnDecay: 0.6,
  spawnMin: 5.2,
  /* 每个客人独立耐心(秒), 随天数缩短 */
  patienceBase: 46,
  patienceDecay: 2.1,
  patienceMin: 18,
  /* 耐心随订单复杂度增加 */
  patiencePerLayer: 12,
  /* 特殊客人耐心更短、奖励更高 */
  specialPatience: 0.8,
  specialReward: 2.0, // 3.0 太肥, 客均收入尖刺大
  /* 同屏最多客人 */
  maxOnScreen: 6,
  /* 耐心耗尽离开的惩罚 */
  leaveCoinPenalty: 15,
  leaveRepPenalty: 2,
};

/* ---- 撒钱(客人结算的金币拆成分币撒出, 点击收集才入账) ----
 * 每位客人的结算金币会拆成 2~3 枚金币散落到柜台台面上,
 * 在 life 秒内点击捡起才算钱; 没捡到就消失(这笔钱就没了) */
const MONEY = {
  perCustomer: [2, 3], // 每位客人撒出的金币枚数(含范围)
  scatterVx: [-180, 180], // 撒出初速度 x 范围
  scatterVy: [-360, -210], // 撒出初速度 y 范围(向上)
  gravity: 1150, // 重力加速度
  bounce: 0.42, // 落到台面后的弹跳衰减
  restAboveCounter: 20, // 静止高度: counterY 往上这么多(落在柜台台面上)
  life: 7, // 停留多久后消失(秒)
  blinkAt: 2.5, // 剩余多少秒开始闪烁提示
  pickupRadius: 48, // 点击拾取半径
  touchExtra: 26, // 触屏额外放宽
};

/* ---- 能源核心 ----
 * 每座工厂耗 1 格电; 核心等级决定总电量(可同时供电的工厂数)
 * 电量不够时, 离核心近的工厂优先通电, 最远的断电
 * coreCost: 升到下一级的花费(下标 = 当前等级-1) */
const CORE = {
  maxLevel: 5,
  capacity: [3, 5, 7, 10, 14], // 各等级总电量
  cost: [500, 1100, 2200, 4000], // 1→2, 2→3, 3→4, 4→5
};

/* ---- 工厂生产(进度条 → 掉落产物) ----
 * 通电工厂按 speed 累积进度, 进度满 1 生成一个产物(掉落状态)
 * 工厂旁边堆到 maxDrops 个未捡产物就停产 */
const PRODUCE = {
  maxDrops: 3, // 单个工厂最多堆几个待捡产物
  dropValue: 1, // 一个产物 = 几份原料进背包
};

/* ---- 开门前备货 ----
 * 饼皮固定价; 馅料按「今天的订单需求」浮动: 客人要的贵, 没人要的便宜 */
const STOCKING = {
  crustPrice: 24, // 饼皮固定单价
  fillingBase: 14, // 馅料基准价
  demandUp: 1.8, // 今日有人点 -> 加价倍率
  demandDown: 0.5, // 今日没人点 -> 降价倍率
};

/* ---- 柜台升级(在工厂管理页购买) ----
 *   boiler 锅炉   : 提升烤炉效率(缩短烘烤时间, 延后烤糊)
 *   tray   托盘   : 制作台托盘位 +1(最多到 slots)
 *   cart   收银小车: 柜台上来回移动, 自动捡起沿途金币
 */
const COUNTER_LABEL = { tray: '制作台数量', boiler: '烤炉速度', cart: '收银小车', auto: '自动装配速度', autoBake: '自动烤制' };
const COUNTER = {
  /* 制作台数量: 1 个起, 最多加到 tray.slots 个 */
  tray: { max: 3, slots: 4, cost: [375, 875, 1750] },
  /* 烤炉速度: 缩短烘烤时间 / 延后烤糊 */
  boiler: { max: 3, bakeFactor: 0.12, burnFactor: 0.18, cost: [325, 700, 1225] },
  /* 收银小车: 柜台上来回移动自动捡金币 */
  cart: { max: 2, speed: [170, 300], radius: [44, 62], cost: [375, 800] },
  /* 制作台自动化: 自动从背包取皮+馅, 按客人订单填满空托盘
   * interval[lv-1] = 该等级的「每步间隔」(秒), 越小越快 */
  auto: { max: 3, interval: [3.0, 2.2, 1.6], cost: [1500, 1200, 1600] },
  /* 自动烤制: 自动装配好的月饼自动送进空烤位 */
  autoBake: { max: 1, cost: [2400] },
};

/* ---- 工厂 ---- */
const FACTORY_TICK = 0.5; // 产线结算步长(秒)
const STOCK_START_RATIO = 0.5; // 开局库存占容量比例
const START_MATERIAL_EACH = 5; // 开局赠送的启动材料: 初始饼皮 + 初始馅料, 每种各 5 个
/* 取货: 从工厂面板把原料搬到原料架, 每次可连续取 */
const FETCH = {
  batch: 1, // 每次点击取 1 份
  holdRepeat: 0.12, // 长按连取间隔(秒)
};

/* ---- 烤炉 ---- */
const OVEN = {
  slots: 1, // 初始烤位数(可升级)
  maxSlots: 4, // 升级上限
  bakeTime: 9, // 标准烘焙时长(秒)
  burnTime: 15, // 超过此时长未取出 → 烤糊
};

/* ---- 评分 ---- */
const SCORE_WEIGHT = {
  crust: 0.15, // 面皮正确
  filling: 0.35, // 馅料种类与层数正确
  bake: 0.2, // 火候
  speed: 0.3, // 出餐速度(剩余耐心比例)
};
/* 触屏时判定放宽 */
const TOUCH_TOLERANCE = 1.4;

/* ---- 存档 ---- */
const SAVE_VERSION = 1;
const SAVE_PREFIX = 'mooncake';
const SAVE_KEYS = {
  meta: SAVE_PREFIX + '_meta',
  factory: SAVE_PREFIX + '_factory',
  progress: SAVE_PREFIX + '_progress',
};
const LOCAL_SAVE_KEY = 'mooncake_workshop_local';

/* ---- 素材清单 ----
 * 路径相对站点根目录; 文件名需与美术交付一致(详见 ASSETS.md)
 * 缺失的素材不会阻塞游戏, 会以虚线占位框显示 */
const ASSET_LIST = [
  /* ---- 图集(sprite sheet): 已交付 ---- */
  /* 饼皮 3行(生面团/包好成品/摊开饼皮) x 4列(糖浆/奶黄/抹茶/巧克力) */
  { key: 'crust_sheet', src: 'assets/sprite/crust_sheet.png' },
  /* 馅料 各 2x2 */
  { key: 'filling_a', src: 'assets/sprite/filling_a.png' }, // 五仁/莲蓉/豆沙/蛋黄
  { key: 'filling_b', src: 'assets/sprite/filling_b.png' }, // 西瓜/螺丝/砖头/腐肉
  /* 客人 2×2 四宫格立绘 */
  { key: 'npc', src: 'assets/贴图/顾客.png' },

  /* 图集/包(自动识别连通块切格, 不要求严格网格; 顺序见 core/assets.js 的 SHEET_SLICES)
   * 之后美术交付的贴图统一放 assets/贴图/ 下 */
  { key: 'ui_sheet', src: 'assets/贴图/ui新.png' },
  { key: 'factory_icons', src: 'assets/贴图/工厂图标.png' },
  { key: 'components_sheet', src: 'assets/贴图/组件.png' },
  { key: 'fx_sheet', src: 'assets/贴图/特效.png' },
  { key: 'mold_stamp_sheet', src: 'assets/贴图/道具.png' },
  { key: 'counter_sheet', src: 'assets/贴图/柜台.png' },

  /* 道具图标 */
  { key: 'mold_stamp', src: 'assets/mask/mold_stamp.png' },

  /* 背景 */
  { key: 'bg_open', src: 'assets/贴图/开店.png' }, // 营业中(明亮)
  { key: 'bg_closed', src: 'assets/贴图/闭店.png' }, // 打烊/开始界面(昏暗)
  { key: 'bg_shop', src: 'assets/bg/bg_shop.png' },
  { key: 'bg_counter', src: 'assets/bg/bg_counter.png' },
  { key: 'bg_factory', src: 'assets/bg/bg_factory.png' },
  { key: 'bg_menu', src: 'assets/bg/bg_menu.png' },

  /* UI */
  { key: 'ui_panel', src: 'assets/ui/ui_panel.png' },
  { key: 'ui_card', src: 'assets/ui/ui_card.png' },
  { key: 'ui_button', src: 'assets/ui/ui_button.png' },
  { key: 'ui_button_active', src: 'assets/ui/ui_button_active.png' },
  { key: 'ui_coin', src: 'assets/ui/ui_coin.png' },
  { key: 'ui_star', src: 'assets/ui/ui_star.png' },
  { key: 'ui_plate', src: 'assets/ui/ui_plate.png' },
  { key: 'ui_box', src: 'assets/ui/ui_box.png' },
  { key: 'ui_lock', src: 'assets/ui/ui_lock.png' },

  /* 工厂 */
  { key: 'factory_crust', src: 'assets/factory/factory_crust.png' },
  { key: 'factory_filling', src: 'assets/factory/factory_filling.png' },
  { key: 'icon_speed', src: 'assets/factory/icon_speed.png' },
  { key: 'icon_capacity', src: 'assets/factory/icon_capacity.png' },
  { key: 'icon_quality', src: 'assets/factory/icon_quality.png' },
  { key: 'icon_unlock', src: 'assets/factory/icon_unlock.png' },

  /* 组件图标 */
  { key: 'comp_motor', src: 'assets/component/comp_motor.png' },
  { key: 'comp_gear', src: 'assets/component/comp_gear.png' },
  { key: 'comp_mold', src: 'assets/component/comp_mold.png' },
  { key: 'comp_mixer', src: 'assets/component/comp_mixer.png' },
  { key: 'comp_cooler', src: 'assets/component/comp_cooler.png' },
  { key: 'comp_moon', src: 'assets/component/comp_moon.png' },
  /* 梗组件 */
  { key: 'comp_melon', src: 'assets/component/comp_melon.png' }, // 西瓜刀
  { key: 'comp_nut', src: 'assets/component/comp_nut.png' }, // 螺母馅压机
  { key: 'comp_kiln', src: 'assets/component/comp_kiln.png' }, // 高温窑炉
  { key: 'comp_spawner', src: 'assets/component/comp_spawner.png' }, // 僵尸刷怪笼

  /* 特效 */
  { key: 'fx_sparkle', src: 'assets/fx/fx_sparkle.png' },
  { key: 'fx_steam', src: 'assets/fx/fx_steam.png' },
  { key: 'fx_success', src: 'assets/fx/fx_success.png' },
  { key: 'fx_fail', src: 'assets/fx/fx_fail.png' },
  { key: 'fx_coin', src: 'assets/fx/fx_coin.png' },
];
