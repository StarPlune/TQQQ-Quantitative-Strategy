const fs = require('node:fs');
const engine = require('../docs/js/cn-strategy.js');
const path = process.argv[2] || 'docs/data/cn_market_data.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const result = engine.evaluate(data);
const bt = engine.backtest(data);
if (!Number.isFinite(bt.final) || bt.final <= 0) throw new Error('回测净值无效');
for (const trade of bt.trades) {
  if (!(trade.executionDate > trade.signalDate)) throw new Error('使用了信号当日成交');
}
console.log(JSON.stringify({ date: result.latest.date, state: result.latest.state,
  targets: result.latest.targets, coldStart: result.cold.targets,
  ma30: result.latest.ma30, redBuy: result.latest.redBuy, redSell: result.latest.redSell,
  observations: result.history.length, execution: bt.execution }, null, 2));
