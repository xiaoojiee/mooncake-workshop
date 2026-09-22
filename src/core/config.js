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

/* ---- 配色: 暖橙卡通风 ----
 * 三层表面:
 *   背景 = 暖橙渐变(见 hud.js 的 drawFallbackBg / 贴图)
 *   浅色面板 = 奶油底 + 深棕字(ink / inkDim)
 *   橙色按钮/表头 = 橙底 + 奶油字(cream / goldLight) */
const COLORS = {
  bg: '#9e602a',
  bgWarm: '#d99f57', // 背景暖橙
  bgWarmDeep: '#bf7736', // 背景深橙
  panel: '#f8efdd', // 面板奶油底
  panelLight: '#fcf8ef', // 悬停/浅面板
  panelDark: '#eee0c1', // 外层大面板
  panelInner: '#f3e5ca', // 面板里的凹槽/内层
  panelBorder: '#ca883f', // 面板包边(琥珀橙)
  panelInk: '#603c1f', // 浅面板上的主文字
  panelInkDim: '#8d6942', // 浅面板上的次要文字
  panelTitle: '#a06227', // 浅面板上的小标题(深琥珀)
  gold: '#c9933b',
  goldLight: '#eac87b',
  cream: '#fbf4e6', // 深色/橙底上的文字
  creamDim: '#f4e2bb', // 深色/橙底上的次要文字
  text: '#603c1f',
  textDim: '#8d6942',
  ok: '#67994b',
  warn: '#c58739',
  fail: '#b85945',
  lotus: '#b78a5d',
  bean: '#704539',
  custard: '#d0a952',
  crust: '#cea26e',
  icy: '#c2d7e2',

  /* ---- 主题化的渐变/控件色(闭店关灯时整套换掉) ---- */
  gloss: '#fdfcf4', // 面板顶面高光
  btnTop: '#eac17b',
  btnMid: '#d79d55',
  btnBot: '#bf7e3b',
  btnTopOn: '#ebc985',
  btnMidOn: '#daa04b',
  btnBotOn: '#c17c2f',
  borderTop: '#eccc8d',
  borderMid: '#ca883f',
  borderBot: '#a96626',
  btnInk: '#8f5c26', // 按钮文字描边
  shadow: 'rgba(96,60,31,0.32)',
  headerTop: '#d9a35a',
  headerBot: '#c17c2f',

  /* 柜台/地板 */
  counterFloor1: '#a4662e',
  counterFloor2: '#8b5223',
  counterFloor3: '#5d3416',
  counterTop1: '#e8cfa2',
  counterTop2: '#d9b17a',
  counterTop3: '#b9834a',
  counterTopHi: '#fff3d6',
  counterEdge1: '#f0d79a',
  counterEdge3: '#a76c1f',
  counterEdgeHi: '#fff6dd',
  counterFace1: '#8a4f22',
  counterFace2: '#6f3d19',
  counterFace3: '#4a2811',
  counterSeam: '#3a1f0d',
  counterSeamHi: '#c08542',
  counterWood: '#6b3f1c',
  counterOutline: 'rgba(96,60,31,0.5)',
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
  sky: true, // 程序化「星空+圆月」背景(暂代背景贴图); false = 用贴图
  counterProcedural: true, // 程序化柜台(暂代 柜台.png); false = 用贴图
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
const TOY_BVID = 'BV1FndsBGEk8'; // 绑定的视频 BV 号
const TOY_AUTHOR_UID = '137429365'; // UP 主 uid
const TOY_AUTHOR_NAME = '火山哥哥'; // 作者名兜底
const TOY_VIDEO_TITLE = '月饼工坊'; // 视频标题兜底
/* 头像/封面兜底: 端内会自动从 SDK/接口拿, 这两项留空即可(填了就是站外也有图) */
const TOY_AUTHOR_FACE = '';
const TOY_VIDEO_COVER = '';

/* ---- 排行榜榜位 ---- */
const BOARD = {
  coins: 1, // 总金币榜
  score: 2, // 单笔最佳订单评分榜
  rep: 3, // 累计口碑榜
};

/* ---- B站互动奖励(每项只发一次) ----
 * 参照 demo1: 点赞送启动材料 / 投币送金币 / 收藏送通用组件 / 关注送一只月兔
 * (端内端外都支持, 不弹数据确认) */
const TOY_REWARDS = {
  liked: { label: '点赞', text: '启动材料各5份' },
  coin: { label: '投币', text: '500 金币' },
  fav: { label: '收藏', text: '通用组件×2' },
  following: { label: '关注', text: '月兔×1' },
};
const TOY_REWARD = { mats: 5, coins: 500, comps: 2 };

/* ---- 游戏节奏(多客人并发) ---- */
const DAY = {
  duration: 150, // 每天营业时长(秒), 时间到就收摊(等店里客人处理完)
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


  rabbitGiftChance: 0.7, // 月兔客人送谢礼(送一只月兔/升一级)的几率
  specialChance: 0.22, // 特殊客人出现概率(在有资格的特殊客人里随机抽)
  /* 五金月饼砸人 */
  smashRepPenalty: 5, // 砸普通客人掉的口碑(砸找茬的不掉)
  smashShake: 12,
  /* 立绘占位: 用竖排「顾客」二字代替客人贴图(贴图齐了 -> false) */
  customerTextPlaceholder: false,
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
  maxLevel: 7,
  capacity: [3, 5, 7, 10, 14, 18, 22], // 各等级总电量
  cost: [500, 1100, 2200, 4000, 7000, 12000], // 1→2, 2→3, 3→4, 4→5
};

/* ---- 工厂生产(进度条 → 掉落产物) ----
 * 通电工厂按 speed 累积进度, 进度满 1 生成一个产物(掉落状态)
 * 工厂旁边堆到 maxDrops 个未捡产物就停产 */
const PRODUCE = {
  maxDrops: 3, // 工厂旁最多堆几个未捡产物
  dropValue: 1, // 一个产物 = 几个原料价值
  speedMulCap: 8, // 组件堆速度的上限倍率(免得后期产速爆炸)
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
 *   (收银小车 / 自动装配 / 自动烤制 已由「月兔」取代, 见 RABBIT)
 */
const COUNTER_LABEL = { tray: '制作台数量', boiler: '烤炉速度' };
const COUNTER = {
  /* 制作台数量: 1 个起, 最多加到 tray.slots 个 */
  tray: { max: 3, slots: 4, cost: [375, 875, 1750] },
  /* 烤炉速度: 缩短烘烤时间 / 延后烤糊 */
  boiler: { max: 6, bakeFactor: 0.12, burnFactor: 0.18, cost: [325, 700, 1225, 2100, 3200, 4600] },
};

/* ---- 月兔 ----
 * 花金币买月兔(可多只), 它们在店里四处跑; 每只的 6 项能力各自独立升级:
 *   calm    安抚: 碰到客人 -> 那位客人耐心暂时掉得更慢
 *   speed   速度: 跑得更快
 *   cashier 收银: 自动捡柜台上的金币
 *   cook    做月饼: 用背包里的料填好一个空托盘
 *   bake    入炉: 把做好的月饼送进烤炉
 *   serve   送餐: 把烤好的月饼送给客人
 *   fix     纠错: 托盘上的月饼做错了 -> 跑过去把不对的馅料拿走(退回背包)
 * 数值: base + per × 等级 (cook/bake/serve/fix 是「间隔秒」, 越小越快) */
const RABBIT = {
  max: 4, // 最多同时养几只
  buyCost: [800, 1800, 3600, 7000], // 第 N 只的购买价
  costMul: 1.9, // 能力每升 1 级, 花费 ×1.9
  roam: { x0: 36, x1: VW - 36, y0: 100, y1: VH - 26 }, // 活动范围: 全屏到处跑
  /* 休息(没事干)溜达时的范围: 别钻进底栏/原料架里, 会被面板压住像卡住了 */
  restRoam: { x0: 36, x1: VW - 36, y0: 96, y1: LAYOUT.bottomY - 26 },
  touch: { x: 46, y: 60 }, // 判定「碰到客人」的横向/纵向距离
  arrive: 10, // 走到目标的判定半径(px)
  calmTime: 0.7, // 安抚效果持续时间(秒)
  bodyH: 99, // 场上月兔的绘制高度(比原来大 1.5 倍)
  /* 宽裕(没正事可干)的月兔会主动在客人之间来回移动, 维持耐心 */
  calmBelow: 0.72, // 客人耐心掉到「最大耐心的这个比例」以下就算告急
  calmMax: 2, // 最多同时派 2 只月兔去巡逻安抚
  calmHold: 3.2, // 在一位客人身边守这么久(秒), 再换下一位
  abil: {
    calm: { label: '安抚', tip: '碰到客人, 他的耐心掉得更慢; 闲下来会主动在客人之间巡逻', max: 4, cost: 400, base: 0.35, per: 0.15 },
    speed: { label: '速度', tip: '月兔跑得更快', max: 4, cost: 350, base: 70, per: 30 },
    cashier: { label: '收银', tip: '自动捡起柜台上的金币', max: 3, cost: 500, base: 60, per: 34 },
    cook: { label: '做月饼', tip: '用背包的料填好一个空托盘', max: 3, cost: 700, base: 5.0, per: -1.1 },
    bake: { label: '入炉', tip: '把做好的月饼送进烤炉', max: 1, cost: 1200, base: 2.6, per: 0 },
    serve: { label: '送餐', tip: '把烤好的月饼送给客人', max: 1, cost: 1400, base: 2.6, per: 0 },
    fix: { label: '纠错', tip: '托盘上做错了 -> 跑去把不对的馅料拿走', max: 3, cost: 600, base: 5.0, per: -1.1 },
  },
};
/* 月亮能力展示用: 当前等级下的数值 */
function rabbitAbilValue(key, level) {
  const a = RABBIT.abil[key];
  if (!a) return 0;
  return a.base + a.per * level;
}

/* ---- 流浪猫「耄耋」----
 * 第 CAT.fromDay 天起出现, 在店里捣乱:
 *   随机扑咬客人(客人当场没了, 算流失) / 偷吃烤炉里没烤好的月饼 / 偷吃快捷栏的材料
 *   干坏事要「跑到对应位置」, 吃东西时冒粒子(像 Minecraft) */
const CAT = {
  fromDay: 2, // 第几天开始出现
  name: '耄耋',
  speed: 128, // 跑动速度(px/s)
  roam: { x0: 36, x1: VW - 36, y0: 100, y1: VH - 26 },
  restRoam: { x0: 36, x1: VW - 36, y0: 96, y1: LAYOUT.bottomY - 26 }, // 溜达时别钻底栏
  arrive: 12, // 走到目标的判定半径
  attackChance: 0.22, // 挑活时「扑客人」的概率(其余去偷吃)
  eatTime: 1.5, // 吃东西的时长(秒, 期间冒粒子)
  restTime: 5.5, // 干完一件坏事歇多久
  leaveChance: 0.8, // 每做一次坏事, 80% 概率溜走(溜了当天就不来了)
  arriveMin: 12, // 每天随机「第几秒」溜进来(秒)
  arriveMax: 95,
  tameHits: 3, // 被打飞 3 次 -> 第二天再来就是驯服状态
  tameCalm: 0.8, // 驯服后守着客人: 耐心下降速度 ×(1-0.8) = 0.2
  tameCalmTime: 1.2, // 驯服安抚的余韵(秒)
  tameHold: 2.4, // 驯服后在一位客人身边守多久再换人
  tameReach: 96, // 驯服后「守在客人身边」的判定半径(px)
  knockRep: 2, // 打飞一次给的口碑(小奖励)
  body: '#6f6157', // 猫毛色
  belly: '#d8cfc4', // 肚皮/口鼻
};

/* ---- 工厂 ---- */
const FACTORY_TICK = 0.5; // 产线结算步长(秒)
const STOCK_START_RATIO = 0.5; // 开局库存占容量比例

/* ---- 品质(全厂平均品质的作用) ----
 * 品质只升不降: 1 是基准; 每高 1 点 -> 出餐金币 +pricePerLevel, 口碑 +repPerLevel */
/* ---- 店铺评分(外卖软件那种) ----
 * 每次出餐按得分折算成 0~5 星, 榜单上是「平均星级」;
 * 评价人数不够(≤ minCount)时没有分数, 不上榜。
 * decimals: 榜单显示/上报保留几位小数。
 *   注意: B站 submitScore 只收整数(上限 16,777,215), 所以 0~5 分最多 6 位小数(5,000,000) */
const RATING = {
  stars: 5, // 满分几星
  decimals: 4, // 精确到小数点后几位(想更细就调大, 上限 6)
  minCount: 20, // 超过这么多位客人评分才有分数
};

const QUALITY = {
  pricePerLevel: 0.3, // 每 1 点品质 -> 售价 +30%
  repPerLevel: 1, // 每 1 点品质 -> 口碑 +1(向下取整)
};
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
  /* 馅料: 一张 3×3 九宫格(中间格空) -> 8 种, 切图见 atlas.js 的 FILLING_SHEET_SPEC */
  { key: 'filling_sheet', src: 'assets/sprite/馅料贴图.png' },
  /* 客人 2×2 四宫格立绘 */
  { key: 'npc_normal', src: 'assets/贴图/普通npc.png' }, // 普通顾客立绘(3×3, 中间格空)
  { key: 'npc_special', src: 'assets/贴图/特殊npc.png' }, // 特殊客人立绘(3×3, 中间格空)

  /* 图集/包(自动识别连通块切格, 不要求严格网格; 顺序见 core/assets.js 的 SHEET_SLICES)
   * 之后美术交付的贴图统一放 assets/贴图/ 下 */
  { key: 'ui_sheet', src: 'assets/贴图/ui新.png' },
  /* 注: 工厂图标 / 组件图标 不再用贴图 —— 改成程序化绘制(见 core/icons.js 的 drawIconArt)
   * 想换回贴图: 把下面两行放开, 并在 assets.js 的 SHEET_SLICES 里恢复对应条目即可
   * { key: 'factory_icons', src: 'assets/贴图/工厂图标.png' },
   * { key: 'components_sheet', src: 'assets/贴图/组件.png' }, */
  { key: 'fx_sheet', src: 'assets/贴图/特效.png' },
  { key: 'mold_stamp_sheet', src: 'assets/贴图/道具.png' },
  { key: 'counter_sheet', src: 'assets/贴图/柜台.png' },
  { key: 'hardware_sheet', src: 'assets/贴图/五金.png' }, // 五金月饼(裁留白后存成 hardware_moon)
  /* 月兔 4 色 / 流浪猫耄耋 / 猫爪印(裁留白后存成 rabbit_1..4 / cat / cat_paw) */
  { key: 'rabbit1', src: 'assets/贴图/月兔1.png' },
  { key: 'rabbit2', src: 'assets/贴图/月兔2.png' },
  { key: 'rabbit3', src: 'assets/贴图/月兔3.png' },
  { key: 'rabbit4', src: 'assets/贴图/月兔4.png' },
  { key: 'cat_sheet', src: 'assets/贴图/耄耋.png' },
  { key: 'cat_paw_sheet', src: 'assets/贴图/耄耋攻击.png' },
  { key: 'interact_sheet', src: 'assets/贴图/互动贴图.png' }, // 互动入口图标(星星), 裁留白后存成 interact_icon

  /* 道具图标 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'mold_stamp', src: 'assets/mask/mold_stamp.png' }, */

  /* 背景 */
  { key: 'bg_open', src: 'assets/贴图/开店.png' }, // 营业中(明亮)
  { key: 'bg_closed', src: 'assets/贴图/闭店.png' }, // 打烊/开始界面(昏暗)
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'bg_shop', src: 'assets/bg/bg_shop.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'bg_counter', src: 'assets/bg/bg_counter.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'bg_factory', src: 'assets/bg/bg_factory.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'bg_menu', src: 'assets/bg/bg_menu.png' }, */

  /* UI */
  /* 注: ui_panel/ui_button 等已改为程序化绘制; 只剩金币/托盘/锁三件用图集,
   * 由 assets/贴图/ui新.png 切出(见 assets.js 的 UI_SHEET_LITE), 不再单列 PNG */

  /* 工厂 */
  /* 工厂/属性图标已改为程序化绘制, 这些单图占位不再加载(文件本来也不存在) */

  /* 组件图标 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_motor', src: 'assets/component/comp_motor.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_gear', src: 'assets/component/comp_gear.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_mold', src: 'assets/component/comp_mold.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_mixer', src: 'assets/component/comp_mixer.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_cooler', src: 'assets/component/comp_cooler.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_moon', src: 'assets/component/comp_moon.png' }, */
  /* 梗组件 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_melon', src: 'assets/component/comp_melon.png' }, // 西瓜刀 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_nut', src: 'assets/component/comp_nut.png' }, // 螺母馅压机 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_kiln', src: 'assets/component/comp_kiln.png' }, // 高温窑炉 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'comp_spawner', src: 'assets/component/comp_spawner.png' }, // 僵尸刷怪笼 */

  /* 特效 */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'fx_sparkle', src: 'assets/fx/fx_sparkle.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'fx_steam', src: 'assets/fx/fx_steam.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'fx_success', src: 'assets/fx/fx_success.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'fx_fail', src: 'assets/fx/fx_fail.png' }, */
  /* (空壳占位, 文件不存在, 代码有兜底) { key: 'fx_coin', src: 'assets/fx/fx_coin.png' }, */
];
