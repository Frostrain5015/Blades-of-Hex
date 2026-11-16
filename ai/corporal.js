// Corporal —— 中立守备队的回合规划。
// 只攻击引擎允许的来犯目标。陆军在本方行政区调防，舰船只在近岸避险。

import { createCombatModel } from './doctrine.js';
import { isWaterTile } from '../rules/surfaces.js';
import { getUnitBaseType } from '../rules/units.js';
import { canReinforceAtTile } from '../rules/healing.js';
import { isNeutralDistrict, isNextToNeutralCoast } from '../rules/neutralDefense.js';

export const meta = {
    name: 'Corporal',
    tier: 'Neutral',
    difficultyId: 'easy',
    description: '中立守备队：钉死在防区里打退来犯之敌，不出击、不支援、不扩张'
};

// 与 Optio 同级的犹豫程度。只作用于「打谁」「站哪格」这类同级选项，
// 不参与「守不守」的判断——守是定式，不是权衡出来的。
const DECISION_NOISE = 0.42;

// 防区半径：单位离锚点最远能走多少格。守备队的活动范围就这么大，
// 越过这个圈就不再是防守而是出击了。
const SECTOR_LEASH = 3;
// 舰船的锚地更紧：中立海军只负责封住自家港口的水道，不巡航、不远征。
const NAVAL_LEASH = 2;
// 原地不动是守备队的默认答案。加一道惯性阈值，让「换个格子站」必须真的
// 更好才成立——否则同级评分加上抖动就会让守军每回合在阵地上左右挪窝，
// 既看着像犹豫，也白白把自己送出工事。
const HOLD_INERTIA = 35;

export function planActions(gameState, helpers, myCamp = helpers?.CAMP?.neutral) {
    const {
        getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS,
        CAMP, UNIT_CONFIG, canAttackFaction, isHostileFaction, recruitTypesForCity
    } = helpers;
    if (!myCamp) return [];

    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const campKey = myCamp.id;
    const weather = gameState.weather || 'clear';

    const decisionRandom = () => gameState.rng?.next?.() ?? Math.random();
    const jitter = scale => (decisionRandom() * 2 - 1) * scale * DECISION_NOISE;
    const tileVisible = tile => !gameState.skirmishFog
        || !helpers.isTileVisible || helpers.isTileVisible(tile, myCamp);
    const unitVisible = unit => !!unit && (unit.camp === myCamp || !helpers.isUnitVisibleToCamp || helpers.isUnitVisibleToCamp(unit, myCamp));

    // 交战判定走外交表，但必须用**交战资格**而不是**敌意**：
    // 中立与玩家的 relation 就是字面上的 'neutral'，isHostile 恒为 false，
    // 拿它筛目标会把引擎允许打的人全部滤掉——守备队于是从头到尾一枪不发。
    // canAttack 同时接受 enemy 与 neutral，正是引擎自己在 getAttackableTiles
    // 里用的那一条。战役里若与某方结盟，这条同样会把盟友挡在外面。
    const mayEngageCamp = camp => {
        if (!camp || camp === myCamp) return false;
        if (canAttackFaction) return canAttackFaction(myCamp, camp);
        if (isHostileFaction) return isHostileFaction(myCamp, camp);
        return true;
    };
    const isFoeUnit = unit => !!unit && unitVisible(unit) && mayEngageCamp(unit.camp);

    // 与三档玩家人格共用同一套战斗估算：同一次交换必须算出同一个数字。
    // 跨域修正（岸防炮对舰 +30%、陆海互攻 −50%）就在这里面，因此岸防炮
    // 天然会把舰船排在陆上目标前面，不需要再写死一条「优先打船」的规则。
    const { estimateDamage, wouldDieToCounter } = createCombatModel({ state: gameState, weather, hexDistance });

    const isFixedEmplacement = unit => Number(unit.config?.speed) === 0;
    const isNavalUnit = unit => unit.config?.movementDomain === 'naval';

    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);
    const livingUnits = gameState.tiles
        .map(t => t.unit)
        .filter(unit => unit?.camp === myCamp && unit.hp > 0);
    const canAffordAnything = (gameState.playerGold?.[campKey] || 0) >= (UNIT_CONFIG.infantry?.cost || 8);
    if (allUnits.length === 0 && !canAffordAnything) return actions;

    // ═══════════════════════════════════════════
    // 领土 —— 完全由当前局面推导，不含任何写死的行政区编号
    // ═══════════════════════════════════════════

    const myCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp);
    const myVillages = gameState.tiles.filter(t => t.isVillage && isNeutralDistrict(gameState, t));
    const myPorts = gameState.tiles.filter(t => t.isPort && t.camp === myCamp);

    // 驻防点：值得站上去、也值得为之开火的地块。
    const garrisonPosts = [...myCities, ...myVillages, ...myPorts];

    /**
     * 该单位守得住的驻防点。港口是水格、城村是陆地，所以陆军不会被划给港口、
     * 舰船也不会被划给内陆城——否则单位会围着一个自己永远站不上去的锚点空转。
     */
    function eligiblePosts(unit) {
        return garrisonPosts.filter(post => isNavalUnit(unit)
            ? (isWaterTile(post) || post.isPort)
            : !isWaterTile(post));
    }

    /**
     * 单位的锚点：就近划归的驻防点。防区因此是一组以驻防点为中心的沃罗诺伊格，
     * 边界由「离谁更近」决定，天然实现了「不跨区支援」——隔壁城再危险，
     * 那也是隔壁那个锚点的防区，本单位过不去。
     * 一个驻防点都没有（城全丢了）时锚点就是脚下这一格：原地打到死，不流窜。
     */
    function anchorFor(unit, posts = eligiblePosts(unit)) {
        let best = null;
        let bestDistance = Infinity;
        for (const post of posts) {
            const distance = hexDistance(unit.tile, post);
            if (distance < bestDistance) { bestDistance = distance; best = post; }
        }
        return best || unit.tile;
    }

    /**
     * 防区 = 锚点周围 leash 格，外加通往本单位负责的那个空岗的走廊。
     *
     * 「不跨区支援」由 leash 本身保证：相邻行政区的城市在标准地图上都在 5 格以外，
     * 3 格的牵引半径根本够不着。早先这里还叠了一层沃罗诺伊边界（离哪个驻防点更近
     * 就归谁），结果制造出一圈死区——单位走向自己负责的空村时，途经格子会因为
     * 「离隔壁的村更近」被判出界，于是卡在半路，村子永远没人驻守。
     * 边界精度对守备队没有价值，牵引半径才是真正的约束。
     */
    function isInSector(tile, anchor, leash, objective = null) {
        if (hexDistance(tile, anchor) <= leash) return true;
        return !!objective && hexDistance(tile, objective) <= leash;
    }

    /**
     * 落点的通行性。这是修复「守军集体渡海」的硬闸门：
     * 引擎允许陆军上船漂海，但 Corporal 没有护航概念也没有海战意识，
     * 把陆军放到水上就是白送。所以陆军的落点**永远**是陆地，没有例外分支。
     */
    function canStandOn(unit, tile) {
        if (!tile || (tile.unit && unitVisible(tile.unit))) return false;
        if (isNavalUnit(unit)) {
            return tile.isPort ? tile.camp === myCamp : isWaterTile(tile) && isNextToNeutralCoast(gameState, tile);
        }
        return !isWaterTile(tile) && isNeutralDistrict(gameState, tile);
    }

    function countAdjacentFoes(tile) {
        let count = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (isFoeUnit(neighbor?.unit)) count++;
        }
        return count;
    }

    function isPostTile(tile) {
        return garrisonPosts.some(post => post.q === tile.q && post.r === tile.r);
    }

    function isAdjacentToPost(tile) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor && isPostTile(neighbor)) return true;
        }
        return false;
    }

    const terrainDefenseScore = tile =>
        tile.terrain === 'mountain' ? 26 : tile.terrain === 'forest' ? 18 : 0;

    const effectiveHp = defender => defender.hp + (defender._shield || 0);
    const willKill = (attacker, defender) =>
        estimateDamage(attacker, defender) >= effectiveHp(defender);

    // ═══════════════════════════════════════════
    // 对策卡：中立阵营没有卡牌经济。drawCard() 对 neutral 直接返回 null，
    // playerHands / playerDrawsThisTurn 也没有 neutral 键，免费发牌同样跳过中立。
    // 这不是难度阉割，是规则如此——所以这里一张卡都不规划。
    // ═══════════════════════════════════════════

    // ═══════════════════════════════════════════
    // 第一轮：用引擎判定的防御目标开火
    // ═══════════════════════════════════════════

    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;
        const targets = getAttackableTiles(unit)
            .filter(tile => isFoeUnit(tile.unit) && tileVisible(tile));
        if (targets.length === 0) continue;

        const anchor = anchorFor(unit);
        let bestTile = null;
        let bestScore = -Infinity;

        for (const tile of targets) {
            const target = tile.unit;
            let score = 0;

            // 斩杀优先。中立没有战役目标，减少一个进攻方单位就是它全部的收益。
            if (willKill(unit, target)) {
                score += 200;
                if (target.commander) score += 50;
            }

            // 越靠近我要守的东西，威胁越大。这是 Corporal 唯一的「战略」。
            const threatDistance = hexDistance(tile, anchor);
            score += Math.max(0, 90 - threatDistance * 25);
            if (isPostTile(tile)) score += 120;   // 已经站到我的城/村上了，最优先赶走
            if (isAdjacentToPost(tile)) score += 45;

            // 残血收割：估算伤害占目标剩余血量的比例越高越值得打。
            score += (1 - target.hp / target.maxHp) * 55;

            // 这一刀的期望伤害。克制、天气、跨域修正都已经折进 estimateDamage，
            // 所以岸防炮会自然而然地把舰船排在陆上目标前面。Optio 级的粗判断：
            // 只看这一次交换，不与同伴分配输出，也不推演下一刀。
            score += Math.min(60, estimateDamage(unit, target) * 0.35);

            // 反击自杀否决 —— 但固定火力点除外：碉堡和岸防炮既退不走也躲不掉，
            // 憋着不开火只会让对方毫发无损地通过，永远是更差的选择。
            if (!isFixedEmplacement(unit) && wouldDieToCounter(unit, target)) score -= 150;

            score += jitter(60);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第二轮：驻防 —— 站住阵地，退回锚点，绝不追击
    // ═══════════════════════════════════════════

    const reserved = new Set();
    const heldPosts = new Set();
    for (const unit of livingUnits) {
        if (unit.tile && isPostTile(unit.tile)) heldPosts.add(`${unit.tile.q},${unit.tile.r}`);
    }

    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;

        // 固定火力点没有腿。它这一轮要么已经开过火，要么就在原地待命。
        if (isFixedEmplacement(unit)) continue;

        // 中央航母是地图彩头：引擎不再拦死它的移动，挪不挪由这里的评分决定。
        // 重罚离港 + 重奖泊港，平时一步不动；唯一压得过这套账的是贴脸威胁——
        // 安全优先于泊港，但规避也不出锚地牵引圈，威胁过去后自然漂回港口。
        if (getUnitBaseType(unit) === 'carrier') {
            const portAnchor = anchorFor(unit, myPorts.length > 0 ? myPorts : eligiblePosts(unit));
            const carrierCandidates = getMovableTiles(unit).filter(tile =>
                canStandOn(unit, tile)
                && !reserved.has(`${tile.q},${tile.r}`)
                && hexDistance(tile, portAnchor) <= NAVAL_LEASH);
            const scoreCarrierTile = tile =>
                -hexDistance(tile, portAnchor) * 60
                + (tile.isPort && tile.camp === myCamp ? 120 : 0)
                - countAdjacentFoes(tile) * 200;
            let bestCarrierTile = null;
            let bestCarrierScore = scoreCarrierTile(unit.tile) + HOLD_INERTIA;
            for (const tile of carrierCandidates) {
                const score = scoreCarrierTile(tile) + jitter(45);
                if (score > bestCarrierScore) { bestCarrierScore = score; bestCarrierTile = tile; }
            }
            if (bestCarrierTile) {
                actions.push({ type: 'move', unitId: unit.id, tileQ: bestCarrierTile.q, tileR: bestCarrierTile.r, autoAttack: false });
                reserved.add(`${bestCarrierTile.q},${bestCarrierTile.r}`);
                if (isPostTile(bestCarrierTile)) heldPosts.add(`${bestCarrierTile.q},${bestCarrierTile.r}`);
                processed.add(unit.id);
            }
            continue;
        }

        // 已经站在驻防点上的单位：守着，不动。
        // 旧脚本在这里做过「残血换防 + 招人顶上」的复杂调度，那既超出本档的规划深度，
        // 也正是让中立显得「久攻不下」的原因之一——现在守军就是守到死为止。
        if (isPostTile(unit.tile)) continue;

        const posts = eligiblePosts(unit);
        const anchor = anchorFor(unit, posts);
        const leash = isNavalUnit(unit) ? NAVAL_LEASH : SECTOR_LEASH;

        // 本防区里还空着、且本单位站得上去的岗位。一步走不到也要往那边挪：
        // 只给「这一步能落到岗位上」加分的话，速度 3 的炮兵永远够不着四格外的空村，
        // 于是它会在原地站一辈子，而村子一直无人驻守。
        const vacantObjective = posts
            .filter(post => !heldPosts.has(`${post.q},${post.r}`) && (!post.unit || !unitVisible(post.unit))
                && hexDistance(post, anchor) <= leash
                && canStandOn(unit, post))
            .sort((left, right) => hexDistance(unit.tile, left) - hexDistance(unit.tile, right))[0] || null;
        const distanceToObjective = vacantObjective
            ? hexDistance(unit.tile, vacantObjective) : 0;

        const candidates = getMovableTiles(unit).filter(tile =>
            canStandOn(unit, tile)
            && !reserved.has(`${tile.q},${tile.r}`)
            && isInSector(tile, anchor, leash, vacantObjective));
        if (candidates.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;

        function scorePosition(tile) {
            let score = 0;

            // ① 空着的驻防点必须有人站——这是守备队闲下来时唯一该做的事。
            //    注意这不是为了增收：无人的村庄本来就按行政区归城市所有者结算
            //    （grantTurnStartIncome 里 vTile.unit 为空时取该区城主），
            //    站上去的意义是**拒止**——只要敌人站上来，这笔钱当场改姓。
            //    空岗的分值必须压过「原地不动」，否则一支闲兵会站在自家村口
            //    看着村子门户洞开。
            const postKey = `${tile.q},${tile.r}`;
            const isVacantPost = isPostTile(tile) && !heldPosts.has(postKey);
            if (isVacantPost) {
                score += tile.isCity ? 300 : 210;
                // 雨天步兵守城 +20% 防御，是这个档次唯一看得懂的天气账。
                if (tile.isCity && getUnitBaseType(unit) === 'infantry') {
                    score += weather === 'rain' ? 45 : 25;
                }
            }

            // ③ 向空岗行进：这一步拉近了多少距离就记多少分，够不着也要往那边走。
            if (vacantObjective && !isVacantPost) {
                score += (distanceToObjective - hexDistance(tile, vacantObjective)) * 28;
            }

            // ④ 向锚点收拢，负责把被打散、被推开的单位召回。
            //    去补空岗时不算这笔账：岗位在哪，防区就延伸到哪，
            //    否则「离锚点更远」会把远处的空村永远排除在外。
            if (!isVacantPost) {
                score += (leash - hexDistance(tile, anchor)) * 22;
                if (isAdjacentToPost(tile)) score += 40;
            }

            // ⑤ 地形。守备队没有别的本钱，能站高地就站高地。
            score += terrainDefenseScore(tile);

            // ⑥ 安全。残血时格外躲开贴脸的敌人；炮兵任何时候都怕被贴上。
            const adjacentFoes = countAdjacentFoes(tile);
            score -= adjacentFoes * (getUnitBaseType(unit) === 'archer' ? 34 : hpRatio < 0.35 ? 30 : 12);

            return score;
        }

        // 原地不动是守备队的默认答案：「换个格子站」必须真的好过惯性阈值才成立。
        let bestTile = null;
        let bestScore = scorePosition(unit.tile) + HOLD_INERTIA;

        for (const tile of candidates) {
            const score = scorePosition(tile) + jitter(45);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r, autoAttack: false });
            reserved.add(`${bestTile.q},${bestTile.r}`);
            if (isPostTile(bestTile)) heldPosts.add(`${bestTile.q},${bestTile.r}`);
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第三轮：补员 —— 一回合最多一个，且只救真正要塌的阵地
    // ═══════════════════════════════════════════
    // 中立的强度直接决定玩家的挫败感：一个能持续回血的守军会把「拿下中立城」
    // 变成消耗战。所以补员是止血，不是续航——门槛压到 40%，每回合只准一次。

    let gold = gameState.playerGold[campKey] || 0;
    const emptyOwnCities = myCities.filter(city => !city.unit);
    const recruitReserve = emptyOwnCities.length > 0 ? (UNIT_CONFIG.infantry?.cost || 8) : 0;

    const woundedGarrison = gameState.tiles
        .filter(tile => tile.unit?.camp === myCamp
            && tile.unit.hp < tile.unit.maxHp * 0.40
            && isPostTile(tile)
            && !tile._reinforcedThisTurn
            && canReinforceAtTile(tile.unit, gameState))
        .sort((left, right) =>
            (left.unit.hp / left.unit.maxHp) - (right.unit.hp / right.unit.maxHp))[0];

    if (woundedGarrison) {
        const unit = woundedGarrison.unit;
        const healAmount = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
        const cost = Math.max(1, Math.ceil(unit.config.cost * (healAmount / unit.maxHp) * (helpers.getCulturalReinforceCostScale ? helpers.getCulturalReinforceCostScale(woundedGarrison, unit.camp) : 1)));
        if (healAmount > 0 && gold - cost >= recruitReserve) {
            actions.push({ type: 'reinforce', unitId: unit.id });
            gold -= cost;
        }
    }

    // ═══════════════════════════════════════════
    // 第四轮：招募 —— 只补空城，一回合一个，够守就不再买
    // ═══════════════════════════════════════════
    // 规则层已经把中立的城市与村庄合计收入统一折算到 20%
    // （rules/constants.applyNeutralEconomyRate，在 grantTurnStartIncome 入账前拦截）：
    // 王冠环岛上中立 3 城 6 村，毛收入 9+6=15，实收 3。
    // 这里再加一道**部队规模上限**作为行为层的第二道闸门：
    // 守备队的编制等于驻防点数，多出来的钱宁可烂在账上也不变成野战军。
    // 两道闸门是一个意思——中立没有取胜目标，它是玩家争夺的资源，
    // 打不完清不掉的中立会让双方/三方玩家一起难受。

    if (emptyOwnCities.length === 0) return actions;
    if (livingUnits.length > garrisonPosts.length) return actions;

    const target = emptyOwnCities
        .map(city => ({
            city,
            // 先补最危险的空城：身边有敌人的、以及所在行政区里敌人多的。
            pressure: countAdjacentFoes(city) * 80
                + gameState.tiles.filter(tile => isFoeUnit(tile.unit)
                    && tile.districtId === city.districtId).length * 20
        }))
        .sort((left, right) => right.pressure - left.pressure)[0];

    const preference = ['infantry', 'archer', 'cavalry'];
    const types = recruitTypesForCity ? recruitTypesForCity(target.city, preference) : preference;
    for (const type of types) {
        if (gold >= UNIT_CONFIG[type].cost) {
            actions.push({
                type: 'recruit', unitType: type,
                tileQ: target.city.q, tileR: target.city.r
            });
            break;
        }
    }

    return actions;
}
