// 執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../js/scheduler.js');

// 讀 config.js（它是給瀏覽器用的，所以用 vm 跑）
function loadConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8'), ctx);
  return ctx.window.ROSTER_CONFIG;
}
const CFG = loadConfig();
const daily = CFG.presets.daily;
const weekend = CFG.presets.weekend;

test('日期工具：月份天數、閏年、星期', () => {
  assert.deepEqual(R.monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(R.monthRange('2027-02'), { start: '2027-02-01', end: '2027-02-28' });
  assert.equal(R.weekday('2026-11-01'), 0); // 2026-11-01 是週日
  assert.equal(R.weekKey('2026-11-01', 1), '2026-10-26');
  assert.equal(R.weekKey('2026-11-01', 0), '2026-11-01');
  assert.throws(() => R.parseDate('2026-02-30'));
  assert.throws(() => R.dateRange('2026-11-10', '2026-11-01'));
});

test('門市每日值班：每天剛好 1 人、沒有警告', () => {
  const { start, end } = R.monthRange('2026-11');
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  for (const d of R.dateRange(start, end)) assert.equal(r.plan[d].length, 1, d);
  assert.deepEqual(r.warnings, []);
});

test('固定班：店長每個週日都排到', () => {
  const { start, end } = R.monthRange('2026-11');
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  for (const d of R.dateRange(start, end)) {
    if (R.weekday(d) === 0) assert.deepEqual(r.plan[d], ['manager'], d);
  }
});

test('固定班的人請假：當天改排別人，不排請假的人', () => {
  const { start, end } = R.monthRange('2026-11');
  const leaves = [{ staffId: 'manager', from: '2026-11-08', to: '2026-11-08' }];
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules, leaves });
  assert.equal(r.plan['2026-11-08'].length, 1);
  assert.notEqual(r.plan['2026-11-08'][0], 'manager');
  assert.equal(r.warnings.filter(w => w.type === 'leave').length, 0);
});

test('請假期間完全不會被排到', () => {
  const { start, end } = R.monthRange('2026-11');
  const leaves = [{ staffId: 'agentA', from: '2026-11-03', to: '2026-11-16' }];
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules, leaves });
  for (const d of R.dateRange('2026-11-03', '2026-11-16')) assert.ok(!r.plan[d].includes('agentA'), d);
});

test('每週上限：strict 的人永遠不超過；一般人只有人手不足才會超過', () => {
  const { start, end } = R.monthRange('2026-11');
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  const perWeek = {};
  for (const d of R.dateRange(start, end)) for (const id of r.plan[d]) {
    const k = R.weekKey(d, 1) + id;
    perWeek[k] = (perWeek[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(perWeek)) {
    if (k.endsWith('parttime')) assert.ok(n <= 1, k);
    else assert.ok(n <= 2, k);
  }
});

test('輪流公平：除了固定班，大家次數差距不超過 1', () => {
  const { start, end } = R.monthRange('2026-11');
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  const others = ['deputy', 'agentA', 'agentB', 'agentC'].map(id => r.counts[id]);
  assert.ok(Math.max(...others) - Math.min(...others) <= 1, JSON.stringify(r.counts));
});

test('週末三人輪班：週五六固定，週日兩人輪流、不連續同一人', () => {
  const r = R.generate({ start: '2026-11-06', end: '2026-12-27', staff: weekend.staff, rules: weekend.rules });
  let lastSun = null;
  for (const d of R.dateRange('2026-11-06', '2026-12-27')) {
    const wd = R.weekday(d);
    if (wd === 5 || wd === 6) assert.deepEqual(r.plan[d], ['agentA'], d);
    else if (wd === 0) {
      assert.equal(r.plan[d].length, 1);
      assert.notEqual(r.plan[d][0], lastSun, d);
      lastSun = r.plan[d][0];
    } else assert.deepEqual(r.plan[d], [], d);
  }
  assert.deepEqual(r.warnings, []);
});

test('同樣的輸入，每次結果都一樣（不用亂數）', () => {
  const { start, end } = R.monthRange('2026-11');
  const a = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  const b = R.generate({ start, end, staff: daily.staff, rules: daily.rules });
  assert.deepEqual(a.plan, b.plan);
});

test('排不出人：回報缺人，不會當掉', () => {
  const staff = [{ id: 'x', name: '甲', days: [1], maxPerWeek: 1, strict: true }];
  const r = R.generate({ start: '2026-11-02', end: '2026-11-04', staff, rules: { dutyDays: [1, 2, 3] } });
  assert.deepEqual(r.plan['2026-11-02'], ['x']);
  assert.equal(r.warnings.filter(w => w.type === 'short').length, 2);
});

test('手動改班後檢查：請假、超過上限、連續值班都會提醒', () => {
  const staff = [{ id: 'a', name: '甲', maxPerWeek: 1 }, { id: 'b', name: '乙' }];
  const plan = { '2026-11-02': ['a'], '2026-11-03': ['a'], '2026-11-04': ['b'] };
  const w = R.check({ start: '2026-11-02', end: '2026-11-04', staff, plan, leaves: [{ staffId: 'b', from: '2026-11-04', to: '2026-11-04' }] });
  const types = w.map(x => x.type).sort();
  assert.deepEqual(types, ['consecutive', 'leave', 'weekmax']);
});

test('locked：手動指定的日子不會被自動排班覆蓋', () => {
  const { start, end } = R.monthRange('2026-11');
  const r = R.generate({ start, end, staff: daily.staff, rules: daily.rules, locked: { '2026-11-01': ['agentB'] } });
  assert.deepEqual(r.plan['2026-11-01'], ['agentB']);
});

test('匯出 CSV：有 BOM、標題列、每人一列、當日值班列', () => {
  const r = R.generate({ start: '2026-11-02', end: '2026-11-08', staff: daily.staff, rules: daily.rules });
  const csv = R.toCSV({ start: '2026-11-02', end: '2026-11-08', staff: daily.staff, plan: r.plan });
  assert.ok(csv.startsWith('﻿人員,11-02(一)'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + daily.staff.length + 1);
  assert.ok(lines[lines.length - 1].startsWith('當日值班,'));
});
