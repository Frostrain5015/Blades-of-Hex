// Corporal —— 中立阵营指挥官。
//
// 定位：**守土的班长**。它不是一个弱化的玩家 AI，而是一支没有战争目标的守备队。
//   最高目标：守住脚下的阵地，并击退走进来的人。除此之外它对这场战争没有诉求。
//
//   会做的：射程内出现敌人就开火、把城市和村庄站满、被打退了就退回锚点、
//           挑地形站位、城里的兵优先用步兵、守军快打空了才补员招兵。
//   不做的：不跨防区支援（隔壁城丢了也不去救）、不主动出击追击、不攻城拔寨、
//           不用对策卡（中立没有卡牌经济）、不集火补刀、不预测威胁、
//           不给敌人建模、不做任何战役规划、**陆军绝不下海**。
//
// 智能水平对标 Optio：它会用同一套战斗估算判断「这一刀能不能砍死」，
// 但不会为一次击杀在同伴之间分配输出，也不会推算对手下一回合能覆盖到哪里。
//
// ── 为什么重写而不是升级旧的 Claude 人格 ──
// 旧脚本把「我的领土」写死成 `MY_DISTRICTS = {3,4,5}`，这在王冠环岛之外全盘失效，
// 并且直接制造了两个已确认的行为缺陷：
//   ① 岸防炮对射程内的敌舰无动于衷。舰船站在水格上，而水格既没有 districtId
//      也没有归属阵营，`isMyTurf(目标格)` 恒为假，于是引擎明明给出了合法目标，
//      脚本却把它全部过滤掉。讽刺的是只有**行政区编号不在硬编码表里**的那几门炮
//      会掉进「孤军后备」分支从而开火——离家越近的炮越不设防。
//   ② 陆军成建制横渡大洋。防区判定失败后，同一个「孤军后备」分支放开了落点限制，
//      而引擎允许陆军上船漂海，于是跳岛图上守军第一回合就集体下水，
//      在没有护航的情况下被对手在海上逐个点名。
//
// 所以 Corporal 不再用行政区编号理解领土，改用两条随局面推导的事实：
//   · **阵地**：我实际拥有的城/村/港，以及以它们为中心的防区（就近划归，见 anchorFor）。
//   · **射程**：对固定火力点而言，射程内就是领土内。碉堡和岸防炮走不了也退不掉，
//     它们的防区就是自己的火力圈——引擎判定可打的目标，一律打。

import { createCombatModel } from './doctrine.js';
import { isWaterTile } from '../rules/surfaces.js';

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
    const isFoeUnit = unit => !!unit && mayEngageCamp(unit.camp);

    // 与三档玩家人格共用同一套战斗估算：同一次交换必须算出同一个数字。
    // 跨域修正（岸防炮对舰 +30%、陆海互攻 −50%）就在这里面，因此岸防炮
    // 天然会把舰船排在陆上目标前面，不需要再写死一条「优先打船」的规则。
    const { estimateDamage, wouldDieToCounter } = createCombatModel({ weather, hexDistance });

    const isFixedEmplacement = unit => Number(unit.config?.speed) === 0;
    const isLandUnit = unit => unit.config?.movementDomain === 'land';
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
    const myCityDistricts = new Set(myCities.map(city => city.districtId).filter(id => id != null));
    // 村庄归属看谁站在上面（与收入结算一致），所以「我的村庄」= 我占着的
    // ＋ 我拥有的城市所在行政区里的村庄。后者是我该去站的，不是我已经站住的。
    const myVillages = gameState.tiles.filter(t => t.isVillage
        && (t.unit?.camp === myCamp
            || (t.districtId != null && myCityDistricts.has(t.districtId))));
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
        if (!tile || tile.unit) return false;
        if (isLandUnit(unit)) return !isWaterTile(tile);
        if (isNavalUnit(unit)) return isWaterTile(tile) || tile.isPort;
        return true;
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
    // 第一轮：开火 —— 引擎说打得着，就打
    // ═══════════════════════════════════════════
    // 这里刻意不对**目标所在的格子**做任何领土过滤。守备队的职责是让走进射程的人
    // 付出代价，至于对方脚下那一格属于谁、算不算行政区，与该不该开火无关。
    // 旧脚本正是在这一步把岸防炮的目标筛没了。

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
        // 中央航母是地图彩头而不是机动兵力，引擎也会拒绝它移动，这里不浪费指令。
        if (unit.type === 'carrier') continue;

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
            .filter(post => !heldPosts.has(`${post.q},${post.r}`) && !post.unit
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
                if (tile.isCity && unit.type === 'infantry') {
                    score += weather === 'rain' ? 45 : 25;
                }
            }

            // ② 被敌人占着的自家空城可以走回去（占领），这仍属于守土而非出击。
            //    远程单位进不了城，不给它这个分，免得反复提交必定被拒的指令。
            if (tile.isCity && tile.camp !== myCamp && !tile.unit
                && isLandUnit(unit) && unit.type !== 'archer'
                && myCityDistricts.has(tile.districtId)) {
                score += 180;
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
            score -= adjacentFoes * (unit.type === 'archer' ? 34 : hpRatio < 0.35 ? 30 : 12);

            return score;
        }

        // 原地不动是守备队的默认答案。加一道惯性阈值，让「换个格子站」必须真的
        // 更好才成立——否则同级评分加上抖动就会让守军每回合在阵地上左右挪窝，
        // 既看着像犹豫，也白白把自己送出工事。
        const HOLD_INERTIA = 35;
        let bestTile = null;
        let bestScore = scorePosition(unit.tile) + HOLD_INERTIA;

        for (const tile of candidates) {
            const score = scorePosition(tile) + jitter(45);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
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
            && !tile._reinforcedThisTurn
            && ((tile.isCity && tile.camp === myCamp) || tile.isVillage))
        .sort((left, right) =>
            (left.unit.hp / left.unit.maxHp) - (right.unit.hp / right.unit.maxHp))[0];

    if (woundedGarrison) {
        const unit = woundedGarrison.unit;
        const healAmount = Math.min(Math.floor(unit.maxHp * 0.50), unit.maxHp - unit.hp);
        const cost = Math.max(1, Math.ceil(unit.config.cost * (healAmount / unit.maxHp)));
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
