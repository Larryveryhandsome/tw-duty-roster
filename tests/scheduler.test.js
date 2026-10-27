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

// ---------- 擴展性／漏洞檢視後補的測試 ----------
const S = R;

test('性質測試：隨機人員／請假／規則 2000 次，不卡住、不重複排同一人、不超過每天人數、請假不排', () => {
  let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let it = 0; it < 2000; it++) {
    const n = 1 + Math.floor(rnd() * 8);
    const staff = Array.from({ length: n }, (_, i) => ({ id: 's' + i, name: 'S' + i, days: [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() < 0.7), maxPerWeek: rnd() < 0.5 ? Math.floor(rnd() * 4) : null, strict: rnd() < 0.3 }));
    const slots = 1 + Math.floor(rnd() * 3);
    const m = S.monthRange('2026-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0'));
    const leaves = Array.from({ length: Math.floor(rnd() * 6) }, () => { const f = S.addDays(m.start, Math.floor(rnd() * 28)); return { staffId: 's' + Math.floor(rnd() * n), from: f, to: S.addDays(f, Math.floor(rnd() * 7)) }; });
    const rules = { dutyDays: [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() < 0.8), slotsPerDay: slots, weekStartsOn: rnd() < 0.5 ? 0 : 1, avoidConsecutive: rnd() < 0.5, relaxWhenShort: rnd() < 0.5 };
    const r = S.generate({ start: m.start, end: m.end, staff, rules, leaves });
    for (const [d, ids] of Object.entries(r.plan)) {
      assert.equal(new Set(ids).size, ids.length, d + ' 同一人重複');
      assert.ok(ids.length <= slots, d + ' 超過每天人數');
      ids.forEach(id => assert.ok(!S.onLeave(leaves, id, d), `${d} ${id} 請假卻排班`));
    }
  }
});

test('人少請假多：全員請假只會出現「缺人」警告，不會卡住或丟錯', () => {
  const staff = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const r = S.generate({ start: '2026-11-01', end: '2026-11-30', staff, rules: { slotsPerDay: 2 }, leaves: [{ staffId: 'a', from: '2026-11-01', to: '2026-11-30' }, { staffId: 'b', from: '2026-11-10', to: '2026-11-20' }] });
  assert.ok(r.warnings.some(w => w.type === 'short'));
  assert.equal(r.plan['2026-11-15'].length, 0);
});

test('跨月：上個月最後一天值班的人，下個月第一天不會又排他（連續兩天），且每週上限跨月算', () => {
  const staff = [{ id: 'a', name: 'A', maxPerWeek: 2, strict: true }, { id: 'b', name: 'B', maxPerWeek: 2, strict: true }];
  // 2026-11-01 是週日；weekStartsOn=1（週一）所以 10/26(一)～11/1(日) 是同一週
  const history = { '2026-10-26': ['a'], '2026-10-27': ['a'], '2026-10-31': ['b'] };
  const noHist = S.generate({ start: '2026-11-01', end: '2026-11-01', staff, rules: { weekStartsOn: 1, relaxWhenShort: false } });
  const withHist = S.generate({ start: '2026-11-01', end: '2026-11-01', staff, rules: { weekStartsOn: 1, relaxWhenShort: false }, history });
  assert.deepEqual(noHist.plan['2026-11-01'], ['a']);          // 沒歷史：照名單順序排 a
  assert.ok(!withHist.plan['2026-11-01'].includes('a'), 'a 該週已值班 2 次（strict 上限 2），不能再排');
  assert.ok(!withHist.plan['2026-11-01'].includes('b'), 'b 前一天 10/31 才值班，避免連續');
  // check 也要看得到跨月衝突
  const bad = S.check({ start: '2026-11-01', end: '2026-11-01', staff, plan: { '2026-11-01': ['b'] }, history });
  assert.ok(bad.some(w => w.type === 'consecutive'));
});

test('CSV 匯出防公式注入（姓名）', () => {
  const csv = S.toCSV({ start: '2026-11-01', end: '2026-11-02', staff: [{ id: 'x', name: '=HYPERLINK("http://e.com","go")' }, { id: 'y', name: '@SUM(1)' }], plan: {} });
  assert.ok(csv.includes(`"'=HYPERLINK(`) || csv.includes("'=HYPERLINK("));
  assert.ok(csv.includes("'@SUM(1)"));
});

test('validateState：重建欄位、擋 __proto__／重複代號／壞顏色／壞日期', () => {
  const ok = JSON.parse('{"staff":[{"id":"a","name":"甲","color":"red;background:url(x)","days":[1,"2",9,-1],"maxPerWeek":"3","evil":1,"__proto__":{"p":1}}],"rules":{"slotsPerDay":999},"start":"2026-11-01","end":"2026-11-30","leaves":[{"staffId":"a","from":"2026-11-05","to":"2026-11-03"},{"staffId":"zz","from":"2026-11-01","to":"2026-11-02"},{"staffId":"a","from":"2026-11-02","to":"2026-11-03"}],"plan":{"2026-11-02":["a","ghost","a"],"bad":["a"]},"plans":{"2026-10-01~2026-10-31":{"2026-10-31":["a"]},"x":{}}}');
  const s = S.validateState(ok);
  assert.equal({}.p, undefined);
  assert.equal(s.staff[0].color, '#64748b');
  assert.deepEqual(s.staff[0].days, [1, 2]);
  assert.equal(s.staff[0].maxPerWeek, 3);
  assert.ok(!('evil' in s.staff[0]));
  assert.equal(s.rules.slotsPerDay, 50);
  assert.equal(s.leaves.length, 1);
  assert.deepEqual(s.plan, { '2026-11-02': ['a'] });
  assert.deepEqual(Object.keys(s.plans), ['2026-10-01~2026-10-31']);
  assert.throws(() => S.validateState({ staff: [{ id: 'a' }, { id: 'a' }], start: '2026-11-01', end: '2026-11-02' }));
  assert.throws(() => S.validateState({ staff: [{ id: '<img>' }], start: '2026-11-01', end: '2026-11-02' }));
  assert.throws(() => S.validateState({ staff: [], start: '2026-02-30', end: '2026-03-01' }));
  assert.throws(() => S.validateState(null));
});

test('效能：200 人 × 31 天 × 每天 10 人在 2 秒內排完', () => {
  const staff = Array.from({ length: 200 }, (_, i) => ({ id: 'b' + i, name: 'B' + i, maxPerWeek: 3 }));
  const t = Date.now();
  const r = S.generate({ start: '2026-01-01', end: '2026-01-31', staff, rules: { slotsPerDay: 10 } });
  assert.ok(Date.now() - t < 2000, `太慢 ${Date.now() - t}ms`);
  assert.equal(r.warnings.filter(w => w.type === 'short').length, 0);
});
