"""Временная проверка источников данных с серверов GitHub. Результат — probe/out.json (ключи вырезаны)."""
import json
import os
import re
import time
import urllib.request
import urllib.error
from datetime import date, timedelta

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FH = os.environ.get("FINNHUB_API_KEY", "").strip()
EOD = os.environ.get("EODHD_API_KEY", "").strip()
SEC_UA = os.environ.get("SEC_USER_AGENT", "").strip() or "EconNews research bot econnews@example.com"
SECRETS = [s for s in (FH, EOD) if s]
today = date.today()


def redact(s):
    for k in SECRETS:
        s = s.replace(k, "***")
    return s


def get(url, headers=None, timeout=30):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, body, r.headers.get("content-type", ""), time.time() - t
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:2000], e.headers.get("content-type", ""), time.time() - t
    except Exception as e:
        return -1, repr(e).encode(), "", time.time() - t


def summarize(body, ctype, sample=1500):
    out = {"bytes": len(body)}
    text = body.decode("utf-8", "replace")
    try:
        j = json.loads(text)
        if isinstance(j, dict):
            out["keys"] = list(j.keys())[:60]
        elif isinstance(j, list):
            out["len"] = len(j)
            if j and isinstance(j[0], dict):
                out["item_keys"] = list(j[0].keys())[:60]
        out["sample"] = redact(json.dumps(j, ensure_ascii=False)[:sample])
    except Exception:
        out["sample"] = redact(text[:sample])
    return out


R = {}


def probe(name, url, headers=None, sample=1500, extra=None):
    code, body, ctype, dt = get(url, headers)
    rec = {"url": redact(url), "status": code, "ctype": ctype, "sec": round(dt, 2)}
    rec.update(summarize(body, ctype, sample))
    if extra and code == 200:
        try:
            rec["extra"] = extra(body)
        except Exception as e:
            rec["extra_error"] = repr(e)
    R[name] = rec
    print(name, code, rec.get("bytes"), round(dt, 2))
    return code, body


def jl(b):
    return json.loads(b.decode("utf-8"))


# ---------------- Yahoo ----------------
probe("yahoo_chart_aapl_1y", "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d", sample=600,
      extra=lambda b: {"n": len(jl(b)["chart"]["result"][0]["timestamp"]), "meta": jl(b)["chart"]["result"][0]["meta"]})
probe("yahoo_spark_batch", "https://query1.finance.yahoo.com/v7/finance/spark?symbols=AAPL,MSFT,NVDA&range=1d&interval=5m", sample=800)
probe("yahoo_spark_batch_v8", "https://query1.finance.yahoo.com/v8/finance/spark?symbols=AAPL,MSFT,NVDA&range=5d&interval=1d", sample=800)
probe("yahoo_quote_v7", "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT", sample=400)
for s in ["ZQ=F", "ZQX26.CBT", "ZQZ26.CBT", "ZQF27.CBT", "ZQG27.CBT", "ZQH27.CBT"]:
    probe("yahoo_fut_" + s, "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.request.quote(s) + "?range=5d&interval=1d", sample=300,
          extra=lambda b: {k: jl(b)["chart"]["result"][0]["meta"].get(k) for k in ("symbol", "regularMarketPrice", "shortName", "longName", "expireDate", "exchangeName")})

# ---------------- Finnhub ----------------
if FH:
    B = "https://finnhub.io/api/v1"
    fr, to = (today - timedelta(days=10)).isoformat(), today.isoformat()
    probe("fh_quote", f"{B}/quote?symbol=AAPL&token={FH}")
    probe("fh_profile2", f"{B}/stock/profile2?symbol=AAPL&token={FH}")
    probe("fh_metric", f"{B}/stock/metric?symbol=AAPL&metric=all&token={FH}", sample=300,
          extra=lambda b: {"metric_keys": sorted(jl(b).get("metric", {}).keys()),
                           "metric": jl(b).get("metric", {}),
                           "annual_keys": sorted((jl(b).get("series", {}).get("annual") or {}).keys()),
                           "quarterly_keys": sorted((jl(b).get("series", {}).get("quarterly") or {}).keys()),
                           "annual_eps": (jl(b).get("series", {}).get("annual") or {}).get("eps", [])[:6],
                           "quarterly_eps": (jl(b).get("series", {}).get("quarterly") or {}).get("eps", [])[:6]})
    probe("fh_recommendation", f"{B}/stock/recommendation?symbol=AAPL&token={FH}", sample=600)
    probe("fh_earnings", f"{B}/stock/earnings?symbol=AAPL&limit=8&token={FH}", sample=1200)
    probe("fh_cal_earnings", f"{B}/calendar/earnings?from={today.isoformat()}&to={(today + timedelta(days=14)).isoformat()}&token={FH}", sample=1200,
          extra=lambda b: {"n": len(jl(b).get("earningsCalendar", []))})
    probe("fh_cal_earnings_sym", f"{B}/calendar/earnings?from={today.isoformat()}&to={(today + timedelta(days=120)).isoformat()}&symbol=AAPL&token={FH}", sample=800)
    probe("fh_company_news", f"{B}/company-news?symbol=AAPL&from={fr}&to={to}&token={FH}", sample=1200,
          extra=lambda b: {"n": len(jl(b))})
    probe("fh_peers", f"{B}/stock/peers?symbol=AAPL&token={FH}")
    probe("fh_price_target", f"{B}/stock/price-target?symbol=AAPL&token={FH}")
    probe("fh_candle", f"{B}/stock/candle?symbol=AAPL&resolution=D&from={int(time.time()) - 86400 * 30}&to={int(time.time())}&token={FH}", sample=300)
    probe("fh_fin_reported", f"{B}/stock/financials-reported?symbol=AAPL&freq=quarterly&token={FH}", sample=300)
    probe("fh_insider_tx", f"{B}/stock/insider-transactions?symbol=AAPL&token={FH}", sample=600)
    probe("fh_ownership", f"{B}/stock/ownership?symbol=AAPL&limit=10&token={FH}", sample=600)
    probe("fh_fund_ownership", f"{B}/stock/fund-ownership?symbol=AAPL&limit=10&token={FH}", sample=300)
    probe("fh_search", f"{B}/search?q=apple&token={FH}", sample=600)
    probe("fh_eps_estimate", f"{B}/stock/eps-estimate?symbol=AAPL&freq=quarterly&token={FH}", sample=300)
    probe("fh_dividend", f"{B}/stock/dividend?symbol=AAPL&from=2024-01-01&to={to}&token={FH}", sample=300)
    probe("fh_profile2_moex", f"{B}/stock/profile2?symbol=SBER.ME&token={FH}", sample=300)
    probe("fh_market_status", f"{B}/stock/market-status?exchange=US&token={FH}", sample=300)
else:
    R["finnhub"] = "no key"

# ---------------- EODHD (платный ключ владельца) ----------------
if EOD:
    probe("eod_fund_general", f"https://eodhd.com/api/fundamentals/AAPL.US?filter=General::Name,General::Sector&api_token={EOD}&fmt=json", sample=400)
    probe("eod_fund_holders", f"https://eodhd.com/api/fundamentals/AAPL.US?filter=Holders&api_token={EOD}&fmt=json", sample=600)
    probe("eod_eod_hist", f"https://eodhd.com/api/eod/AAPL.US?from={(today - timedelta(days=10)).isoformat()}&api_token={EOD}&fmt=json", sample=400)
    probe("eod_user", f"https://eodhd.com/api/user?api_token={EOD}", sample=600)
else:
    R["eodhd"] = "no key"

# ---------------- SEC ----------------
sec_h = {"User-Agent": SEC_UA, "Accept-Encoding": "identity"}
probe("sec_company_tickers", "https://www.sec.gov/files/company_tickers.json", headers=sec_h, sample=300)


def facts_extra(b):
    j = jl(b)
    g = j.get("facts", {}).get("us-gaap", {})
    out = {"n_concepts": len(g)}
    for c in ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss", "EarningsPerShareDiluted",
              "OperatingIncomeLoss", "NetCashProvidedByUsedInOperatingActivities", "PaymentsToAcquirePropertyPlantAndEquipment",
              "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt", "LongTermDebtNoncurrent", "StockholdersEquity", "GrossProfit"]:
        if c in g:
            units = g[c]["units"]
            u = list(units.keys())[0]
            out[c] = {"unit": u, "n": len(units[u]), "last": units[u][-3:]}
    return out


probe("sec_companyfacts_aapl", "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", headers=sec_h, sample=200, extra=facts_extra)

# ---------------- Кривые доходности ----------------
ym = today.strftime("%Y%m")
probe("ust_curve_csv", f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{today.year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={today.year}&page&_format=csv", sample=800)
probe("ust_curve_csv_month", f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/{ym}?type=daily_treasury_yield_curve&field_tdr_date_value_month={ym}&page&_format=csv", sample=800)
probe("ecb_yc", "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M+SR_1Y+SR_2Y+SR_5Y+SR_10Y+SR_30Y?lastNObservations=3&format=csvdata", sample=1500)
probe("mof_jgb", "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv", sample=900)
probe("moex_zcyc", "https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off", sample=1500)
probe("boe_iadb", "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Sep/2026&Dateto=now&SeriesCodes=IUDSNZC,IUDMNZC,IUDLNZC&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N", sample=800)
probe("bund_bbk", "https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A?lastNObservations=3&format=csv", sample=800)

# ---------------- Ставки центробанков и ФРС ----------------
probe("bis_cbpol_v1", "https://stats.bis.org/api/v1/data/WS_CBPOL/D.US+XM+GB+JP+RU/all?lastNObservations=2&format=csv", sample=1500)
probe("bis_cbpol_v2", "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.US+XM+GB+JP+RU?lastNObservations=2&format=csv", sample=1500)
probe("nyfed_effr", "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json", sample=800)
probe("fomc_calendar", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", sample=200,
      extra=lambda b: {"snippets": re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.{0,200}?fomc-meeting__date[^>]*>([^<]+)<',
                                              b.decode("utf-8", "replace"), re.S)[:20]})
probe("cbr_keyrate", "https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=01.09.2026&UniDbQuery.To=15.10.2026", sample=300,
      extra=lambda b: {"rows": re.findall(r"<td>(\d\d\.\d\d\.\d{4})</td>\s*<td>([\d,]+)</td>", b.decode("utf-8", "replace"))[:5]})

# ---------------- История цен: запасные источники ----------------
probe("stooq_aapl", "https://stooq.com/q/d/l/?s=aapl.us&i=d", sample=300)
probe("coingecko_simple", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true", sample=300)
probe("moex_sber", "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/SBER.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,PREVPRICE,LOTSIZE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE", sample=600)
probe("gtranslate", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=" + urllib.request.quote("Apple beats earnings\nNvidia shares fall"), sample=400)

os.makedirs("probe", exist_ok=True)
with open("probe/out.json", "w", encoding="utf-8") as f:
    json.dump(R, f, ensure_ascii=False, indent=1)
print("done", len(R))
