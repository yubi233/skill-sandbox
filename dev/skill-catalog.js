/* ============================================================================
   skill-catalog.js — 技能唯一注册表 + 元素体系
   元素采用《洛克王国：世界》手游 18 系（无神系）：
   普通/草/火/水/光/地/冰/龙/电/毒/虫/武/翼/萌/幽/恶/机械/幻。
   与老页游口径的差异：土+石合并为地、幽灵→幽、恶魔→恶、新增幻、删除神火/神水/神草。
   新增技能只需两步：在此添加一个注册项，在 skills.js 提供对应 Cast 子类。
   消费方(core 默认参数 / ui 图标说明与系别分组 / main 快捷键与演示顺序)全部由本表派生。
   本文件只含纯数据与校验，不依赖引擎。
   ========================================================================== */
(function (global) {
  'use strict';
  /* 元素元表：order 同时是技能栏的分组展示顺序（按《洛克王国：世界》18 系口径排列） */
  const ELEMENTS = [
    { key: 'normal', name: '普通', color: '#b8c0c8', order: 1 },
    { key: 'grass', name: '草', color: '#7ed957', order: 2 },
    { key: 'fire', name: '火', color: '#ff8a4a', order: 3 },
    { key: 'water', name: '水', color: '#4f9cff', order: 4 },
    { key: 'light', name: '光', color: '#ffe6a3', order: 5 },
    { key: 'earth', name: '地', color: '#d9a066', order: 6 },
    { key: 'ice', name: '冰', color: '#9fe3ff', order: 7 },
    { key: 'dragon', name: '龙', color: '#7a8cff', order: 8 },
    { key: 'electric', name: '电', color: '#ffd23f', order: 9 },
    { key: 'poison', name: '毒', color: '#b48ce0', order: 10 },
    { key: 'insect', name: '虫', color: '#a8c84f', order: 11 },
    { key: 'martial', name: '武', color: '#e08a7a', order: 12 },
    { key: 'fly', name: '翼', color: '#a8d8f0', order: 13 },
    { key: 'cute', name: '萌', color: '#ffa8c9', order: 14 },
    { key: 'ghost', name: '幽', color: '#9a86c9', order: 15 },
    { key: 'dark', name: '恶', color: '#8d7fb8', order: 16 },
    { key: 'machine', name: '机械', color: '#9fb4c8', order: 17 },
    { key: 'illusion', name: '幻', color: '#e873d8', order: 18 },
  ];
  function elementOf(key) {
    return ELEMENTS.find(e => e.key === key) || null;
  }

  const CATALOG = [
    {
      id: 1, name: '寒霜之矛', ultimateName: '冰枪风暴', form: '抛射物', hotkey: '1',
      element: 'ice',
      color: '#79d2ff', level: 3, range: 30, radius: 3.5, windup: 0.58, cooldown: 0.95,
      groundTarget: false, demoOrder: 6,
      description: '悬空冰枪依次坠落，冻结的碎晶在地表绽放成锋利王冠。',
    },
    {
      id: 2, name: '雷霆之矛', ultimateName: '雷神审判', form: '锯齿射线', hotkey: '2',
      element: 'electric',
      color: '#c9a6ff', level: 3, range: 32, radius: 3.6, windup: 0.65, cooldown: 1.10,
      groundTarget: false, demoOrder: 2,
      description: '高空法印唤下审判巨剑，分支雷霆撕开落点周围的大地。',
    },
    {
      id: 3, name: '陨火天降', ultimateName: '末日陨星', form: '天降 AOE', hotkey: '3',
      element: 'fire',
      color: '#ff9440', level: 5, range: 34, radius: 4.4, windup: 0.76, cooldown: 1.65,
      groundTarget: true, demoOrder: 1,
      description: '熔岩陨星携碎星坠落，冲击波掀起岩板，留下炽热的地裂。',
    },
    {
      id: 4, name: '星光束', ultimateName: '天穹轨道炮', form: '贯穿光束', hotkey: '4',
      element: 'light',
      color: '#8fe0ff', level: 3, range: 40, radius: 3.7, windup: 0.67, cooldown: 1.30,
      groundTarget: false, demoOrder: 4,
      description: '层叠星环校准天穹炮口，收束的星能贯穿地面，释放环形余波。',
    },
    {
      id: 5, name: '伏特禁城', ultimateName: '雷狱', form: '持续领域', hotkey: '5',
      element: 'electric',
      color: '#7b6bff', level: 3, range: 26, radius: 5.2, windup: 0.65, cooldown: 1.80,
      groundTarget: true, demoOrder: 5,
      description: '黑曜立柱围出雷狱，交错电弧封锁穹顶，核心最终向外崩解。',
    },
    {
      id: 6, name: '冰川王冠', ultimateName: '冰川纪元', form: '自身增益', hotkey: '6',
      element: 'ice',
      color: '#7ff0e6', level: 3, range: 18, radius: 4.5, windup: 0.66, cooldown: 1.80,
      groundTarget: true, demoOrder: 3,
      description: '寒潮层层向外推进，冰晶从地脉生长，重塑整片战场。',
    },
    {
      id: 7, name: '疾风裂空', ultimateName: '龙卷裂隙', form: '位移', hotkey: '7',
      element: 'fly',
      color: '#86ffd0', level: 3, range: 15, radius: 3.8, windup: 0.46, cooldown: 1.25,
      groundTarget: false, demoOrder: 7,
      description: '化作疾风穿越战场，留下裹挟碎石的螺旋风壁与巨型龙卷。',
    },
    {
      id: 8, name: '岩牙突刺', ultimateName: '群山崩塌', form: '直线近战', hotkey: '8',
      element: 'earth',
      color: '#e0a86a', level: 3, range: 12, radius: 3.9, windup: 0.58, cooldown: 1.15,
      groundTarget: false, demoOrder: 8,
      description: '大地沿施法方向开裂，巨石与山脊依次隆起，掀起漫天尘土。',
    },
    {
      id: 9, name: '王之财宝', ultimateName: '天地乖离', form: '剑雨投射', hotkey: '9',
      element: 'light',
      color: '#ffcf6b', level: 3, range: 36, radius: 4.2, windup: 0.64, cooldown: 1.35,
      groundTarget: false, demoOrder: 9,
      description: '金色门扉在头顶展开宝库，六十柄宝具分轮齐射，钉满整片落点。',
    },
    {
      id: 10, name: '魔弹连射', ultimateName: '弹幕终章', form: '弹幕风暴', hotkey: '0',
      element: 'normal',
      color: '#dfe9ff', level: 3, range: 28, radius: 3.4, windup: 0.52, cooldown: 1.05,
      groundTarget: false, demoOrder: 10,
      description: '连珠魔弹撕裂空气，弹链环绕、俯冲、倾泻，终章时整片天空化作弹幕之海。',
    },
    {
      id: 11, name: '怒涛裂岸', ultimateName: '沧海归墟', form: '浪涌漩涡', hotkey: '-',
      element: 'water',
      color: '#37b5ff', level: 3, range: 26, radius: 4.6, windup: 0.62, cooldown: 1.50,
      groundTarget: true, demoOrder: 11,
      description: '巨浪掀地而出横扫落点，倒卷成漩涡吸聚万物，归墟内爆吞没全场。',
    },
  ];

  /* 启动时与测试都会运行；返回问题列表而不是抛错，便于一次收集全部问题 */
  function validate() {
    const problems = [];
    /* 元素元表自检：key/order 不得重复（同系多技能是合法的，不做技能级查重） */
    const elementKeys = new Set(), elementOrders = new Set();
    for (const e of ELEMENTS) {
      if (elementKeys.has(e.key)) problems.push('元素 key 重复: ' + e.key);
      elementKeys.add(e.key);
      if (elementOrders.has(e.order)) problems.push('元素 order 重复: ' + e.order);
      elementOrders.add(e.order);
      if (!/^#[0-9a-f]{6}$/i.test(e.color)) problems.push('元素 ' + e.key + ' 颜色非法: ' + e.color);
    }
    const ids = new Set(), keys = new Set(), orders = new Set();
    for (const s of CATALOG) {
      if (!Number.isInteger(s.id) || s.id < 1 || ids.has(s.id)) problems.push('id 非法或重复: ' + s.id);
      ids.add(s.id);
      if (!/^#[0-9a-f]{6}$/i.test(s.color)) problems.push(s.name + ' 颜色非法: ' + s.color);
      if (!(s.level >= 1 && s.level <= 5)) problems.push(s.name + ' 默认等级非法: ' + s.level);
      if (!s.hotkey || keys.has(s.hotkey)) problems.push(s.name + ' 快捷键缺失或重复: ' + s.hotkey);
      keys.add(s.hotkey);
      if (typeof s.description !== 'string' || s.description.length < 4) problems.push(s.name + ' 缺少描述');
      if (!Number.isInteger(s.demoOrder) || s.demoOrder < 1 || s.demoOrder > CATALOG.length || orders.has(s.demoOrder)) {
        problems.push(s.name + ' demoOrder 非法或重复: ' + s.demoOrder);
      }
      orders.add(s.demoOrder);
      if (!elementOf(s.element)) problems.push(s.name + ' 未知元素: ' + s.element);
      for (const key of ['range', 'radius', 'windup', 'cooldown']) {
        if (!(s[key] > 0)) problems.push(s.name + ' 缺少有效 ' + key);
      }
      if (typeof s.groundTarget !== 'boolean') problems.push(s.name + ' groundTarget 必须是布尔');
    }
    return problems;
  }

  global.SKILL_CATALOG = CATALOG;
  global.SkillCatalog = { items: CATALOG, elements: ELEMENTS, elementOf, validate };
})(window);
