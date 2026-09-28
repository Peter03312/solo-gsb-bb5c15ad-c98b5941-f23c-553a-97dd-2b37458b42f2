'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateQuotas,
  selectSheetIndexes,
  planInspection,
} = require('../src/inspection');
const { generateImposition } = require('../src/imposition');

/* ---------- 名额分配（最大余数法） ---------- */

test('名额分配：每帖先分一个名额，Q=帖数时各帖均为 1', () => {
  assert.deepEqual(allocateQuotas([2, 2, 1], 3), [1, 1, 1]);
  assert.deepEqual(allocateQuotas([8], 1), [1]);
});

test('名额分配：总数与上限正确', () => {
  const counts = [2, 2, 1]; // 共 5 张
  for (let q = 3; q <= 5; q++) {
    const quotas = allocateQuotas(counts, q);
    assert.equal(quotas.reduce((a, b) => a + b, 0), q);
    quotas.forEach((qi, i) => assert.ok(qi >= 1 && qi <= counts[i]));
  }
  // 抽全部：各帖取满
  assert.deepEqual(allocateQuotas(counts, 5), [2, 2, 1]);
});

test('名额分配：其余名额按各帖剩余纸张数比例分配（最大余数法）', () => {
  // 3 帖纸张数 [1,2,3]，共 6 张；Q=5 → R=2，剩余权重 [0,1,2]、T=3：floor [0,0,1]，补发 1 张给第 2 帖
  assert.deepEqual(allocateQuotas([1, 2, 3], 5), [1, 2, 2]);
  // Q=4 → R=1：份额 [0,1/3,2/3] → [1,1,2]
  assert.deepEqual(allocateQuotas([1, 2, 3], 4), [1, 1, 2]);
});

test('名额分配：余数相同时帖号小者优先', () => {
  // 两帖各 3 张，Q=4 → R=2、T=4，份额各 1，恰好整除
  assert.deepEqual(allocateQuotas([3, 3], 4), [2, 2]);
  // [2,2]，Q=3 → R=1、T=2，两帖份额均为 0.5（余数相同），帖号小者得
  assert.deepEqual(allocateQuotas([2, 2], 3), [2, 1]);
  // [3,3,3]，Q=5 → R=2、T=6，三帖份额均为 1，恰好整除
  assert.deepEqual(allocateQuotas([3, 3, 3], 5), [2, 2, 1]);
  // [4,4,4]，Q=6 → R=3、T=9，各帖份额恰好 1
  assert.deepEqual(allocateQuotas([4, 4, 4], 6), [2, 2, 2]);
});

test('名额分配：余数决胜时帖号小者优先（构造真实分数并列）', () => {
  // [5,3]，Q=6 → R=4、T=6：份额 16/6=2 余 4、8/6=1 余 2
  // floor 后 [3,2] 合计 5，欠 1；余数大者第 1 帖补发 → [4,2]
  assert.deepEqual(allocateQuotas([5, 3], 6), [4, 2]);
  // [4,2,2]，Q=6 → R=3、T=6：权重 [3,1,1]，份额 [1.5,0.5,0.5]
  // floor [1,0,0] 合计 4（含保底），欠 2；余数大者第 1 帖先补、第 2、3 帖余数并列帖号小者再补
  assert.deepEqual(allocateQuotas([4, 2, 2], 6), [3, 2, 1]);
  // [2,2,1,1]，Q=4 恰等于帖数 4：R=0，每帖只保留底 → [1,1,1,1]
  assert.deepEqual(allocateQuotas([2, 2, 1, 1], 4), [1, 1, 1, 1]);
  // [2,2,1,1]，Q=5 → R=1、T=4：前两帖份额 0.25 余数并列（1 张纸帖权重 0），帖号 1 优先
  assert.deepEqual(allocateQuotas([2, 2, 1, 1], 5), [2, 1, 1, 1]);
  // 真实分数并列决胜：[4,4,2]，Q=8 → R=5、T=8：份额 15/8=1 余 7、15/8=1 余 7、10/8=1 余 2
  // floor 后 [2,2,2] 合计 6，欠 2；前两帖余数完全相同，帖 1、帖 2 依次补发 → [3,3,2]
  assert.deepEqual(allocateQuotas([4, 4, 2], 8), [3, 3, 2]);
  // 同上结构调换纸张数顺序：余数并列的仍是前两帖，与第三帖大小无关，帖号小者依旧优先
  assert.deepEqual(allocateQuotas([4, 4, 1, 1], 8), [3, 3, 1, 1]);
});

test('名额分配：名额不超过各帖纸张数（取整阶段以剩余纸张数封顶）', () => {
  // 含 1 张纸的帖：该帖永不参与额外分配
  assert.deepEqual(allocateQuotas([1, 1, 8], 9), [1, 1, 7]);
  assert.deepEqual(allocateQuotas([1, 1, 8], 10), [1, 1, 8]);
});

test('名额分配：floor 阶段已取满时名额不重发；含 1 张纸帖时结果正确', () => {
  // [2,1,1,1,1]（共 6 张、5 帖），Q=6 → R=1、T=2：第 1 帖份额 0.5（floor 0、未触封顶），
  // 其余 1 张纸的帖权重 0；floor 后全为保底 1（合计 5）欠 1，余数大者第 1 帖补发 → [2,1,1,1,1]
  assert.deepEqual(allocateQuotas([2, 1, 1, 1, 1], 6), [2, 1, 1, 1, 1]);
  // 极端比例 [8,1,1]（10 张、3 帖）全选 Q=10：第 1 帖 floor 阶段即取满 8，另两帖保底，
  // 恰好分完，不重发也不超额
  assert.deepEqual(allocateQuotas([8, 1, 1], 10), [8, 1, 1]);
});

/* ---------- 帖内选纸 ---------- */

test('帖内选纸：名额一张时取向外取整的中位张 ceil(n/2)', () => {
  assert.deepEqual(selectSheetIndexes(1, 1), [1]);
  assert.deepEqual(selectSheetIndexes(2, 1), [1]); // 偶数张取靠外口（序号小）的一张
  assert.deepEqual(selectSheetIndexes(3, 1), [2]);
  assert.deepEqual(selectSheetIndexes(4, 1), [2]); // ceil(4/2)=2
  assert.deepEqual(selectSheetIndexes(5, 1), [3]);
  assert.deepEqual(selectSheetIndexes(8, 1), [4]);
});

test('帖内选纸：名额不少于两张时按 1+floor(j×(n−1)/(q−1)) 等距选取', () => {
  // n=5, q=2：j=0→1，j=1→5
  assert.deepEqual(selectSheetIndexes(5, 2), [1, 5]);
  // n=5, q=3：[1, 3, 5]
  assert.deepEqual(selectSheetIndexes(5, 3), [1, 3, 5]);
  // n=5, q=4：floor 序列 0,4/3,8/3,4 → [1, 2, 3, 5]
  assert.deepEqual(selectSheetIndexes(5, 4), [1, 2, 3, 5]);
  // n=8, q=3：[1, 4, 8]
  assert.deepEqual(selectSheetIndexes(8, 3), [1, 4, 8]);
  // n=8, q=4：[1, 3, 5, 8]（floor 14/3=4 → 5）
  assert.deepEqual(selectSheetIndexes(8, 4), [1, 3, 5, 8]);
  // n=8, q=8：逐张全选
  assert.deepEqual(selectSheetIndexes(8, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  // n=2, q=2
  assert.deepEqual(selectSheetIndexes(2, 2), [1, 2]);
});

test('帖内选纸：序号升序且不重复；多张时首尾必选，单张时为向外取整中位张', () => {
  for (let n = 1; n <= 8; n++) {
    for (let q = 1; q <= n; q++) {
      const idx = selectSheetIndexes(n, q);
      assert.equal(idx.length, q, `n=${n} q=${q} 数量不符`);
      if (q >= 2) {
        assert.ok(idx[0] === 1 && idx[idx.length - 1] === n, '多张时首尾必选');
      } else {
        assert.deepEqual(idx, [Math.ceil(n / 2)], '单张时取向外取整中位张');
      }
      assert.equal(new Set(idx).size, q, '不得重复');
      assert.deepEqual(idx, [...idx].sort((a, b) => a - b), '升序');
      assert.ok(idx.every((v) => v >= 1 && v <= n), '序号在范围内');
    }
  }
});

test('帖内选纸：非法参数抛错', () => {
  assert.throws(() => selectSheetIndexes(0, 1));
  assert.throws(() => selectSheetIndexes(3, 0));
  assert.throws(() => selectSheetIndexes(3, 4));
});

/* ---------- 抽检清单 ---------- */

test('抽检清单：结构非法返回 null', () => {
  assert.equal(planInspection(null, 1), null);
  assert.equal(planInspection({ pages: 3, totalPages: 8, sheets: [] }, 1), null);
});

test('抽检清单：单帖视为一帖，帖号照列', () => {
  // 8 页 = 2 张纸：第 1 张 正面[8,1]/反面[2,7]，第 2 张 正面[6,3]/反面[4,5]
  const plan = planInspection(generateImposition(8), 1);
  assert.equal(plan.signatureCount, 1);
  assert.equal(plan.totalSheets, 2);
  assert.equal(plan.sheetCount, 1);
  assert.deepEqual(plan.signatures, [{ sig: 1, sheetCount: 2, quota: 1, indexes: [1] }]);
  // 一张时取向外取整中位张：ceil(2/2)=1
  assert.deepEqual(plan.sheets[0], {
    sig: 1,
    sheet: 1,
    front: { left: 8, right: 1 },
    back: { left: 2, right: 7 },
  });
});

test('抽检清单：全选时每张纸恰好出现一次，顺序按帖号与帖内纸张序', () => {
  const plan = planInspection(generateImposition(20, 2), 5); // 3 帖共 5 张
  assert.equal(plan.sheetCount, 5);
  assert.deepEqual(
    plan.sheets.map((s) => [s.sig, s.sheet]),
    [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]]
  );
  assert.deepEqual(plan.signatures.map((g) => g.quota), [2, 2, 1]);
});

test('抽检清单：跨帖按帖号、帖内纸张序排列且纸张不重复', () => {
  // 20 页 M=2：帖纸张数 [2,2,1]；Q=4 → [2,1,1]（余数决胜帖号小者）
  const plan = planInspection(generateImposition(20, 2), 4);
  assert.equal(plan.sampleCount, 4);
  assert.deepEqual(plan.signatures.map((g) => g.quota), [2, 1, 1]);
  assert.deepEqual(plan.signatures[0].indexes, [1, 2]);
  // 第 2、3 帖各 1 张，取向外中位（2 张帖取第 1 张；1 张帖取第 1 张）
  assert.deepEqual(plan.signatures[1].indexes, [1]);
  assert.deepEqual(plan.signatures[2].indexes, [1]);
  assert.deepEqual(
    plan.sheets.map((s) => [s.sig, s.sheet]),
    [[1, 1], [1, 2], [2, 1], [3, 1]]
  );
  const keys = plan.sheets.map((s) => `${s.sig}-${s.sheet}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('抽检清单：清单列出正反左右页码，空白版位照实显示（null）', () => {
  // 6 页单帖：第 1 张 正面[空白,1]/反面[2,空白]
  const plan = planInspection(generateImposition(6), 1);
  assert.equal(plan.sheetCount, 1);
  assert.deepEqual(plan.sheets[0].front, { left: null, right: 1 });
  assert.deepEqual(plan.sheets[0].back, { left: 2, right: null });
});

test('抽检清单：多帖等距选纸与页码内容正确', () => {
  // 32 页 M=8：恰好 1 帖 8 张；Q=3 → 序号 [1,4,8]
  let plan = planInspection(generateImposition(32, 8), 3);
  assert.equal(plan.signatureCount, 1);
  assert.deepEqual(plan.signatures[0].indexes, [1, 4, 8]);
  assert.deepEqual(plan.sheets.map((s) => s.sheet), [1, 4, 8]);

  // 40 页 M=3：40/12 → 帖数 4，纸张 [3,3,3,1]；Q=6
  // R=2、T=6：权重 [2,2,2,0]，份额各 2/3 余数相同 → 帖 1、2 补发
  plan = planInspection(generateImposition(40, 3), 6);
  assert.deepEqual(plan.signatures.map((g) => g.quota), [2, 2, 1, 1]);
  // 3 张帖抽 2 张 → [1,3]；1 张帖抽 1 张 → [1]
  assert.deepEqual(plan.signatures[0].indexes, [1, 3]);
  assert.deepEqual(plan.signatures[3].indexes, [1]);
  assert.equal(plan.sheetCount, 6);
});

test('抽检清单：抽检数非整数时拒绝并说明原因', () => {
  const imp = generateImposition(8);
  for (const bad of ['x', '1.5', '', null, undefined, NaN, true]) {
    const r = planInspection(imp, bad);
    assert.match(r.error, /抽检纸张数必须是整数/, `bad=${bad}`);
  }
});

test('抽检清单：抽检数越界（小于帖数或大于纸张总数）时拒绝', () => {
  const single = generateImposition(8); // 单帖 1 帖、2 张
  assert.match(planInspection(single, 0).error, /1～2 的整数/);
  assert.match(planInspection(single, 3).error, /1～2 的整数/);

  const multi = generateImposition(20, 2); // 3 帖、5 张
  assert.match(planInspection(multi, 2).error, /3～5 的整数/); // 小于帖数
  assert.match(planInspection(multi, 6).error, /3～5 的整数/); // 大于纸张总数
});

test('抽检清单：拼版存在错误时拒绝并附错误明细', () => {
  const imp = generateImposition(8);
  [imp.sheets[0].front.left, imp.sheets[1].front.left] = [
    imp.sheets[1].front.left,
    imp.sheets[0].front.left,
  ];
  const r = planInspection(imp, 1);
  assert.match(r.error, /当前拼版存在错误/);
  assert.ok(r.errors);
});
