"""Daily automated market data updater & signal notifier for GitHub Actions."""
import datetime
import json
import math
import os
import sys
import numpy as np
import pandas as pd
import requests
import yfinance as yf

DATA_PATH = os.path.join("docs", "data", "market_data.json")

# Strategy parameters (Preferred: No-Patch + 30%/26% Hysteresis)
EMA_FAST, EMA_MID, EMA_SLOW = 5, 15, 30
VOL_HI, VOL_LO = 0.30, 0.26


def fetch_latest_prices(start_date: str):
    """Fetch recent adjusted closes for QQQ and TQQQ via yfinance."""
    df = yf.download(["QQQ", "TQQQ"], start=start_date, auto_adjust=True, progress=False)
    if df.empty:
        return pd.DataFrame()
    close = df["Close"] if "Close" in df else df
    close = close[["QQQ", "TQQQ"]].dropna()
    close.index = pd.to_datetime(close.index).strftime("%Y-%m-%d")
    return close


def compute_signal(dates, qqq_list, tqqq_list):
    """Run exact state machine over full history and return latest signal dict."""
    qqq = np.array(qqq_list, dtype=float)
    tqqq = np.array(tqqq_list, dtype=float)
    n = len(dates)

    rq = np.zeros(n)
    rq[1:] = qqq[1:] / qqq[:-1] - 1.0
    vol20 = pd.Series(rq).rolling(20).std(ddof=1).values * math.sqrt(252)

    s_t = pd.Series(tqqq)
    e_f = s_t.ewm(span=EMA_FAST, adjust=False).mean().values
    e_m = s_t.ewm(span=EMA_MID, adjust=False).mean().values
    e_s = s_t.ewm(span=EMA_SLOW, adjust=False).mean().values

    ema_pos = 0
    in_hv = False
    asset = "QQQ"
    prev_asset = "QQQ"

    for i in range(1, n):
        prev_asset = asset
        if ema_pos == 0 and e_f[i - 1] <= e_m[i - 1] and e_f[i] > e_m[i]:
            ema_pos = 1
        elif ema_pos == 1 and e_f[i - 1] >= e_s[i - 1] and e_f[i] < e_s[i]:
            ema_pos = 0

        vm = vol20[i]
        if not np.isnan(vm):
            if not in_hv and vm >= VOL_HI:
                in_hv = True
            elif in_hv and vm < VOL_LO:
                in_hv = False

        asset = "TBILL" if in_hv else ("TQQQ" if ema_pos == 1 else "QQQ")

    return {
        "date": dates[-1],
        "qqq": float(qqq[-1]),
        "tqqq": float(tqqq[-1]),
        "vol20_pct": round(float(vol20[-1]) * 100.0, 2),
        "asset": asset,
        "prev_asset": prev_asset,
        "switched": asset != prev_asset,
    }


def send_notifications(sig: dict):
    """Optional Telegram or generic Webhook notification via GitHub Secrets."""
    action = f"【触发换仓】{sig['prev_asset']} -> {sig['asset']}" if sig["switched"] else f"维持持仓：{sig['asset']}"
    msg = (
        f"📊 量化日报 ({sig['date']})\n"
        f"{action}\n"
        f"QQQ: ${sig['qqq']:.2f} | TQQQ: ${sig['tqqq']:.2f}\n"
        f"QQQ 20日年化波动率: {sig['vol20_pct']:.1f}%"
    )
    print(msg)

    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    tg_chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if tg_token and tg_chat:
        try:
            requests.post(
                f"https://api.telegram.org/bot{tg_token}/sendMessage",
                json={"chat_id": tg_chat, "text": msg},
                timeout=15,
            )
            print("Telegram notification sent.")
        except Exception as exc:
            print(f"Telegram notify failed: {exc}", file=sys.stderr)

    webhook = os.environ.get("WEBHOOK_URL", "").strip()
    if webhook:
        try:
            requests.post(webhook, json={"text": msg, "content": msg, "signal": sig}, timeout=15)
            print("Webhook notification sent.")
        except Exception as exc:
            print(f"Webhook notify failed: {exc}", file=sys.stderr)


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    last_date = data["dates"][-1]
    # Look back 7 days to ensure we catch any missed days cleanly
    start_dt = (datetime.date.fromisoformat(last_date) - datetime.timedelta(days=7)).isoformat()
    recent = fetch_latest_prices(start_dt)

    added = 0
    for dt_str, row in recent.iterrows():
        q_val = round(float(row["QQQ"]), 2)
        t_val = round(float(row["TQQQ"]), 2)
        if not (q_val > 0 and t_val > 0):
            continue
        # Basic sanity check against bad feed spikes (>50% single-day QQQ jump)
        prev_q = data["qqq"][-1]
        if abs(q_val / prev_q - 1.0) > 0.50:
            print(f"Skipping suspicious quote on {dt_str}: QQQ={q_val} vs prev={prev_q}")
            continue

        if dt_str > data["dates"][-1]:
            data["dates"].append(dt_str)
            data["qqq"].append(q_val)
            data["tqqq"].append(t_val)
            data["tqqqLive"].append(t_val)
            added += 1
        elif dt_str == data["dates"][-1]:
            # Refresh intraday/close quote for latest trading day
            data["qqq"][-1] = q_val
            data["tqqq"][-1] = t_val
            data["tqqqLive"][-1] = t_val

    data["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"Data update complete: +{added} new day(s), latest={data['dates'][-1]}")
    sig = compute_signal(data["dates"], data["qqq"], data["tqqq"])
    send_notifications(sig)


if __name__ == "__main__":
    main()
