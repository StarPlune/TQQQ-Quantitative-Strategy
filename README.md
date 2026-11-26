# 个人量化交易工作台（全自动更新版）

一套零服务器成本、基于 **GitHub Pages + GitHub Actions** 自动更新的个人美股 ETF（TQQQ / QQQ / 短期美债 SGOV·BIL）量化看板与信号系统。

## 目录结构

- `docs/index.html`：前端图形化工作台（自动加载最新 `docs/data/market_data.json`，含每日信号驾驶舱、交互式回测实验室、换仓日志）
- `docs/data/market_data.json`：已预置 1999-03-10 至 2026-11-25 完整历史日线（6,952 个交易日）
- `scripts/update_data.py`：每日自动拉取 QQQ / TQQQ 最新收盘价、校验异常值、更新 JSON 并计算当日持仓信号
- `.github/workflows/daily-update.yml`：GitHub Actions 定时任务（美东时间每个交易日 15:50 尾盘预估 + 16:15 盘后确认）

## 5 分钟上线步骤

1. **新建 GitHub 仓库**：登录 GitHub 创建一个新仓库（Public 可免费直接用 GitHub Pages）。
2. **上传全部文件**：解压本压缩包，将所有文件（含 `.github/` 隐藏目录）推送或上传到仓库根目录。
3. **开启 GitHub Pages**：进入仓库 `Settings -> Pages`，Source 选择 `Deploy from a branch`，Branch 选 `main` 且目录选 `/docs`，保存后等待 1 分钟即可获得你的专属网址。
4. **开启定时任务写入权限**：进入 `Settings -> Actions -> General`，在 `Workflow permissions` 下勾选 `Read and write permissions` 并保存。
5. **手动测试一次**：进入仓库 `Actions` 标签页，点击 `Daily Quant Data & Signal Update` -> `Run workflow`，运行成功后网页即自动同步最新收盘行情。

## 可选：开启手机每日信号推送

进入仓库 `Settings -> Secrets and variables -> Actions`，按需添加以下 Secrets（不配也能正常更新网页）：

- **Telegram 推送**：添加 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`
- **自定义 Webhook（如飞书 / 钉钉 / 企业微信 / Discord）**：添加 `WEBHOOK_URL`
