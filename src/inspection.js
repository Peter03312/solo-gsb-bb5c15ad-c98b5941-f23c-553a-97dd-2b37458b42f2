'use strict';

/**
 * 印刷抽检清单（拼版校验通过后的实体纸张抽检）。
 *
 * 质检员输入本次抽检的实体纸张数 Q（整数），生成不重复的双面抽检清单：
 *  - 取值范围：帖数 S ～ 实体纸张总数 N（单帖模式视为一帖，帖号 1）；
 *  - 分帖名额：每帖先分 1 个名额，其余 Q−S 个名额按各帖剩余纸张数（n_i−1）
 *    比例用最大余数法（Hamilton）分配——先按比例取整 floor，再按小数余数从大到小
 *    补发，余数相同时帖号小者优先；任何帖名额不超过该帖纸张数（取整阶段以 n_i−1
 *    封顶，结构上不可能超额）；
 *  - 帖内选纸（序号 1 起，由外到内）：
 *      名额为 1 张时取「向外取整的中位张」，序号 = ceil(n/2)（偶数张取靠外口的一张）；
 *      名额不少于 2 张时按序号 1 + floor(j×(n−1)/(q−1))，j = 0..q−1 选取
 *      （首尾必选、间距均匀，公式保证不重复）。
 *  - 清单跨帖按帖号、帖内按纸张序排列，列出帖号、纸张序号及正反左右四个版位，
 *    空白版位以 null 照实返回。
 *
 * 拼版结构非法返回 null；拼版未通过校验或抽检数越界返回 { error }，拒绝生成。
 */

const SIDES = ['front', 'back'];
const POSITIONS = ['left', 'right'];

/** 校验错误的简要统计（用于一句话说明拼版为何不能生成抽检清单） */
function summarizeErrors(errors) {
  const parts = [];
  if (errors.duplicates.length) parts.push(`重复页 ${errors.duplicates.length} 处`);
  if (errors.missing.length) parts.push(`缺页 ${errors.missing.length} 处`);
  if (errors.outOfRange.length) parts.push(`越界页码 ${errors.outOfRange.length} 处`);
  if (errors.crossSignature && errors.crossSignature.length) {
    parts.push(`跨帖异常 ${errors.crossSignature.length} 处`);
  }
  if (errors.pairing.length) parts.push(`配对异常 ${errors.pairing.length} 处`);
  return parts.join('、') || '未知错误';
}

/**
 * 按帖分配抽检名额（最大余数法 / Hamilton）。
 * sheetCounts：各帖纸张数（数组顺序即帖号顺序，1 起）；Q：抽检实体纸张总数。
 * 返回与 sheetCounts 等长的名额数组；调用方须保证 S ≤ Q ≤ Σn_i。
 */
function allocateQuotas(sheetCounts, Q) {
  const S = sheetCounts.length;
  const total = sheetCounts.reduce((sum, n) => sum + n, 0);
  if (S === 0 || !Number.isInteger(Q) || Q < S || Q > total) {
    throw new RangeError('抽检数必须介于帖数与实体纸张总数之间');
  }

  const quotas = sheetCounts.map(() => 1); // 每帖先分一个名额
  const R = Q - S; // 待按比例分配的其余名额
  if (R === 0) return quotas;

  // 剩余纸张总数（每帖扣除先分走的 1 张）；Q ≤ Σn 保证 R ≤ T
  const T = sheetCounts.reduce((sum, n) => sum + (n - 1), 0);

  // 第一阶段：按比例取整（floor），以 n_i−1 封顶（R ≤ T 时 x_i ≤ n_i−1）
  for (let i = 0; i < S; i++) {
    const f = Math.floor((R * (sheetCounts[i] - 1)) / T);
    quotas[i] += Math.min(f, sheetCounts[i] - 1);
  }

  // 第二阶段：按小数余数从大到小补发，余数相同帖号小者优先。
  // 用整数余数 (R·w mod T) 比较，避免浮点误差；每帖至多再补 1 个名额，
  // 已封顶（达该帖纸张数）的帖跳过，名额顺延给排序靠后的未满帖（Q ≤ Σn 保证发得完）。
  const remainderOf = (i) => (R * (sheetCounts[i] - 1)) % T;
  const order = sheetCounts.map((n, i) => i).sort((a, b) => {
    const ra = remainderOf(a);
    const rb = remainderOf(b);
    if (rb !== ra) return rb - ra;
    return a - b;
  });
  let left = Q - quotas.reduce((sum, q) => sum + q, 0); // floor 阶段后尚欠名额
  for (const i of order) {
    if (left === 0) break;
    if (quotas[i] < sheetCounts[i]) {
      quotas[i] += 1;
      left -= 1;
    }
  }
  return quotas;
}

/**
 * 帖内选纸（序号 1 起，由外到内）：
 *  - q = 1：取向外取整的中位张，序号 = ceil(n/2)；
 *  - q ≥ 2：按 1 + floor(j×(n−1)/(q−1))，j = 0..q−1 选取（升序、不重复）。
 */
function selectSheetIndexes(n, q) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(q) || q < 1 || q > n) {
    throw new RangeError('帖内名额必须是 1～本帖纸张数 的整数');
  }
  if (q === 1) return [Math.ceil(n / 2)];
  const indexes = [];
  for (let j = 0; j < q; j++) {
    indexes.push(1 + Math.floor((j * (n - 1)) / (q - 1)));
  }
  return indexes;
}

/**
 * 生成双面印刷抽检清单。
 *  - 拼版结构非法返回 null；
 *  - 拼版未通过校验返回 { error, errors }；抽检数非整数或越界返回 { error }；
 *  - 成功返回 { sampleCount, signatureCount, totalSheets, sheetCount, signatures, sheets }：
 *      signatures：每帖 { sig, sheetCount, quota, indexes }（抽中纸张的帖内序号）；
 *      sheets：按帖号、帖内纸张序排列的抽检纸张，每项含 sig、sheet 及
 *              front/back 的 left/right 版位（null 即空白版位，照实显示）。
 */
function planInspection(raw, sampleCount) {
  // 延迟依赖，避免与 imposition 模块形成耦合环
  const { normalizeState, validateImposition } = require('./imposition');

  const state = normalizeState(raw);
  if (!state) return null;
  const validation = validateImposition(raw);
  if (!validation.valid) {
    return {
      error: `当前拼版存在错误（${summarizeErrors(validation.errors)}），请先修复或重置后再生成抽检清单`,
      errors: validation.errors,
    };
  }

  if (typeof sampleCount === 'boolean' || sampleCount === null || sampleCount === undefined ||
      String(sampleCount).trim() === '') {
    return { error: '抽检纸张数必须是整数' };
  }
  const Q = Number(sampleCount);
  if (!Number.isInteger(Q)) {
    return { error: '抽检纸张数必须是整数' };
  }

  const signatureCount = state.mode === 'multi' ? state.signatureCount : 1; // 单帖视为一帖
  const totalSheets = state.sheetCount;
  if (Q < signatureCount || Q > totalSheets) {
    return {
      error: `抽检纸张数必须是 ${signatureCount}～${totalSheets} 的整数（帖数～实体纸张总数）`,
    };
  }

  const groups = state.mode === 'multi'
    ? state.signatures.map((g) => ({ sig: g.sig, sheets: g.sheets }))
    : [{ sig: 1, sheets: state.sheets }];

  const quotas = allocateQuotas(groups.map((g) => g.sheets.length), Q);

  const signatures = [];
  const sheets = [];
  groups.forEach((g, k) => {
    const n = g.sheets.length;
    const quota = quotas[k];
    const indexes = selectSheetIndexes(n, quota);
    signatures.push({ sig: g.sig, sheetCount: n, quota, indexes });
    for (const idx of indexes) {
      const s = g.sheets[idx - 1];
      const entry = { sig: g.sig, sheet: s.index, front: {}, back: {} };
      for (const side of SIDES) {
        for (const pos of POSITIONS) entry[side][pos] = s[side][pos];
      }
      sheets.push(entry);
    }
  });

  return {
    sampleCount: Q,
    signatureCount,
    totalSheets,
    sheetCount: sheets.length,
    signatures,
    sheets,
  };
}

module.exports = {
  allocateQuotas,
  selectSheetIndexes,
  planInspection,
};
