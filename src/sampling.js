'use strict';

/**
 * 印刷抽检清单（拼版校验通过后的实体纸抽检）。
 *
 * 质检员输入抽检的实体纸张数 count（整数），服务端在已校验通过的当前拼版上
 * 生成「不重复的双面抽检清单」：每张选中纸正反两面、每面左右两个版位都要检查，
 * 同一张实体纸在清单中只出现一次。
 *
 * 名额分配（帖数 S、实体纸张总数 T）：
 *  - count 必须为整数且 S ≤ count ≤ T（单帖视为一帖，S=1）；
 *  - 每帖先分一个名额，其余 count−S 个名额按各帖「剩余纸张数」n_s−1 占
 *    Σ(n_s−1) 的比例用最大余数法分配：
 *        q_s = 1 + floor((count−S)(n_s−1) / (T−S))，余下名额按小数余数从大到小
 *    补发，余数相同时帖号小者优先；
 *  - 因初始各占 1 名、剩余名额又只按剩余纸张比例分配，q_s 必不超过该帖纸张数 n_s。
 *
 * 帖内选纸（帖内纸张序号 1..n，由外到内）：
 *  - q = 1：取向外取整的中位张 ⌈n/2⌉（偶数张时取靠近内侧的一张）；
 *  - q ≥ 2：按序号 1 + floor(j × (n−1) / (q−1)) 选纸，j = 0..q−1
 *    （两端必选、等距分布、序号严格递增不重复；q = n 时即全部纸张）。
 *
 * 拼版结构非法返回 null；拼版未通过校验或抽检数越界时返回 { error, errors? }。
 */

const { normalizeState, validateImposition } = require('./imposition');

/** 帖内只抽 1 张时：向外取整的中位张序号 ⌈n/2⌉（偶数张取靠内一张） */
function medianSheetIndex(n) {
  return Math.ceil(n / 2);
}

/**
 * 帖内选纸序号（1 起，由外到内，升序且不重复）：
 * q = 1 取向外取整中位张；q ≥ 2 取 1 + floor(j(n−1)/(q−1))，j = 0..q−1。
 */
function selectSheetIndexes(n, q) {
  if (!Number.isInteger(n) || !Number.isInteger(q) || q < 1 || q > n) return null;
  if (q === 1) return [medianSheetIndex(n)];
  const indexes = [];
  for (let j = 0; j <= q - 1; j++) {
    indexes.push(1 + Math.floor((j * (n - 1)) / (q - 1)));
  }
  return indexes;
}

/**
 * 抽检名额按帖分配（最大余数法，纯整数运算避免浮点误差）。
 * sheetCounts 为各帖纸张数（按帖号升序）；返回各帖名额数组。
 * count 须满足 帖数 ≤ count ≤ 纸张总数。
 */
function allocateQuotas(sheetCounts, count) {
  const S = sheetCounts.length;
  const T = sheetCounts.reduce((a, b) => a + b, 0);
  if (!Number.isInteger(count) || count < S || count > T) return null;
  if (S === 1) return [count];

  const extra = count - S; // 先各分 1 名后待分配的名额
  const weightTotal = T - S; // Σ(n_s − 1)
  const quotas = sheetCounts.map((n) => 1 + Math.floor((extra * (n - 1)) / weightTotal));
  let left = count - quotas.reduce((a, b) => a + b, 0);

  // 余数从大到小补发；余数相同帖号小者优先（余数以「未除分子」表示，整数精确比较）
  const order = sheetCounts
    .map((n, idx) => ({ idx, remainder: (extra * (n - 1)) % weightTotal }))
    .filter((o) => sheetCounts[o.idx] - quotas[o.idx] > 0) // 不超过该帖纸张数
    .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
  for (const o of order) {
    if (left === 0) break;
    quotas[o.idx] += 1;
    left -= 1;
  }
  return left === 0 && quotas.every((q, i) => q >= 1 && q <= sheetCounts[i]) ? quotas : null;
}

/**
 * 生成双面抽检清单。
 * @param {object} raw 当前拼版状态（单帖或分帖）
 * @param {number} rawCount 抽检实体纸张数
 * @returns 成功 { signatureCount, totalSheets, count, quotas, sheets }；
 *          拼版未通过校验 / 抽检数越界返回 { error, errors? }；结构非法返回 null。
 */
function planInspection(raw, rawCount) {
  const state = normalizeState(raw);
  if (!state) return null;
  const validation = validateImposition(raw);
  if (!validation.valid) {
    return {
      error: '当前拼版存在错误，请先修复或重置、校验通过后再生成抽检清单',
      errors: validation.errors,
    };
  }

  const groups = state.mode === 'multi'
    ? state.signatures.map((g) => ({ sig: g.sig, sheets: g.sheets }))
    : [{ sig: 1, sheets: state.sheets }]; // 单帖视为一帖
  const signatureCount = groups.length;
  const totalSheets = state.sheetCount;

  // 抽检数：整数，范围 帖数..实体纸张总数
  if (rawCount === null || rawCount === '' || rawCount === undefined) {
    return { error: '请输入抽检的实体纸张数（整数）' };
  }
  // Number.isInteger 对字符串 / 布尔 / 小数 / NaN 均返回 false，确保必须是 JSON 整数
  if (!Number.isInteger(rawCount)) {
    return { error: '抽检数必须为整数' };
  }
  const count = rawCount;
  if (count < signatureCount) {
    return {
      error: `抽检数不能少于帖数 ${signatureCount}（每帖至少抽检 1 张；单帖视为一帖）`,
    };
  }
  if (count > totalSheets) {
    return { error: `抽检数不能超过实体纸张总数 ${totalSheets} 张` };
  }

  const sheetCounts = groups.map((g) => g.sheets.length);
  const qList = allocateQuotas(sheetCounts, count);
  if (!qList) return { error: '抽检名额分配失败，请检查抽检数与拼版结构' };

  const quotas = [];
  const sheets = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const n = g.sheets.length;
    const q = qList[gi];
    const selected = selectSheetIndexes(n, q);
    if (!selected) return { error: '帖内抽检选纸失败，请检查抽检数与拼版结构' };
    quotas.push({ sig: g.sig, sheets: n, quota: q, selected });
    for (const index of selected) {
      const s = g.sheets[index - 1];
      const entry = {
        sig: g.sig,
        sheet: s.index,
        front: { left: s.front.left, right: s.front.right },
        back: { left: s.back.left, right: s.back.right },
      };
      if (state.creep) entry.creep = s.creep;
      sheets.push(entry);
    }
  }

  return { signatureCount, totalSheets, count, quotas, sheets };
}

module.exports = {
  medianSheetIndex,
  selectSheetIndexes,
  allocateQuotas,
  planInspection,
};
