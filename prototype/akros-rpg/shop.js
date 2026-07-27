// 商人交易：库存、定价、买卖校验。
// 回购价 = 售价 × BUYBACK_RATE；库存有限，卖光即无——避免"刷怪→无限进货"的经济空转。
// 所有金额均为整数「分」。

import { ITEMS, MERCHANTS, BUYBACK_RATE } from './data.js';
import { addItem, takeItem, spendMoney, addMoney, canAfford } from './character.js';

/** 从冻结的商人定义生成可变的运行期库存。 */
export function createShops() {
    const shops = {};
    for (const [id, def] of Object.entries(MERCHANTS)) {
        shops[id] = {
            def,
            stock: def.stock.map(row => ({ item: row.item, count: row.count }))
        };
    }
    return shops;
}

export function buybackPrice(itemId) {
    const item = ITEMS[itemId];
    if (!item || item.priceless) return 0;
    return Math.max(1, Math.round(item.price * BUYBACK_RATE));
}

/** 该商人是否收这件东西。 */
export function accepts(shop, itemId) {
    const item = ITEMS[itemId];
    if (!item || item.priceless) return false;
    if (shop.def.buysAnything) return true;
    return shop.stock.some(row => row.item === itemId);
}

/**
 * 购买。返回 { ok, reason }。
 * 校验顺序刻意固定：先库存、再钱包、最后背包——错误提示才稳定可测。
 */
export function buy(shop, character, itemId) {
    const row = shop.stock.find(r => r.item === itemId);
    if (!row || row.count <= 0) return { ok: false, reason: '这件已经没有了' };
    const item = ITEMS[itemId];
    if (!canAfford(character, item.price)) return { ok: false, reason: '钱不够' };
    if (!addItem(character, itemId, 1)) return { ok: false, reason: '背包满了' };
    spendMoney(character, item.price);
    row.count -= 1;
    return { ok: true, price: item.price, item };
}

/** 出售。装备中的物品需先卸下——由 UI 保证，这里只认背包里的。 */
export function sell(shop, character, itemId) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, reason: '无此物品' };
    if (item.priceless) return { ok: false, reason: '这个不卖' };
    if (!accepts(shop, itemId)) return { ok: false, reason: '这位不收这个' };
    if (!takeItem(character, itemId, 1)) return { ok: false, reason: '背包里没有' };
    const price = buybackPrice(itemId);
    addMoney(character, price);
    const row = shop.stock.find(r => r.item === itemId);
    if (row) row.count += 1;               // 卖回去的东西重新上架
    else shop.stock.push({ item: itemId, count: 1 });
    return { ok: true, price, item };
}
