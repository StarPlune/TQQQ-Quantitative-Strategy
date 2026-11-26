/* A-share workspace, isolated from the existing US strategy controls and data. */
(function () {
  'use strict';
  const root = document.getElementById('viewCn');
  const names = { '512890': '红利低波ETF', '159915': '创业板ETF', '511260': '十年国债ETF' };
  let data, result, bt, scenario = 'history', panel = 'signal', eqChart, ddChart;
  const $ = id => document.getElementById(id);
  const number = (x, digits = 3) => Number.isFinite(x) ? x.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const pct = (x, digits = 2) => number(x * 100, digits) + '%';
  const money = x => '¥' + number(x, 2);
  root.innerHTML = `
    <div class="cn-panel cn-heading">
      <div><h2 class="cn-title">红利低波 × 创业板</h2><p class="cn-sub">回归择时与趋势择时独立运行 · 60∶40预算 · 退出资金转入511260</p></div>
      <span id="cnDataDate" class="cn-pill">正在加载已验证收盘行情</span>
    </div>
    <div id="cnError" class="cn-error cn-hidden" role="alert"></div>
    <div id="cnLoading" class="cn-panel cn-sub">正在校验行情、月线与历史状态…</div>
    <div id="cnContent" class="cn-hidden">
      <section id="cnSignalPanel">
        <div class="cn-panel cn-banner" id="cnBanner" aria-live="polite">
          <div class="cn-heading"><div><p class="cn-sub" id="cnScenarioLabel"></p><h3 class="cn-status" id="cnStatus"></h3><p id="cnReason"></p></div>
          <div class="cn-controls"><button id="cnHistory" class="cn-button" aria-pressed="true">历史延续</button><button id="cnCold" class="cn-button" aria-pressed="false">今日全现金启动</button></div></div>
          <p class="cn-sub" id="cnFreshness"></p>
        </div>
        <div class="cn-grid" id="cnCards"></div>
        <div class="cn-two" style="margin-top:20px">
          <div class="cn-panel"><div class="cn-heading"><div><h3 class="cn-asset-name">下一交易日目标预算</h3><p class="cn-sub">独立策略资金 · 目标比例不代表实际持仓</p></div>
            <div class="cn-controls"><label>策略资金（人民币）<input id="cnCapital" type="number" min="1" step="1000" value="100000"></label></div></div>
            <div class="cn-budget-bar" id="cnBudgetBar" aria-hidden="true"></div><div id="cnBudgetRows"></div>
            <p class="cn-sub" style="margin-top:14px">信号改变时，下一交易日恢复全组合目标比例；无变化时允许权重漂移，不每日强制调仓。预算估算不连接券商，不执行交易。</p>
          </div>
          <div class="cn-panel"><h3 class="cn-asset-name">四种独立状态</h3><div class="cn-table-wrap"><table class="cn-table"><thead><tr><th>股票状态</th><th>红利</th><th>创业板</th><th>国债</th></tr></thead><tbody>
            <tr><td>两者持有</td><td>60%</td><td>40%</td><td>0%</td></tr><tr><td>仅红利</td><td>60%</td><td>0%</td><td>40%</td></tr><tr><td>仅创业板</td><td>0%</td><td>40%</td><td>60%</td></tr><tr><td>都未持有</td><td>0%</td><td>0%</td><td>100%</td></tr>
          </tbody></table></div><p class="cn-sub" style="margin-top:14px">未启用的预算交给国债，另一只股票不会自动接管。三只ETF的目标预算合计100%。</p></div>
        </div>
      </section>
      <section id="cnBacktestPanel" class="cn-hidden">
        <div class="cn-panel"><div class="cn-heading"><div><h3 class="cn-asset-name">全现金启动的历史模拟</h3><p class="cn-sub">首日收盘判断，下一交易日收盘执行；仅股票信号改变时再平衡。</p></div><div class="cn-controls">
          <label>回测起始日<input id="cnBtStart" type="date" value="2020-01-02" min="2020-01-02"></label><label>初始本金（元）<input id="cnBtCapital" type="number" min="1" value="100000"></label><label>单边总交易成本（基点）<input id="cnBtFee" type="number" min="0" max="100" step="0.5" value="5"></label><button id="cnRunBt" class="cn-button primary">重新计算</button>
        </div></div><p id="cnBtError" class="cn-error cn-hidden" role="alert"></p><div id="cnKpis" class="cn-kpis"></div><p id="cnBtScope" class="cn-sub"></p>
        <div class="cn-chart"><canvas id="cnEqChart" role="img" aria-label="A股策略与60比40持有基准的净值曲线"></canvas></div><div class="cn-chart dd"><canvas id="cnDdChart" role="img" aria-label="A股策略历史回撤曲线"></canvas></div>
        <p class="cn-warning">分红按除息日即时再投总收益近似，支持任意碎股；未模拟整手、最低佣金或成交不足。费用为单边佣金与滑点合计，5基点＝0.05%。国债使用真实ETF历史行情，不是固定利息现金。历史回测不代表未来收益。</p>
        <p id="cnGaps" class="cn-sub" style="margin-top:12px"></p>
        </div>
      </section>
      <section id="cnLogsPanel" class="cn-hidden"><div class="cn-panel"><div class="cn-heading"><div><h3 class="cn-asset-name">历史信号变化</h3><p class="cn-sub">从2020年初空仓逐日推进；以下是信号日期，不是已成交的账户记录。</p></div><button id="cnExportLogs" class="cn-button">导出信号CSV</button></div><div class="cn-table-wrap" style="margin-top:16px"><table class="cn-table"><thead><tr><th>信号日</th><th>新触发事件</th><th>红利</th><th>创业板</th><th>国债</th><th>计划执行</th></tr></thead><tbody id="cnLogsBody"></tbody></table></div></div></section>
      <details class="cn-panel"><summary class="cn-rules-summary">策略规则与数据口径</summary>
        <h3 class="cn-asset-name">固定规则 · cn-60-40-v1</h3>
        <div class="cn-rule"><h3>红利低波512890 · 回归择时</h3><p>以前3、4、6个已结束月份的月末ETF收盘价计算M3/M4/M6，排除当月。B为三线中位数，H为最高值。</p><p>未持有且P＜0.97×B：启用60%预算；已持有且P＞1.06×H：退出，预算转国债。其余及等于门槛时沿用原状态。没有独立止损，持续下跌时可能一直持有。</p></div>
        <div class="cn-rule"><h3>创业板159915 · 趋势择时</h3><p>MA30为包含信号日收盘的最近30个有效报价交易日简单均线。未持有且P＞1.04×MA30：启用40%预算；已持有且P＜1.01×MA30：退出转国债。其余及等于门槛时保持。</p><p>使用ETF场内行情生成信号，不用创业板指数替代。</p></div>
        <div class="cn-rule"><h3>十年国债511260 · 预算承接</h3><p>国债没有独立择时规则，不替换成511520。股票预算独立，未启用部分转国债。任一股票信号改变时，下一交易日恢复全组合目标；没有变化时不每日再平衡。国债价格也会下跌。</p></div>
        <div class="cn-rule"><h3>历史延续与新启动</h3><p>历史延续从2020年首个交易日、两只股票均未持有开始逐日推进。今天全现金启动只检查今天的入场条件，不继承研究模型历史持仓。用户实际成交和账户持仓未知。</p></div>
        <div class="cn-rule"><h3>数据与成交口径</h3><p>原始场内收盘价来自新浪日线，并与腾讯盘后报价及昨收核对；分红拆分表来自东方财富。按历史事件逐日构建因果复权序列，门槛换算回当日原始报价单位。指标没有使用当月最终收盘或未来分红。</p><p>历史缺报日，该标的不生成新信号；回测仅按过去最近报价估值、不在缺报日成交，待全部报价有效才执行待调仓。回测为次日收盘总收益近似，绝不把同一收盘价确认并成交包装成可实现结果。</p><p>每天北京时间16:35由GitHub Actions尝试刷新。无新增确认交易日时保留原日期；数据失败保留上次快照，页面显示真实行情截止日，不冒充当天信号。自动任务可能延迟。</p><p id="cnSourceMeta" class="cn-sub"></p><a href="./data/cn_market_data.json" target="_blank" rel="noopener" style="color:#047857">查看公开行情与来源快照</a></div>
      </details>
    </div>`;

  function showPanel(next) {
    panel = next;
    for (const name of ['signal', 'backtest', 'logs']) {
      const suffix = name[0].toUpperCase() + name.slice(1);
      $('cn' + suffix + 'Panel').classList.toggle('cn-hidden', next !== name);
    }
    if (next === 'backtest' && result) runBacktest();
  }
  document.addEventListener('cn-panel', event => showPanel(event.detail));
  $('cnHistory').addEventListener('click', () => { scenario = 'history'; renderSignal(); });
  $('cnCold').addEventListener('click', () => { scenario = 'cold'; renderSignal(); });
  $('cnCapital').addEventListener('input', renderBudget);
  $('cnRunBt').addEventListener('click', runBacktest);

  function renderBudget() {
    if (!result) return;
    const targets = scenario === 'history' ? result.latest.targets : result.cold.targets;
    const value = Number($('cnCapital').value), valid = Number.isFinite(value) && value > 0;
    const classes = ['cn-red', 'cn-growth', 'cn-bond'];
    $('cnBudgetBar').innerHTML = CNStrategy.CODES.map((code, i) => `<div class="${classes[i]}" style="width:${targets[code] * 100}%"></div>`).join('');
    $('cnBudgetRows').innerHTML = CNStrategy.CODES.map((code, i) => `<div class="cn-budget-row"><span><span class="cn-dot ${classes[i]}"></span>${names[code]} ${code}</span><strong class="cn-number">${pct(targets[code], 0)} · ${valid ? money(value * targets[code]) : '请填写有效资金'}</strong></div>`).join('');
  }
  function renderSignal() {
    if (!result) return;
    const r = result.latest, state = scenario === 'history' ? r.state : result.cold.state;
    const changed = scenario === 'history' ? r.changed : result.cold.changed;
    $('cnHistory').setAttribute('aria-pressed', String(scenario === 'history'));
    $('cnCold').setAttribute('aria-pressed', String(scenario === 'cold'));
    $('cnScenarioLabel').textContent = scenario === 'history' ? '历史延续模型 · 已逐日继承状态' : '新资金情景 · 今天从全现金启动';
    $('cnStatus').textContent = scenario === 'history' ? changed ? '新触发：' + r.events.join('、') : '无新调仓信号' : '今日新启动：' + (state.red || state.growth ? '满足股票入场条件' : '股票均未触发入场');
    $('cnReason').textContent = scenario === 'history'
      ? `红利${state.red ? '继续持有' : '继续空仓'}；创业板${state.growth ? '继续持有' : '继续空仓'}。${changed ? '下一交易日按新状态恢复目标预算。' : '沿用原状态，今日不强制恢复比例。'}`
      : `红利${state.red ? '启用60%预算' : '不买入'}；创业板${state.growth ? '启用40%预算' : '不买入'}；剩余预算转国债。今日收盘条件用于下一交易日，不代表已经成交。`;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const age = Math.floor((Date.parse(day) - Date.parse(data.quoteDate)) / 86400000);
    $('cnDataDate').textContent = '已验证收盘 · ' + data.quoteDate;
    $('cnFreshness').textContent = `行情截至 ${data.quoteDate}（北京时间），上一可比交易日 ${result.previous.date}。${age > 0 ? '当前展示历史截止日，非今日实时信号；遇休市或更新延迟，待新快照确认。' : '盘后数据已核对。'}门槛随均线更新，不是永久挂单价。`;
    $('cnBanner').classList.toggle('warning', age > 0);
    const row = (label, value) => `<span>${label}</span><span class="cn-number">${number(value, 6)}</span>`;
    $('cnCards').innerHTML = CNStrategy.CODES.map(code => {
      const asset = data.assets[code], p = asset.close.at(-1), change = p / asset.close.at(-2) - 1;
      const held = code === '512890' ? state.red : code === '159915' ? state.growth : true;
      let values = code === '512890' ? row('M3 / 前3个完整月', r.m3) + row('M4 / 前4个完整月', r.m4) + row('M6 / 前6个完整月', r.m6) + row('买入：P严格低于', r.redBuy) + row('退出：P严格高于', r.redSell)
        : code === '159915' ? row('MA30 / 包含今日', r.ma30) + row('买入：P严格高于', r.growthBuy) + row('退出：P严格低于', r.growthSell)
        : '<span>固定预算承接</span><span>0%—100%</span><span>独立择时</span><span>无</span><span>黄金预算</span><span>本模块不含黄金</span>';
      const tag = code === '511260' ? '承接未启用预算' : (scenario === 'history' ? held ? '持有状态' : '空仓状态' : held ? '新入场条件满足' : '未触发入场');
      return `<article class="cn-panel"><h3 class="cn-asset-name">${names[code]} <span class="cn-sub">${code}</span></h3><div class="cn-price">¥${number(p)}</div><p class="cn-number ${change >= 0 ? 'cn-positive' : 'cn-negative'}">${change >= 0 ? '+' : ''}${pct(change)} <span class="cn-sub">较上一报价日</span></p><p class="cn-tag ${held ? '' : 'idle'}">${tag}</p><div class="cn-rule-values">${values}</div></article>`;
    }).join('');
    renderBudget();
  }
  function runBacktest() {
    if (!data) return;
    try {
      bt = CNStrategy.backtest(data, { start: $('cnBtStart').value, capital: Number($('cnBtCapital').value), feeBps: Number($('cnBtFee').value) });
      $('cnBtError').classList.add('cn-hidden');
      $('cnKpis').innerHTML = [['复合年化', pct(bt.cagr)], ['最大回撤', pct(bt.maxDD)], ['期末资产', money(bt.final)], ['调仓交易日', bt.trades.length]].map(([name, value]) => `<div class="cn-kpi"><span class="cn-sub">${name}</span><strong class="cn-number">${value}</strong></div>`).join('');
      $('cnBtScope').textContent = `${bt.start} — ${bt.end} · 初始本金${money(bt.capital)} · 单边成本${bt.feeBps}基点 · 累计费用${money(bt.totalFees)} · 基准：60%红利＋40%创业板买入持有。`;
      $('cnGaps').textContent = bt.missingQuoteDays.length ? `历史缺报日：${bt.missingQuoteDays.join('、')}。这些日期仅沿用过去最近报价估值，缺报标的保持信号，组合暂停成交；未填入虚构行情。` : '本回测区间没有历史缺报日。';
      drawCharts();
    } catch (e) { $('cnBtError').textContent = e.message; $('cnBtError').classList.remove('cn-hidden'); }
  }
  function drawCharts() {
    if (typeof Chart === 'undefined') { $('cnBtError').textContent = '图表库加载失败；上方数值仍为已计算结果，请刷新后重试。'; $('cnBtError').classList.remove('cn-hidden'); return; }
    if (eqChart) eqChart.destroy(); if (ddChart) ddChart.destroy();
    const step = Math.max(1, Math.floor(bt.curves.length / 400)), sample = bt.curves.filter((r, i) => i % step === 0 || i === bt.curves.length - 1);
    const options = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { font: { size: 13 } } } }, scales: { x: { ticks: { maxTicksLimit: 7 } }, y: { ticks: { callback: value => number(value, 0) } } } };
    eqChart = new Chart($('cnEqChart'), { type: 'line', data: { labels: sample.map(r => r.date), datasets: [
      { label: '双择时策略', data: sample.map(r => r.nav), borderColor: '#0d9488', borderWidth: 2, pointRadius: 0 },
      { label: '60∶40持有基准', data: sample.map(r => r.passive), borderColor: '#94a3b8', borderWidth: 1.5, pointRadius: 0 }] }, options });
    ddChart = new Chart($('cnDdChart'), { type: 'line', data: { labels: sample.map(r => r.date), datasets: [{ label: '历史回撤（%）', data: sample.map(r => r.drawdown * 100), borderColor: '#6366f1', backgroundColor: '#6366f115', fill: true, borderWidth: 1.5, pointRadius: 0 }] }, options });
  }
  function renderLogs() {
    const rows = result.history.filter(r => r.changed).slice().reverse();
    $('cnLogsBody').innerHTML = rows.map(r => `<tr><td class="cn-number">${r.date}</td><td>${r.events.join('、')}</td>${CNStrategy.CODES.map(c => `<td class="cn-number">${pct(r.targets[c], 0)}</td>`).join('')}<td>下一交易日</td></tr>`).join('');
  }
  $('cnExportLogs').addEventListener('click', () => {
    if (!result) return;
    const rows = [['signal_date', 'event', '512890_target', '159915_target', '511260_target', 'execution'], ...result.history.filter(r => r.changed).map(r => [r.date, r.events.join(' / '), ...CNStrategy.CODES.map(c => r.targets[c]), 'next_session'])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `cn-signals-${data.quoteDate}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  async function load() {
    try {
      const response = await fetch('./data/cn_market_data.json?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('A股行情文件加载失败，请稍后重试');
      data = await response.json(); result = CNStrategy.evaluate(data);
      $('cnBtStart').max = data.quoteDate;
      $('cnSourceMeta').textContent = `行情截止：${data.quoteDate}；快照生成：${new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）。原始来源地址与校验哈希随公开快照保存。`;
      renderSignal(); renderLogs(); $('cnLoading').classList.add('cn-hidden'); $('cnContent').classList.remove('cn-hidden');
      if (panel === 'backtest' && !root.classList.contains('hidden')) runBacktest();
    } catch (e) { $('cnLoading').classList.add('cn-hidden'); $('cnDataDate').textContent = '行情待核实'; $('cnError').textContent = e.message + '。不生成确定买卖结论。'; $('cnError').classList.remove('cn-hidden'); }
  }
  load();
})();
