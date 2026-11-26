# 个人量化交易工作台（全自动更新版）

一套基于 **GitHub Pages** 的个人量化工作台，包含原有美股轮动与新增的 **A股红利低波＋创业板＋十年国债** 模块。

## A股双择时（60∶40）

在每日信号驾驶舱、策略回测实验室或换仓日志页内选择美股或A股策略。切换页面时保留所选策略。直接入口：[A股每日信号驾驶舱](https://starplune.github.io/TQQQ-Quantitative-Strategy/#cn)。三只ETF为512890、159915、511260，不包含黄金。

- 红利预算60%：此前3/4/6个已结束月份的月末ETF收盘价计算均线；空仓时低于三线中位数3%入场，持有时高于最高线6%退出，无独立止损。
- 创业板预算40%：ETF收盘价与含当天的MA30比较；空仓时高于4%入场，持有时低于上方1%线退出。
- 股票信号独立，未启用预算转511260。严格不等号，等于门槛保持；信号改变后下一交易日恢复目标比例，其余日允许漂移。
- “历史延续”从2020年初空仓逐日推进；“今日全现金启动”只用当日入场条件，两者不冒充实际账户持仓。
- 信号总览、人民币预算估算、可选起始日期的回测、调仓信号日志与CSV导出。回测按次日收盘成交、因果复权总收益近似计账，默认单边总成本5基点；支持碎股，不模拟最低佣金。历史缺报日不生成该标的新信号、不成交，仅沿用过去报价估值。

### 数据与自动更新

`docs/data/cn_market_data.json` 保存原始场内价格、分红拆分事件、公开来源与哈希。新浪日线须与腾讯当日收盘及昨收一致；东方财富用于分红拆分。未同步、未收盘或校验失败时，不覆盖上一份快照。没有当日行情时保持真实截止日期。

`.github/workflows/cn-daily-update.yml` 于工作日北京时间16:35尝试更新，可手动运行 **A-share ETF close update**。GitHub定时任务可能延迟；休市或无新确认行情时保留原日期。Pages继续使用main分支的`/docs`目录。

```sh
node --test tests/cn-strategy.test.cjs
node scripts/check_cn_data.cjs
python scripts/update_cn_data.py
python -m http.server 8765 --directory docs
```

本地网页打开 `http://localhost:8765/#cn`。A股更新脚本只使用Python标准库及Node 20+，不依赖yfinance；美股原有脚本仍使用下方requirements。新模块不连接券商、不执行交易，也不调用原有消息推送。

## 目录结构

- `docs/index.html`：前端图形化工作台（自动加载最新 `docs/data/market_data.json`，含每日信号驾驶舱、交互式回测实验室、换仓日志）
- `docs/data/market_data.json`：已预置 1999-03-10 至 2026-11-25 完整历史日线（6,952 个交易日）
- `scripts/update_data.py`：每日自动拉取 QQQ / TQQQ 最新收盘价、校验异常值、更新 JSON 并计算当日持仓信号
- `docs/js/cn-strategy.js`：A股共享纯计算引擎（网页、校验及测试使用同一规则）
- `docs/js/cn-dashboard.js`、`docs/css/cn-dashboard.css`：A股图形化模块
- `scripts/update_cn_data.py`：A股盘后公开行情更新与原子发布
- `.github/workflows/cn-daily-update.yml`：A股定时更新工作流；原有美股`update_data.py`可单独运行，仓库初始未包含README旧版提到的美股工作流

## 5 分钟上线步骤

1. **新建 GitHub 仓库**：登录 GitHub 创建一个新仓库（Public 可免费直接用 GitHub Pages）。
2. **上传全部文件**：解压本压缩包，将所有文件（含 `.github/` 隐藏目录）推送或上传到仓库根目录。
3. **开启 GitHub Pages**：进入仓库 `Settings -> Pages`，Source 选择 `Deploy from a branch`，Branch 选 `main` 且目录选 `/docs`，保存后等待 1 分钟即可获得你的专属网址。
4. **开启定时任务写入权限**：进入 `Settings -> Actions -> General`，在 `Workflow permissions` 下勾选 `Read and write permissions` 并保存。
5. **手动测试A股更新**：进入仓库 `Actions` 标签页，点击 `A-share ETF close update` -> `Run workflow`，运行成功后A股网页同步已确认收盘行情。

## 可选：开启手机每日信号推送

进入仓库 `Settings -> Secrets and variables -> Actions`，按需添加以下 Secrets（不配也能正常更新网页）：

- **Telegram 推送**：添加 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`
- **自定义 Webhook（如飞书 / 钉钉 / 企业微信 / Discord）**：添加 `WEBHOOK_URL`
