/**
 * The stone article the stone inward specs pick for vendor RAJA.
 *
 * The Stone Inward article select only offers what the VENDOR's stone rate
 * list holds (StockInwardStone/GetStoneArticlesWithStonesRates). Until
 * 05-11-2026 that list had "Jerald" for RAJA; since then it holds only
 * "Black Diamond-Black Diamond Sub Cat1" (10-11-2026: "Jerald" -> "No items
 * found"), so the suite moved to Black Diamond (user decision 10-11-2026).
 *
 * The name is matched as typed search text against the option and equals the
 * Stone Group the pick back-fills. STONE_ARTICLE=Jerald switches back once
 * the vendor rate is restored on qa.
 */
const STONE_ARTICLE = process.env.STONE_ARTICLE || 'Black Diamond';

module.exports = { STONE_ARTICLE };
