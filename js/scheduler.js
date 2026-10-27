/*
 * tw-duty-roster 排班引擎（純函式，不碰畫面）
 * 瀏覽器：window.Roster；Node：require('./scheduler.js')
 *
 * 日期一律用 'YYYY-MM-DD' 字串，星期 0=日 … 6=六。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Roster = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

  // ---------- 日期工具（全部用 UTC，避免時區造成差一天） ----------
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) throw new Error('日期格式要是 YYYY-MM-DD：' + s);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1) throw new Error('不存在的日期：' + s);
    return d;
  }
  function fmt(d) {
    return d.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmt(d);
  }
  function weekday(s) {
    return parseDate(s).getUTCDay();
  }
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function dateRange(start, end) {
    const out = [];
    if (daysBetween(start, end) < 0) throw new Error('結束日不能早於起始日');
    if (daysBetween(start, end) > 400) throw new Error('一次最多排 400 天');
    for (let d = start; daysBetween(d, end) >= 0; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function monthRange(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) throw new Error('月份格式要是 YYYY-MM：' + ym);
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
  }
  // 這一天所在「週」的第一天（weekStartsOn：0=週日開始，1=週一開始）
  function weekKey(s, weekStartsOn) {
    const back = (weekday(s) - weekStartsOn + 7) % 7;
    return addDays(s, -back);
  }

  // ---------- 規則預設值 ----------
  function normRules(rules) {
    const r = Object.assign({
      dutyDays: [0, 1, 2, 3, 4, 5, 6], // 哪幾個星期需要有人值班
      slotsPerDay: 1,                  // 每天幾個人
      weekStartsOn: 1,                 // 每週上限從星期幾開始算
      avoidConsecutive: true,          // 盡量不要連續兩天值班
      relaxWhenShort: true,            // 排不出人時，放寬「非嚴格」的每週上限
    }, rules || {});
    r.slotsPerDay = Math.max(1, parseInt(r.slotsPerDay, 10) || 1);
    return r;
  }
  function normStaff(staff) {
    const seen = new Set();
    return (staff || []).map((p, i) => {
      const id = String(p.id || p.name || 'p' + i);
      if (seen.has(id)) throw new Error('人員代號重複：' + id);
      seen.add(id);
      const fixed = Array.isArray(p.fixedDays) ? p.fixedDays.map(Number) : [];
      const max = p.maxPerWeek === '' || p.maxPerWeek == null ? null : Number(p.maxPerWeek);
      return {
        id,
        name: String(p.name || id),
        color: p.color || '#64748b',
        fixedDays: fixed,
        // 固定班的星期一定算「可值班」
        days: [...new Set([...(Array.isArray(p.days) ? p.days.map(Number) : [0, 1, 2, 3, 4, 5, 6]), ...fixed])].sort(),
        maxPerWeek: Number.isFinite(max) ? max : null,
        strict: !!p.strict,
      };
    });
  }
  function onLeave(leaves, id, date) {
    return (leaves || []).some(l => l.staffId === id && daysBetween(l.from, date) >= 0 && daysBetween(date, l.to) >= 0);
  }

  // ---------- 自動排班 ----------
  /**
   * @param {object} input
   *   start, end        'YYYY-MM-DD'
   *   staff             [{id,name,days,fixedDays,maxPerWeek,strict}]
   *   rules             見 normRules
   *   leaves            [{staffId, from, to}]
   *   locked            {date: [staffId,…]}  手動指定、不要自動改的日子
   * @returns {{plan: Object<string,string[]>, warnings: object[], counts: Object<string,number>}}
   */
  function generate(input) {
    const rules = normRules(input.rules);
    const staff = normStaff(input.staff);
    const leaves = input.leaves || [];
    const locked = input.locked || {};
    const dates = dateRange(input.start, input.end);
    const plan = {};
    const total = Object.fromEntries(staff.map(p => [p.id, 0]));
    const last = {}; // id -> 最近一次值班日
    const weekCount = {}; // weekKey|id -> 次數

    // 前一段時間已經排好的班（例如上個月）：讓「連續兩天」「每週上限」「誰最久沒值班」跨月也算得準
    const history = input.history || {};
    const known = new Set(staff.map(p => p.id));
    Object.keys(history).sort().forEach(d => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= input.start) return;
      const gap = daysBetween(d, input.start);
      if (gap > 14) return;
      (history[d] || []).forEach(id => {
        if (!known.has(id)) return;
        last[id] = d;
        const k = weekKey(d, rules.weekStartsOn) + '|' + id;
        weekCount[k] = (weekCount[k] || 0) + 1;
      });
    });

    const wc = (d, id) => weekCount[weekKey(d, rules.weekStartsOn) + '|' + id] || 0;
    const take = (d, id) => {
      plan[d].push(id);
      total[id] = (total[id] || 0) + 1;
      last[id] = d;
      const k = weekKey(d, rules.weekStartsOn) + '|' + id;
      weekCount[k] = (weekCount[k] || 0) + 1;
    };

    for (const d of dates) {
      plan[d] = [];
      const wd = weekday(d);
      if (locked[d]) {
        locked[d].forEach(id => take(d, id));
        continue;
      }
      if (!rules.dutyDays.includes(wd)) continue;

      // 1. 固定班（請假就跳過，交給一般排班）
      for (const p of staff) {
        if (plan[d].length >= rules.slotsPerDay) break;
        if (p.fixedDays.includes(wd) && !onLeave(leaves, p.id, d)) take(d, p.id);
      }

      // 2. 一般排班：值班最少的人優先；同分看誰最久沒值班；再同分照名單順序
      const pick = (relax) => {
        const yesterday = addDays(d, -1);
        const tomorrow = addDays(d, 1);
        // 明天是他的固定班，今天就先不排，免得連續兩天
        const fixedTomorrow = p => p.fixedDays.includes(weekday(tomorrow)) &&
          rules.dutyDays.includes(weekday(tomorrow)) && !onLeave(leaves, p.id, tomorrow);
        const cands = staff.filter(p =>
          !plan[d].includes(p.id) &&
          p.days.includes(wd) &&
          !onLeave(leaves, p.id, d) &&
          (p.maxPerWeek == null || wc(d, p.id) < p.maxPerWeek || (relax && !p.strict)) &&
          (!rules.avoidConsecutive || relax || (last[p.id] !== yesterday && !fixedTomorrow(p))));
        cands.sort((a, b) =>
          (total[a.id] - total[b.id]) ||
          ((last[a.id] || '0000-00-00') < (last[b.id] || '0000-00-00') ? -1 : (last[a.id] || '0000-00-00') > (last[b.id] || '0000-00-00') ? 1 : 0) ||
          (staff.indexOf(a) - staff.indexOf(b)));
        return cands[0];
      };
      while (plan[d].length < rules.slotsPerDay) {
        const p = pick(false) || (rules.relaxWhenShort ? pick(true) : null);
        if (!p) break;
        take(d, p.id);
      }
    }
    return { plan, warnings: check({ start: input.start, end: input.end, staff: input.staff, rules: input.rules, leaves, plan, history }), counts: countDuties(plan, staff) };
  }

  function countDuties(plan, staff) {
    const c = Object.fromEntries(normStaff(staff).map(p => [p.id, 0]));
    Object.values(plan).forEach(ids => ids.forEach(id => { c[id] = (c[id] || 0) + 1; }));
    return c;
  }

  // ---------- 檢查（自動排的、手動改過的都用這個） ----------
  function check(input) {
    const rules = normRules(input.rules);
    const staff = normStaff(input.staff);
    const byId = Object.fromEntries(staff.map(p => [p.id, p]));
    const plan = input.plan || {};
    const leaves = input.leaves || [];
    const out = [];
    const name = id => (byId[id] ? byId[id].name : id);
    const weekCount = {};
    const history = input.history || {};
    // 起始日之前已排好的班：算進同一週的次數，也用來檢查第一天是否和前一天連續
    Object.keys(history).forEach(d => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= input.start || daysBetween(d, input.start) > 7) return;
      (history[d] || []).forEach(id => {
        const k = weekKey(d, rules.weekStartsOn) + '|' + id;
        weekCount[k] = (weekCount[k] || 0) + 1;
      });
    });
    const planAt = d => (plan[d] != null ? plan[d] : (history[d] || []));

    for (const d of dateRange(input.start, input.end)) {
      const ids = plan[d] || [];
      const wd = weekday(d);
      const label = `${d}（${WEEKDAY_NAMES[wd]}）`;
      if (rules.dutyDays.includes(wd) && ids.length < rules.slotsPerDay) {
        out.push({ date: d, type: 'short', msg: `${label} 缺 ${rules.slotsPerDay - ids.length} 人` });
      }
      if (ids.length > rules.slotsPerDay) {
        out.push({ date: d, type: 'over', msg: `${label} 排了 ${ids.length} 人，超過每天 ${rules.slotsPerDay} 人` });
      }
      if (ids.length && !rules.dutyDays.includes(wd)) {
        out.push({ date: d, type: 'offday', msg: `${label} 不是值班日，但有排人` });
      }
      for (const id of ids) {
        const p = byId[id];
        if (!p) { out.push({ date: d, type: 'unknown', msg: `${label} 有不在名單上的人：${id}` }); continue; }
        if (onLeave(leaves, id, d)) out.push({ date: d, type: 'leave', staffId: id, msg: `${label} ${name(id)} 請假中卻排了值班` });
        if (!p.days.includes(wd)) out.push({ date: d, type: 'weekday', staffId: id, msg: `${label} ${name(id)} 設定為星期${WEEKDAY_NAMES[wd]}不值班` });
        if (planAt(addDays(d, -1)).includes(id) && rules.avoidConsecutive) {
          out.push({ date: d, type: 'consecutive', staffId: id, msg: `${label} ${name(id)} 連續兩天值班` });
        }
        const k = weekKey(d, rules.weekStartsOn) + '|' + id;
        weekCount[k] = (weekCount[k] || 0) + 1;
        if (p.maxPerWeek != null && weekCount[k] === p.maxPerWeek + 1) {
          out.push({ date: d, type: 'weekmax', staffId: id, msg: `${name(id)} 在 ${weekKey(d, rules.weekStartsOn)} 那週超過每週上限 ${p.maxPerWeek} 次` });
        }
      }
    }
    return out;
  }

  // ---------- 匯出 ----------
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[\t\r\s]*[=+\-@]|^[\t\r]/.test(s)) s = "'" + s;   // 防 Excel 公式注入（姓名可能來自匯入的檔案）
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** 匯出成 CSV（含 BOM，Excel 直接開不會亂碼） */
  function toCSV(input) {
    const staff = normStaff(input.staff);
    const dates = dateRange(input.start, input.end);
    const leaves = input.leaves || [];
    const plan = input.plan || {};
    const head = ['人員', ...dates.map(d => `${d.slice(5)}(${WEEKDAY_NAMES[weekday(d)]})`), '值班次數'];
    const rows = staff.map(p => {
      let n = 0;
      const cells = dates.map(d => {
        if ((plan[d] || []).includes(p.id)) { n++; return '值'; }
        return onLeave(leaves, p.id, d) ? '假' : '';
      });
      return [p.name, ...cells, n];
    });
    const daily = ['當日值班', ...dates.map(d => (plan[d] || []).map(id => (staff.find(p => p.id === id) || { name: id }).name).join('、')), ''];
    return '﻿' + [head, ...rows, daily].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- 備份檔驗證 ----------
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const SAFE_ID = /^[A-Za-z0-9_\u4e00-\u9fff-]{1,40}$/;
  const validYMD = s => { try { parseDate(s); return YMD.test(s); } catch (e) { return false; } };
  const dayList = a => Array.isArray(a) ? [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  /**
   * 檢查並重建匯入的備份（只收白名單欄位、型別強制轉換、擋 __proto__、顏色只收 #RRGGBB）。
   * 格式不對丟錯誤。回傳可以直接當 state 用的物件。
   */
  function validateState(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.staff)) throw new Error('不是有效的備份檔（缺少 staff）');
    if (obj.staff.length > 500) throw new Error('人員超過 500 人');
    const ids = new Set();
    const staff = obj.staff.map((p, i) => {
      if (!p || typeof p !== 'object') throw new Error(`第 ${i + 1} 位人員格式不對`);
      const id = String(p.id == null ? '' : p.id);
      if (!SAFE_ID.test(id) || id === '__proto__') throw new Error(`人員代號不合法：${id.slice(0, 20)}`);
      if (ids.has(id)) throw new Error('人員代號重複：' + id);
      ids.add(id);
      const max = p.maxPerWeek === '' || p.maxPerWeek == null ? null : Number(p.maxPerWeek);
      return { id, name: String(p.name == null ? id : p.name).slice(0, 40) || id,
        color: /^#[0-9a-fA-F]{6}$/.test(String(p.color)) ? p.color : '#64748b',
        days: dayList(p.days), fixedDays: dayList(p.fixedDays),
        maxPerWeek: Number.isFinite(max) && max >= 0 ? Math.floor(max) : null, strict: !!p.strict };
    });
    const r = obj.rules && typeof obj.rules === 'object' ? obj.rules : {};
    const rules = normRules({ dutyDays: Array.isArray(r.dutyDays) ? dayList(r.dutyDays) : undefined,
      slotsPerDay: Math.min(50, Math.max(1, parseInt(r.slotsPerDay, 10) || 1)), weekStartsOn: Number(r.weekStartsOn) === 0 ? 0 : 1,
      avoidConsecutive: r.avoidConsecutive !== false, relaxWhenShort: r.relaxWhenShort !== false });
    const start = validYMD(obj.start) ? obj.start : null, end = validYMD(obj.end) ? obj.end : null;
    if (!start || !end || end < start) throw new Error('備份檔的起訖日期不對');
    const cleanPlan = pl => {
      const out = {};
      if (!pl || typeof pl !== 'object' || Array.isArray(pl)) return out;
      Object.keys(pl).forEach(d => {
        if (!validYMD(d) || !Array.isArray(pl[d])) return;
        out[d] = [...new Set(pl[d].map(String).filter(id => ids.has(id)))];
      });
      return out;
    };
    const plans = {};
    if (obj.plans && typeof obj.plans === 'object') {
      Object.keys(obj.plans).slice(0, 60).forEach(k => {
        if (/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(k)) plans[k] = cleanPlan(obj.plans[k]);
      });
    }
    const leaves = (Array.isArray(obj.leaves) ? obj.leaves : []).slice(0, 2000)
      .filter(l => l && ids.has(String(l.staffId)) && validYMD(l.from) && validYMD(l.to) && l.from <= l.to)
      .map(l => ({ staffId: String(l.staffId), from: l.from, to: l.to }));
    return { presetId: String(obj.presetId || '').slice(0, 40), staff, rules, start, end, leaves,
      plan: obj.plan == null ? null : cleanPlan(obj.plan), plans, note: String(obj.note || '').slice(0, 2000) };
  }

  return { validateState, WEEKDAY_NAMES, parseDate, fmt, addDays, weekday, daysBetween, dateRange, monthRange, weekKey, normRules, normStaff, onLeave, generate, check, countDuties, toCSV };
});
