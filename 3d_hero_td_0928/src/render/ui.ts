/* ============================================================================
   ui.ts — 死灵防线 3D · 营地与战斗界面
   （自 dev/ui.js 移植为 ESM；原文已删，git 历史保留）
   注册表提供内容，DIRECTOR 提供拥有权、投资门控与效果预览。
   营地是独立界面；战斗与波间整备都没有升级抽屉。
   ========================================================================== */
import { CONFIG, type SpellDef, type AllyDef, type UpgradeDef } from '../core/config';
import { DIRECTOR } from '../core/director';
import { SPELLS } from './skills';
import { Units } from './entities/units';
import { FX } from './particles';
import type { Game } from './scene';

/* ------------------------------ 类型 ------------------------------ */
/* 表面标识：'' 为初始值；其余与 document.body.dataset.surface 同步 */
type UiSurface = '' | 'title' | 'camp' | 'combat' | 'defeat';

/* 研习卡片句柄（_buildUpgrades 构建，_renderCamp 刷新） */
interface UpgradeCard {
  el: HTMLElement;
  rank: HTMLElement;
  current: HTMLElement;
  next: HTMLElement;
  milestone: HTMLElement;
  cost: HTMLElement;
  buy: HTMLButtonElement;
  availability: HTMLElement;
}

/* ------------------------------ 助手 ------------------------------ */
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const text = (el: HTMLElement, value: unknown): void => {
  const next = String(value);
  if (el.textContent !== next) el.textContent = next;
};
const make = (tag: string, className?: string, value?: string): HTMLElement => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
};
const gate = (el: HTMLElement, visible: boolean): void => {
  el.hidden = !visible;
  el.inert = !visible;
  el.setAttribute('aria-hidden', String(!visible));
};

export const UI = {
  game: null as Game | null,
  selectedId: null as number | null,
  _els: {} as Record<string, HTMLElement>,
  _hudT: 0,
  _toastT: 0,
  _bannerT: 0,
  _screenOpen: false,
  /* showScreen/hideScreen 动态写入的操作回调（原 JS 的隐式属性，这里显式声明） */
  _screenAction: null as (() => void) | null,
  _surface: '' as UiSurface,
  _campSignature: '',
  _hintSignature: '',
  spellSlots: {} as Record<number | string, HTMLButtonElement>,
  summonBtns: {} as Record<string, HTMLButtonElement>,
  upgradeCards: {} as Record<string, UpgradeCard>,
  upgradeGroups: {} as Record<string, HTMLElement>,

  init(game: Game) {
    this.game = game;
    for (const id of ['scene', 'combat-ui', 'hp-fill', 'hp-frame', 'hp-num', 'hp-max', 'gold',
      'wave-label', 'phase-label', 'boss-bar', 'boss-fill', 'boss-frame', 'boss-name',
      'spellbar', 'summonbar', 'summon-group', 'summon-sep', 'bolt-status', 'combat-hints',
      'upgrade-panel', 'upgrade-list', 'upgrade-summary', 'camp-milestone',
      'camp-screen', 'camp-shell', 'camp-title', 'camp-sub', 'camp-gold', 'camp-start',
      'camp-onboarding', 'camp-return', 'camp-first-guide', 'camp-loadout-group', 'camp-loadout',
      'camp-record', 'camp-delves', 'camp-hp', 'camp-footer-title', 'camp-footer-note',
      'starter-name', 'starter-description', 'starter-damage', 'starter-cooldown', 'starter-key',
      'screen', 'screen-title', 'screen-sub', 'screen-tip', 'screen-action', 'screen-kicker',
      'screen-results', 'result-wave', 'result-kills', 'result-gold',
      'banner', 'banner-title', 'banner-sub', 'toast', 'inter-bar', 'inter-count',
      'btn-next', 'hud-fps', 'hud-particles', 'blight-label', 'btn-retreat']) {
      this._els[id] = $(id);
    }
    const els = this._els;
    this.spellSlots = {};
    this.summonBtns = {};
    this.upgradeCards = {};
    this.upgradeGroups = {};
    els.spellbar.replaceChildren();
    els.summonbar.replaceChildren();
    els['upgrade-list'].replaceChildren();
    for (const def of CONFIG.SPELLS) {
      const slot = this._makeSlot(def, false);
      slot.addEventListener('click', () => this.select(def.id));
      els.spellbar.appendChild(slot);
      this.spellSlots[def.id] = slot;
    }
    for (const def of CONFIG.ALLIES) {
      const slot = this._makeSlot(def, true);
      slot.addEventListener('click', () => {
        if (DIRECTOR.inRun() && DIRECTOR.ownsAlly(def.key) && !this._screenOpen) DIRECTOR.summon(def.key);
      });
      els.summonbar.appendChild(slot);
      this.summonBtns[def.key] = slot;
    }
    els['btn-retreat'].addEventListener('click', () => {
      if (DIRECTOR.inRun()) DIRECTOR.retreat();
    });
    els['btn-next'].addEventListener('click', () => {
      if (DIRECTOR.state === 'intermission') DIRECTOR.startNextNow();
    });
    els['camp-start'].addEventListener('click', () => {
      if (DIRECTOR.state === 'camp' && !this._screenOpen && DIRECTOR.enterDelve()) this.hideScreen();
    });
    els['screen-action'].addEventListener('click', () => {
      if (this._screenOpen && this._screenAction) this._screenAction();
    });
    // 标题/结算只有一个操作；其余界面已 hidden + inert，Tab 不落入背后的战场。
    els.screen.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && this._screenOpen) {
        event.preventDefault();
        els['screen-action'].focus();
      }
    });

    DIRECTOR.on((kind, data) => {
      if (kind === 'camp') {
        this.showCamp();
      } else if (kind === 'wave') {
        this.hideScreen();
        this.banner('第 ' + data.wave + ' 波' + (data.wave % CONFIG.BOSS_EVERY === 0 ? ' · 头目' : ''),
          data.banner || '守住防线 · 击退亡灵，收集金币');
      } else if (kind === 'delve') {
        this.hideScreen();
        this.clearSelection();
        this.select(1);
        this._updateHud();
      } else if (kind === 'clear') {
        this._syncSurfaces();
        this._updateHud();
        this.banner('第 ' + data.wave + ' 波守住', '获得 ' + data.bonus + ' 金 · 继续迎战，或按 R 安全回营');
      } else if (kind === 'retreat') {
        this.toast('安全回营 · 抵达第 ' + data.wave + ' 波，金币全部保留');
      } else if (kind === 'defeat') {
        this.showScreen('防线失守', '这次下探告一段落，火种仍在。\n金币与已学会的能力全部保留。',
          '带着收获回营', () => DIRECTOR.goCamp());
      } else if (kind === 'reset') {
        this._showTitle();
      } else if (kind === 'reject') {
        const why: Record<string, string> = { gold: '金币不足', cap: '已达在场上限', slot: '集结位已满', locked: '尚未学会', battle: '仅下探时可召唤', state: '仅下探时可召唤' };
        this.toast((data.name || '召唤') + ' · ' + (why[data.reason] || '暂时无法召唤'));
      } else if (kind === 'reject-upgrade') {
        const why: Record<string, string> = { gold: '金币不足', locked: '尚未满足前置条件', max: '已达最高阶',
          unknown: '未知研习项目', state: '返回营地后才能投资', camp: '返回营地后才能投资',
          first: '完成首次下探后开放投资', 'first-delve': '完成首次下探后开放投资' };
        this.toast((data.name || '研习') + ' · ' + (why[data.reason] || '暂时无法投资'));
      } else if (kind === 'upgrade') {
        const def = CONFIG.upgradeOf(data.key);
        if (def) this.toast(def.name + ' · 第 ' + DIRECTOR.level(def.key) + ' 阶已掌握');
        this._campSignature = '';
        if (this._surface === 'camp') this._renderCamp();
      } else if (kind === 'laststand') {
        const def = CONFIG.upgradeOf('lastStand');
        this.banner(def ? def.name : '最终壁垒', '圣辉挡下了致命一击 · 本次下探已消耗');
      } else if (kind === 'summon') {
        this.toast(data.name + ' 加入防线');
        this._updateHud();
      }
    });
    this._showTitle();
    this._updateHud();
  },

  _makeSlot(def: SpellDef | AllyDef, ally: boolean): HTMLButtonElement {
    const slot = make('button', 'slot' + (ally ? ' summon' : '')) as HTMLButtonElement;
    slot.type = 'button';
    slot.disabled = true;
    gate(slot, false);
    const glyph = make('span', 'glyph' + (ally ? ' ally' : ''));
    glyph.style.setProperty('--c', ally ? (def as AllyDef).trim : def.color);
    glyph.setAttribute('aria-hidden', 'true');
    slot.append(make('kbd', 'key', def.hotkey), glyph, make('span', 'nm', def.name), make('span', 'slot-status'));
    slot.setAttribute('aria-keyshortcuts', def.hotkey);
    if (!ally) {
      slot.setAttribute('aria-pressed', 'false');
      const cooldown = make('span', 'cd');
      cooldown.setAttribute('aria-hidden', 'true');
      slot.appendChild(cooldown);
    }
    return slot;
  },

  select(id: number | string) {
    const def = CONFIG.spellOf(Number(id));
    /* ownsSpell 形参为 string，其内部 CONFIG.spellOf 会 Number() 归一；String() 往返等价 */
    if (!def || !DIRECTOR.inRun() || !DIRECTOR.ownsSpell(String(def.id)) || this._screenOpen) return false;
    this.selectedId = this.selectedId === def.id ? null : def.id;
    this._syncSelection();
    return true;
  },
  clearSelection() {
    this.selectedId = null;
    this._syncSelection();
  },
  _syncSelection() {
    for (const key in this.spellSlots) {
      const selected = Number(key) === this.selectedId;
      this.spellSlots[key].classList.toggle('sel', selected);
      this.spellSlots[key].setAttribute('aria-pressed', String(selected));
    }
  },

  _syncSurfaces() {
    const els = this._els;
    const combat = DIRECTOR.inRun() && !this._screenOpen;
    const camp = DIRECTOR.state === 'camp' && !this._screenOpen;
    const surface = this._screenOpen ? (DIRECTOR.state === 'defeat' ? 'defeat' : 'title') : camp ? 'camp' : 'combat';
    gate(els['combat-ui'], combat);
    gate(els['camp-screen'], camp);
    gate(els.screen, this._screenOpen);
    els.screen.classList.toggle('show', this._screenOpen);
    els.scene.inert = !combat;
    els.scene.tabIndex = combat ? 0 : -1;
    els.scene.setAttribute('aria-hidden', String(!combat));
    const investing = camp && DIRECTOR.canBuyUpgrades();
    gate(els['upgrade-panel'], investing);
    els['upgrade-panel'].classList.toggle('open', investing);
    (els['camp-start'] as HTMLButtonElement).disabled = !camp;
    (els['screen-action'] as HTMLButtonElement).disabled = !this._screenOpen;
    (els['btn-retreat'] as HTMLButtonElement).disabled = !combat;
    const inter = combat && DIRECTOR.state === 'intermission';
    gate(els['inter-bar'], inter);
    els['inter-bar'].classList.toggle('show', inter);
    (els['btn-next'] as HTMLButtonElement).disabled = !inter;
    if (!combat && this.selectedId !== null) this.clearSelection();
    if (this._surface !== surface) {
      this._surface = surface;
      this._campSignature = '';
      document.body.dataset.surface = surface;
      els.banner.classList.remove('show');
      this._bannerT = 0;
      const target = this._screenOpen ? els['screen-action'] : camp ? els['camp-title'] : els.scene;
      target.focus({ preventScroll: true });
    }
  },

  // 兼容输入层旧 API。营地研习是页面内容，不再是可被 U / Escape 开合的抽屉。
  togglePanel(_legacyArg?: boolean) {
    this._syncSurfaces();
    return this._surface === 'camp' && DIRECTOR.canBuyUpgrades();
  },

  _buildUpgrades() {
    for (const branch of CONFIG.BRANCHES) {
      const section = make('section', 'upgrade-branch');
      section.style.setProperty('--branch', branch.color);
      const heading = make('h3', 'branch-title', branch.name);
      heading.id = 'branch-' + branch.key;
      section.setAttribute('aria-labelledby', heading.id);
      const grid = make('div', 'upgrade-grid');
      section.append(heading, grid);
      this._els['upgrade-list'].appendChild(section);
      this.upgradeGroups[branch.key] = section;
      for (const def of CONFIG.UPGRADES.filter((item) => item.branch === branch.key)) {
        const card = make('article', 'upgrade-card');
        card.dataset.key = def.key;
        card.tabIndex = -1;
        const title = make('h4', 'upgrade-name', def.name);
        title.id = 'upgrade-name-' + def.key;
        card.setAttribute('aria-labelledby', title.id);
        const rank = make('span', 'upgrade-rank');
        const head = make('div', 'upgrade-card-head');
        head.append(title, rank);
        const applies = make('p', 'upgrade-applies', def.applies + ' · ' + def.per);
        const desc = make('p', 'upgrade-description', def.description);
        desc.id = 'upgrade-desc-' + def.key;
        const effects = make('div', 'upgrade-effects');
        effects.id = 'upgrade-effects-' + def.key;
        const current = make('strong');
        const next = make('strong');
        const from = make('div');
        const to = make('div');
        const arrow = make('span', 'effect-arrow', '→');
        arrow.setAttribute('aria-hidden', 'true');
        from.append(make('span', 'effect-label', '当前'), current);
        to.append(make('span', 'effect-label', '下一阶'), next);
        effects.append(from, arrow, to);
        const milestone = make('p', 'upgrade-milestone');
        const purchase = make('div', 'upgrade-purchase');
        const cost = make('strong', 'upgrade-cost');
        const buy = make('button', 'buy-btn') as HTMLButtonElement;
        buy.type = 'button';
        buy.disabled = true;
        const availability = make('p', 'upgrade-availability');
        availability.id = 'upgrade-status-' + def.key;
        buy.setAttribute('aria-describedby', desc.id + ' ' + effects.id + ' ' + availability.id);
        purchase.append(cost, buy);
        card.append(head, applies, desc, effects, milestone, purchase, availability);
        buy.addEventListener('click', () => {
          if (this._surface !== 'camp' || !DIRECTOR.canBuyUpgrades() || !DIRECTOR.upgradeVisible(def.key) ||
            !DIRECTOR.isUnlocked(def.key) || DIRECTOR.level(def.key) >= def.max || DIRECTOR.gold < DIRECTOR.upgradeCost(def.key)) return;
          const hadFocus = document.activeElement === buy;
          if (DIRECTOR.buyUpgrade(def.key)) {
            this._campSignature = '';
            this._renderCamp();
            if (hadFocus && buy.disabled) card.focus({ preventScroll: true });
          }
        });
        grid.appendChild(card);
        this.upgradeCards[def.key] = { el: card, rank, current, next, milestone, cost, buy, availability };
      }
    }
  },
  _dependencies(def: UpgradeDef): string[] {
    const required = Array.isArray(def.requires) ? def.requires : def.requires ? [def.requires] : [];
    return [def.parent, ...required].filter((key): key is string => !!key);
  },
  _renderCamp() {
    const els = this._els;
    const signature = [DIRECTOR.gold, DIRECTOR.completedDelves, DIRECTOR.record, DIRECTOR.heroMaxHp,
      DIRECTOR.canBuyUpgrades(), ...CONFIG.UPGRADES.map((def) => DIRECTOR.level(def.key))].join('|');
    if (signature === this._campSignature) return;
    this._campSignature = signature;
    const first = DIRECTOR.completedDelves === 0;
    const canBuy = DIRECTOR.canBuyUpgrades();
    els['camp-shell'].classList.toggle('first-visit', first);
    gate(els['camp-onboarding'], first);
    gate(els['camp-first-guide'], first);
    gate(els['camp-return'], !first);
    gate(els['camp-loadout-group'], !first);
    gate(els['upgrade-panel'], canBuy && this._surface === 'camp');
    text(els['camp-title'], first ? '余烬营地' : '欢迎回到营地');
    text(els['camp-sub'], first ? '一束火，一道防线。你的第一次下探，从这里开始。' : '把带回的金币变成力量，再向更深处出发。');
    text(els['camp-gold'], DIRECTOR.gold);
    text(els['camp-record'], '第 ' + DIRECTOR.record + ' 波');
    text(els['camp-delves'], DIRECTOR.completedDelves + ' 次');
    text(els['camp-hp'], DIRECTOR.heroMaxHp);
    text(els['camp-start'], first ? '开始首次下探 →' : '整装，再次下探 →');
    text(els['camp-footer-title'], first ? '目标：用火球守住第一波' : '每次归来，都比上次更强');
    text(els['camp-footer-note'], '从第 1 波出发 · 败北或撤退都会保留金币与能力');
    const starter = CONFIG.spellOf(1);
    if (starter) {
      text(els['starter-name'], starter.name);
      text(els['starter-description'], starter.description);
      text(els['starter-damage'], starter.damage + ' 范围伤害');
      text(els['starter-cooldown'], starter.cooldown + ' 秒冷却');
      text(els['starter-key'], starter.hotkey);
    }
    this._renderCampLoadout();
    // 首次回营前，不创建任何投资卡片或锁定树。
    if (!canBuy) return;
    if (!Object.keys(this.upgradeCards).length) this._buildUpgrades();
    const visible = CONFIG.UPGRADES.filter((def) => DIRECTOR.upgradeVisible(def.key));
    let affordable = 0;
    for (const def of CONFIG.UPGRADES) {
      const card = this.upgradeCards[def.key];
      if (!card) continue;
      const shown = visible.includes(def);
      gate(card.el, shown);
      if (!shown) { card.buy.disabled = true; continue; }
      const level = DIRECTOR.level(def.key);
      const maxed = level >= def.max;
      const unlocked = DIRECTOR.isUnlocked(def.key);
      const cost = DIRECTOR.upgradeCost(def.key);
      const available = canBuy && unlocked && !maxed && DIRECTOR.gold >= cost;
      const preview = DIRECTOR.upgradePreview(def.key);
      text(card.rank, '阶 ' + level + ' / ' + def.max);
      text(card.current, preview.current);
      text(card.next, maxed ? '已达最高阶' : preview.next);
      text(card.cost, maxed ? '永久掌握' : cost + ' 金');
      text(card.buy, maxed ? '已完成' : !unlocked ? '前置未完成' : available ? (def.max === 1 ? '学习' : '投资 +1 阶') : '金币不足');
      card.buy.disabled = !available;
      card.buy.setAttribute('aria-label', def.name + '，' + (maxed ? '已达最高阶' : '第 ' + (level + 1) + ' 阶，' + cost + ' 金，' + card.buy.textContent));
      const prerequisites = this._dependencies(def).filter((key) => DIRECTOR.level(key) < 1)
        .map((key) => { const prior = CONFIG.upgradeOf(key); return prior ? prior.name : key; });
      text(card.availability, maxed ? '已生效 · 每次下探都保留' : !unlocked ? '先学习：' + prerequisites.join('、') :
        available ? '可投资 · 立即生效，永久保留' : '还差 ' + Math.max(0, cost - DIRECTOR.gold) + ' 金');
      const child = CONFIG.UPGRADES.find((next) => this._dependencies(next).includes(def.key) && DIRECTOR.level(next.key) === 0);
      text(card.milestone, child ? '后续里程碑 · ' + child.name : maxed ? '此项研习已完成' : '成长目标 · 达到第 ' + def.max + ' 阶');
      card.el.classList.toggle('affordable', available);
      card.el.classList.toggle('maxed', maxed);
      card.el.classList.toggle('locked', !unlocked);
      if (available) affordable++;
    }
    for (const branch of CONFIG.BRANCHES) gate(this.upgradeGroups[branch.key], visible.some((def) => def.branch === branch.key));
    text(els['upgrade-summary'], affordable ? affordable + ' 项可投资' : '积攒金币，继续成长');
    const milestone = visible.find((def) => def.max === 1 && DIRECTOR.level(def.key) === 0) ||
      visible.find((def) => DIRECTOR.level(def.key) === 0) || visible.find((def) => DIRECTOR.level(def.key) < def.max);
    text(els['camp-milestone'], milestone ? '下个目标 · ' + milestone.name + ' — ' + DIRECTOR.upgradePreview(milestone.key).next : '已掌握所有研习 · 向更深的防线进发');
  },
  _renderCampLoadout() {
    const list = this._els['camp-loadout'];
    list.replaceChildren();
    const add = (name: string, detail: string, color: string) => {
      const item = make('li', 'loadout-item');
      const dot = make('span', 'loadout-dot');
      dot.style.setProperty('--c', color);
      dot.setAttribute('aria-hidden', 'true');
      const copy = make('div');
      copy.append(make('strong', '', name), make('span', '', detail));
      item.append(dot, copy);
      list.appendChild(item);
    };
    for (const def of CONFIG.SPELLS) if (DIRECTOR.ownsSpell(String(def.id))) add(def.name, '法术 · 按 ' + def.hotkey + ' 选择', def.color);
    if (DIRECTOR.ownsBolt()) add(CONFIG.HERO.autoBolt.name, '自动攻击 · 无需操作', CONFIG.HERO.autoBolt.color);
    for (const def of CONFIG.ALLIES) if (DIRECTOR.ownsAlly(def.key)) add(def.name, '召唤 · ' + def.cost + ' 金 / 名', def.trim);
  },

  toast(msg: string) {
    text(this._els.toast, msg);
    this._els.toast.classList.add('show');
    this._toastT = 2.8;
  },
  banner(title: string, sub?: string) {
    text(this._els['banner-title'], title);
    text(this._els['banner-sub'], sub || '');
    this._els.banner.classList.add('show');
    this._bannerT = 2.6;
  },
  _showTitle() {
    this.showScreen('死灵防线', '以火球点亮防线，击退涌来的亡灵。\n带回金币，让每一次出发更从容。', '走进余烬营地 →', () => DIRECTOR.begin());
  },
  showScreen(title: string, sub: string, action: string, cb: () => void) {
    const els = this._els;
    text(els['screen-title'], title);
    text(els['screen-sub'], sub);
    text(els['screen-action'], action);
    const defeat = DIRECTOR.state === 'defeat';
    text(els['screen-kicker'], defeat ? 'THE EMBER REMAINS · 火种未熄' : 'LEGION BREAKER · 3D');
    text(els['screen-tip'], defeat ? '回营研习新的力量，再试一次。' : '施放法术 / 守住防线 / 满载归来');
    gate(els['screen-results'], defeat);
    if (defeat) {
      text(els['result-wave'], DIRECTOR.wave);
      text(els['result-kills'], DIRECTOR.runKills);
      text(els['result-gold'], DIRECTOR.gold);
    }
    this._screenAction = cb;
    this._screenOpen = true;
    this._syncSurfaces();
  },
  hideScreen() {
    this._screenOpen = false;
    this._screenAction = null;
    this._syncSurfaces();
  },
  showCamp() {
    this._screenOpen = false;
    this._screenAction = null;
    this._campSignature = '';
    this._syncSurfaces();
    this._renderCamp();
  },

  _renderHints(spells: SpellDef[], allies: AllyDef[]) {
    const inter = DIRECTOR.state === 'intermission';
    const signature = spells.map((def) => def.id).join(',') + '|' + allies.map((def) => def.key).join(',') + '|' + inter;
    if (signature === this._hintSignature) return;
    this._hintSignature = signature;
    const hints = this._els['combat-hints'];
    hints.replaceChildren();
    const add = (key: string, label: string) => {
      const hint = make('span', 'control-hint');
      hint.append(make('kbd', '', key), make('span', '', label));
      hints.appendChild(hint);
    };
    if (spells.length) {
      add(spells.map((def) => def.hotkey).join(' / '), spells.length === 1 ? spells[0].name : '切换法术');
      add('左键', '落点释放');
      add('空格', '自动锁定施法');
    }
    for (const def of allies) add(def.hotkey, '召唤' + def.name);
    if (inter) add('N', '提前迎战');
    add('右键拖动', '环视');
  },
  _updateHud() {
    const els = this._els;
    const inRun = DIRECTOR.inRun() && !this._screenOpen;
    const spells = CONFIG.SPELLS.filter((def) => DIRECTOR.ownsSpell(String(def.id)));
    const allies = CONFIG.ALLIES.filter((def) => DIRECTOR.ownsAlly(def.key));
    if (this.selectedId !== null && (!inRun || !DIRECTOR.ownsSpell(String(this.selectedId)))) this.clearSelection();
    text(els['hp-num'], Math.ceil(DIRECTOR.heroHp));
    text(els['hp-max'], DIRECTOR.heroMaxHp);
    els['hp-frame'].setAttribute('aria-valuenow', String(Math.ceil(DIRECTOR.heroHp)));
    els['hp-frame'].setAttribute('aria-valuemax', String(DIRECTOR.heroMaxHp));
    text(els.gold, DIRECTOR.gold);
    const inter = DIRECTOR.state === 'intermission';
    text(els['wave-label'], '第 ' + DIRECTOR.wave + ' 波 · ' + (inter ? '波间整备' : '守住防线'));
    const inBattle = inRun && DIRECTOR.state === 'battle';
    gate(els['blight-label'], inBattle);
    if (inBattle) text(els['blight-label'], '瘴蚀 −' + DIRECTOR.blightPerSec().toFixed(1) + ' 生命 / 秒');
    const boss = inRun ? Units.boss() : null;
    gate(els['boss-bar'], !!boss);
    els['boss-bar'].classList.toggle('show', !!boss);
    if (boss) {
      text(els['boss-name'], boss.def.name);
      els['boss-fill'].style.width = (clamp(boss.hp / boss.maxHp, 0, 1) * 100).toFixed(1) + '%';
      els['boss-frame'].setAttribute('aria-label', boss.def.name + '生命');
      els['boss-frame'].setAttribute('aria-valuenow', String(Math.ceil(boss.hp)));
      els['boss-frame'].setAttribute('aria-valuemax', String(boss.maxHp));
    }
    const aliveAllies = Units.aliveAllies();
    for (const def of CONFIG.ALLIES) {
      const btn = this.summonBtns[def.key];
      const owned = DIRECTOR.ownsAlly(def.key);
      gate(btn, owned);
      btn.disabled = true;
      if (!owned) continue;
      const alive = aliveAllies.filter((ally) => ally.def.key === def.key).length;
      const full = alive >= DIRECTOR.capOf(def.key);
      const poor = DIRECTOR.gold < def.cost;
      const status = full ? '已满员' : poor ? '还差 ' + (def.cost - DIRECTOR.gold) + ' 金' : def.cost + ' 金召唤';
      text(btn.querySelector('.slot-status') as HTMLElement, alive + '/' + DIRECTOR.capOf(def.key) + ' · ' + status);
      btn.disabled = !inRun || full || poor;
      btn.setAttribute('aria-label', def.name + '，' + status + '，在场 ' + alive + '/' + DIRECTOR.capOf(def.key));
      btn.classList.toggle('poor', poor);
      btn.classList.toggle('full', full);
    }
    gate(els['summon-group'], allies.length > 0);
    gate(els['summon-sep'], allies.length > 0);
    for (const def of CONFIG.SPELLS) {
      const slot = this.spellSlots[def.id];
      const owned = DIRECTOR.ownsSpell(String(def.id));
      gate(slot, owned);
      slot.disabled = !owned || !inRun;
      if (!owned) continue;
      const cd = SPELLS.cdRemaining(def.id);
      const status = cd > 0.01 ? cd.toFixed(1) + ' 秒' : this.selectedId === def.id ? '已选择' : '就绪';
      text(slot.querySelector('.slot-status') as HTMLElement, status);
      slot.setAttribute('aria-label', def.name + '，按 ' + def.hotkey + ' 选择，' + status);
    }
    gate(els['bolt-status'], DIRECTOR.ownsBolt());
    if (DIRECTOR.ownsBolt()) text(els['bolt-status'], CONFIG.HERO.autoBolt.name + ' · 自动攻击');
    this._renderHints(spells, allies);
    if (inter) text(els['inter-count'], Math.ceil(DIRECTOR.intermissionLeft()) + ' 秒');
    text(els['hud-fps'], Math.round(this.game!.engine.getFps()));
    text(els['hud-particles'], FX.aliveCount());
    const owner = SPELLS.poseOwner();
    text(els['phase-label'], owner ? '正在施放 · ' + owner.def.name : this.selectedId ? '点击战场释放法术' : '选择法术，守住防线');
  },
  update(dt: number) {
    if (!this.game) return;
    this._syncSurfaces();
    if (this._surface === 'camp') this._renderCamp();
    const hpK = clamp(DIRECTOR.heroHp / DIRECTOR.heroMaxHp, 0, 1);
    this._els['hp-fill'].style.width = (hpK * 100).toFixed(1) + '%';
    this._els['hp-fill'].classList.toggle('low', hpK < 0.32);
    if (DIRECTOR.inRun()) {
      for (const def of CONFIG.SPELLS) {
        if (!DIRECTOR.ownsSpell(String(def.id))) continue;
        const slot = this.spellSlots[def.id];
        const frac = SPELLS.cdFraction(def.id);
        (slot.querySelector('.cd') as HTMLElement).style.transform = 'scaleY(' + frac.toFixed(3) + ')';
        slot.classList.toggle('cooling', frac > 0.001);
      }
    }
    if (this._toastT > 0 && (this._toastT -= dt) <= 0) this._els.toast.classList.remove('show');
    if (this._bannerT > 0 && (this._bannerT -= dt) <= 0) this._els.banner.classList.remove('show');
    this._hudT += dt;
    if (this._hudT < 0.2) return;
    this._hudT = 0;
    this._updateHud();
  },
};

// TODO(阶段2末)：全部模块转换后移除此全局桥
(window as unknown as { UI: typeof UI }).UI = UI;
