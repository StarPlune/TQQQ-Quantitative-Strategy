/* Shared browser/Node engine. Only ETF exchange prices; no index or NAV substitution. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CNStrategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CODES = ['512890', '159915', '511260'];
  const RULES = Object.freeze({ redBudget: 0.6, growthBudget: 0.4, growthDays: 30,
    redEntry: 0.97, redExit: 1.06, growthEntry: 1.04, growthExit: 1.01,
    researchStart: '2020-01-02', version: 'cn-60-40-v1' });
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  function check(ok, message) { if (!ok) throw new Error(message); }
  function monthBefore(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const v = y * 12 + m - 1 - n;
    return `${Math.floor(v / 12)}-${String(v % 12 + 1).padStart(2, '0')}`;
  }
  function validate(data) {
    check(data && data.schemaVersion === 1 && data.confirmedClose === true, '需要已确认的盘后行情文件');
    check(/^\d{4}-\d{2}-\d{2}$/.test(data.quoteDate || ''), '缺少行情日期');
    for (const code of CODES) {
      const a = data.assets && data.assets[code];
      check(a && Array.isArray(a.dates) && a.dates.length > 180, `${code} 历史数据不足`);
      check(a.close.length === a.dates.length && a.open.length === a.dates.length, `${code} 行情长度不一致`);
      for (let i = 0; i < a.dates.length; i++) {
        check(/^\d{4}-\d{2}-\d{2}$/.test(a.dates[i]) && (!i || a.dates[i] > a.dates[i - 1]), `${code} 日期无效或重复`);
        check(finite(a.close[i]) && a.close[i] > 0 && finite(a.open[i]) && a.open[i] > 0, `${code} 存在无效报价`);
      }
      check(a.dates.at(-1) === data.quoteDate, `${code} 最新日期不同步，待核实`);
      check(a.actions && Array.isArray(a.actions.dividends) && Array.isArray(a.actions.splits), `${code} 缺少分红拆分表`);
      for (const d of a.actions.dividends) check(finite(d.cashPerShare) && d.cashPerShare >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.exDate), `${code} 分红数据无效`);
      for (const s of a.actions.splits) check(finite(s.ratio) && s.ratio > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.date), `${code} 拆分数据无效`);
    }
    return data;
  }
  function levels(asset) {
    const out = [], map = new Map(); let level = asset.close[0];
    for (let i = 0; i < asset.dates.length; i++) {
      if (i) {
        const prev = asset.dates[i - 1], now = asset.dates[i];
        const split = asset.actions.splits.filter(s => s.date > prev && s.date <= now).reduce((x, s) => x * s.ratio, 1);
        const cash = asset.actions.dividends.filter(d => d.exDate > prev && d.exDate <= now).reduce((x, d) => x + d.cashPerShare, 0);
        check(!(split !== 1 && cash !== 0), '同日分红与拆分需人工核实');
        level *= (split * asset.close[i] + cash) / asset.close[i - 1];
      }
      check(finite(level) && level > 0, '复权价格无效');
      out.push(level); map.set(asset.dates[i], { index: i, level, raw: asset.close[i] });
    }
    return { values: out, map };
  }
  function indicators(data) {
    validate(data);
    const paths = Object.fromEntries(CODES.map(c => [c, levels(data.assets[c])]));
    const monthly = new Map(), red = data.assets['512890'], growth = data.assets['159915'];
    for (let i = 0; i < red.dates.length; i++) monthly.set(red.dates[i].slice(0, 7), paths['512890'].values[i]);
    // Preserve sessions with historical gaps: keep only that leg's prior state.
    // Never fill a missing quote to manufacture a new signal or a transaction.
    const dates = [...new Set(CODES.flatMap(c => data.assets[c].dates.filter(d => d >= RULES.researchStart)))].sort();
    check(dates.at(-1) === data.quoteDate, '缺少最新共同交易日');
    const rows = dates.map(date => {
      const ym = date.slice(0, 7), past = Array.from({ length: 6 }, (_, i) => monthly.get(monthBefore(ym, i + 1)));
      check(past.every(finite), `${date} 缺少此前六个完整月线`);
      const rp = paths['512890'].map.get(date), gp = paths['159915'].map.get(date);
      check(!gp || gp.index >= 29, `${date} 不足30个有效报价`);
      const scale = rp ? rp.raw / rp.level : 1;
      const means = [3, 4, 6].map(n => past.slice(0, n).reduce((x, y) => x + y, 0) / n * scale);
      const median = means.slice().sort((x, y) => x - y)[1], high = Math.max(...means);
      const ma30 = gp ? paths['159915'].values.slice(gp.index - 29, gp.index + 1).reduce((x, y) => x + y, 0) / 30 * gp.raw / gp.level : null;
      const bond = paths['511260'].map.get(date);
      return { date, red: rp ? rp.raw : null, growth: gp ? gp.raw : null, bond: bond ? bond.raw : null,
        redValid: !!rp, growthValid: !!gp, complete: !!(rp && gp && bond),
        m3: means[0], m4: means[1], m6: means[2], b: median, h: high,
        redBuy: RULES.redEntry * median, redSell: RULES.redExit * high,
        ma30, growthBuy: RULES.growthEntry * ma30, growthSell: RULES.growthExit * ma30 };
    });
    return { rows, paths };
  }
  function targets(state) {
    const red = state.red ? RULES.redBudget : 0, growth = state.growth ? RULES.growthBudget : 0;
    return { '512890': red, '159915': growth, '511260': Math.max(0, 1 - red - growth) };
  }
  function transition(prev, r) {
    if (r.redValid !== false) for (const k of ['red', 'redBuy', 'redSell']) check(finite(r[k]), '红利信号指标未齐');
    if (r.growthValid !== false) for (const k of ['growth', 'growthBuy', 'growthSell']) check(finite(r[k]), '创业板信号指标未齐');
    const state = { red: !!prev.red, growth: !!prev.growth }, events = [];
    if (r.redValid !== false) {
      if (!prev.red && r.red < r.redBuy) { state.red = true; events.push('红利买入'); }
      else if (prev.red && r.red > r.redSell) { state.red = false; events.push('红利退出'); }
    }
    if (r.growthValid !== false) {
      if (!prev.growth && r.growth > r.growthBuy) { state.growth = true; events.push('创业板买入'); }
      else if (prev.growth && r.growth < r.growthSell) { state.growth = false; events.push('创业板退出'); }
    }
    return { state, events, changed: events.length > 0, targets: targets(state) };
  }
  function replay(rows, start = RULES.researchStart) {
    let prev = { red: false, growth: false };
    return rows.filter(r => r.date >= start).map(r => {
      const next = transition(prev, r); prev = next.state;
      return Object.assign({}, r, next);
    });
  }
  function evaluate(data) {
    const input = indicators(data), history = replay(input.rows);
    check(history.length > 1, '信号样本不足');
    const latest = history.at(-1), cold = transition({ red: false, growth: false }, latest);
    return { latest, previous: history.at(-2), cold, history, paths: input.paths, indicators: input.rows };
  }
  function backtest(data, options = {}) {
    const start = options.start || RULES.researchStart, capital = options.capital ?? 100000, bps = options.feeBps ?? 5;
    check(finite(capital) && capital > 0 && finite(bps) && bps >= 0 && bps <= 100, '本金或费用参数无效');
    const input = indicators(data), firstComplete = input.rows.find(r => r.date >= start && r.complete);
    check(!!firstComplete, '所选区间没有完整行情');
    const rows = replay(input.rows, firstComplete.date);
    check(rows.length >= 2, '回测区间至少需要两个交易日');
    const fee = bps / 10000, units = [0, 0, 0], curves = [], trades = [];
    let cash = capital, pending = null, previousTarget = null, totalFees = 0, peak = capital, maxDD = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], prices = CODES.map(c => {
        const path = input.paths[c], dates = data.assets[c].dates;
        if (path.map.has(r.date)) return path.map.get(r.date).level;
        let k = dates.length - 1; while (k >= 0 && dates[k] > r.date) k--;
        check(k >= 0, '缺少过去可用估值'); return path.values[k];
      });
      let values = units.map((u, k) => u * prices[k]), nav = cash + values.reduce((x, y) => x + y, 0);
      // A close signal can only execute at the following session's close.
      let executed = false;
      if (pending && r.complete) {
        const w = CODES.map(c => pending.targets[c]);
        let lo = nav / (1 + 2 * fee), hi = nav;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2, cost = values.reduce((s, v, k) => s + Math.abs(w[k] * mid - v) * fee, 0);
          if (mid + cost > nav) hi = mid; else lo = mid;
        }
        const endNav = (lo + hi) / 2, cost = nav - endNav;
        values = w.map(x => x * endNav);
        for (let k = 0; k < 3; k++) units[k] = values[k] / prices[k];
        cash = 0; totalFees += cost;
        trades.push({ signalDate: pending.date, executionDate: r.date, reason: pending.reason,
          targets: pending.targets, previousTargets: previousTarget, fee: cost, nav: endNav });
        previousTarget = pending.targets; nav = endNav; executed = true;
      }
      peak = Math.max(peak, nav); const dd = nav / peak - 1; maxDD = Math.max(maxDD, -dd);
      const passive = capital / (1 + fee) * (0.6 * prices[0] / input.paths['512890'].map.get(rows[0].date).level +
        0.4 * prices[1] / input.paths['159915'].map.get(rows[0].date).level);
      curves.push({ date: r.date, nav, passive, drawdown: dd, weights: Object.fromEntries(CODES.map((c, k) => [c, values[k] / nav])) });
      pending = i === 0 || r.changed ? { date: r.date, targets: r.targets, reason: i === 0 ? '全现金启动' : r.events.join('、') } : executed ? null : pending;
    }
    const first = curves[0], last = curves.at(-1), years = (Date.parse(last.date) - Date.parse(first.date)) / (86400000 * 365.25);
    const annual = []; let prior = capital;
    for (const year of [...new Set(curves.map(r => r.date.slice(0, 4)))]) {
      const end = curves.filter(r => r.date.startsWith(year)).at(-1).nav;
      annual.push({ year, return: end / prior - 1 }); prior = end;
    }
    return { curves, trades, annual, capital, feeBps: bps, start: first.date, end: last.date,
      cagr: years > 0 ? (last.nav / capital) ** (1 / years) - 1 : null,
      maxDD, final: last.nav, totalFees, missingQuoteDays: rows.filter(r => !r.complete).map(r => r.date),
      pending: pending && { signalDate: pending.date, targets: pending.targets },
      execution: 'next_close', adjustment: 'causal_total_return_ex_date_reinvestment_approximation' };
  }
  return { CODES, RULES, validate, levels, indicators, transition, targets, replay, evaluate, backtest, monthBefore };
});
