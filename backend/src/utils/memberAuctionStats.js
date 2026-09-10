/**
 * Pure aggregator for Profile Auction Rewards.
 * Recorded battles = unique loot_history date+event groups (guild-wide).
 * Item qty = sum of this member's web_requests where selectionStatus is Selected.
 * Resolves catalog by itemId, then case-insensitive item name (legacy rows omit itemId).
 */

export function asItemsList(rawItems) {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) return rawItems.filter(Boolean);
  return Object.values(rawItems).filter(Boolean);
}

export function resolveCatalogItem(row, itemsList) {
  if (!row || !itemsList?.length) return null;
  if (row.itemId) {
    const id = String(row.itemId).trim().toLowerCase();
    const byId = itemsList.find((i) => i.id && String(i.id).trim().toLowerCase() === id);
    if (byId) return byId;
  }
  if (row.item) {
    const name = String(row.item).trim().toLowerCase();
    const byName = itemsList.find((i) => (i.name || '').trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

export function buildMemberAuctionStats({ lootHistory, memberRequests, itemsList = [] }) {
  const catalog = asItemsList(itemsList);
  const battleKeys = new Set();

  Object.values(lootHistory || {}).forEach((row) => {
    if (!row) return;
    battleKeys.add(`${row.date || ''}_${row.event || ''}`);
  });

  const qtyByKey = new Map();
  catalog.forEach((item) => {
    if (!item?.id) return;
    qtyByKey.set(item.id, 0);
  });

  const extraMeta = new Map();

  Object.values(memberRequests || {}).forEach((row) => {
    if (!row) return;
    if (String(row.selectionStatus || '').toLowerCase() !== 'selected') return;
    const qty = parseInt(row.quantity, 10) || 0;

    const catalogItem = resolveCatalogItem(row, catalog);
    const key = catalogItem?.id || row.itemId || row.item || 'unknown';
    qtyByKey.set(key, (qtyByKey.get(key) || 0) + qty);

    if (!catalogItem && !extraMeta.has(key)) {
      extraMeta.set(key, {
        itemId: row.itemId || key,
        name: row.item || row.itemId || 'Unknown',
        colorTheme: '',
      });
    }
  });

  const items = [];
  catalog.forEach((item) => {
    if (!item?.id) return;
    items.push({
      itemId: item.id,
      name: item.name || item.id,
      colorTheme: item.colorTheme || '',
      quantity: qtyByKey.get(item.id) || 0,
    });
  });
  extraMeta.forEach((meta, key) => {
    items.push({
      itemId: meta.itemId,
      name: meta.name,
      colorTheme: meta.colorTheme,
      quantity: qtyByKey.get(key) || 0,
    });
  });

  return {
    recordedBattles: battleKeys.size,
    totalItemsAcquired: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    items,
  };
}
