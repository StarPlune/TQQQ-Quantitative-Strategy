"""Refresh public ETF exchange closes; publish only cross-checked, completed sessions.

No brokerage, private account data or outbound notifications. An invalid fetch never
replaces the last valid snapshot. --seed-dir accepts a previously verified public
quote snapshot for an auditable first installation.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs/data/cn_market_data.json"
TZ = dt.timezone(dt.timedelta(hours=8))
ASSETS = {"512890": "红利低波ETF", "159915": "创业板ETF", "511260": "十年国债ETF"}


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table = []
        if tag == "tr" and self.table is not None:
            self.row = []
        if tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_data(self, value):
        if self.cell is not None:
            self.cell += value

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        if tag == "tr" and self.row is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        if tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://fund.eastmoney.com/"})
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
    return raw, {"url": url, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sha256": hashlib.sha256(raw).hexdigest()}


def actions(tables):
    div_table = next((t for t in tables if t and any("除息日" in x for x in t[0])), None)
    split_table = next((t for t in tables if t and any("拆分折算日" in x for x in t[0])), None)
    if div_table is None or split_table is None:
        raise ValueError("分红拆分页面格式变化，需要人工核实")
    dividends, splits = [], []
    for row in div_table[1:]:
        if len(row) == 5 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[2]):
            dividends.append({"exDate": row[2], "payDate": row[4], "cashPerShare": float(re.findall(r"\d+(?:\.\d+)?", row[3])[-1]) / 10})
        elif not any("暂无分红" in x for x in row):
            raise ValueError("无法解析分红记录")
    for row in split_table[1:]:
        if len(row) == 4 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[1]):
            splits.append({"date": row[1], "ratio": float(row[3].split(":")[-1])})
        elif not any("暂无拆分" in x for x in row):
            raise ValueError("无法解析拆分记录")
    return {"dividends": dividends, "splits": splits}


def quote_map(raw):
    quotes = {}
    for line in raw.decode("gbk").splitlines():
        if '="' not in line:
            continue
        values = line.split('="', 1)[1].split('"', 1)[0].split("~")
        quotes[values[2]] = {"close": float(values[3]), "previousClose": float(values[4]), "time": values[30]}
    return quotes


def asset_payload(rows, tables, code, day):
    bars = sorted((r for r in rows if str(r.get("date", r.get("day")))[:10] <= day), key=lambda r: str(r.get("date", r.get("day"))))
    dates = [str(r.get("date", r.get("day")))[:10] for r in bars]
    return {"name": ASSETS[code], "dates": dates, "open": [float(r["open"]) for r in bars],
            "close": [float(r["close"]) for r in bars], "actions": actions(tables)}


def load_seed(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8-sig"))
    quotes = quote_map((folder / "tencent_close_quotes.txt").read_bytes())
    day = min(q["time"][:8] for c, q in quotes.items() if c in ASSETS)
    day = dt.datetime.strptime(day, "%Y%m%d").date().isoformat()
    assets = {}
    for code in ASSETS:
        with (folder / f"{code}_sina.csv").open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        tables = json.loads((folder / f"{code}_events_tables.json").read_text(encoding="utf-8"))
        assets[code] = asset_payload(rows, tables, code, day)
    sources = [{"provider": item["kind"], "code": item["code"], "url": item["url"], "fetchedAt": item["fetched_utc"], "sha256": item["sha256"]}
               for item in manifest["sources"] if item["code"] in ASSETS and item["kind"] in ("sina", "events")]
    qmeta = json.loads((folder / "tencent_close_quotes.json").read_text(encoding="utf-8"))
    sources.append({"provider": "tencent", "url": qmeta["url"], "fetchedAt": qmeta["fetched_utc"], "sha256": qmeta["sha256"]})
    return day, assets, quotes, sources


def load_live(now):
    tasks = {}
    for code in ASSETS:
        symbol = ("sz" if code.startswith("15") else "sh") + code
        tasks[(code, "sina")] = f"https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=8000"
        tasks[(code, "events")] = f"https://fundf10.eastmoney.com/fhsp_{code}.html"
    tasks[("all", "tencent")] = "https://qt.gtimg.cn/q=sh512890,sz159915,sh511260"
    fetched = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        futures = {pool.submit(fetch, url): key for key, url in tasks.items()}
        for future in concurrent.futures.as_completed(futures):
            fetched[futures[future]] = future.result()
    quotes = quote_map(fetched[("all", "tencent")][0])
    days = {q["time"][:8] for c, q in quotes.items() if c in ASSETS}
    if len(days) != 1:
        raise ValueError("腾讯报价日期不同步")
    day = dt.datetime.strptime(days.pop(), "%Y%m%d").date().isoformat()
    if day > now.date().isoformat():
        raise ValueError("报价日期在未来")
    assets, sources = {}, []
    for code in ASSETS:
        rows = json.loads(fetched[(code, "sina")][0])
        parser = Tables()
        parser.feed(fetched[(code, "events")][0].decode("utf-8", errors="replace"))
        assets[code] = asset_payload(rows, parser.tables, code, day)
    for (code, kind), (_, meta) in fetched.items():
        sources.append({"code": code, "provider": kind, **meta})
    return day, assets, quotes, sources


def make_payload(day, assets, quotes, sources):
    for code in ASSETS:
        asset, quote = assets[code], quotes[code]
        if asset["dates"][-1] != day or quote["time"][:8] != day.replace("-", "") or quote["time"][8:] < "150000":
            raise ValueError(f"{code} 缺少当日确认收盘")
        if abs(asset["close"][-1] - quote["close"]) > 1e-9 or abs(asset["close"][-2] - quote["previousClose"]) > 1e-9:
            raise ValueError(f"{code} 新浪与腾讯报价不一致")
    return {"schemaVersion": 1, "strategyId": "cn-60-40-v1", "quoteDate": day, "confirmedClose": True,
            "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "assets": assets, "sources": sources,
            "quality": {"closeCrossCheck": "sina_tencent_matched_all_three", "corporateActions": "eastmoney_fhsp",
                        "scope": "public_exchange_prices_only", "timezone": "Asia/Shanghai"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed-dir", type=Path)
    args = parser.parse_args()
    now = dt.datetime.now(TZ)
    if not args.seed_dir and (now.weekday() >= 5 or now.hour < 15 or now.hour == 15 and now.minute < 10):
        print("非盘后更新时间，保留已验证快照")
        return
    day, assets, quotes, sources = load_seed(args.seed_dir) if args.seed_dir else load_live(now)
    payload = make_payload(day, assets, quotes, sources)
    if DEST.exists():
        previous = json.loads(DEST.read_text(encoding="utf-8"))
        if day < previous["quoteDate"]:
            raise ValueError("数据源倒退；保留原快照")
        if not args.seed_dir and day < now.date().isoformat():
            print(f"无新增确认交易日（可能休市或数据延迟），保留 {previous['quoteDate']}；不冒充今日信号")
            return
        # Historical revisions must be explained by a reviewed action, not silently accepted.
        for code in ASSETS:
            old = previous["assets"][code]
            prior = dict(zip(old["dates"], old["close"]))
            for date, price in zip(assets[code]["dates"], assets[code]["close"]):
                if date in prior and abs(prior[date] - price) > 1e-9:
                    raise ValueError(f"{code} 历史报价被改写：{date}；需要人工核实")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=DEST.parent, suffix=".json", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        # The same pure engine runs on the website, under Node in CI, and in tests.
        completed = subprocess.run(["node", str(ROOT / "scripts/check_cn_data.cjs"), str(temporary)], capture_output=True, text=True, encoding="utf-8")
        if completed.returncode:
            raise ValueError(completed.stderr.strip() or "策略计算校验失败")
        print(completed.stdout.strip())
        temporary.replace(DEST)
        print(f"已发布已验证公开行情快照：{day}")
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"A股行情更新失败，上一快照保留：{exc}", file=sys.stderr)
        sys.exit(1)
