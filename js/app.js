/* tw-duty-roster 畫面邏輯。排班規則在 scheduler.js，這裡只管畫面與存檔。 */
(function () {
  'use strict';
  const R = window.Roster;
  const CFG = window.ROSTER_CONFIG || { presets: {} };
  const KEY = 'tw-duty-roster:v1';
  const W = R.WEEKDAY_NAMES;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- 狀態 ----------
  function thisMonth() {
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth() + 1, 1); // 預設排下個月（從 1 號算，1/31 時不會跳到 3 月）
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function fromPreset(id, base) {
    const p = CFG.presets[id] || Object.values(CFG.presets)[0] || { staff: [], rules: {} };
    const s = base || {};
    const m = s.start ? null : R.monthRange(thisMonth());
    return {
      presetId: id,
      staff: clone(p.staff || []),
      rules: R.normRules(clone(p.rules || {})),
      start: s.start || m.start,
      end: s.end || m.end,
      leaves: [],
      plan: null,
      plans: s.plans || {},
      note: s.note || '',
    };
  }
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) return R.validateState(JSON.parse(raw));
    } catch (e) {
      // 讀不懂就用範本，但先把原本的資料另存一份，避免下次存檔把它蓋掉而救不回來
      try { if (raw) localStorage.setItem(KEY + ':corrupt-backup', raw); } catch (e2) { /* 空間不足就算了 */ }
    }
    return fromPreset(CFG.defaultPreset || Object.keys(CFG.presets)[0]);
  }
  let state = load();
  let saveFailed = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; }
    catch (e) { saveFailed = true; }   // 無痕模式、空間滿了：不能靜悄悄，畫面上會出現紅字提醒
    const w = document.getElementById('saveWarn');
    if (w) w.hidden = !saveFailed;
  }
  // 別的分頁改了資料 → 這頁重新讀入，避免兩個分頁互相用舊資料覆蓋
  window.addEventListener('storage', e => {
    if (e.key !== KEY || e.newValue == null) return;
    try { state = R.validateState(JSON.parse(e.newValue)); renderSettings(); renderGrid(); } catch (err) { /* 壞資料就忽略 */ }
  });
  // 其他期間已排好的班（例如上個月），給排班與檢查參考：跨月的連續值班、每週上限才算得準
  function historyMap() {
    const h = {};
    Object.keys(state.plans || {}).forEach(k => {
      if (k === state.start + '~' + state.end) return;
      Object.assign(h, state.plans[k]);
    });
    return h;
  }
  function archiveCurrent() {
    if (!state.plan) return;
    state.plans = state.plans || {};
    state.plans[state.start + '~' + state.end] = state.plan;
    Object.keys(state.plans).sort().slice(0, Math.max(0, Object.keys(state.plans).length - 24)).forEach(k => delete state.plans[k]);
  }

  // ---------- 小元件 ----------
  function dayChecks(selected, onChange, order) {
    const box = document.createElement('span');
    box.className = 'days';
    (order || [1, 2, 3, 4, 5, 6, 0]).forEach(d => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.includes(d);
      cb.addEventListener('change', () => {
        const set = new Set(selected);
        cb.checked ? set.add(d) : set.delete(d);
        onChange([...set].sort());
      });
      lab.append(cb, W[d]);
      box.append(lab);
    });
    return box;
  }
  function newId() {
    let i = state.staff.length + 1;
    while (state.staff.some(p => p.id === 'p' + i)) i++;
    return 'p' + i;
  }

  // ---------- 畫面：設定區 ----------
  function renderSettings() {
    document.title = CFG.title || '值班表';
    $('title').textContent = CFG.title || '值班表';
    $('noteLabel').textContent = CFG.noteLabel || '備註';
    $('start').value = state.start;
    $('end').value = state.end;
    $('month').value = state.start.slice(0, 7);

    $('preset').innerHTML = Object.entries(CFG.presets)
      .map(([id, p]) => `<option value="${esc(id)}"${id === state.presetId ? ' selected' : ''}>${esc(p.label || id)}</option>`).join('');

    // 人員
    const tb = $('staffTable').querySelector('tbody');
    tb.innerHTML = '';
    state.staff.forEach((p, i) => {
      const tr = document.createElement('tr');
      const td = () => tr.appendChild(document.createElement('td'));

      const name = document.createElement('input');
      name.className = 'name';
      name.value = p.name;
      name.addEventListener('change', () => { p.name = name.value.trim() || p.id; changed(true); });
      td().append(name);

      const color = document.createElement('input');
      color.type = 'color';
      color.value = p.color || '#64748b';
      color.addEventListener('change', () => { p.color = color.value; changed(true); });
      td().append(color);

      td().append(dayChecks(p.days || [], v => { p.days = v; changed(true); }));
      td().append(dayChecks(p.fixedDays || [], v => { p.fixedDays = v; changed(true); }));

      const max = document.createElement('input');
      max.type = 'number';
      max.min = '0';
      max.className = 'num';
      max.placeholder = '不限';
      max.value = p.maxPerWeek == null ? '' : p.maxPerWeek;
      max.addEventListener('change', () => { p.maxPerWeek = max.value === '' ? null : Number(max.value); changed(true); });
      td().append(max);

      const strict = document.createElement('input');
      strict.type = 'checkbox';
      strict.checked = !!p.strict;
      strict.addEventListener('change', () => { p.strict = strict.checked; changed(true); });
      td().append(strict);

      const del = document.createElement('button');
      del.className = 'small';
      del.textContent = '移除';
      del.addEventListener('click', () => {
        state.staff.splice(i, 1);
        state.leaves = state.leaves.filter(l => l.staffId !== p.id);
        if (state.plan) Object.keys(state.plan).forEach(d => { state.plan[d] = state.plan[d].filter(x => x !== p.id); });
        changed(true);
        renderSettings();
      });
      td().append(del);
      tb.append(tr);
    });

    // 規則
    const dd = $('dutyDays');
    dd.innerHTML = '';
    dd.append(dayChecks(state.rules.dutyDays, v => { state.rules.dutyDays = v; changed(true); }));
    $('slots').value = state.rules.slotsPerDay;
    $('weekStart').value = String(state.rules.weekStartsOn);
    $('avoidConsecutive').checked = !!state.rules.avoidConsecutive;
    $('relax').checked = !!state.rules.relaxWhenShort;

    renderLeaves();
    $('note').value = state.note || '';
  }

  function renderLeaves() {
    const box = $('leaves');
    box.innerHTML = '';
    state.leaves.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'leave-row';
      row.innerHTML = `
        <select>${state.staff.map(p => `<option value="${esc(p.id)}"${p.id === l.staffId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <label>從 <input type="date" value="${esc(l.from)}"></label>
        <label>到 <input type="date" value="${esc(l.to)}"></label>
        <button class="small">移除</button>`;
      const [sel] = row.getElementsByTagName('select');
      const [from, to] = row.querySelectorAll('input');
      sel.addEventListener('change', () => { l.staffId = sel.value; changed(false); });
      from.addEventListener('change', () => { l.from = from.value; if (!l.to || l.to < l.from) { l.to = l.from; to.value = l.from; } changed(false); });
      to.addEventListener('change', () => { l.to = to.value; changed(false); });
      row.querySelector('button').addEventListener('click', () => { state.leaves.splice(i, 1); changed(false); renderLeaves(); });
      box.append(row);
    });
  }

  // ---------- 畫面：排班表 ----------
  function validLeaves() {
    return state.leaves.filter(l => l.staffId && /^\d{4}-\d{2}-\d{2}$/.test(l.from) && /^\d{4}-\d{2}-\d{2}$/.test(l.to) && l.from <= l.to);
  }
  function input() {
    return { start: state.start, end: state.end, staff: state.staff, rules: state.rules, leaves: validLeaves(), plan: state.plan || {}, history: historyMap() };
  }

  function renderGrid() {
    const grid = $('grid');
    let dates;
    try { dates = R.dateRange(state.start, state.end); } catch (e) {
      grid.innerHTML = '';
      $('warnings').innerHTML = `<li>${esc(e.message)}</li>`;
      return;
    }
    $('tableTitle').textContent = `${state.start} ～ ${state.end} 排班表`;
    const leaves = validLeaves();
    const plan = state.plan || {};
    const staff = R.normStaff(state.staff);
    const wdClass = d => (R.weekday(d) === 0 ? 'sun' : R.weekday(d) === 6 ? 'sat' : '') + (state.rules.dutyDays.includes(R.weekday(d)) ? '' : ' off');

    let h = '<thead><tr><th class="name">人員</th>' +
      dates.map(d => `<th class="${wdClass(d)}">${+d.slice(8)}<br>${W[R.weekday(d)]}</th>`).join('') +
      '<th>次數</th></tr></thead><tbody>';
    for (const p of staff) {
      let n = 0;
      h += `<tr><td class="name"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</td>`;
      for (const d of dates) {
        const duty = (plan[d] || []).includes(p.id);
        const leave = R.onLeave(leaves, p.id, d);
        if (duty) n++;
        h += `<td class="cell ${duty ? 'duty' : leave ? 'leave' : ''} ${wdClass(d)}" data-d="${d}" data-p="${esc(p.id)}">${duty ? '值' : leave ? '假' : ''}</td>`;
      }
      h += `<td>${n}</td></tr>`;
    }
    const nameOf = id => (staff.find(p => p.id === id) || { name: id }).name;
    h += '<tr class="daily"><td class="name">當日值班</td>' +
      dates.map(d => `<td class="${wdClass(d)}">${(plan[d] || []).map(id => esc(nameOf(id))).join('<br>')}</td>`).join('') + '<td></td></tr>';
    grid.innerHTML = h + '</tbody>';

    const ws = state.plan ? R.check(input()) : [];
    $('warnings').innerHTML = !state.plan
      ? '<li class="ok">還沒排班，按上面的「產生排班」。</li>'
      : ws.length ? ws.map(w => `<li>${esc(w.msg)}</li>`).join('') : '<li class="ok">✓ 檢查通過：沒有缺人、請假衝突或超過上限。</li>';
    $('notePrint').textContent = state.note || '';
  }

  // 點格子：加上或拿掉值班
  $('grid').addEventListener('click', e => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    const d = td.dataset.d, id = td.dataset.p;
    state.plan = state.plan || {};
    const list = state.plan[d] || [];
    state.plan[d] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    save();
    renderGrid();
  });

  // ---------- 事件 ----------
  function changed(staffChanged) {
    save();
    if (staffChanged) renderLeaves();
    renderGrid();
  }
  function setRange(start, end) {
    archiveCurrent();                       // 換期間前先把這期班表收進歷史，不會因為切換月份就不見
    state.start = start;
    state.end = end;
    state.plan = (state.plans && state.plans[start + '~' + end]) || null;   // 這個期間以前排過就直接還原
    save();
    renderSettings();
    renderGrid();
  }
  $('month').addEventListener('change', e => { if (e.target.value) { const m = R.monthRange(e.target.value); setRange(m.start, m.end); } });
  $('start').addEventListener('change', e => { if (e.target.value) setRange(e.target.value, e.target.value > state.end ? e.target.value : state.end); });
  $('end').addEventListener('change', e => { if (e.target.value) setRange(state.start, e.target.value); });

  $('slots').addEventListener('change', e => { state.rules.slotsPerDay = Math.min(50, Math.max(1, Math.floor(+e.target.value) || 1)); e.target.value = state.rules.slotsPerDay; changed(false); });
  $('weekStart').addEventListener('change', e => { state.rules.weekStartsOn = +e.target.value; changed(false); });
  $('avoidConsecutive').addEventListener('change', e => { state.rules.avoidConsecutive = e.target.checked; changed(false); });
  $('relax').addEventListener('change', e => { state.rules.relaxWhenShort = e.target.checked; changed(false); });
  $('note').addEventListener('input', e => { state.note = e.target.value; $('notePrint').textContent = state.note; save(); });

  $('btnAddStaff').addEventListener('click', () => {
    state.staff.push({ id: newId(), name: '新人員', color: '#64748b', days: [1, 2, 3, 4, 5, 6], fixedDays: [], maxPerWeek: 2 });
    changed(true);
    renderSettings();
  });
  $('btnAddLeave').addEventListener('click', () => {
    if (!state.staff.length) return;
    state.leaves.push({ staffId: state.staff[0].id, from: state.start, to: state.start });
    changed(false);
    renderLeaves();
  });

  $('btnPreset').addEventListener('click', () => { $('presetConfirm').hidden = false; });
  $('btnPresetNo').addEventListener('click', () => { $('presetConfirm').hidden = true; });
  $('btnPresetYes').addEventListener('click', () => {
    $('presetConfirm').hidden = true;
    archiveCurrent();
    state = fromPreset($('preset').value, { start: state.start, end: state.end, note: state.note, plans: state.plans });
    save();
    renderSettings();
    renderGrid();
  });

  $('btnGenerate').addEventListener('click', () => {
    const hasPlan = state.plan && Object.values(state.plan).some(ids => ids.length);
    if (hasPlan && !window.confirm('這個期間已經有排好的班表（含你手動調整的）。重新產生會全部覆蓋，確定嗎？\n（建議先按「備份」存成檔案）')) return;
    try {
      state.plan = R.generate(input()).plan;
    } catch (e) {
      $('warnings').innerHTML = `<li>${esc(e.message)}</li>`;
      return;
    }
    save();
    renderGrid();
  });

  $('btnCSV').addEventListener('click', () => {
    const blob = new Blob([R.toCSV(input())], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `值班表_${state.start}_${state.end}.csv`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('btnPrint').addEventListener('click', () => window.print());

  // 備份／還原（換手機、換電腦、傳給同事都靠這個；資料只存在瀏覽器裡）
  $('btnBackup').addEventListener('click', () => {
    archiveCurrent();
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `值班表備份_${stamp}.json`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('fileRestore').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const s = R.validateState(JSON.parse(String(fr.result)));
        if (!window.confirm(`備份檔有 ${s.staff.length} 位人員、期間 ${s.start} ～ ${s.end}。要取代目前的全部資料嗎？`)) return;
        state = s;
        save();
        renderSettings();
        renderGrid();
      } catch (err) { alert('還原失敗：' + err.message); }
    };
    fr.readAsText(f, 'utf-8');
    e.target.value = '';
  });

  renderSettings();
  renderGrid();
})();
