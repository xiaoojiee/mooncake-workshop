'use strict';

/* 游戏内容定义表: 饼皮 / 馅料 / 工厂 / 组件 / 订单模板
 *
 * 素材与图集(sprite sheet)的对应关系见 src/core/atlas.js:
 *   饼皮 = crust_sheet.png  3行(生面团/包好成品/摊开饼皮) x 4列(4 种饼皮)
 *   馅料 = filling_a.png / filling_b.png 各 2x2, 共 8 种
 *   客人 = npc.png  上排 3 人 + 下排 2 人, 共 5 位
 *
 * 解锁体系(混合):
 *   - 开局可用: 糖浆皮 + 五仁 + 莲蓉
 *   - 普通食材: unlock.type === 'level', 该工厂槽位数达到 level 自动解锁
 *   - 梗/特殊食材: unlock.type === 'component', 装上指定组件解锁(瓜/螺丝/砖头/腐肉)
 *   - 限定食材: unlock.type === 'liked'|'coin'|'fav'|'following', 靠 B站 互动解锁
 */

/* ---- 饼皮 ----
 * col: 在 crust_sheet.png 中的列(0..3)
 * factory: 产出该饼皮的工厂 id */
const CRUSTS = [
  /* value: 面皮基础价值; effect/effectText: 特殊功能(见 order.js 的 moonValue) */
  {
    id: 'guangshi',
    name: '广式糖浆皮',
    col: 0,
    color: '#f0e6d2',
    factory: 'factory_crust_guangshi',
    value: 8, effect: null, effectText: '经典百搭，无附加',
    unlock: null, // 开局可用
  },
  {
    id: 'naihuang',
    name: '奶黄皮',
    col: 1,
    color: '#f0b93a',
    factory: 'factory_crust_naihuang',
    value: 12, effect: 'rich', effectText: '奶香浓郁：整块售价 ×1.15',
    unlock: { type: 'level', level: 2, label: '奶黄皮工坊开 2 个槽' },
  },
  {
    id: 'matcha',
    name: '抹茶皮',
    col: 2,
    color: '#8fc63f',
    factory: 'factory_crust_matcha',
    value: 12, effect: 'fresh', effectText: '清爽解腻：含莲蓉/豆沙时 ×1.25',
    unlock: { type: 'level', level: 3, label: '抹茶工坊开 3 个槽' },
  },
  {
    id: 'choco',
    name: '巧克力皮',
    col: 3,
    color: '#7a4a2b',
    factory: 'factory_crust_choco',
    value: 16, effect: 'bitter', effectText: '可可微苦：每层馅料 +3 价值',
    unlock: { type: 'level', level: 4, label: '巧克力工坊开 4 个槽' },
  },
];

/* ---- 馅料 ----
 * index: 在馅料图集中的序号(0..3 -> filling_a, 4..7 -> filling_b)
 * 前 4 种是正经馅料, 后 4 种是梗食材 */
const FILLINGS = [
  /* value: 每份馅料加到售价里的基础价值; effect: 特殊效果(见 order.js 的 fillingBonus)
   * effectText: 给 UI 展示的效果说明 */
  {
    id: 'wuren', name: '五仁', index: 0, color: '#d8c9a3', factory: 'factory_filling_wuren',
    value: 7, effect: 'nutty', effectText: '百搭坚果：与其它馅料同场时 ×1.1', unlock: null,
  },
  {
    id: 'lianrong', name: '莲蓉', index: 1, color: '#c9b98d', factory: 'factory_filling_lianrong',
    value: 5, effect: 'lotus', effectText: '层数越多越值钱（每层×本月饼层数）', unlock: null,
  },
  {
    id: 'dousha', name: '豆沙', index: 2, color: '#5e3a26', factory: 'factory_filling_dousha',
    value: 10, effect: 'sweet', effectText: '与蛋黄同场时 ×1.3',
    unlock: { type: 'level', level: 2, label: '豆沙产线开 2 个槽' },
  },
  {
    id: 'danhuang', name: '蛋黄', index: 3, color: '#f5a623', factory: 'factory_filling_danhuang',
    value: 13, effect: 'golden', effectText: '只此一层时 ×1.5',
    unlock: { type: 'level', level: 3, label: '蛋黄产线开 3 个槽' },
  },
  /* ---- 梗食材(更值钱的「高阶」馅) ---- */
  {
    id: 'xigua', name: '西瓜', index: 4, color: '#e8425a', factory: 'factory_filling_xigua',
    value: 11, effect: 'melon', joke: true, effectText: '保熟：整块售价 ×0.9~1.4(随机)',
    unlock: { type: 'component', componentId: 'melonblade', label: '瓜摊·西瓜刀' },
    hint: '「你这瓜保熟吗？」——华强买瓜',
  },
  {
    id: 'luosi', name: '螺丝', index: 5, color: '#9aa0a6', factory: 'factory_filling_luosi',
    value: 16, effect: null, joke: true, effectText: '硬核高价，无附加',
    unlock: { type: 'component', componentId: 'nutcracker', label: '五金车间·螺母馅压机' },
    hint: '公司发的月饼硬得能拧螺丝',
  },
  {
    id: 'zhuantou', name: '砖头', index: 6, color: '#b3502e', factory: 'factory_filling_zhuantou',
    value: 20, effect: null, joke: true, effectText: '最贵实心，无附加',
    unlock: { type: 'component', componentId: 'kiln', label: '砖窑·高温窑炉' },
    hint: '硌牙警告：这不是巧克力',
  },
  {
    id: 'furou', name: '腐肉', index: 7, color: '#7a5230', factory: 'factory_filling_furou',
    value: 22, effect: 'rot', joke: true, effectText: '单价最高但产得慢，每多一种其他馅料 ×0.7',
    unlock: { type: 'component', componentId: 'spawner', label: '刷怪塔·僵尸刷怪笼' },
    hint: '吃了掉饥饿值，谨慎食用',
  },
];

/* ---- 工厂 ----
 * 产出刻意压得很低: 前几天的原料「刚好够用」, 逼玩家规划开槽/装组件提产
 * speed 单位: 份/秒; 一天约 2~3 分钟营业时间, 故 speed 0.3 ≈ 一天多产 40~55 份
 * cost: 工厂卡片的购买价(卖出价 = cost 的一半, 见 sellFactory) */
const FACTORIES = [
  /* 饼皮(初始产速很低, 全靠组件/升级拉起来) */
  { id: 'factory_crust_guangshi', kind: 'crust', productId: 'guangshi', name: '糖浆皮工坊', baseSpeed: 0.09, baseCapacity: 12, baseQuality: 1, cost: 375 },
  { id: 'factory_crust_naihuang', kind: 'crust', productId: 'naihuang', name: '奶黄皮工坊', baseSpeed: 0.085, baseCapacity: 10, baseQuality: 1, cost: 425 },
  { id: 'factory_crust_matcha', kind: 'crust', productId: 'matcha', name: '抹茶工坊', baseSpeed: 0.075, baseCapacity: 10, baseQuality: 2, cost: 475 },
  { id: 'factory_crust_choco', kind: 'crust', productId: 'choco', name: '巧克力工坊', baseSpeed: 0.065, baseCapacity: 8, baseQuality: 2, cost: 525 },
  /* 正经馅料 */
  { id: 'factory_filling_wuren', kind: 'filling', productId: 'wuren', name: '五仁产线', baseSpeed: 0.085, baseCapacity: 18, baseQuality: 1, cost: 375 },
  { id: 'factory_filling_lianrong', kind: 'filling', productId: 'lianrong', name: '莲蓉产线', baseSpeed: 0.065, baseCapacity: 16, baseQuality: 1, cost: 400 },
  { id: 'factory_filling_dousha', kind: 'filling', productId: 'dousha', name: '豆沙产线', baseSpeed: 0.09, baseCapacity: 16, baseQuality: 1, cost: 425 },
  { id: 'factory_filling_danhuang', kind: 'filling', productId: 'danhuang', name: '蛋黄产线', baseSpeed: 0.08, baseCapacity: 14, baseQuality: 1, cost: 450 },
  /* 梗馅料 */
  { id: 'factory_filling_xigua', kind: 'filling', productId: 'xigua', name: '瓜摊', baseSpeed: 0.11, baseCapacity: 20, baseQuality: 1, cost: 450 },
  { id: 'factory_filling_luosi', kind: 'filling', productId: 'luosi', name: '五金车间', baseSpeed: 0.09, baseCapacity: 18, baseQuality: 1, cost: 475 },
  { id: 'factory_filling_zhuantou', kind: 'filling', productId: 'zhuantou', name: '砖窑', baseSpeed: 0.08, baseCapacity: 22, baseQuality: 1, cost: 500 },
  { id: 'factory_filling_furou', kind: 'filling', productId: 'furou', name: '刷怪塔', baseSpeed: 0.075, baseCapacity: 20, baseQuality: 1, cost: 450 },
  /* 自动设施: 吸料塔 —— 不生产, 通电后自动把全场掉落的产物吸进背包
   * baseSpeed 此时表示「每秒吸几个」 */
  { id: 'factory_vacuum', kind: 'util', productId: null, name: '吸料塔', baseSpeed: 1.0, baseCapacity: 0, baseQuality: 1, cost: 1200 },
];

/* ---- 升级项 ----
 * 工厂本体用「槽位 + 组件」体系(见 COMPONENTS), 这里只保留烤炉扩容 */
const UPGRADES = [
  { id: 'oven_slot_1', factoryId: 'oven', type: 'oven', name: '烤位 +1', cost: 300, value: 1 },
  { id: 'oven_slot_2', factoryId: 'oven', type: 'oven', name: '烤位 +1', cost: 650, value: 1 },
  { id: 'oven_slot_3', factoryId: 'oven', type: 'oven', name: '烤位 +1', cost: 1225, value: 1 },
];

/* ---- 组件系统 ----
 * 工厂 = 若干槽位; 槽位里装组件; 组件可升级, 效果按等级放大
 *
 * type:
 *   normal  普通 —— 无工厂限制, 任何工厂都能装(相当于"无职业要求")
 *   special 特殊 —— 默认锁死 factoryId 指定的那座工厂; 
 *                   月光石是「通用特殊」(factoryId=null), 仍只能掉落
 *
 * buyable: 能否用金币购买(普通可买; 特殊/月光石 只能靠特殊客人掉落)
 *
 * effect:
 *   speed / quality / yield  -> 数值加成
 *   unlock                   -> 装上即解锁对应食材(梗食材靠这个)
 */
const COMPONENT_TYPES = [
  /* ---- 普通组件: 通用, 可购买 ---- */
  {
    id: 'motor', name: '动力马达', icon: 'comp_motor', type: 'normal', buyable: true, factoryId: null,
    desc: '提升产线速度', effect: { speed: 1.8 }, cost: 140, upgradable: true, maxLevel: 5,
  },
  {
    id: 'gear', name: '传动齿轮', icon: 'comp_gear', type: 'normal', buyable: true, factoryId: null,
    desc: '速度与品质兼顾', effect: { speed: 1.2, quality: 0.3 }, cost: 200, upgradable: true, maxLevel: 5,
  },
  {
    id: 'cooler', name: '冷凝管', icon: 'comp_cooler', type: 'normal', buyable: true, factoryId: null,
    desc: '稳定品质', effect: { quality: 0.6 }, cost: 180, upgradable: true, maxLevel: 4,
  },
  {
    id: 'mold', name: '精工模具', icon: 'comp_mold', type: 'normal', buyable: true, factoryId: null,
    desc: '大幅提升品质', effect: { quality: 1 }, cost: 280, upgradable: true, maxLevel: 4,
  },
  {
    id: 'mixer', name: '搅拌桨', icon: 'comp_mixer', type: 'normal', buyable: true, factoryId: null,
    desc: '速度与产出兼顾', effect: { speed: 1.0, yield: 1 }, cost: 360, upgradable: true, maxLevel: 3,
  },
  /* ---- 通用特殊: 任何工厂可装, 但只能掉落 ---- */
  {
    id: 'moonstone', name: '月光石', icon: 'comp_moon', type: 'special', buyable: false, factoryId: null,
    desc: '嫦娥掉落。大幅提升速度与品质（通用特殊）', effect: { speed: 3, quality: 1.5 }, cost: 0, upgradable: false, maxLevel: 1,
  },
  /* ---- 专属特殊: 只能装在指定工厂, 装上解锁对应梗食材 ---- */
  {
    id: 'melonblade', name: '西瓜刀', icon: 'comp_melon', type: 'special', buyable: false, factoryId: 'factory_filling_xigua',
    desc: '瓜摊专用。装上解锁「西瓜」——你这瓜保熟吗',
    effect: { speed: 1.5, unlock: 'xigua' }, cost: 0, upgradable: false, maxLevel: 1,
  },
  {
    id: 'nutcracker', name: '螺母馅压机', icon: 'comp_nut', type: 'special', buyable: false, factoryId: 'factory_filling_luosi',
    desc: '五金车间专用。装上解锁「螺丝」——硬得能拧螺丝',
    effect: { speed: 1.5, unlock: 'luosi' }, cost: 0, upgradable: false, maxLevel: 1,
  },
  {
    id: 'kiln', name: '高温窑炉', icon: 'comp_kiln', type: 'special', buyable: false, factoryId: 'factory_filling_zhuantou',
    desc: '砖窑专用。装上解锁「砖头」——硌牙警告',
    effect: { speed: 1.2, unlock: 'zhuantou' }, cost: 0, upgradable: false, maxLevel: 1,
  },
  {
    id: 'spawner', name: '僵尸刷怪笼', icon: 'comp_spawner', type: 'special', buyable: false, factoryId: 'factory_filling_furou',
    desc: '刷怪塔专用。装上解锁「腐肉」——吃了掉饥饿值',
    effect: { speed: 1.8, unlock: 'furou' }, cost: 0, upgradable: false, maxLevel: 1,
  },
];

function findComponentDef(id) {
  return COMPONENT_TYPES.find((c) => c.id === id) || null;
}

/* 组件的效果文案(给 UI 显示): 速度/品质/产出/解锁 */
function componentEffectText(def) {
  if (!def || !def.effect) return '—';
  const e = def.effect;
  const parts = [];
  if (e.speed) parts.push('速度+' + e.speed);
  if (e.quality) parts.push('品质+' + e.quality);
  if (e.yield) parts.push('产出+' + e.yield);
  if (e.unlock) {
    const f = findFillingDef(e.unlock);
    parts.push('解锁' + (f ? f.name : e.unlock));
  }
  return parts.join(' ') || '—';
}

/* 组件能不能装到某工厂: 普通=通用; 特殊默认锁 factoryId(月光石 factoryId=null 也通用) */
function isComponentAllowed(def, fid) {
  if (!def) return false;
  if (def.type !== 'special') return true;
  return !def.factoryId || def.factoryId === fid;
}

/* 专属组件被限制到哪座工厂(用于提示文案); 通用则返回 '' */
function componentRestrictLabel(def) {
  const f = def && def.factoryId ? findFactoryDef(def.factoryId) : null;
  return f ? f.name : '';
}

/* 槽位开启花费: 已有 n 个槽时开下一个的价格 */
function slotCost(currentSlots) {
  return Math.round(280 * Math.pow(1.95, currentSlots - 1));
}
const MAX_SLOTS = 4;

/* 组件升级花费 */
function componentUpgradeCost(compDef, level) {
  return Math.round(compDef.cost * 0.8 * Math.pow(1.6, level - 1));
}

/* 把工厂槽位合成为运行数值 */
function computeFactoryStats(base, factory) {
  let speed = 0;
  let quality = 0;
  let yieldBonus = 0;
  const unlocks = [];
  for (const slot of factory.slots || []) {
    if (!slot) continue;
    const def = findComponentDef(slot.compId);
    if (!def) continue;
    const lv = slot.level || 1;
    const e = def.effect;
    if (e.speed) speed += e.speed * lv;
    if (e.quality) quality += e.quality * lv;
    if (e.yield) yieldBonus += e.yield * lv;
    if (e.unlock) unlocks.push(e.unlock);
  }
  return {
    speed: base.baseSpeed + speed,
    quality: base.baseQuality + quality,
    yieldBonus,
    unlocks,
    finalSpeed: Math.min(30, base.baseSpeed + speed),
  };
}

/* ---- 特殊道具 ---- */
const ITEMS = [
  { id: 'item_moon_mold', name: '月光模具', description: '嫦娥的信物', icon: 'mold_stamp' },
];

/* ---- 订单生成规则 ----
 * 不再用固定模板, 改成按天数生成, 这样:
 *   - 层数随天数增长(1 层起, 逐渐到 4 层)
 *   - 允许同一馅料重复出现(「多放点五仁」)
 *   - 数量(一次要几块)也随天数增长
 * 只会用"玩家已解锁食材"来生成 */
const ORDER_RULES = {
  /* 第 n 天的期望层数(会取整+小幅随机); 延长到 18 天, 难度不早封顶 */
  layersPerDay: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6],
  /* 单笔订单要几块月饼 */
  qtyPerDay: [1, 1, 1, 1, 1, 1, 2, 1, 2, 2, 2, 2, 3, 2, 3, 2, 3, 3, 3, 3],
  /* 重复同一馅料的概率(「双份五仁」), 随天数缓慢上升 */
  repeatChance: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.5, 0.55, 0.55, 0.6, 0.6, 0.65, 0.65, 0.7, 0.7, 0.7],
  maxLayers: 6,
  maxQty: 3,
};

/* 兼容: 旧代码若还引用 ORDER_TEMPLATES, 给一个最小集合 */
const ORDER_TEMPLATES = [
  { id: 't1', minDay: 1, layers: ['wuren'] },
  { id: 't2', minDay: 1, layers: ['lianrong'] },
];

/* ---- 客人 ----
 * npcIndex: 在 npc.png 中的立绘序号(0..4) */
const CUSTOMERS = [
  /* reward: 基础工钱(馅料价值另算, 见 order.js fillingBonus) */
  { id: 'c1', kind: 'normal', name: '瓜摊老板', npcIndex: 0, reward: 24, quip: '你这瓜保熟吗？' },
  { id: 'c2', kind: 'normal', name: '大厨', npcIndex: 1, reward: 26, quip: '给我来份拿手的' },
  { id: 'c3', kind: 'normal', name: '潮男', npcIndex: 2, reward: 28, quip: '要拍照好看的那种' },
  { id: 'c4', kind: 'normal', name: '花衬衫大叔', npcIndex: 3, reward: 25, quip: '多放点料！' },
  { id: 'c5', kind: 'normal', name: '黑衬衫小哥', npcIndex: 4, reward: 27, quip: '随便来一个' },
  { id: 'c6', kind: 'special', name: '嫦娥', npcIndex: 1, reward: 80, rewardItem: 'item_moon_mold', minDay: 2, quip: '来块月饼，要圆的' },
];

/* ---- 查询辅助 ---- */
function findCrustDef(id) {
  return CRUSTS.find((c) => c.id === id) || null;
}
function findFillingDef(id) {
  return FILLINGS.find((f) => f.id === id) || null;
}
function findFactoryDef(id) {
  return FACTORIES.find((f) => f.id === id) || null;
}
function findItemDef(id) {
  return ITEMS.find((i) => i.id === id) || null;
}
function fillingColorOf(id) {
  const def = findFillingDef(id);
  return def ? def.color : COLORS.text;
}
function fillingIndexOf(id) {
  const def = findFillingDef(id);
  return def ? def.index : 0;
}

/* ---- 解锁判定 ----
 * unlock.type:
 *   null        -> 开局可用
 *   'level'     -> 该食材所属工厂的「槽位数」达到 level
 *   'component' -> 已获得/装上指定组件
 *   'liked'/'coin'/'fav'/'following' -> B站 互动解锁 */
/* 解锁判定(简化): 只要产出它的工厂已上场, 该食材就能用;
 * 不再看槽位数 / 组件 / 互动(工厂上场即解锁) */
function isUnlocked(content) {
  if (!content) return false;
  if (!content.factory) return true;
  return hasFactoryDeployed(content.factory);
}

/* 某组件是否已装在任何已上场的工厂里(或组件仓库里有) */
function hasComponentInstalled(compId) {
  for (const uid in shop.units) {
    const u = shop.units[uid];
    for (const slot of u.slots || []) {
      if (slot && slot.compId === compId) return true;
    }
  }
  return !!(shop.components && shop.components[compId] > 0);
}

function unlockLabel(content) {
  if (!content || !content.factory) return '已解锁';
  if (hasFactoryDeployed(content.factory)) return '已解锁（工坊已上场）';
  const def = findFactoryDef(content.factory);
  return '上场「' + (def ? def.name : content.factory) + '」后可用';
}

function unlockedCrusts() {
  return CRUSTS.filter((c) => isUnlocked(c));
}
function unlockedFillings() {
  return FILLINGS.filter((f) => isUnlocked(f));
}
