/*
 * tw-duty-roster 設定檔
 * 用記事本打開就能改，改完存檔、重新整理網頁即可。
 *
 * 星期代號：0=日 1=一 2=二 3=三 4=四 5=五 6=六
 *
 * 人員欄位：
 *   id          代號（英數，不能重複）
 *   name        顯示名稱
 *   color       顏色
 *   days        哪幾個星期可以值班
 *   fixedDays   哪幾個星期固定由他值班（請假時會自動找別人）
 *   maxPerWeek  每週最多幾次（留 null 代表不限）
 *   strict      true＝人手不足時也不能超過每週上限
 *
 * 規則欄位：
 *   dutyDays          哪幾個星期需要有人值班
 *   slotsPerDay       每天幾個人
 *   weekStartsOn      每週上限從星期幾開始算（1＝週一）
 *   avoidConsecutive  盡量不要連續兩天值班
 *   relaxWhenShort    排不出人時，放寬非 strict 人員的每週上限
 *
 * 網頁上改的人員、規則、請假會存在這台電腦的瀏覽器裡；
 * 想回到這份設定，按網頁上的「套用範本」。
 */
window.ROSTER_CONFIG = {
  title: '示範不動產 值班表',
  noteLabel: '店長的話',
  defaultPreset: 'daily',

  presets: {
    // 範本一：門市每日值班（每天 1 人，店長固定週日；店長請假由副店長代）
    daily: {
      label: '門市每日值班',
      rules: { dutyDays: [0, 1, 2, 3, 4, 5, 6], slotsPerDay: 1, weekStartsOn: 1, avoidConsecutive: true, relaxWhenShort: true },
      staff: [
        { id: 'manager', name: '店長', color: '#2563eb', days: [0, 1, 2, 3, 4, 5, 6], fixedDays: [0], maxPerWeek: 2 },
        { id: 'deputy', name: '副店長', color: '#16a34a', days: [0, 1, 2, 3, 4, 5, 6], maxPerWeek: 2 },
        { id: 'agentA', name: '業務A', color: '#ea580c', days: [1, 2, 3, 4, 5, 6], maxPerWeek: 2 },
        { id: 'agentB', name: '業務B', color: '#9333ea', days: [1, 2, 3, 4, 5, 6], maxPerWeek: 2 },
        { id: 'agentC', name: '業務C', color: '#db2777', days: [1, 2, 3, 4, 5, 6], maxPerWeek: 2 },
        { id: 'parttime', name: '兼職', color: '#0891b2', days: [1, 2, 3, 4, 5], maxPerWeek: 1, strict: true },
      ],
    },

    // 範本二：週末三人輪班（週五、六固定一人，週日兩人輪流）
    weekend: {
      label: '週末三人輪班',
      rules: { dutyDays: [5, 6, 0], slotsPerDay: 1, weekStartsOn: 1, avoidConsecutive: false, relaxWhenShort: true },
      staff: [
        { id: 'agentA', name: '業務A', color: '#16a34a', days: [5, 6], fixedDays: [5, 6] },
        { id: 'agentB', name: '業務B', color: '#2563eb', days: [0] },
        { id: 'deputy', name: '副店長', color: '#ea580c', days: [0] },
      ],
    },
  },
};
