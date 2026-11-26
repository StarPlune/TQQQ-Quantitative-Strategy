const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../docs/js/cn-strategy.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/cn_market_data.json'), 'utf8'));
const base = { red: 1, growth: 1, redBuy: 0.97, redSell: 1.06, growthBuy: 1.04, growthSell: 1.01 };
const near = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const clone = x => JSON.parse(JSON.stringify(x));
function prefix(day) {
  const out = clone(data); out.quoteDate = day;
  for (const a of Object.values(out.assets)) {
    const n = a.dates.filter(d => d <= day).length;
    for (const k of ['dates', 'open', 'close']) a[k] = a[k].slice(0, n);
  }
  return out;
}
test('strict thresholds: equality never changes either state', () => {
  for (const held of [false, true]) {
    const r = { ...base, red: held ? base.redSell : base.redBuy, growth: held ? base.growthSell : base.growthBuy };
    assert.deepEqual(E.transition({ red: held, growth: held }, r).state, { red: held, growth: held });
  }
});
test('entry and exit independently allocate 60/40; idle budget goes to 511260', () => {
  const r = E.transition({ red: false, growth: false }, { ...base, red: 0.96, growth: 1.05 });
  assert.deepEqual(r.state, { red: true, growth: true });
  for (const red of [false, true]) for (const growth of [false, true]) {
    const w = E.targets({ red, growth });
    near(w['512890'], red ? 0.6 : 0); near(w['159915'], growth ? 0.4 : 0);
    near(Object.values(w).reduce((a, b) => a + b, 0), 1);
  }
  assert.equal(E.transition({ red: true, growth: true }, { ...base, red: 1.07, growth: 1 }).events.length, 2);
});
test('buffer retains state; red has no invented stop loss', () => {
  assert.equal(E.transition({ red: true, growth: false }, { ...base, red: 0.5 }).state.red, true);
  assert.equal(E.transition({ red: false, growth: true }, { ...base, growth: 1.02 }).state.growth, true);
  assert.equal(E.transition({ red: true, growth: false }, { ...base, growth: 1.02 }).state.growth, false);
});
test('missing historical quote cannot create an exit or entry', () => {
  const r = E.transition({ red: true, growth: false }, { ...base, red: null, redValid: false, growth: null, growthValid: false });
  assert.deepEqual(r.state, { red: true, growth: false }); assert.equal(r.changed, false);
});
test('month arithmetic crosses year boundaries', () => {
  assert.equal(E.monthBefore('2026-01', 1), '2025-12'); assert.equal(E.monthBefore('2026-01', 6), '2025-07');
});
test('Nov 26 reference: completed monthly closes and ETF MA30 match reviewed snapshot', () => {
  const r = E.evaluate(prefix('2026-11-26')).latest;
  near(r.m3, (1.192 + 1.196 + 1.243) / 3);
  near(r.m4, (1.204 + 1.192 + 1.196 + 1.243) / 4);
  near(r.m6, (1.167 + 1.067 + 1.204 + 1.192 + 1.196 + 1.243) / 6);
  near(r.ma30, 2.4899333333333336); near(r.redBuy, 1.1724875); near(r.redSell, 1.2829533333333334);
  assert.deepEqual(r.state, { red: true, growth: false });
});
test('daily MA includes signal-day price and uses 30 actual observations', () => {
  const a = data.assets['159915']; const index = a.dates.indexOf('2026-11-26');
  const rawMean = a.close.slice(index - 29, index + 1).reduce((x, y) => x + y, 0) / 30;
  near(E.evaluate(prefix('2026-11-26')).latest.ma30, rawMean);
});
test('new cash does not inherit the historical red holding', () => {
  const r = E.evaluate(prefix('2026-11-26'));
  assert.equal(r.latest.state.red, true); assert.equal(r.cold.state.red, false);
  assert.equal(r.cold.targets['511260'], 1);
});
test('no future month close or future action changes a historical signal', () => {
  const full = E.evaluate(data), cut = E.evaluate(prefix('2026-11-25'));
  const archived = full.history.find(r => r.date === '2026-11-25');
  for (const k of ['ma30', 'm3', 'm4', 'm6', 'redBuy', 'redSell', 'growthBuy', 'growthSell']) near(archived[k], cut.latest[k]);
  assert.deepEqual(archived.state, cut.latest.state);
  const future = prefix('2026-11-26'); future.assets['512890'].actions.dividends.push({ exDate: '2030-01-01', payDate: '2030-01-02', cashPerShare: 100 });
  near(E.evaluate(future).latest.redBuy, E.evaluate(prefix('2026-11-26')).latest.redBuy);
});
test('split and dividend enter total-return path exactly once', () => {
  const a = { dates: ['2020-01-01', '2020-01-02'], close: [100, 50], actions: { dividends: [], splits: [{ date: '2020-01-02', ratio: 2 }] } };
  near(E.levels(a).values[1], 100);
  a.close[1] = 95; a.actions = { splits: [], dividends: [{ exDate: '2020-01-02', cashPerShare: 5 }] };
  near(E.levels(a).values[1], 100);
});
test('corrupt / unsynchronized latest quotes fail closed', () => {
  const bad = clone(data); bad.assets['159915'].close[10] = 0;
  assert.throws(() => E.evaluate(bad), /无效报价/);
  const stale = clone(data); stale.quoteDate = '2099-01-01';
  assert.throws(() => E.evaluate(stale), /不同步/);
});
test('backtest trades strictly after signals and never on missing-quote days', () => {
  const bt = E.backtest(data), all = E.evaluate(data);
  assert.ok(bt.trades.length > 1);
  for (const trade of bt.trades) {
    assert.ok(trade.executionDate > trade.signalDate);
    assert.ok(!bt.missingQuoteDays.includes(trade.executionDate));
    const i = all.history.findIndex(r => r.date === trade.executionDate);
    assert.ok(i > 0);
  }
  assert.ok(bt.curves.every(r => r.nav > 0));
  assert.deepEqual(bt.missingQuoteDays, ['2021-02-08', '2021-10-22']);
});
test('subperiod starts cash and only uses preexisting data to warm up indicators', () => {
  const bt = E.backtest(data, { start: '2026-11-24' });
  assert.equal(bt.trades[0].signalDate, '2026-11-24');
  assert.equal(bt.trades[0].targets['512890'], 0);
  assert.equal(bt.trades[0].targets['511260'], 1);
});
test('costs reduce final value; scale is proportional without minimum commission', () => {
  const zero = E.backtest(data, { feeBps: 0 }), fee = E.backtest(data, { feeBps: 5 }), twice = E.backtest(data, { capital: 200000 });
  assert.ok(fee.final < zero.final); near(fee.final * 2, twice.final, 1e-6);
  assert.ok(fee.totalFees > 0); near(fee.cagr, twice.cagr);
});
test('no daily forced target reset: weights drift between rebalances', () => {
  const bt = E.backtest(data); const executed = new Set(bt.trades.map(t => t.executionDate));
  assert.ok(bt.curves.some(r => !executed.has(r.date) && r.weights['512890'] > 0 && Math.abs(r.weights['512890'] - 0.6) > 0.001));
});
test('invalid account and date ranges produce an explanatory error', () => {
  assert.throws(() => E.backtest(data, { capital: -1 }), /本金/);
  assert.throws(() => E.backtest(data, { feeBps: -1 }), /费用/);
  assert.throws(() => E.backtest(data, { start: '2099-01-01' }), /没有完整行情/);
});
