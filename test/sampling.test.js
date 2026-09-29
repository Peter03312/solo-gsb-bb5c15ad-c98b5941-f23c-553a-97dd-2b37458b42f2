'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateImposition,
} = require('../src/imposition');
const {
  medianSheetIndex,
  selectSheetIndexes,
  allocateQuotas,
  planInspection,
} = require('../src/sampling');

/* ---------- 帖内选纸 ---------- */

test('帖内名额为 1：取向外取整的中位张 ⌈n/2⌉（偶数张取靠内一张）', () => {
  assert.equal(medianSheetIndex(1), 1);
  assert.equal(medianSheetIndex(2), 1);
  assert.equal(medianSheetIndex(3), 2);
  assert.equal(medianSheetIndex(4), 2);
  assert.equal(medianSheetIndex(5), 3);
  assert.equal(medianSheetIndex(6), 3);
  assert.deepEqual(selectSheetIndexes(4, 1), [2]);
  assert.deepEqual(selectSheetIndexes(5, 1), [3]);
});

test('帖内名额不少于 2：1+floor(j(n−1)/(q−1))，两端必选、严格递增、不重复', () => {
  assert.deepEqual(selectSheetIndexes(4, 2), [1, 4]);
  assert.deepEqual(selectSheetIndexes(5, 2), [1, 5]);
  assert.deepEqual(selectSheetIndexes(5, 3), [1, 3, 5]);
  assert.deepEqual(selectSheetIndexes(6, 3), [1, 3, 6]); // j=1: floor(5/2)=2 → 3
  assert.deepEqual(selectSheetIndexes(6, 4), [1, 2, 4, 6]);
  assert.deepEqual(selectSheetIndexes(7, 4), [1, 3, 5, 7]);
  // q = n 时即全部纸张
  assert.deepEqual(selectSheetIndexes(5, 5), [1, 2, 3, 4, 5]);
});

test('帖内选纸参数非法返回 null', () => {
  assert.equal(selectSheetIndexes(0, 1), null);
  assert.equal(selectSheetIndexes(3, 0), null);
  assert.equal(selectSheetIndexes(3, 4), null);
});

/* ---------- 名额分配（最大余数法） ---------- */

test('名额分配：每帖先分一个，其余按剩余纸张比例，余数相同帖号小者优先', () => {
  // 20 页 M=2 → 帖纸张数 [2,2,1]，T=5、S=3
  // Q=3：每帖 1 个
  assert.deepEqual(allocateQuotas([2, 2, 1], 3), [1, 1, 1]);
  // Q=4：额外 1 名，权重 [1,1,0]，余数并列 → 帖 1
  assert.deepEqual(allocateQuotas([2, 2, 1], 4), [2, 1, 1]);
  // Q=5：全部纸张
  assert.deepEqual(allocateQuotas([2, 2, 1], 5), [2, 2, 1]);

  // 40 页 M=2 → 每帖 2 张，T=10、S=5，权重相等；余数并列时严格按帖号补发
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 5), [1, 1, 1, 1, 1]);
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 6), [2, 1, 1, 1, 1]);
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 7), [2, 2, 1, 1, 1]);
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 8), [2, 2, 2, 1, 1]);
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 9), [2, 2, 2, 2, 1]);
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2], 10), [2, 2, 2, 2, 2]);
});

test('名额分配：按余数大小优先于帖号', () => {
  // 权重 [4,3,2,1]（总 10），额外 4 名：floor 各 [1,1,0,0]，余 [6,2,8,4]
  // 补发 2 名 → 余数最大者：帖 3（8）、帖 1（6）
  assert.deepEqual(allocateQuotas([5, 4, 3, 2], 8), [3, 2, 2, 1]);
});

test('名额分配：最大余数法不被贪心截断（比例份额本身为 0 时仍可凭余数获得名额）', () => {
  // 8 帖 [2,2,2,2,2,2,2,1]，T=15、S=8，额外 Q−8 名，权重总和 7
  // Q=10：floor 前 7 帖各 floor(2/7)=0、末帖 0；余 [2,2,2,2,2,2,2,0] → 帖 1、2
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2, 2, 2, 1], 10), [2, 2, 1, 1, 1, 1, 1, 1]);
  // Q=15：全部纸张
  assert.deepEqual(allocateQuotas([2, 2, 2, 2, 2, 2, 2, 1], 15), [2, 2, 2, 2, 2, 2, 2, 1]);
});

test('名额分配：越界返回 null', () => {
  assert.equal(allocateQuotas([2, 2, 1], 2), null); // 少于帖数 3
  assert.equal(allocateQuotas([2, 2, 1], 6), null); // 多于总数 5
  assert.equal(allocateQuotas([2, 2, 1], 3.5), null); // 非整数
});

/* ---------- 抽检清单 ---------- */

test('单帖抽检：单帖视为一帖，结构非法返回 null', () => {
  assert.equal(planInspection(null, 1), null);
  assert.equal(planInspection({ pages: 3, totalPages: 8, sheets: [] }, 1), null);
});

test('单帖抽检：边界数量与帖内选纸', () => {
  const st = generateImposition(16); // 4 张纸
  // 范围 1（帖数）..4（总纸张数）
  let plan = planInspection(st, 1);
  assert.equal(plan.signatureCount, 1);
  assert.equal(plan.totalSheets, 4);
  assert.deepEqual(plan.quotas, [{ sig: 1, sheets: 4, quota: 1, selected: [2] }]);
  assert.equal(plan.sheets.length, 1);
  assert.equal(plan.sheets[0].sig, 1);
  assert.equal(plan.sheets[0].sheet, 2);

  plan = planInspection(st, 2);
  assert.deepEqual(plan.quotas[0].selected, [1, 4]);
  assert.deepEqual(plan.sheets.map((s) => s.sheet), [1, 4]);

  plan = planInspection(st, 4); // 全检
  assert.deepEqual(plan.sheets.map((s) => s.sheet), [1, 2, 3, 4]);
});

test('抽检清单：不重复（同一实体纸只出现一次），且正反四个版位与拼版一致', () => {
  const st = generateImposition(20, 2); // 帖纸张 [2,2,1]
  const plan = planInspection(st, 5);
  const keys = plan.sheets.map((s) => `${s.sig}-${s.sheet}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(plan.sheets.length, 5);

  // 第 1 帖第 1 张：8 页成品帖 正面[8,1]/反面[2,7]
  const s11 = plan.sheets.find((s) => s.sig === 1 && s.sheet === 1);
  assert.deepEqual(s11.front, { left: 8, right: 1 });
  assert.deepEqual(s11.back, { left: 2, right: 7 });
});

test('空白版位照实显示（null 保留）', () => {
  // 10 页 M=2：第 2 帖 1 张纸 正面[空白,9]/反面[10,空白]
  const st = generateImposition(10, 2);
  const plan = planInspection(st, 2); // 每帖 1 名；第 2 帖只 1 张必为该张
  const s21 = plan.sheets.find((s) => s.sig === 2 && s.sheet === 1);
  assert.equal(s21.front.left, null);
  assert.equal(s21.front.right, 9);
  assert.equal(s21.back.left, 10);
  assert.equal(s21.back.right, null);
});

test('分帖抽检：名额汇总正确且各帖不超纸张数', () => {
  const st = generateImposition(40, 2); // 5 帖各 2 张，共 10 张
  for (const count of [5, 6, 7, 8, 9, 10]) {
    const plan = planInspection(st, count);
    assert.equal(plan.quotas.reduce((a, q) => a + q.quota, 0), count);
    assert.equal(plan.sheets.length, count);
    for (const q of plan.quotas) {
      assert.ok(q.quota >= 1 && q.quota <= q.sheets);
      assert.equal(q.selected.length, q.quota);
      assert.equal(new Set(q.selected).size, q.quota); // 帖内不重复
    }
  }
});

test('抽检数越界或非整数：拒绝并说明原因', () => {
  const st = generateImposition(20, 2); // 3 帖、5 张纸
  assert.match(planInspection(st, 2).error, /不能少于帖数 3/);
  assert.match(planInspection(st, 6).error, /不能超过实体纸张总数 5/);
  for (const bad of [undefined, null, '', '3']) {
    assert.ok(planInspection(st, bad).error, `应拒绝输入 ${JSON.stringify(bad)}`);
  }
  assert.match(planInspection(st, 3.5).error, /必须为整数/);
  assert.match(planInspection(st, '3').error, /必须为整数/);
});

test('拼版存在错误时拒绝生成抽检清单并附错误概要数据', () => {
  const st = generateImposition(8);
  st.sheets[0].front.left = 3; // 制造重复 / 缺页错误
  const result = planInspection(st, 1);
  assert.ok(result.error);
  assert.ok(result.errors);
});

test('启用爬移补偿时清单条目附 creep', () => {
  const st = generateImposition(16, null, { thickness: 0.1, cap: 2 });
  const plan = planInspection(st, 4);
  assert.deepEqual(plan.sheets.map((s) => s.creep), [0, 0.2, 0.4, 0.6]);
});
