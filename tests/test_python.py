import json
import math
import os
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import ai          # noqa: E402
import ipo         # noqa: E402
import rates       # noqa: E402
import stocks      # noqa: E402

FX = os.path.join(HERE, "fixtures")


def fx(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return f.read()


class UsQuotesOnTheSite(unittest.TestCase):

    def test_us_panel_tickers_are_in_the_bot_data(self):
        import re
        import market
        with open(os.path.join(os.path.dirname(HERE), "docs", "terminal", "index.html"), encoding="utf-8") as f:
            html = f.read()
        group = re.search(r"\{code:'US', ids:\[([^\]]+)\]\}", html).group(1)
        panel = re.findall(r"'([A-Z]+)'", group)
        self.assertEqual(len(panel), 11)
        by = {i["short"]: i for i in market.INSTRUMENTS}
        for s in panel:
            self.assertIn(s, by, s)
            self.assertEqual(by[s]["sym"], s)
            self.assertTrue(by[s].get("terminal"), "terminal only: not on the Markets page, not in the picture")
            self.assertFalse(by[s].get("chart", True))

    def test_to_json_marks_them_terminal_only(self):
        import market
        inst = next(i for i in market.INSTRUMENTS if i["short"] == "SPY")
        t0 = datetime(2026, 11, 5, 14, 30, tzinfo=timezone.utc)
        q = {**inst, "price": 738.03, "change": 0.69, "period": "5 дней",
             "series": [(t0, 733.0), (t0 + timedelta(days=1), 738.03)]}
        item = market.to_json([q])[0]
        self.assertEqual((item["id"], item["value"], item["digits"], item["prefix"]), ("SPY", 738.03, 2, "$"))
        self.assertTrue(item["terminal"])
        self.assertEqual(item["price"], "$738,03")


class TickerTagging(unittest.TestCase):
    def test_english_and_russian_names(self):
        self.assertEqual(stocks.tickers_in("Apple beats estimates as iPhone sales jump"), ["AAPL"])
        self.assertEqual(stocks.tickers_in("Акции Теслы упали после отчёта"), ["TSLA"])
        self.assertEqual(stocks.tickers_in("Сбербанк отчитался о росте прибыли"), ["MOEX:SBER"])
        self.assertIn("NVDA", stocks.tickers_in("Nvidia and Microsoft lead tech rally"))
        self.assertIn("MSFT", stocks.tickers_in("Nvidia and Microsoft lead tech rally"))

    def test_explicit_cashtag(self):
        self.assertEqual(stocks.tickers_in("Shares of $JPM rose"), ["JPM"])
        self.assertEqual(stocks.tickers_in("Deal announced (NYSE: XOM)"), ["XOM"])

    def test_no_false_positives(self):
        self.assertEqual(stocks.tickers_in("Visa rules for travelers tightened"), [])
        self.assertEqual(stocks.tickers_in("Inflation target missed again"), [])
        self.assertEqual(stocks.tickers_in("Applesauce prices"), [])
        self.assertEqual(stocks.tickers_in("Магнитная буря ожидается в выходные"), [])
        self.assertEqual(stocks.tickers_in("Сберегательный сертификат"), [])
        self.assertEqual(stocks.tickers_in("Акции Норникеля и Газпрома выросли"), ["MOEX:GAZP", "MOEX:GMKN"])
        self.assertEqual(stocks.tickers_in(""), [])

    def test_direction(self):
        self.assertEqual(stocks.direction("Nvidia shares surge after record revenue"), 1)
        self.assertEqual(stocks.direction("Boeing shares plunge after recall"), -1)
        self.assertEqual(stocks.direction("Apple to hold event on Tuesday"), 0)


class StocksParsing(unittest.TestCase):
    def test_parse_spark(self):
        payload = {"spark": {"result": [
            {"symbol": "AAPL", "response": [{"meta": {"regularMarketPrice": 342.96, "regularMarketChangePercent": 0.495,
                                                       "fiftyTwoWeekHigh": 348.15, "fiftyTwoWeekLow": 243.42,
                                                       "regularMarketVolume": 49799638, "previousClose": 341.27}}]},
            {"symbol": "BRK-B", "response": [{"meta": {"regularMarketPrice": 480.0, "chartPreviousClose": 500.0}}]},
            {"symbol": "BAD", "response": []},
        ]}}
        out = stocks.parse_spark(payload)
        self.assertEqual(out["AAPL"]["px"], 342.96)
        self.assertAlmostEqual(out["AAPL"]["ch"], 0.495)
        self.assertIn("BRK.B", out)
        self.assertAlmostEqual(out["BRK.B"]["ch"], -4.0)
        self.assertNotIn("BAD", out)

    def test_parse_metric_real_sample(self):
        m = stocks.parse_metric(json.loads(fx("finnhub_metric.json")))
        self.assertGreater(m["mcap"], 1_000_000)
        self.assertAlmostEqual(m["pe"], 38.83, places=1)
        self.assertAlmostEqual(m["dy"], 0.505, places=2)
        self.assertIn("beta", m)
        self.assertIn("r52", m)

    def test_parse_earnings_calendar(self):
        payload = {"earningsCalendar": [
            {"symbol": "AAP", "date": "2026-10-28", "hour": "", "epsEstimate": 0.8, "revenueEstimate": 2e9},
            {"symbol": "AAPL", "date": "2026-11-02", "hour": "amc", "quarter": 4, "year": 2026, "epsEstimate": 2.0214,
             "epsActual": None, "revenueEstimate": 115327453620, "revenueActual": None},
            {"symbol": "MSFT", "date": "2026-10-28", "hour": "amc", "epsEstimate": 3.9, "revenueEstimate": 8e10},
            {"symbol": "JPM", "date": "2026-10-28", "hour": "bmo", "epsEstimate": 5.1, "revenueEstimate": 4.5e10},
        ]}
        out = stocks.parse_earnings_calendar(payload, set(stocks.BY_TICKER))
        self.assertEqual([x["s"] for x in out], ["JPM", "MSFT", "AAPL"])
        self.assertEqual(out[2]["n"], "Apple")
        self.assertEqual(out[2]["rev_e"], 115327453620)

    def test_earnings_calendar_split_when_cut_off(self):
        def get(a, b):
            days = (date.fromisoformat(b) - date.fromisoformat(a)).days + 1
            rows = [{"symbol": "JPM", "date": "2026-10-13"}] if a <= "2026-10-13" <= b else []
            rows += [{"symbol": "AAPL", "date": "2026-11-02"}] if a <= "2026-11-02" <= b else []
            rows += [{"symbol": "ZZZ", "date": b}] * (60 * days)
            if len(rows) > stocks.FH_CALENDAR_CAP:
                rows = sorted(rows, key=lambda r: r["date"])[-stocks.FH_CALENDAR_CAP:]
            return {"earningsCalendar": rows}
        out = stocks.fetch_earnings("k", date(2026, 10, 15), get=get)
        self.assertEqual([x["s"] for x in out], ["JPM", "AAPL"])

    def test_universe_is_consistent(self):
        tickers = [t for t, *_ in stocks.UNIVERSE]
        self.assertEqual(len(tickers), len(set(tickers)))
        self.assertGreaterEqual(len(tickers), 100)
        for t, n, sec, en, ru in stocks.UNIVERSE:
            self.assertTrue(n and sec)

    def test_sectors_summary_weighted(self):
        rows = [{"sec": "A", "ch": 2.0, "mcap": 300}, {"sec": "A", "ch": -1.0, "mcap": 100}, {"sec": "B", "ch": 1.0, "mcap": 50},
                {"sec": "B", "ch": None, "mcap": 50}]
        out = {s["sec"]: s for s in stocks.sectors_summary(rows)}
        self.assertAlmostEqual(out["A"]["ch"], 1.25)
        self.assertEqual(out["B"]["n"], 1)


def fact(start, end, val, form="10-Q", fp="Q1", filed="2026-01-01"):
    f = {"end": end, "val": val, "form": form, "fp": fp, "filed": filed}
    if start:
        f["start"] = start
    return f


class SecFinancials(unittest.TestCase):
    def facts(self):
        rev = [fact("2024-10-01", "2025-09-30", 400, "10-K", "FY", "2025-11-01"),
               fact("2024-10-01", "2024-12-31", 120), fact("2025-01-01", "2025-03-31", 90),
               fact("2025-04-01", "2025-06-30", 95),
               fact("2025-10-01", "2025-12-31", 130, filed="2026-02-01")]
        old_rev = [fact("2017-10-01", "2018-09-30", 1, "10-K", "FY")]
        ocf = [fact("2024-10-01", "2024-12-31", 30), fact("2024-10-01", "2025-03-31", 50),
               fact("2024-10-01", "2025-06-30", 80), fact("2024-10-01", "2025-09-30", 110, "10-K", "FY")]
        capex = [fact("2024-10-01", "2024-12-31", 5), fact("2024-10-01", "2025-03-31", 9),
                 fact("2024-10-01", "2025-06-30", 14), fact("2024-10-01", "2025-09-30", 20, "10-K", "FY")]
        cash = [fact(None, "2025-09-30", 55), fact(None, "2025-06-30", 50), fact(None, "2025-12-31", 60)]
        eps = [fact("2024-10-01", "2025-09-30", 6.5, "10-K", "FY")]
        g = {"RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": rev}},
             "Revenues": {"units": {"USD": old_rev}},
             "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": ocf}},
             "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": capex}},
             "CashAndCashEquivalentsAtCarryingValue": {"units": {"USD": cash}},
             "EarningsPerShareDiluted": {"units": {"USD/shares": eps}}}
        return {"entityName": "Test Inc", "facts": {"us-gaap": g}}

    def test_annual_and_quarters(self):
        fin = stocks.financials_from_facts(self.facts())
        self.assertEqual(fin["name"], "Test Inc")
        a = fin["annual"][0]
        self.assertEqual(a["end"], "2025-09-30")
        self.assertEqual(a["rev"], 400)
        self.assertEqual(a["fcf"], 110 - 20)
        self.assertEqual(a["cash"], 55)
        self.assertEqual(a["eps"], 6.5)
        q = {r["end"]: r for r in fin["quarterly"]}
        self.assertEqual(q["2025-09-30"]["rev"], 400 - 120 - 90 - 95)
        self.assertEqual(q["2025-03-31"]["ocf"], 20)
        self.assertEqual(q["2025-06-30"]["ocf"], 30)
        self.assertEqual(q["2025-09-30"]["ocf"], 30)
        self.assertEqual(q["2025-06-30"]["fcf"], 30 - 5)
        self.assertEqual(fin["quarterly"][0]["end"], "2025-12-31")

    def test_update_financials_writes_files(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(stocks, "FIN_DIR", d), \
                mock.patch.object(stocks, "cik_for", return_value=320193), \
                mock.patch.object(stocks, "_json", return_value=self.facts()), \
                mock.patch.object(stocks.time, "sleep"):
            n = stocks.update_financials(["AAPL", "MSFT"], datetime(2026, 10, 15, tzinfo=timezone.utc), limit=1)
            self.assertEqual(n, 1)
            files = os.listdir(d)
            self.assertEqual(len(files), 1)
            with open(os.path.join(d, files[0]), encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["cik"], 320193)
            self.assertTrue(data["annual"])


class BuildStocks(unittest.TestCase):
    def test_build_with_mocked_sources(self):
        prices = {t: {"px": 100.0, "ch": 1.0} for t, *_ in stocks.UNIVERSE}
        prices["AAPL"] = {"px": 110.0, "ch": -2.0}

        def fake_metric(t, key):
            return {"mcap": 1000.0, "pe": 20.0}
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "stocks.json")
            now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)
            with mock.patch.object(stocks, "fetch_prices", return_value=prices), \
                    mock.patch.object(stocks, "fetch_metric", side_effect=fake_metric), \
                    mock.patch.object(stocks, "fetch_earnings", return_value=[{"s": "AAPL", "d": "2026-11-02"}]), \
                    mock.patch.object(stocks, "update_financials", return_value=0), \
                    mock.patch.object(stocks.time, "sleep"):
                data = stocks.build(now, key="k", metric_limit=5, path=path)
                self.assertEqual(data["prices_ok"], len(stocks.UNIVERSE))
                self.assertEqual(data["metrics_updated"], 5)
                self.assertEqual(data["earnings"][0]["s"], "AAPL")
                rows = {r["s"]: r for r in data["stocks"]}
                self.assertEqual(rows["AAPL"]["px"], 110.0)
                first = [r for r in data["stocks"] if r.get("mu")]
                self.assertEqual(len(first), 5)
                prices2 = {k: dict(v, px=v["px"] * 1.1) for k, v in prices.items()}
                with mock.patch.object(stocks, "fetch_prices", return_value=prices2):
                    data2 = stocks.build(now, key="k", metric_limit=5, path=path)
                rows2 = {r["s"]: r for r in data2["stocks"]}
                t0 = first[0]["s"]
                self.assertAlmostEqual(rows2[t0]["mcap"], 1100.0, places=0)
                self.assertEqual(len([r for r in data2["stocks"] if r.get("mu")]), 10)
                self.assertTrue(os.path.exists(path))

    def test_build_without_key_updates_prices_only(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "stocks.json")
            with mock.patch.object(stocks, "fetch_prices", return_value={"AAPL": {"px": 1.0, "ch": 0.5}}), \
                    mock.patch.object(stocks, "update_financials", return_value=0), \
                    mock.patch.object(stocks, "fetch_metric") as fm:
                data = stocks.build(datetime(2026, 10, 15, tzinfo=timezone.utc), key="", path=path)
                fm.assert_not_called()
                self.assertEqual(data["metrics_updated"], 0)


class RatesParsing(unittest.TestCase):
    def test_us_curve_real_sample(self):
        rows = rates.parse_ust(fx("ust.csv"))
        c = rates.curve_from_rows(rows, [l for _, l in rates.UST_COLS])
        self.assertEqual(c["date"], "2026-10-14")
        i10 = c["t"].index("10Y")
        self.assertAlmostEqual(c["y"][i10], 5.19)
        self.assertEqual(c["x"][c["t"].index("3M")], 0.25)
        self.assertIsNotNone(c["w"])
        self.assertEqual(c["wd"], "2026-10-07")

    def test_jp_real_sample(self):
        rows, labels = rates.parse_mof(fx("mof.csv"))
        self.assertIn("10Y", labels)
        self.assertEqual(rows[0][0], date(2026, 10, 1))
        self.assertAlmostEqual(rows[0][1]["10Y"], 3.092)

    def test_uk_real_sample(self):
        rows = rates.parse_boe(fx("boe.csv"))
        self.assertEqual(rows[0][0], date(2026, 9, 1))
        self.assertAlmostEqual(rows[0][1]["10Y"], 5.2068)

    def test_de_real_sample(self):
        rows = rates.parse_bbk(fx("bbk.csv"))
        self.assertEqual(rows[-1][0], date(2026, 10, 14))
        self.assertAlmostEqual(rows[-1][1]["10Y"], 3.48)

    def test_de_multi_series(self):
        text = ('"";BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A;BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A_FLAGS;'
                'BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A;BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A_FLAGS\n'
                'Einheit;PROZENT;;PROZENT;\n2026-10-14;2,10;;3,48;\n')
        rows = rates.parse_bbk(text)
        self.assertEqual(rows[0][1], {"2Y": 2.10, "10Y": 3.48})

    def test_ecb(self):
        text = ("KEY,FREQ,TIME_PERIOD,OBS_VALUE\n"
                "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y,B,2026-10-09,3.5112\n"
                "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y,B,2026-10-09,2.1\n"
                "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y,B,2026-10-12,3.4987\n")
        rows = rates.parse_ecb(text)
        self.assertEqual(rows[-1][0], date(2026, 10, 12))
        self.assertAlmostEqual(rows[0][1]["2Y"], 2.1)

    def test_moex(self):
        payload = {"yearyields": {"columns": ["tradedate", "tradetime", "period", "value"],
                                  "data": [["2026-10-14", "18:54:59", 0.25, 13.5], ["2026-10-14", "18:54:59", 10.0, 15.9]]}}
        d, pts = rates.parse_moex(payload)
        self.assertEqual(d, "2026-10-14")
        self.assertEqual(pts[10.0], 15.9)

    def test_bis_since_and_prev(self):
        text = ("FREQ,REF_AREA,TITLE,TIME_PERIOD,OBS_VALUE\n"
                "D,JP,x,2026-09-22,1.0\nD,JP,x,2026-09-23,1.0\nD,JP,x,2026-09-24,1.25\nD,JP,x,2026-10-06,1.25\n"
                "D,US,x,2026-10-06,3.875\n")
        out = rates.parse_bis(text)
        self.assertEqual(out["JP"]["rate"], 1.25)
        self.assertEqual(out["JP"]["prev"], 1.0)
        self.assertEqual(out["JP"]["since"], "2026-09-24")
        self.assertIsNone(out["US"]["prev"])

    def test_cbr(self):
        html = "<td>14.10.2026</td><td>14,00</td><td>12.09.2026</td><td>14,00</td><td>11.09.2026</td><td>15,00</td>"
        ru = rates.parse_cbr(html)
        self.assertEqual(ru["rate"], 14.0)
        self.assertEqual(ru["prev"], 15.0)
        self.assertEqual(ru["since"], "2026-09-12")

    def test_fomc_parse(self):
        html = ('<h4><a id="1">2026 FOMC Meetings</a></h4>'
                '<div class="fomc-meeting__month col"><strong>October</strong></div><div class="fomc-meeting__date col">27-28</div>'
                '<div class="fomc-meeting__month col"><strong>December</strong></div><div class="fomc-meeting__date col">8-9*</div>'
                '<h4><a id="2">2027 FOMC Meetings</a></h4>'
                '<div class="fomc-meeting__month col"><strong>Jan/Feb</strong></div><div class="fomc-meeting__date col">31-1</div>'
                '<div class="fomc-meeting__month col"><strong>March</strong></div><div class="fomc-meeting__date col">16-17*</div>'
                '<div class="fomc-meeting__month col"><strong>August</strong></div><div class="fomc-meeting__date col">22 (notation vote)</div>')
        self.assertEqual(rates.parse_fomc(html), [date(2026, 10, 28), date(2026, 12, 9), date(2027, 2, 1), date(2027, 3, 17)])

    def test_zq_symbol(self):
        self.assertEqual(rates.zq_symbol(2026, 11), "ZQX26.CBT")
        self.assertEqual(rates.zq_symbol(2027, 1), "ZQF27.CBT")

    def test_implied_path_and_probabilities(self):
        meetings = [date(2026, 10, 28), date(2026, 12, 9)]
        avg = {(2026, 10): 3.89, (2026, 11): 4.005, (2026, 12): 4.10}
        path = rates.implied_path(3.88, meetings, avg)
        self.assertEqual(len(path), 2)
        self.assertAlmostEqual(path[0]["after"], 4.005)
        self.assertAlmostEqual(path[0]["d_bp"], 12.5)
        after2 = (4.10 * 31 - 4.005 * 9) / 22
        self.assertAlmostEqual(path[1]["after"], round(after2, 4), places=3)
        p = rates.probabilities(12.5)
        self.assertEqual((p["hike"], p["hold"]), (50, 50))
        p = rates.probabilities(-30)
        self.assertEqual((p["cut"], p["cut50"]), (80, 20))
        self.assertEqual(rates.probabilities(0)["hold"], 100)

    def test_build_keeps_old_parts_when_sources_fail(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "rates.json")
            with open(path, "w") as f:
                json.dump({"updated": "2000-01-01", "curves": {"US": {"y": [1]}}, "cb": [{"c": "US"}], "wirp": None}, f)
            boom = mock.Mock(side_effect=OSError("network"))
            with mock.patch.object(rates, "_get", boom):
                data = rates.build(datetime(2026, 10, 15, tzinfo=timezone.utc), path=path)
            self.assertEqual(data["curves"]["US"], {"y": [1]})
            self.assertEqual(data["cb"], [{"c": "US"}])


class AiBrief(unittest.TestCase):
    def test_parse_and_annotate(self):
        items = [{"title": "Fed raises rates", "lead": "x"}, {"title": "Oil jumps"}]
        answer = 'Вот: [{"i":1,"sum":"ФРС повысила ставку — давление на акции","assets":[{"a":"S&P 500","d":"down"},{"a":"доллар","d":"up"},{"a":"bad","d":"?"}]},{"i":7,"sum":"x"}]'
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}):
            n = ai.annotate(items, call=lambda prompt, key, model: answer)
        self.assertEqual(n, 1)
        self.assertEqual(items[0]["ai"]["assets"], [{"a": "S&P 500", "d": "down"}, {"a": "доллар", "d": "up"}])
        self.assertNotIn("ai", items[1])

    def test_disabled_without_key(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}):
            self.assertFalse(ai.enabled())
            self.assertEqual(ai.annotate([{"title": "x"}]), 0)

    def test_bad_answer(self):
        self.assertEqual(ai.parse_answer("no json", 3), {})


class AutoReload(unittest.TestCase):
    def test_reload_when_code_changes(self):
        import news_bot
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "a.py"), "w") as f:
                f.write("x = 1")
            h1 = news_bot.code_hash(d)
            with open(os.path.join(d, "data.json"), "w") as f:
                f.write("{}")
            self.assertEqual(news_bot.code_hash(d), h1)
            with open(os.path.join(d, "a.py"), "w") as f:
                f.write("x = 2")
            self.assertNotEqual(news_bot.code_hash(d), h1)

    def test_loop_reloads_after_pull_and_keeps_deadline(self):
        import news_bot
        hashes = iter(["old", "new"])
        with mock.patch.object(news_bot, "code_hash", side_effect=lambda repo: next(hashes)), \
                mock.patch.object(news_bot, "git_sync"), \
                mock.patch.object(news_bot, "selfcheck_in", return_value=(True, "SELF-CHECK OK")), \
                mock.patch.object(news_bot, "run") as run, \
                mock.patch.object(news_bot.os, "execv", side_effect=SystemExit("reloaded")) as ex, \
                mock.patch.dict(os.environ, {"LOOP_DEADLINE": "123456.5"}):
            news_bot.loop(5, True)
            ex.assert_called_once()
            run.assert_not_called()
            self.assertEqual(os.environ["LOOP_DEADLINE"], "123456.5")


class FeedLinks(unittest.TestCase):
    def test_only_web_links_leave_the_feed(self):
        import news_bot
        rss = b"""<?xml version="1.0"?><rss><channel>
<item><title>Good</title><link> https://example.com/a </link></item>
<item><title>Script</title><link>javascript:alert(1)</link></item>
<item><title>Data</title><guid>data:text/html,x</guid></item>
<item><title>Atom</title><link href="HTTP://example.com/b"/></item>
</channel></rss>"""
        links = {i["title"]: i["link"] for i in news_bot.parse_feed(rss)}
        self.assertEqual(links, {"Good": "https://example.com/a", "Script": "", "Data": "", "Atom": "HTTP://example.com/b"})


class NewsBotIntegration(unittest.TestCase):
    def test_page_news_item_has_tickers(self):
        import news_bot
        r = {"title": "Tesla shares plunge after recall", "title_ru": "Акции Tesla обвалились после отзыва",
             "lead": "", "sources": ["CNBC"], "link": "https://x", "score": 7, "ts": "2026-10-14T10:00:00+00:00",
             "ai": {"sum": "s", "assets": []}}
        item = news_bot.page_news_item(r)
        self.assertEqual(item["tk"], ["TSLA"])
        self.assertEqual(item["dir"], -1)
        self.assertEqual(item["ai"]["sum"], "s")
        self.assertEqual(item["level"], "high")
        self.assertEqual(item["lang"], "en")
        self.assertEqual(item["title_ru"], "Акции Tesla обвалились после отзыва")


class NewsBotRunBothLanguages(unittest.TestCase):

    def test_run_sends_each_reader_their_language(self):
        import news_bot
        now = datetime.now(timezone.utc)

        def story(i, title, score, tags, source="Reuters"):
            return {"id": f"id{i}", "title": title, "lead": "", "tags": tags, "link": f"https://x/{i}", "source": source,
                    "sources": [source], "score": score, "ts": now.isoformat()}

        batches = [[story(1, "Fed holds rates steady as inflation cools", 9, ["Fed", "rates"])],
                   [story(2, "Oil jumps after OPEC cuts output sharply", 8, ["oil"]),
                    story(3, "ЦБ сохранил ключевую ставку на уровне 16%", 9, ["BankOfRussia"], source="Bank of Russia")]]
        sent = []

        def fake_call(self, method, fields, files=None):
            sent.append((str(fields.get("chat_id")), method, fields))
            return {"message_id": len(sent)}

        def fake_translate(text, lang="ru"):
            src = news_bot.orig_lang(text)
            return None if src == lang else f"[{lang}] {text}"

        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "docs"))
            env = {"TELEGRAM_BOT_TOKEN": "1:T", "TELEGRAM_CHAT_ID": "100", "PAGES_URL": "https://p.test/",
                   "STATE_FILE": os.path.join(d, "state.json"), "PAGE_DATA": os.path.join(d, "docs", "data.json"),
                   "DIGEST_HOUR": "0", "MORNING_HOUR": "-1", "BRIEF_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
                   "FRED_API_KEY": "", "QUIET_HOURS": "0-0"}
            with mock.patch.dict(os.environ, env), \
                    mock.patch.object(news_bot, "collect", side_effect=lambda now: (batches.pop(0), {})), \
                    mock.patch.object(news_bot, "fetch_quotes", return_value=[]), \
                    mock.patch.object(news_bot, "fetch_subscribers", return_value=(["200", "300"], {"300": "ru"})), \
                    mock.patch.object(news_bot, "translate", side_effect=fake_translate), \
                    mock.patch.object(news_bot, "update_extras", return_value=""), \
                    mock.patch.object(news_bot, "push_live"), \
                    mock.patch.object(news_bot.Telegram, "_call", fake_call):
                news_bot.run()
                first = [s for s in sent]
                with open(env["STATE_FILE"], encoding="utf-8") as f:
                    st = json.load(f)
                st["last_digest"] = ""
                with open(env["STATE_FILE"], "w", encoding="utf-8") as f:
                    json.dump(st, f)
                sent.clear()
                news_bot.run()
            with open(env["PAGE_DATA"], encoding="utf-8") as f:
                data = json.load(f)

        self.assertEqual({c for c, _, _ in first}, {"100"}, "the start message goes to the owner only")
        self.assertIn("Economic news bot is running", first[0][2]["text"])
        by = {}
        for chat, method, f in sent:
            by.setdefault(chat, []).append(f["text"])
        en, ru, owner = "\n".join(by["200"]), "\n".join(by["300"]), "\n".join(by["100"])
        self.assertIn("Economy ·", en)
        self.assertIn("Oil jumps after OPEC cuts output sharply", en)
        self.assertIn("[en] ЦБ сохранил ключевую ставку", en)
        self.assertIn("#BankOfRussia", en)
        self.assertIn("Bank of Russia", en)
        self.assertIn("Top stories of", en)
        self.assertIn("Экономика ·", ru)
        self.assertIn("[ru] Oil jumps after OPEC", ru)
        self.assertIn("ЦБ сохранил ключевую ставку на уровне 16%", ru)
        self.assertIn("#нефть", ru)
        self.assertIn("ЦБ РФ", ru)
        self.assertIn("Главное за", ru)
        self.assertEqual(owner, en, "the owner has no language set — English")
        buttons = [json.loads(f["reply_markup"]) for c, _, f in sent if c == "300" and f.get("reply_markup")]
        self.assertTrue(buttons and "lang=ru" in buttons[0]["inline_keyboard"][0][0]["web_app"]["url"])
        n = {x["title"]: x for x in data["news"]}
        oil = n["Oil jumps after OPEC cuts output sharply"]
        self.assertEqual((oil["lang"], oil["title_ru"], oil["tags"]), ("en", "[ru] Oil jumps after OPEC cuts output sharply", ["oil"]))
        cbr = n["ЦБ сохранил ключевую ставку на уровне 16%"]
        self.assertEqual((cbr["lang"], cbr["sources"]), ("ru", ["Bank of Russia"]))
        self.assertTrue(cbr["title_en"].startswith("[en] "))

    def test_old_ai_notes_are_russian_only(self):
        import news_bot
        old = {"ai": {"sum": "Старая заметка"}}
        new = {"ai": {"sum": "New note", "sum_ru": "Новая заметка"}}
        self.assertEqual(news_bot.ai_sum(old, "en"), "")
        self.assertEqual(news_bot.ai_sum(old, "ru"), "Старая заметка")
        self.assertEqual(news_bot.ai_sum(new, "en"), "New note")
        self.assertEqual(news_bot.ai_sum(new, "ru"), "Новая заметка")


class ChineseAndArabic(unittest.TestCase):

    def test_every_text_in_four_languages_with_the_same_placeholders(self):
        import re
        import i18n
        self.assertEqual(i18n.LANGS, ("en", "ru", "zh", "ar"))
        ph = re.compile(r"\{\w+\}")
        tags = re.compile(r"</?[a-z]+>")
        for key, entry in i18n.S.items():
            for lang in i18n.LANGS:
                self.assertIn(lang, entry, f"{key}: no {lang}")
                self.assertEqual(sorted(ph.findall(entry[lang])), sorted(ph.findall(entry["en"])), f"{key}: placeholders in {lang}")
                self.assertEqual(tags.findall(entry[lang]), tags.findall(entry["en"]), f"{key}: markup in {lang}")
        self.assertRegex(i18n.t("zh", "batch_head", stamp="13.11 09:00"), "经济")
        self.assertRegex(i18n.t("ar", "batch_head", stamp="13.11 09:00"), "الاقتصاد")
        self.assertEqual(i18n.norm_lang("zh-hans"), "zh")
        self.assertEqual(len(i18n.MONTHS["zh"]), 12)
        self.assertEqual(len(i18n.MONTHS["ar"]), 12)
        for lang in ("zh", "ar"):
            for k in i18n.TAGS_RU:
                self.assertNotRegex(i18n.tag(k, lang), r"\s", "a hashtag has no spaces")
            self.assertNotEqual(i18n.tag("ФРС", lang), "ФРС", "older Russian tags are shown in the reader's language")
            self.assertNotEqual(i18n.source("Bank of Russia", lang), "Bank of Russia")
            self.assertNotEqual(i18n.part("news", lang), "news")
            self.assertNotEqual(i18n.trade_type("buy", lang), "buy")
            self.assertNotEqual(i18n.trade_owner("SP", lang), "")
        self.assertEqual(i18n.t("xx", "read"), "read →", "an unknown language falls back to English")

    def test_mailing_and_data_in_chinese_and_arabic(self):
        import news_bot
        now = datetime.now(timezone.utc)

        def story(i, title, score, tags, source="Reuters"):
            return {"id": f"id{i}", "title": title, "lead": f"Lead {i}", "tags": tags, "link": f"https://x/{i}", "source": source,
                    "sources": [source], "score": score, "ts": now.isoformat()}
        batches = [[story(1, "Fed holds rates steady as inflation cools", 9, ["Fed", "rates"])],
                   [story(2, "Oil jumps after OPEC cuts output sharply", 8, ["oil"]),
                    story(3, "ЦБ сохранил ключевую ставку на уровне 16%", 9, ["BankOfRussia"], source="Bank of Russia")]]
        sent = []

        def fake_call(self, method, fields, files=None):
            sent.append((str(fields.get("chat_id")), method, fields))
            return {"message_id": len(sent)}

        def fake_translate(text, lang="ru"):
            return None if news_bot.orig_lang(text) == lang else f"[{lang}] {text}"

        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "docs"))
            env = {"TELEGRAM_BOT_TOKEN": "1:T", "TELEGRAM_CHAT_ID": "100", "PAGES_URL": "https://p.test/",
                   "STATE_FILE": os.path.join(d, "state.json"), "PAGE_DATA": os.path.join(d, "docs", "data.json"),
                   "DIGEST_HOUR": "0", "MORNING_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
                   "FRED_API_KEY": "", "QUIET_HOURS": "0-0"}
            with mock.patch.dict(os.environ, env), \
                    mock.patch.object(news_bot, "collect", side_effect=lambda now: (batches.pop(0), {})), \
                    mock.patch.object(news_bot, "fetch_quotes", return_value=[]), \
                    mock.patch.object(news_bot, "fetch_subscribers", return_value=(["400", "500"], {"400": "zh", "500": "ar"})), \
                    mock.patch.object(news_bot, "translate", side_effect=fake_translate), \
                    mock.patch.object(news_bot, "update_extras", return_value=""), \
                    mock.patch.object(news_bot, "push_live"), \
                    mock.patch.object(news_bot.Telegram, "_call", fake_call):
                news_bot.run()
                with open(env["STATE_FILE"], encoding="utf-8") as f:
                    st = json.load(f)
                st["last_digest"] = ""
                with open(env["STATE_FILE"], "w", encoding="utf-8") as f:
                    json.dump(st, f)
                sent.clear()
                news_bot.run()
            with open(env["PAGE_DATA"], encoding="utf-8") as f:
                data = json.load(f)
            with open(env["STATE_FILE"], encoding="utf-8") as f:
                st = json.load(f)
        by = {}
        for chat, method, f in sent:
            by.setdefault(chat, []).append(f["text"])
        zh, ar = "\n".join(by["400"]), "\n".join(by["500"])
        self.assertIn("经济 ·", zh)
        self.assertIn("[zh] Oil jumps after OPEC", zh)
        self.assertIn("[zh] ЦБ сохранил ключевую ставку", zh)
        self.assertIn("[zh] Lead 2", zh)
        self.assertIn("#石油", zh)
        self.assertIn("俄罗斯央行", zh)
        self.assertIn("阅读 →", zh)
        self.assertIn("الاقتصاد ·", ar)
        self.assertIn("[ar] Oil jumps after OPEC", ar)
        self.assertIn("#النفط", ar)
        self.assertIn("البنك المركزي الروسي", ar)
        self.assertIn("أبرز أخبار", ar)
        for chat, lang in (("400", "zh"), ("500", "ar")):
            buttons = [json.loads(f["reply_markup"]) for c, _, f in sent if c == chat and f.get("reply_markup")]
            self.assertTrue(buttons and buttons[0]["inline_keyboard"][0][0]["web_app"]["url"].endswith("?lang=" + lang))
        n = {x["title"]: x for x in data["news"]}
        oil, cbr = n["Oil jumps after OPEC cuts output sharply"], n["ЦБ сохранил ключевую ставку на уровне 16%"]
        for lang in ("ru", "zh", "ar"):
            self.assertEqual(oil["title_" + lang], f"[{lang}] Oil jumps after OPEC cuts output sharply")
        for lang in ("en", "zh", "ar"):
            self.assertTrue(cbr["title_" + lang].startswith(f"[{lang}] "))
        self.assertNotIn("title_ru", cbr, "no translation into the story's own language")
        kept = [r for r in st["recent"] if r["title"].startswith("Oil")][0]
        self.assertEqual(kept["lead_zh"], "[zh] Lead 2", "translations are kept in state.json")

    def test_calendar_names_and_labels(self):
        import econ_calendar as cal
        cpi = {"title": "Core CPI m/m", "country": "USD", "ts": "2026-11-13T13:30:00+00:00", "impact": "High",
               "forecast": "0.3%", "previous": "0.2%"}
        self.assertEqual(cal.known_name(cpi, "zh"), "核心CPI月率")
        self.assertEqual(cal.known_name(cpi, "ar"), "مؤشر أسعار المستهلكين الأساسي (شهري)")
        self.assertEqual(cal.ru_name(cpi), "Базовая инфляция (CPI), м/м")
        fed = dict(cpi, title="Fed Chair Powell Speaks")
        self.assertEqual(cal.known_name(fed, "zh"), "美联储主席Powell讲话")
        self.assertEqual(cal.known_name(fed, "ar"), "كلمة رئيس الاحتياطي الفيدرالي (Powell)")
        other = dict(cpi, title="Building Permits")
        self.assertIsNone(cal.known_name(other, "zh"))
        self.assertEqual(cal.event_name(other, "zh", lambda t, lang: f"[{lang}] {t}"), "[zh] Building Permits")
        self.assertEqual(cal.event_name(other, "ar"), "Building Permits", "no translator — the English name")
        self.assertIn("预期 0.3%", cal.fmt_event(cpi, "zh"))
        self.assertIn("السابق 0.2%", cal.fmt_event(cpi, "ar"))
        self.assertEqual(cal.verdict("0.4%", "0.3%", "zh"), "高于预期")
        self.assertEqual(cal.verdict("0.3%", "0.3%", "ar"), "كما كان متوقعًا")
        self.assertEqual(len({len(row) for row in cal.NAMES}), 1, "every common name has all four languages")

    def test_trade_amounts_and_labels(self):
        import trades
        self.assertEqual(trades.fmt_usd(1.25e9, "en"), "$1.2B")
        self.assertEqual(trades.fmt_usd(1.25e9, "ru"), "$1,2 млрд")
        self.assertEqual(trades.fmt_usd(1.25e9, "zh"), "$12.5亿")
        self.assertEqual(trades.fmt_usd(2.5e6, "zh"), "$250万")
        self.assertEqual(trades.fmt_usd(25000, "zh"), "$2万")
        self.assertEqual(trades.fmt_usd(2.5e6, "ar"), "$2.5 مليون")
        self.assertEqual(trades.fmt_usd(500, "ar"), "$500")
        self.assertEqual(trades.fmt_range(1001, 15000, "en"), "$1–15K")
        self.assertEqual(trades.fmt_range(1000001, 5000000, "zh"), "$100–500万")
        self.assertEqual(trades.fmt_range(1000001, 5000000, "ar"), "$1–5 مليون")
        self.assertEqual(trades.loc("House, CA12", "zh"), "众议院, CA12")
        self.assertEqual(trades.loc("Сенат", "ar"), "مجلس الشيوخ", "older Russian labels too")
        msgs = trades.messages({"congress": [{"ticker": "NVDA", "type": "buy", "amin": 1001, "amax": 15000, "who": "Jane Doe",
                                               "where": "House", "owner": "SP", "date": "2026-10-01", "disclosed": "2026-10-20",
                                               "link": "https://x/r"}]}, lang="zh")
        self.assertIn("美国政界人士交易", msgs[0])
        self.assertIn("买入", msgs[0])
        self.assertIn("配偶", msgs[0])

    def test_the_picture_and_the_ai_note(self):
        import charts
        import news_bot
        self.assertEqual(charts.picture_lang("ar"), "en", "matplotlib cannot join Arabic letters")
        self.assertEqual(charts.picture_lang("ru"), "ru")
        with mock.patch.object(charts, "cjk_font", return_value=None):
            self.assertEqual(charts.picture_lang("zh"), "en", "no Chinese font — an English picture")
        with mock.patch.object(charts, "cjk_font", return_value="Noto Sans CJK SC"):
            self.assertEqual(charts.picture_lang("zh"), "zh")
        res = ai.parse_answer('[{"i": 1, "sum": "Rates stay high", "sum_ru": "Ставки высокие", "sum_zh": "利率维持高位", '
                              '"sum_ar": "الفائدة تبقى مرتفعة", "assets": []}]', 1)
        self.assertEqual((res[1]["sum_zh"], res[1]["sum_ar"]), ("利率维持高位", "الفائدة تبقى مرتفعة"))
        self.assertEqual(news_bot.ai_sum({"ai": res[1]}, "zh"), "利率维持高位")
        old = {"ai": {"sum": "Rates stay high", "sum_ru": "Ставки высокие"}}
        self.assertEqual(news_bot.ai_sum(old, "ar"), "", "no Arabic note yet — the summary is shown instead")

    def test_rates_names(self):
        self.assertEqual(rates.names_xl("Federal Reserve"), {"name_zh": "美联储", "name_ar": "الاحتياطي الفيدرالي"})
        self.assertEqual(rates.names_xl("Atlantis"), {})


class CompanyData(unittest.TestCase):

    def setUp(self):
        import company
        self.co = company
        self.aapl = json.loads(fx("yahoo_qs_AAPL.json"))

    def test_summary_sections(self):
        s = self.co.clean(self.co.parse_summary(self.aapl))
        self.assertEqual(s["profile"]["name"], "Apple Inc.")
        self.assertEqual(s["profile"]["officers"][0]["n"], "Mr. Timothy D. Cook")
        self.assertEqual(s["stats"]["gm"], 48.65)
        self.assertIsInstance(s["targets"]["n"], int)
        self.assertEqual(s["targets"]["key"], "buy")
        self.assertEqual(s["ratings"][0]["d"], "2026-10-12")
        self.assertEqual([e["p"] for e in s["est"]], ["0q", "+1q", "0y", "+1y"])
        self.assertEqual(s["hist"][0]["q"], "2026-06-30")
        self.assertEqual(s["next"]["date"], "2026-11-02")
        self.assertEqual(s["holders"]["top"][0]["n"], "Blackrock Inc.")
        self.assertEqual(s["div"]["split"], "4:1")
        self.assertEqual(s["short"]["d"], "2026-09-30")
        self.assertTrue(s["filings"][0]["url"].startswith("https://"))

    def test_company_without_dividends(self):
        s = self.co.clean(self.co.parse_summary(json.loads(fx("yahoo_qs_TSLA.json"))))
        self.assertEqual(s["profile"]["name"], "Tesla, Inc.")
        self.assertNotIn("rate", s.get("div", {}))
        self.assertTrue(s["est"] and s["holders"]["top"])

    def test_empty_values_dropped(self):
        self.assertEqual(self.co.clean({"a": None, "b": {}, "c": [], "d": "", "e": 0, "f": {"g": None}}), {"e": 0})
        self.assertIsNone(self.co.num({}))
        self.assertIsNone(self.co.num({"raw": float("nan")}))
        self.assertEqual(self.co.day({"raw": 1767225600}), "2026-01-01")

    def test_dividend_events_and_short_history(self):
        divs, splits = self.co.parse_events(json.loads(fx("yahoo_chart_events.json")))
        self.assertEqual(divs[0], ["2026-08-10", 0.27])
        self.assertTrue(all(a[0] > b[0] for a, b in zip(divs, divs[1:])))
        self.assertEqual(splits[0], ["2020-08-31", "4:1"])
        rows = self.co.parse_nasdaq_short(json.loads(fx("nasdaq_short.json")))
        self.assertEqual(rows[0], {"d": "2026-09-30", "sh": 120763539, "adv": 39858260, "days": 3.03})

    def test_wikipedia_company_check(self):
        self.assertTrue(self.co.is_company_page({"description": "American multinational technology company"}))
        self.assertFalse(self.co.is_company_page({"description": "Fruit of the apple tree"}))
        self.assertFalse(self.co.is_company_page({"type": "disambiguation", "description": "company"}))

    def test_build_refreshes_oldest_and_keeps_old_parts_on_errors(self):
        co, aapl = self.co, self.aapl
        events = json.loads(fx("yahoo_chart_events.json"))
        short = json.loads(fx("nasdaq_short.json"))

        class FakeSession:
            calls = []

            def quote_summary(self, sym, modules=None):
                self.calls.append(sym)
                if sym == "BRK-B":
                    raise RuntimeError("Yahoo: no data for BRK-B")
                return aapl

            def json(self, url, ua=None, timeout=25):
                if "events=" in url:
                    return events
                if "nasdaq" in url:
                    raise OSError("blocked")
                if "list=search" in url:
                    return {"query": {"search": [{"title": "Apple Inc."}]}}
                if "langlinks" in url:
                    return {"query": {"pages": {"1": {"langlinks": [{"lang": "ru", "*": "Apple"}]}}}}
                if "ru.wikipedia" in url:
                    return {"title": "Apple", "extract": "Американская корпорация", "content_urls": {"desktop": {"page": "https://ru.wikipedia.org/wiki/Apple"}}}
                return {"title": "Apple Inc.", "description": "American multinational technology company",
                        "extract": "Apple Inc. is a technology company", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Apple_Inc."}}}

        now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "MSFT.json"), "w") as f:
                json.dump({"s": "MSFT", "updated": "2026-10-15T08:00:00+00:00"}, f)
            with open(os.path.join(d, "AAPL.json"), "w") as f:
                json.dump({"s": "AAPL", "updated": "2026-10-14T00:00:00+00:00", "short": {"rows": [{"d": "2026-08-29", "sh": 1}]}}, f)
            fs = FakeSession()
            n = co.build(now, limit=5, sleep=0, tickers=["MSFT", "AAPL", "BRK.B"], out_dir=d, session=fs)
            self.assertEqual(n, 1)
            self.assertEqual(fs.calls, ["BRK-B", "AAPL"])
            out = co.load(os.path.join(d, "AAPL.json"))
            self.assertEqual(out["updated"], now.isoformat())
            self.assertEqual(out["div"]["hist"][0], ["2026-08-10", 0.27])
            self.assertEqual(out["short"]["rows"], [{"d": "2026-08-29", "sh": 1}])
            self.assertEqual(out["wiki"]["ru"]["x"], "Американская корпорация")
            self.assertFalse(os.path.exists(os.path.join(d, "BRK.B.json")))


def cboe_payload():
    def o(code, oi, vol, iv, bid, ask, delta):
        return {"option": code, "open_interest": oi, "volume": vol, "iv": iv, "bid": bid, "ask": ask, "delta": delta,
                "last_trade_price": (bid + ask) / 2}
    opts = [o("XYZ261009C00100000", 999, 9, 0.3, 1, 2, 0.5), {"option": "junk"}]
    for exp in ("261016", "261120"):
        opts += [o(f"XYZ{exp}C00090000", 100, 10, 0.32, 10.5, 11.0, 0.9), o(f"XYZ{exp}P00090000", 500, 40, 0.36, 0.4, 0.5, -0.1),
                 o(f"XYZ{exp}C00100000", 300, 50, 0.30, 2.0, 2.2, 0.5), o(f"XYZ{exp}P00100000", 300, 30, 0.34, 1.8, 2.0, -0.5),
                 o(f"XYZ{exp}C00110000", 800, 20, 0.28, 0.3, 0.4, 0.1), o(f"XYZ{exp}P00110000", 10, 1, 0.40, 10.0, 10.6, -0.9)]
    return {"timestamp": "2026-10-15 15:00:00", "data": {"current_price": 100.0, "price_change_percent": 1.25, "iv30": 31.5,
                                                         "iv30_change": -0.4, "options": opts}}


class OptionChains(unittest.TestCase):
    def test_occ_codes(self):
        import options
        self.assertEqual(options.parse_occ("AAPL261016C00250000"), ("2026-10-16", "C", 250.0))
        self.assertEqual(options.parse_occ("BRK.B261016P00482500"), ("2026-10-16", "P", 482.5))
        self.assertIsNone(options.parse_occ("junk"))

    def test_max_pain(self):
        import options
        self.assertEqual(options.max_pain({90: 100, 100: 300, 110: 800}, {90: 500, 100: 300, 110: 10}), 100)

    def test_snapshot(self):
        import options
        s = options.summarize(cboe_payload(), date(2026, 10, 15))
        self.assertEqual([e["d"] for e in s["exp"]], ["2026-10-16", "2026-11-20"])
        e = s["exp"][0]
        self.assertEqual((e["dte"], e["atm"], e["c_vol"], e["p_vol"], e["c_oi"], e["p_oi"]), (1, 100.0, 80, 71, 1200, 810))
        self.assertEqual(e["iv"], 32.0)
        self.assertEqual(e["move"], 4.0)
        self.assertEqual(s["pcr_vol"], round(142 / 160, 2))
        self.assertEqual(len(s["chains"][0]["rows"]), 3)
        self.assertEqual(s["chains"][0]["rows"][1][:8], [100.0, 2.0, 2.2, 2.1, 30.0, 0.5, 300, 50])
        self.assertEqual(s["top_oi"][0], ["2026-11-20", 110.0, "C", 800])

    def test_build_refreshes_core_hourly_in_market_hours(self):
        import options
        with tempfile.TemporaryDirectory() as d:
            got = []

            def fetcher(sym):
                got.append(sym)
                if sym == "BAD":
                    raise OSError("403")
                return cboe_payload()

            now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)
            with open(os.path.join(d, "SPY.json"), "w") as f:
                json.dump({"updated": "2026-10-15T14:50:00+00:00"}, f)
            with open(os.path.join(d, "AAPL.json"), "w") as f:
                json.dump({"updated": "2026-10-15T13:00:00+00:00"}, f)
            with open(os.path.join(d, "KO.json"), "w") as f:
                json.dump({"updated": "2026-10-15T08:00:00+00:00"}, f)
            with open(os.path.join(d, "QQQ.json"), "w") as f:
                json.dump({"updated": "2026-10-15T14:30:00+00:00"}, f)
            summ = os.path.join(d, "options.json")
            gdir = os.path.join(d, "gex")
            n = options.build(now, sleep=0, tickers=["SPY", "QQQ", "AAPL", "KO", "BAD"], out_dir=d, summary_path=summ,
                              fetcher=fetcher, gex_dir=gdir)
            self.assertEqual((n, sorted(got)), (2, ["AAPL", "BAD", "QQQ"]))
            rows = options.load(summ)["rows"]
            self.assertEqual({r["s"]: r["n"] for r in rows}["AAPL"], "Apple")
            g = options.load(os.path.join(gdir, "AAPL.json"))
            self.assertEqual((g["s"], g["n"], g["px"]), ("AAPL", "Apple", 100.0))
            self.assertIn("zero", g["levels"])
            self.assertTrue(os.path.exists(os.path.join(gdir, "hist", "QQQ.json")))
            self.assertFalse(os.path.exists(os.path.join(gdir, "KO.json")))
        got.clear()
        with tempfile.TemporaryDirectory() as d:
            options.build(now, limit=1, sleep=0, tickers=["AAPL", "KO", "SPX", "SPY", "QQQ", "MSFT"], out_dir=d,
                          summary_path=os.path.join(d, "options.json"), fetcher=fetcher, gex_dir=os.path.join(d, "gex"))
            self.assertEqual(got, ["QQQ", "SPX", "SPY", "AAPL"])


def yahoo_answer(px=100.0, exps=(1792108800, 1795132800), first_only=False, date_ts=None):
    def c(sym, k, cp, oi, iv, bid, ask):
        return {"contractSymbol": f"XYZ{sym}{cp}{int(k * 1000):08d}", "strike": k, "openInterest": oi, "volume": 5,
                "impliedVolatility": iv, "bid": bid, "ask": ask, "lastPrice": (bid + ask) / 2}
    blocks = []
    for t in ([date_ts] if date_ts else exps[:1]):
        ymd = datetime.fromtimestamp(t, timezone.utc).strftime("%y%m%d")
        blocks.append({"expirationDate": t,
                       "calls": [c(ymd, 90, "C", 100, 0.32, 10.5, 11), c(ymd, 100, "C", 300, 0.30, 2.0, 2.2), c(ymd, 110, "C", 800, 0.28, 0.3, 0.4)],
                       "puts": [c(ymd, 90, "P", 500, 0.36, 0.4, 0.5), c(ymd, 100, "P", 300, 0.34, 1.8, 2.0), c(ymd, 110, "P", 10, 0.00001, 10, 10.6)]})
    return {"quote": {"regularMarketPrice": px, "regularMarketChangePercent": 1.5, "regularMarketTime": 1792076400},
            "expirationDates": list(exps), "options": blocks}


class DealerPositioning(unittest.TestCase):
    def test_black_scholes(self):
        import gex
        g = gex.greeks(100, 100, 1.0, 0.2, 0.05)
        self.assertAlmostEqual(g["dc"], 0.6368, places=4)
        self.assertAlmostEqual(g["dp"], -0.3632, places=4)
        self.assertAlmostEqual(g["g"], 0.018762, places=5)
        self.assertAlmostEqual(g["v"], 0.37524, places=4)
        self.assertAlmostEqual(g["tc"] * 365, -6.4140, places=3)
        self.assertAlmostEqual(g["tp"] * 365, -1.6579, places=3)
        self.assertIsNone(gex.greeks(100, 100, 0, 0.2))
        self.assertIsNone(gex.greeks(100, 100, 1, None))
        h = 1e-4
        up, dn = gex.greeks(100, 110, 0.5, 0.25 + h, 0.03), gex.greeks(100, 110, 0.5, 0.25 - h, 0.03)
        self.assertAlmostEqual(gex.greeks(100, 110, 0.5, 0.25, 0.03)["vanna"], (up["dc"] - dn["dc"]) / (2 * h) / 100, places=6)
        later, now_ = gex.greeks(100, 110, 0.5 - 1 / 365, 0.25, 0.03), gex.greeks(100, 110, 0.5, 0.25, 0.03)
        self.assertAlmostEqual(now_["charm"], later["dc"] - now_["dc"], places=4)

    def chain(self, now, S=100.0):
        import gex
        T1, T2 = 7 / 365, 35 / 365
        out = []
        for exp, T in (("2026-10-22", T1), ("2026-11-19", T2)):
            for k, coi, poi in ((90, 100, 3000), (95, 200, 6000), (100, 1500, 1500), (105, 4000, 300), (110, 1000, 50)):
                iv = 0.25 + abs(k - S) / 400
                out.append(gex.option(exp, "C", k, T, oi=coi, iv=iv, bid=1, ask=1.2))
                out.append(gex.option(exp, "P", k, T, oi=poi, iv=iv, bid=1, ask=1.2))
        return out

    def test_levels_and_flip(self):
        import gex
        now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)
        s = gex.analyze(self.chain(now), 100.0, now, size=100, band=0.2)
        lv = s["levels"]
        self.assertEqual((lv["cwall"], lv["pwall"]), (105, 95))
        self.assertTrue(95 < lv["zero"] < 105)
        y = dict(zip(s["prof"]["x"], s["prof"]["y"]))
        self.assertLess(min(y.items(), key=lambda p: p[0])[1], 0)
        self.assertGreater(max(y.items(), key=lambda p: p[0])[1], 0)
        i = s["k"].index(105)
        self.assertGreater(s["gc"][i], 0)
        self.assertLess(s["gp"][s["k"].index(95)], s["gp"][s["k"].index(90)])
        self.assertAlmostEqual(s["tot"]["gex"], sum(s["gc"]) + sum(s["gp"]), delta=abs(s["tot"]["gex"]) * 1e-3)
        self.assertEqual(s["levels"]["pain_d"], "2026-10-22")
        self.assertEqual(s["tot"]["pcr_oi"], round(10850 / 6800, 2))
        self.assertEqual(s["surf"]["d"], ["2026-10-22", "2026-11-19"])
        self.assertEqual(len(s["grk"]["k"]), 3)
        self.assertAlmostEqual(s["em"]["iv30"], 0.25, places=3)
        self.assertAlmostEqual(s["em"]["d1"], 100 * 0.25 / math.sqrt(252), places=2)

    def test_history_keeps_sessions(self):
        import gex
        with tempfile.TemporaryDirectory() as d:
            base = datetime(2026, 10, 12, 15, tzinfo=timezone.utc)
            for day in range(7):
                for h in (0, 1):
                    now = base + timedelta(days=day, hours=h)
                    s = gex.analyze(self.chain(now), 100.0 + day, now, band=0.2)
                    gex.write("XYZ", s, now, "test", out_dir=d, intra_days=3)
            h = gex.load(os.path.join(d, "hist", "XYZ.json"))
            self.assertEqual(sorted({x["day"] for x in h["intra"]}), ["2026-10-16", "2026-10-17", "2026-10-18"])
            self.assertEqual(len(h["days"]), 7)
            self.assertEqual(h["days"][-1]["px"], 106.0)
            self.assertEqual(gex.load(os.path.join(d, "XYZ.json"))["src"], "test")
        self.assertEqual(gex.session_day(datetime(2026, 7, 1, 2, tzinfo=timezone.utc), "equity"), "2026-06-30")
        self.assertEqual(gex.session_day(datetime(2026, 12, 1, 4, 30, tzinfo=timezone.utc), "equity"), "2026-11-30")
        self.assertEqual(gex.session_day(datetime(2026, 12, 1, 4, 30, tzinfo=timezone.utc), "crypto"), "2026-12-01")

    def test_cboe_chain_and_expired(self):
        import gex
        now = datetime(2026, 10, 16, 22, tzinfo=timezone.utc)
        chain, S = gex.from_cboe(cboe_payload(), now)
        self.assertEqual(S, 100.0)
        self.assertEqual({o["exp"] for o in chain}, {"2026-11-20"})

    def test_deribit_live_sample(self):
        import deribit, gex
        fx = os.path.join(HERE, "fixtures", "live")
        book = json.load(open(os.path.join(fx, "deribit_btc_book.json")))["result"]
        S = json.load(open(os.path.join(fx, "deribit_btc_index.json")))["result"]["index_price"]
        now = datetime(2026, 11, 23, 13, 26, tzinfo=timezone.utc)
        self.assertEqual(deribit.parse_name("BTC-27NOV26-60000-C"), ("2026-11-27", "C", 60000.0))
        self.assertEqual(deribit.parse_name("BTC-4DEC26-120000-P"), ("2026-12-04", "P", 120000.0))
        self.assertIsNone(deribit.parse_name("BTC-PERPETUAL"))
        chain = deribit.chain_from(book, now)
        self.assertGreater(len(chain), 300)
        self.assertTrue(all(0 < o["iv"] < 3 for o in chain if o["iv"]))
        s = gex.analyze(chain, S, now, size=1.0, kind="crypto", band=0.25, prof_band=0.2)
        self.assertTrue(40000 < s["levels"]["cwall"] < 90000)
        self.assertTrue(0.2 < s["em"]["iv30"] < 1.5)
        self.assertEqual(s["kind"], "crypto")

    def test_deribit_build(self):
        import deribit
        fx = os.path.join(HERE, "fixtures", "live")
        calls = []

        def fetcher(path, params):
            calls.append((path, params.get("currency") or params.get("index_name")))
            if path == "get_book_summary_by_currency":
                if params["currency"] == "ETH":
                    raise OSError("timeout")
                return json.load(open(os.path.join(fx, "deribit_btc_book.json")))["result"]
            if path == "get_index_price":
                return json.load(open(os.path.join(fx, "deribit_btc_index.json")))["result"]
            return json.load(open(os.path.join(fx, "deribit_dvol.json")))["result"]
        now = datetime(2026, 11, 23, 13, 26, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(deribit.build(now, out_dir=d, fetcher=fetcher, sleep=0), 1)
            btc = json.load(open(os.path.join(d, "BTC.json")))
            self.assertEqual((btc["src"], btc["kind"]), ("deribit", "crypto"))
            self.assertTrue(30 < btc["dvol"] < 120)
            self.assertTrue(btc["dvol_hist"])
            calls.clear()
            self.assertEqual(deribit.build(now + timedelta(minutes=5), out_dir=d, fetcher=fetcher, sleep=0), 0)
            self.assertNotIn(("get_book_summary_by_currency", "BTC"), calls)

    def test_yahoo_fallback(self):
        import options

        class FakeSession:
            crumb = "c"
            def __init__(self):
                self.urls = []
            def yahoo_login(self):
                self.crumb = "c"
            def json(self, url):
                self.urls.append(url)
                q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                return {"optionChain": {"result": [yahoo_answer(date_ts=int(q["date"][0]) if "date" in q else None)]}}
        now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)
        fs = FakeSession()
        p = options.yahoo_chain("SPX", now, session=fs, sleep=0)
        self.assertIn("/%5ESPX?", fs.urls[0])
        self.assertEqual(len(fs.urls), 2)
        self.assertEqual(p["src"], "yahoo")
        s = options.summarize(p, now.date())
        self.assertEqual([e["d"] for e in s["exp"]], ["2026-10-16", "2026-11-20"])
        row = s["chains"][0]["rows"][1]
        self.assertEqual(row[0], 100.0)
        self.assertTrue(0.4 < row[5] < 0.6)
        self.assertEqual(options.pick_expiries([1792108800, 1795132800, 1700000000], now), [1792108800, 1795132800])
        self.assertTrue(options.third_friday(date(2026, 11, 20)))
        self.assertFalse(options.third_friday(date(2026, 11, 13)))
        calls = []

        def cboe(sym):
            calls.append(sym)
            raise urllib.error.HTTPError("u", 403, "Forbidden", {}, None)
        with mock.patch.object(options, "fetch_cboe", cboe), mock.patch.object(options, "yahoo_chain", lambda s, n, f: {"src": "yahoo", "s": s}), \
                mock.patch.object(options, "_cboe_off_until", None):
            self.assertEqual(options.fetch("SPY", now)["src"], "yahoo")
            self.assertEqual(options.fetch("QQQ", now + timedelta(hours=1))["s"], "QQQ")
            self.assertEqual(calls, ["SPY"])
            options.fetch("IWM", now + timedelta(hours=7))
            self.assertEqual(calls, ["SPY", "IWM"])


class PreMarketBrief(unittest.TestCase):
    def test_message_in_every_language(self):
        import brief
        now = datetime(2026, 11, 23, 13, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            def snap(sym, px, gex, upd):
                with open(os.path.join(d, sym + ".json"), "w") as f:
                    json.dump({"s": sym, "updated": upd.isoformat(), "px": px, "tot": {"gex": gex},
                               "levels": {"zero": px * 0.99, "cwall": px * 1.01, "pwall": px * 0.98},
                               "em": {"d1": px * 0.01, "d1_pct": 1.0, "iv30": 0.16}}, f)
            snap("SPY", 676.0, 2.5e9, now - timedelta(hours=3))
            snap("NDX", 24000.0, -1.2e9, now - timedelta(hours=90))
            snap("BTC", 61211.0, -3.0e7, now - timedelta(minutes=10))
            notes = []
            make = brief.build(now, [{"short": "VIX", "value": 17.25}], gex_dir=d,
                               ai_note=lambda facts: notes.append(facts) or {"en": "Calm <today>.", "ru": "Спокойно."})
            en, ru, zh, ar = make("en"), make("ru"), make("zh"), make("ar")
        self.assertIn("Option levels before the US open", en)
        self.assertIn("<b>S&amp;P 500</b> 676", en)
        self.assertIn("GEX +$2.5B — positive gamma", en)
        self.assertIn("GEX −$30.0M — negative gamma", en)
        self.assertNotIn("Nasdaq", en)
        self.assertIn("VIX 17.25", en)
        self.assertIn("Calm &lt;today&gt;.", en)
        self.assertNotIn("as of", en.split("Bitcoin")[0])
        with tempfile.TemporaryDirectory() as d2:
            with open(os.path.join(d2, "SPX.json"), "w") as f:
                json.dump({"s": "SPX", "kind": "equity", "updated": (now - timedelta(hours=64)).isoformat(), "px": 6700.0,
                           "tot": {"gex": 1e9}, "levels": {}, "em": {}}, f)
            mon = brief.build(now, [], gex_dir=d2)("en")
        self.assertIn("(as of 21 Nov)", mon)
        self.assertIn("Опционные уровни перед открытием США", ru)
        self.assertIn("61 211", ru)
        self.assertIn("положительная гамма", ru)
        self.assertIn("S&P 500: price 676.0", notes[0])
        self.assertIn("美股开盘前的期权关键位</b> · 11月23日", zh)
        self.assertIn("<b>标普500</b> 676", zh)
        self.assertIn("GEX +$25.0亿 — 正伽马", zh)
        self.assertIn("<b>比特币</b> 61,211", zh)
        self.assertIn("Calm &lt;today&gt;.", zh)
        self.assertIn("مستويات الخيارات قبل افتتاح السوق الأمريكية</b> · 23 نوفمبر", ar)
        self.assertIn("GEX +$2.5 مليار — غاما موجبة", ar)
        self.assertIn("<b>بيتكوين</b> 61,211", ar)
        self.assertIn("GEX وLVL في المنصة", ar)
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(brief.build(now, [], gex_dir=d))

    def test_ai_note_parsing(self):
        import ai
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}):
            out = ai.brief_note("facts", call=lambda prompt, key, model: 'Sure: {"en": "Support at 6,700.", "ru": "Поддержка 6 700."}')
            self.assertEqual(out, {"en": "Support at 6,700.", "ru": "Поддержка 6 700.",
                                   "zh": "Support at 6,700.", "ar": "Support at 6,700."})
            out = ai.brief_note("facts", call=lambda *a: '{"en": "Support.", "ru": "Поддержка.", "zh": "支撑。", "ar": "دعم."}')
            self.assertEqual(out, {"en": "Support.", "ru": "Поддержка.", "zh": "支撑。", "ar": "دعم."})
            self.assertIsNone(ai.brief_note("facts", call=lambda *a: "no json"))
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}):
            self.assertIsNone(ai.brief_note("facts"))


class TankersAis(unittest.TestCase):

    def serve(self, frames, got):
        import socket as so
        import threading
        srv = so.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)

        def run():
            c, _ = srv.accept()
            req = b""
            while b"\r\n\r\n" not in req:
                req += c.recv(4096)
            key = [l.split(b":", 1)[1].strip() for l in req.split(b"\r\n") if l.lower().startswith(b"sec-websocket-key")][0]
            import base64 as b64, hashlib as hl
            acc = b64.b64encode(hl.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            c.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acc + b"\r\n\r\n")
            h = c.recv(2)
            n = h[1] & 0x7F
            if n == 126:
                n = int.from_bytes(c.recv(2), "big")
            mask = c.recv(4)
            data = b""
            while len(data) < n:
                data += c.recv(n - len(data))
            got.append(((h[1] & 0x80) != 0, bytes(b ^ mask[i % 4] for i, b in enumerate(data)).decode()))
            for fr in frames:
                c.sendall(fr)
            time.sleep(0.3)
            try:
                got.append(("after", c.recv(64)))
            except OSError:
                pass
            c.close()
            srv.close()
        th = threading.Thread(target=run, daemon=True)
        th.start()
        self.server_thread = th
        return srv.getsockname()[1]

    @staticmethod
    def frame(payload, op=1, fin=True):
        b = payload.encode() if isinstance(payload, str) else payload
        n = len(b)
        head = bytes([(0x80 if fin else 0) | op]) + (bytes([n]) if n < 126 else bytes([126]) + n.to_bytes(2, "big"))
        return head + b

    def test_client_and_messages(self):
        import ais
        pos = {"MessageType": "PositionReport", "MetaData": {"MMSI": 538001234, "ShipName": "  OCEAN  STAR  "},
               "Message": {"PositionReport": {"Latitude": 26.5, "Longitude": 56.3, "Sog": 12.4, "Cog": 301.2, "NavigationalStatus": 0}}}
        static = {"MessageType": "ShipStaticData", "MetaData": {"MMSI": 538001234, "ShipName": "OCEAN STAR"},
                  "Message": {"ShipStaticData": {"Type": 80, "Destination": "FUJAIRAH@@@", "MaximumStaticDraught": 14.2}}}
        bad = {"MessageType": "PositionReport", "MetaData": {"MMSI": 12}, "Message": {"PositionReport": {"Latitude": 1, "Longitude": 1}}}
        txt = json.dumps(pos)
        frames = [self.frame(txt[:20], fin=False), self.frame(txt[20:], op=0),
                  self.frame(b"\x01\x02", op=9),
                  self.frame(json.dumps(static).encode(), op=2),
                  self.frame(json.dumps(bad)), self.frame(b"", op=8)]
        got = []
        port = self.serve(frames, got)
        now = datetime(2026, 11, 23, 13, tzinfo=timezone.utc)
        ships, n = ais.listen("SECRET", seconds=5, url=f"ws://127.0.0.1:{port}/v0/stream", now=now)
        self.server_thread.join(3)
        masked, sub = got[0]
        self.assertTrue(masked)
        self.assertEqual(json.loads(sub)["APIKey"], "SECRET")
        self.assertEqual(json.loads(sub)["BoundingBoxes"], ais.WORLD_BOX)
        self.assertEqual(n, 2)
        rec = ships["538001234"]
        self.assertEqual((rec["name"], rec["type"], rec["dest"], rec["area"], rec["sog"], rec["cog"]), ("OCEAN STAR", 80, "FUJAIRAH", "hormuz", 12.4, 301))
        self.assertTrue(got[1][1].startswith(b"\x8a"))
        out = ais.merge({"tk": {"2026-11-22": [538009999]}, "ships": [{"mmsi": 538009999, "lat": 1.2, "lon": 103.8, "t": "2026-11-23T00:00:00+00:00", "area": "malacca"}]}, ships, now)
        self.assertEqual([s["mmsi"] for s in out["ships"]], [538001234])
        self.assertEqual({a["id"]: a["tankers"] for a in out["areas"]}["hormuz"], 1)
        self.assertEqual(out["tk"], {"2026-11-23": [538001234, 538009999]})

    def test_tankers_remembered_for_a_week_only(self):
        import ais
        now = datetime(2026, 11, 23, 13, tzinfo=timezone.utc)
        t = now.isoformat()
        new = {"111111111": {"mmsi": 111111111, "lat": 26.4, "lon": 56.2, "t": t, "area": "hormuz"},
               "222222222": {"mmsi": 222222222, "lat": 26.3, "lon": 56.1, "t": t, "area": "hormuz", "type": 70},
               "333333333": {"mmsi": 333333333, "lat": 26.2, "lon": 56.0, "t": t, "area": "hormuz"}}
        old = {"tk": {"2026-11-20": [111111111], "2026-11-14": [444444444], "2026-11-18": [555555555]}}
        out = ais.merge(old, new, now)
        self.assertEqual([s["mmsi"] for s in out["ships"]], [111111111])
        self.assertEqual(out["tk"], {"2026-11-18": [555555555], "2026-11-23": [111111111]})
        self.assertEqual({a["id"]: (a["tankers"], a["seen_now"]) for a in out["areas"]}["hormuz"], (1, 3))
        many = {str(100000000 + i): {"mmsi": 100000000 + i, "type": 80 if i % 4 == 0 else 70} for i in range(40000)}
        out = ais.merge({}, many, now)
        self.assertEqual(sum(len(v) for v in out["tk"].values()), min(10000, ais.MAX_TANKER_IDS))
        self.assertLess(len(json.dumps(out)), 120_000)
        out = ais.merge({"tk": {"2026-11-22": [666666666]}}, {"666666666": {"mmsi": 666666666, "type": 70}}, now)
        self.assertEqual(out["tk"], {})

    def test_build_needs_the_key_and_keeps_it_secret(self):
        import ais
        calls = []
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ships.json")
            with mock.patch.dict(os.environ, {"AISSTREAM_API_KEY": ""}):
                self.assertEqual(ais.build(path=path, listen_fn=lambda k, now=None: calls.append(k)), 0)
            self.assertEqual(calls, [])
            now = datetime(2026, 11, 23, 13, tzinfo=timezone.utc)
            with mock.patch.dict(os.environ, {"AISSTREAM_API_KEY": "TOPSECRET"}):
                n = ais.build(now, path=path, listen_fn=lambda k, now=None: (calls.append(k), ({}, 7))[1])
                self.assertEqual((n, calls), (7, ["TOPSECRET"]))
                self.assertEqual(ais.build(now + timedelta(minutes=10), path=path, listen_fn=lambda k, now=None: calls.append(k)), 0)
            with open(path) as f:
                self.assertNotIn("TOPSECRET", f.read())


class OilChokepoints(unittest.TestCase):
    NOW = datetime(2026, 11, 23, 13, tzinfo=timezone.utc)

    def page(self):
        with open(os.path.join(HERE, "fixtures", "eia_energysecurity.html"), encoding="utf-8") as f:
            return f.read()

    def test_reads_the_table(self):
        import chokepoints as c
        d = c.parse(self.page(), self.NOW)
        self.assertEqual(d["q"], ["2Q25", "3Q25", "4Q25", "1Q26", "2Q26", "3Q26"])
        self.assertEqual(d["v"]["hormuz"], [21.1, 21.4, 21.6, 15.0, 5.1, 9.1])
        self.assertEqual(d["v"]["danish"][-1], 4.5)
        self.assertEqual(d["v"]["turkish"][0], 3.7)
        self.assertEqual(sorted(d["v"]), sorted(rid for rid, _ in c.ROWS))
        self.assertEqual(d["released"], "2026-11-10")
        self.assertEqual([c.release_date(x) for x in ("Release Date: October 6, 2026", "<b>Release Date</b>: <span>march 3, 2027</span>", "Next Release: May 5, 2027", "")],
                         ["2026-10-06", "2027-03-03", None, None])
        with open(os.path.join(os.path.dirname(HERE), "docs", "terminal", "map.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn("var EIA_Q = ['2Q25', '3Q25', '4Q25', '1Q26', '2Q26', '3Q26'];", js)
        self.assertIn("hormuz: [21.1, 21.4, 21.6, 15.0, 5.1, 9.1]", js)

    def test_two_header_rows_and_other_labels(self):
        import chokepoints as c
        names = ["Strait of Malacca", "Strait of Hormuz", "Suez Canal", "Bab el-Mandeb", "Danish Straits", "Turkish Straits", "Panama Canal", "Cape of Good Hope"]
        rows = "".join(f"<tr><td>{n}</td>" + "".join(f"<td>{i + k / 10:.1f}</td>" for k in range(5)) + "</tr>" for i, n in enumerate(names, 1))
        page = ("<table><tr><th></th><th colspan='2'>2025</th><th colspan='3'>2026</th></tr>"
                "<tr><th></th><th>Q3</th><th>Q4</th><th>Q1</th><th>Q2</th><th>Q3</th></tr>" + rows + "</table>")
        d = c.parse(page, self.NOW)
        self.assertEqual(d["q"], ["3Q25", "4Q25", "1Q26", "2Q26", "3Q26"])
        self.assertEqual(d["v"]["cape"], [8.0, 8.1, 8.2, 8.3, 8.4])
        self.assertEqual([c.quarter(x) for x in ("2Q 2025", "Q2 2025", "2025 Q2", "2Q25", "2Q'25", "2025", "Q2", "")],
                         ["2Q25", "2Q25", "2Q25", "2Q25", "2Q25", None, None, None])

    def test_a_bad_page_changes_nothing(self):
        import chokepoints as c
        good = self.page()
        bad_pages = {"missing rows": good.replace("Panama Canal", "Canal"),
                     "cannot be flows": good.replace("<td>23.9</td>", "<td>239</td>"),
                     "no table": "<html><body>Service unavailable</body></html>"}
        for why, page in bad_pages.items():
            with self.subTest(why), self.assertRaises(ValueError) as e:
                c.parse(page, self.NOW)
            self.assertIn(why, str(e.exception))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "chokepoints.json")
            self.assertEqual(c.build(self.NOW, path=path, fetcher=lambda url: good), 6)
            with open(path) as f:
                first = json.load(f)
            calls = []
            later = self.NOW + timedelta(hours=21)
            with self.assertRaises(ValueError):
                c.build(later, path=path, fetcher=lambda url: (calls.append(url), bad_pages["missing rows"])[1])
            with open(path) as f:
                kept = json.load(f)
            self.assertEqual((kept["q"], kept["v"], kept["updated"]), (first["q"], first["v"], first["updated"]))
            self.assertIn("missing rows", kept["error"])
            self.assertEqual(c.build(later + timedelta(hours=2), path=path, fetcher=lambda url: calls.append(url)), 0)
            self.assertEqual(len(calls), 1)
            def down(url):
                raise OSError("timed out")
            with self.assertRaises(OSError):
                c.build(later + timedelta(days=1), path=path, fetcher=down)
            with open(path) as f:
                self.assertEqual(json.load(f)["v"], first["v"])

    def test_new_quarters_and_revisions(self):
        import chokepoints as c
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "chokepoints.json")
            old_q = ["1Q25", "2Q25", "3Q25", "4Q25"]
            old = {"q": old_q, "v": {rid: [1.0, 2.0, 3.0, 4.0] for rid, _ in c.ROWS}, "updated": "2026-08-01T00:00:00+00:00",
                   "checked": "2026-11-01T00:00:00+00:00"}
            with open(path, "w") as f:
                json.dump(old, f)
            n = c.build(self.NOW, path=path, fetcher=lambda url: self.page())
            with open(path) as f:
                out = json.load(f)
            self.assertEqual(out["q"], ["1Q25", "2Q25", "3Q25", "4Q25", "1Q26", "2Q26", "3Q26"])
            self.assertEqual(out["v"]["hormuz"], [1.0, 21.1, 21.4, 21.6, 15.0, 5.1, 9.1])
            self.assertEqual(n, 6)
            self.assertEqual(out["updated"], self.NOW.isoformat())
            self.assertNotIn("error", out)
            n = c.build(self.NOW + timedelta(days=1), path=path, fetcher=lambda url: self.page())
            with open(path) as f:
                again = json.load(f)
            self.assertEqual((n, again["updated"], again["checked"]), (0, out["updated"], (self.NOW + timedelta(days=1)).isoformat()))
            many = {"q": [f"{q}Q{y:02d}" for y in range(10, 25) for q in range(1, 5)], "v": {}}
            many["v"] = {rid: [1.0] * len(many["q"]) for rid, _ in c.ROWS}
            merged, _ = c.merge(many, c.parse(self.page(), self.NOW))
            self.assertEqual(len(merged["q"]), c.KEEP_Q)
            self.assertEqual(merged["q"][-1], "3Q26")
            newer = self.page().replace("<td>5.1</td><td>9.1</td>", "<td>5.1</td><td>9.3</td>").replace("Release Date:", "Updated:")
            self.assertEqual(c.build(self.NOW + timedelta(days=3), path=path, fetcher=lambda url: newer), 1)
            with open(path) as f:
                self.assertIsNone(json.load(f)["released"])


class MacroAndMoex(unittest.TestCase):
    def test_imf_forecasts(self):
        import macro
        years = [2023, 2024, 2025, 2026, 2027, 2028]
        countries = {c: {str(y): 2.0 + i / 10 for y in years} for i, c in enumerate(list(macro.COUNTRIES)[:12])}
        countries["USA"]["2028"] = None
        fetched = []

        def fetcher(ind, periods):
            fetched.append((ind, tuple(periods)))
            if ind == "LUR":
                raise OSError("403")
            return {"values": {ind: countries}}

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "macro.json")
            now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)
            self.assertEqual(macro.build(now, path=path, fetcher=fetcher), 12)
            self.assertEqual(fetched[0], ("NGDP_RPCH", tuple(years)))
            with open(path, encoding="utf-8") as f:
                out = json.load(f)
            self.assertEqual(out["years"], years)
            self.assertNotIn("LUR", out["ind"])
            usa = next(r for r in out["rows"] if r["c"] == "USA")
            self.assertEqual((usa["en"], usa["ru"]), ("United States", "США"))
            self.assertEqual(usa["v"]["NGDP_RPCH"][-1], None)
            fetched.clear()
            self.assertEqual(macro.build(now + timedelta(hours=3), path=path, fetcher=fetcher), 0)
            self.assertEqual(fetched, [])

    def test_moex_board(self):
        import moex
        sec = {"columns": ["SECID", "SHORTNAME", "LATNAME", "PREVPRICE", "LOTSIZE"],
               "data": [["SBER", "Сбербанк", "Sberbank", 300.0, 10], ["TATNP", "Татнфт 3ап", "Tatneft ap", 600.0, 1],
                        ["DEAD", "Неторг", "Dead ao", 1.0, 1], ["TINY", "Мелочь", "Tiny ao", 1.0, 1]] +
                       [[f"X{i}", f"X{i}", f"X{i} ao", 10.0, 1] for i in range(20)]}
        md = {"columns": ["SECID", "OPEN", "LOW", "HIGH", "LAST", "LASTTOPREVPRICE", "VALTODAY", "ISSUECAPITALIZATION", "UPDATETIME", "MARKETPRICE"],
              "data": [["SBER", 300, 299, 305, 303.3, 1.1, 5e9, 6.8e12, "14:05:00", None],
                       ["TATNP", 600, 590, 601, 595.0, -0.83, 2e8, 1.4e11, "14:04:00", None],
                       ["DEAD", None, None, None, None, None, 0, None, None, None]] +
                      [[f"X{i}", 10, 10, 10, 10.0, 0.0, 2e6, 1e6 * i, "13:00:00", None] for i in range(20)] +
                      [["TINY", 1, 1, 1, 1.0, 5.0, 5000, 1e6, "13:00:00", None]]}
        imoex = {"analytics": {"columns": ["indexid", "tradedate", "ticker", "shortnames", "secids", "weight"],
                               "data": [["IMOEX", "2026-10-14", "SBER", "Сбербанк", "SBER", 14.5]]}}

        def fetcher(url):
            return imoex if "IMOEX" in url else {"securities": sec, "marketdata": md}

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "moex.json")
            now = datetime(2026, 10, 15, 11, tzinfo=timezone.utc)
            self.assertEqual(moex.build(now, path=path, fetcher=fetcher), 22)
            with open(path, encoding="utf-8") as f:
                out = json.load(f)
            self.assertEqual(out["time"], "14:05:00")
            sber, tat = out["rows"][0], out["rows"][1]
            self.assertEqual((sber["s"], sber["sec"], sber["w"], sber["ch"]), ("SBER", "Financials", 14.5, 1.1))
            self.assertEqual((tat["en"], tat["sec"]), ("Tatneft pref", "Energy"))
            self.assertNotIn("DEAD", [r["s"] for r in out["rows"]])
            self.assertNotIn("TINY", [r["s"] for r in out["rows"]], "under 1 mln rubles of turnover and not in the index")
            self.assertEqual(moex.build(now + timedelta(minutes=20), path=path, fetcher=fetcher), 0)


class MapsAndMonitorsData(unittest.TestCase):

    def test_canada_and_australia_curves(self):
        boc = {"observations": [
            {"d": "2026-10-15", "BD.CDN.2YR.DQ.YLD": {"v": "2.50"}, "BD.CDN.5YR.DQ.YLD": {"v": "2.70"}, "BD.CDN.10YR.DQ.YLD": {"v": "3.10"}, "BD.CDN.LONG.DQ.YLD": {"v": "3.50"}},
            {"d": "2026-10-16", "BD.CDN.2YR.DQ.YLD": {"v": "2.55"}, "BD.CDN.5YR.DQ.YLD": {"v": "2.72"}, "BD.CDN.10YR.DQ.YLD": {"v": "3.12"}, "BD.CDN.LONG.DQ.YLD": {"v": "3.52"}},
            {"d": "bad"}]}
        rows = rates.parse_boc(boc)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1], (date(2026, 10, 16), {"2Y": 2.55, "5Y": 2.72, "10Y": 3.12, "30Y": 3.52}))
        cv = rates.curve_from_rows(rows, ["2Y", "5Y", "10Y", "30Y"])
        self.assertEqual(cv["t"], ["2Y", "5Y", "10Y", "30Y"])
        self.assertEqual(cv["y"][2], 3.12)
        rba = ("F2 CAPITAL MARKET YIELDS - GOVERNMENT BONDS - DAILY,,,,\nTitle,2 yr,3 yr,5 yr,10 yr\n"
               "Series ID,FCMYGBAG2D,FCMYGBAG3D,FCMYGBAG5D,FCMYGBAG10D\n15-Oct-2026,3.50,3.60,3.85,4.30\n16-Oct-2026,3.51,3.62,3.88,4.31\n")
        rows = rates.parse_rba(rba)
        self.assertEqual([r[0] for r in rows], [date(2026, 10, 15), date(2026, 10, 16)])
        self.assertEqual(rows[-1][1], {"2Y": 3.51, "3Y": 3.62, "5Y": 3.88, "10Y": 4.31})
        self.assertIn("CA", [c[0] for c in rates.CURVES])
        self.assertIn("AU", [c[0] for c in rates.CURVES])

    def test_overnight_rate_parsers(self):
        ny = {"refRates": [{"effectiveDate": "2026-10-20", "percentRate": 4.31}, {"effectiveDate": "2026-10-21", "percentRate": 4.33}]}
        self.assertEqual(rates.parse_nyfed(ny), ("2026-10-21", 4.33, 4.31))
        self.assertIsNone(rates.parse_nyfed({"refRates": []}))
        estr = "KEY,TIME_PERIOD,OBS_VALUE\nEST.B,2026-10-20,1.921\nEST.B,2026-10-21,1.923\n"
        self.assertEqual(rates.parse_estr(estr), ("2026-10-21", 1.923, 1.921))
        sonia = "DATE,IUDSOIA\n20 Oct 2026,3.9712\n21 Oct 2026,3.9705\n"
        self.assertEqual(rates.parse_sonia(sonia), ("2026-10-21", 3.9705, 3.9712))
        ru = "<tr><td>20.10.2026</td> <td class='right'>16,52</td></tr><tr><td>21.10.2026</td> <td>16,61</td></tr>"
        self.assertEqual(rates.parse_ruonia(ru), ("2026-10-21", 16.61, 16.52))
        rus = {"marketdata": {"columns": ["SECID", "TRADEDATE", "CURRENTVALUE", "LASTVALUE"], "data": [["RUSFAR", "2026-10-22", 16.4, 16.3]]}}
        self.assertEqual(rates.parse_rusfar(rus), ("2026-10-22", 16.4, 16.3))
        self.assertIsNone(rates.parse_rusfar({"marketdata": {"columns": [], "data": []}}))

    def test_money_markets_keep_old_values_on_failure(self):
        def ok(t):
            return ("2026-10-21", 4.33, 4.31)

        def broken(t):
            raise OSError("timeout")

        old = [{"k": "ESTR", "c": "EA", "en": "x", "ru": "x", "date": "2026-10-01", "v": 1.9, "prev": None}]
        mm = [("SOFR", "US", "a", "а", ok), ("ESTR", "EA", "b", "б", broken), ("SONIA", "UK", "c", "в", broken)]
        with mock.patch.object(rates, "MM", mm):
            out = rates.money_markets(date(2026, 10, 22), old)
        self.assertEqual([x["k"] for x in out], ["SOFR", "ESTR"])
        self.assertEqual(out[0]["v"], 4.33)
        self.assertEqual(out[1]["date"], "2026-10-01")

    def test_wpe_parse_and_build(self):
        import wpe
        qs = {"summaryDetail": {"trailingPE": {"raw": 27.3461}, "yield": {"raw": 0.0118}, "totalAssets": {"raw": 6.5e11}},
              "defaultKeyStatistics": {"ytdReturn": {"raw": 0.1432}, "52WeekChange": {"raw": 0.21}},
              "topHoldings": {"equityHoldings": {"priceToEarnings": {"raw": 0.04}, "priceToBook": {"raw": 0.2}, "priceToSales": {"raw": 3.1}}},
              "price": {"regularMarketChangePercent": {"raw": -0.0042}, "regularMarketPrice": {"raw": 671.2}}}
        r = wpe.parse(qs)
        self.assertEqual(r["pe"], 27.35)
        self.assertEqual(r["pb"], 5.0)
        self.assertEqual(r["ps"], 3.1)
        self.assertEqual(r["dy"], 1.18)
        self.assertEqual(r["ch"], -0.42)
        self.assertEqual(r["rytd"], 14.32)
        r2 = wpe.parse({"topHoldings": {"equityHoldings": {"priceToEarnings": {"raw": 0.05}}}})
        self.assertEqual(r2["pe"], 20.0)
        self.assertIsNone(r2["dy"])

        class S:
            def __init__(self, fail):
                self.fail = fail

            def quote_summary(self, sym, modules):
                if sym in self.fail:
                    raise OSError("429")
                return qs

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "wpe.json")
            now = datetime(2026, 10, 22, 6, tzinfo=timezone.utc)
            n = wpe.build(now, path=path, session=S({"EWZ"}), sleep=0)
            self.assertEqual(n, len(wpe.MARKETS) - 1)
            with open(path, encoding="utf-8") as f:
                out = json.load(f)
            self.assertEqual(out["rows"][0]["s"], "SPY")
            self.assertNotIn("EWZ", [x["s"] for x in out["rows"]])
            self.assertEqual(wpe.build(now + timedelta(hours=2), path=path, session=S(set()), sleep=0), 0)
            all_but = {m[1] for m in wpe.MARKETS[2:]}
            self.assertEqual(wpe.build(now + timedelta(days=1), path=path, session=S(all_but), sleep=0), 0)
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["updated"], now.isoformat())

    def test_macro_world_map(self):
        import macro
        payloads = {"NGDP_RPCH": {"values": {"NGDP_RPCH": {"USA": {"2026": 1.94}, "ARG": {"2026": 4.46}, "WEOWORLD": {"2026": 3.1}, "XYZ": {"2025": 1}}}},
                    "PCPIPCH": {"values": {"PCPIPCH": {"ARG": {"2026": 41.27}, "USA": {"2026": None}}}},
                    "NGDPD": {"values": {"NGDPD": {"USA": {"2026": 30000}}}}}
        m = macro.world_map(payloads, 2026)
        self.assertEqual(m["year"], 2026)
        self.assertEqual(m["NGDP_RPCH"], {"USA": 1.9, "ARG": 4.5})
        self.assertEqual(m["PCPIPCH"], {"ARG": 41.3})
        self.assertNotIn("NGDPD", m)


class TreasuryAuctions(unittest.TestCase):
    def test_clean_both_sources(self):
        import auctions
        fd = {"cusip": "912797VA2", "security_type": "Bill", "security_term": "6-Week", "auction_date": "2026-10-20", "issue_date": "2026-10-22",
              "maturity_date": "2026-12-03", "high_yield": "null", "high_discnt_rate": "3.885", "high_investment_rate": "3.962", "int_rate": "null",
              "bid_to_cover_ratio": "2.91", "offering_amt": "95000000000", "reopening": "No", "inflation_index_security": "No", "floating_rate": "No"}
        r = auctions.clean(fd)
        self.assertEqual(r, {"cusip": "912797VA2", "security_type": "Bill", "security_term": "6-Week", "auction_date": "2026-10-20", "issue_date": "2026-10-22",
                             "maturity_date": "2026-12-03", "high_discnt_rate": 3.885, "high_investment_rate": 3.962, "bid_to_cover_ratio": 2.91, "offering_amt": 95000000000})
        td = {"cusip": "91282CRR4", "securityType": "Note", "securityTerm": "5-Year", "auctionDate": "2026-10-22T00:00:00", "issueDate": "2026-10-30T00:00:00",
              "maturityDate": "2031-10-15T00:00:00", "highYield": "", "interestRate": "", "offeringAmount": "26000000000", "tips": "Yes", "floatingRate": "No"}
        r = auctions.clean(td, auctions.TD_FIELDS)
        self.assertEqual((r["auction_date"], r["inflation_index_security"], r["offering_amt"]), ("2026-10-22", "Yes", 26000000000))
        self.assertNotIn("high_yield", r)
        self.assertIsNone(auctions.clean({"cusip": "X", "security_type": "CMB", "auction_date": "2026-10-20"}))

    def test_build_falls_back_and_keeps_fresh_file(self):
        import auctions
        calls = []

        def bill(i, **kw):
            return {"cusip": f"9127{i:05d}", "securityType": "Bill", "securityTerm": "4-Week", "auctionDate": f"2026-09-{1 + i % 28:02d}T00:00:00", **kw}

        def fetch(url):
            calls.append(url)
            if "fiscaldata" in url:
                raise OSError("525")
            if "upcoming" in url:
                return [bill(99, auctionDate="2026-10-27T00:00:00")]
            return [bill(i, bidToCoverRatio="2.8") for i in range(30)] if "type=Bill" in url else []

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "auctions.json")
            now = datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
            self.assertEqual(auctions.build(now, path=path, fetch=fetch), 31)
            self.assertIn("fields=cusip", calls[0])
            with open(path, encoding="utf-8") as f:
                out = json.load(f)
            self.assertEqual(out["source"], "TreasuryDirect")
            self.assertEqual(out["rows"][0]["auction_date"], "2026-10-27")
            calls.clear()
            self.assertEqual(auctions.build(now + timedelta(hours=2), path=path, fetch=fetch), 0)
            self.assertEqual(calls, [])


class GitSync(unittest.TestCase):

    def git(self, cwd, *a, ok=True):
        import subprocess
        r = subprocess.run(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", *a], capture_output=True, text=True)
        if ok:
            self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    @staticmethod
    def write(root, name, text):
        p = os.path.join(root, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)

    @staticmethod
    def read(root, name):
        with open(os.path.join(root, name)) as f:
            return f.read()

    def setUp(self):
        import news_bot
        news_bot._published.clear()
        self._tmp = tempfile.TemporaryDirectory()
        d = self.d = self._tmp.name
        self.remote, self.bot, self.dev = (os.path.join(d, x) for x in ("remote.git", "bot", "dev"))
        self.git(d, "init", "-q", "--bare", "-b", "main", self.remote)
        self.git(d, "clone", "-q", self.remote, self.dev)
        for name, text in (("code.py", "v1"), ("state.json", "{}"), ("docs/index.html", "site"), ("docs/data.json", "{}")):
            self.write(self.dev, name, text)
        self.git(self.dev, "add", "-A"); self.git(self.dev, "commit", "-qm", "init"); self.git(self.dev, "push", "-q", "origin", "main")
        self.git(d, "clone", "-q", self.remote, self.bot)

    def tearDown(self):
        self._tmp.cleanup()

    def remote_files(self, ref):
        return self.git(self.remote, "ls-tree", "-r", "--name-only", ref).splitlines()

    def test_publish_to_data_branch(self):
        import news_bot
        main_before = self.git(self.remote, "rev-parse", "main")
        self.write(self.bot, "state.json", '{"s": 1}')
        self.write(self.bot, "docs/data.json", '{"bot": 1}')
        self.write(self.bot, "docs/co/AAPL.json", "{}")
        news_bot.git_sync("push", self.bot)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), main_before, "no commits to main")
        self.assertEqual(sorted(self.remote_files("gh-pages")),
                         ["docs/co/AAPL.json", "docs/data.json", "docs/index.html", "state.json"])
        self.assertEqual(self.git(self.remote, "show", "gh-pages:docs/data.json"), '{"bot": 1}')
        first = self.git(self.remote, "rev-parse", "gh-pages")
        news_bot.git_sync("push", self.bot)
        self.assertEqual(self.git(self.remote, "rev-parse", "gh-pages"), first, "nothing changed — no push")
        self.write(self.bot, "docs/data.json", '{"bot": 2}')
        news_bot.git_sync("push", self.bot)
        self.assertEqual(self.git(self.remote, "show", "gh-pages:docs/data.json"), '{"bot": 2}')
        self.assertEqual(self.git(self.remote, "rev-list", "--count", "gh-pages"), "1", "the data branch has no history")
        self.assertEqual(self.git(self.bot, "status", "--porcelain", "--", "code.py"), "", "the bot's own checkout is untouched")

    def test_pull_keeps_data_and_fresh_checkout_restores_it(self):
        import news_bot
        self.write(self.bot, "state.json", '{"s": 1}')
        self.write(self.bot, "docs/co/AAPL.json", '{"a": 1}')
        news_bot.git_sync("push", self.bot)
        self.write(self.dev, "code.py", "v2"); self.git(self.dev, "commit", "-qam", "code"); self.git(self.dev, "push", "-q")
        self.write(self.bot, "state.json", '{"s": 2}')
        news_bot.git_sync("pull", self.bot)
        self.assertEqual(self.read(self.bot, "code.py"), "v2")
        self.assertEqual(self.read(self.bot, "state.json"), '{"s": 2}', "a running bot keeps its own data")
        fresh = os.path.join(self.d, "fresh")
        self.git(self.d, "clone", "-q", self.remote, fresh)
        self.assertEqual(self.read(fresh, "state.json"), "{}")
        news_bot.git_sync("pull", fresh)
        self.assertEqual(self.read(fresh, "state.json"), '{"s": 1}')
        self.assertEqual(self.read(fresh, "docs/co/AAPL.json"), '{"a": 1}')
        self.assertEqual(self.read(fresh, "docs/index.html"), "site", "the site's code stays main's")

    def test_no_data_branch_yet(self):
        import news_bot
        news_bot.git_sync("pull", self.bot)
        self.assertEqual(self.read(self.bot, "state.json"), "{}")
        self.assertEqual(self.git(self.bot, "status", "--porcelain"), "")

    def test_data_leaves_main(self):
        import news_bot
        self.write(self.bot, "state.json", '{"s": 1}')
        self.write(self.bot, "docs/data.json", '{"bot": 1}')
        news_bot.git_sync("push", self.bot)
        self.write(self.dev, ".gitignore", "state.json\ndocs/data.json\n")
        self.git(self.dev, "rm", "-q", "--cached", "state.json", "docs/data.json")
        self.git(self.dev, "add", ".gitignore"); self.git(self.dev, "commit", "-qm", "data leaves main"); self.git(self.dev, "push", "-q")
        self.write(self.bot, "state.json", '{"s": 2}')
        news_bot.git_sync("pull", self.bot)
        self.assertTrue(os.path.exists(os.path.join(self.bot, ".gitignore")), "the bot has the new main")
        self.assertEqual(self.read(self.bot, "state.json"), '{"s": 2}')
        self.assertEqual(self.read(self.bot, "docs/data.json"), '{"bot": 1}')
        self.assertEqual(self.git(self.bot, "status", "--porcelain"), "", "the data is ignored now")
        news_bot.git_sync("push", self.bot)
        self.assertEqual(self.git(self.remote, "show", "gh-pages:state.json"), '{"s": 2}')
        self.assertNotIn("state.json", self.remote_files("main"))
        fresh = os.path.join(self.d, "fresh")
        self.git(self.d, "clone", "-q", self.remote, fresh)
        self.assertFalse(os.path.exists(os.path.join(fresh, "state.json")))
        news_bot.git_sync("pull", fresh)
        self.assertEqual(self.read(fresh, "state.json"), '{"s": 2}')
        self.assertEqual(self.read(fresh, "docs/data.json"), '{"bot": 1}')

    def test_old_data_commit_and_stuck_rebase(self):
        import subprocess
        import news_bot
        self.write(self.bot, "state.json", '{"old": 1}'); self.git(self.bot, "commit", "-qam", "news update")
        self.write(self.dev, ".gitignore", "state.json\n")
        self.write(self.dev, "code.py", "v3")
        self.git(self.dev, "rm", "-q", "--cached", "state.json")
        self.git(self.dev, "add", "-A"); self.git(self.dev, "commit", "-qm", "code 3"); self.git(self.dev, "push", "-q")
        self.git(self.bot, "fetch", "-q")
        subprocess.run(["git", "-C", self.bot, "-c", "user.name=t", "-c", "user.email=t@t", "rebase", "-q", "-i", "--exec", "false",
                        "origin/main"], capture_output=True, env={**os.environ, "GIT_SEQUENCE_EDITOR": "true"})
        self.assertTrue(os.path.isdir(os.path.join(self.bot, ".git", "rebase-merge")), "the test set up a stuck rebase")
        news_bot.git_sync("pull", self.bot)
        self.assertFalse(os.path.isdir(os.path.join(self.bot, ".git", "rebase-merge")))
        self.assertEqual(self.read(self.bot, "code.py"), "v3")
        self.assertEqual(self.read(self.bot, "state.json"), '{"old": 1}')
        news_bot.git_sync("push", self.bot)
        self.assertEqual(self.git(self.remote, "show", "gh-pages:state.json"), '{"old": 1}')


class IpoCalendar(unittest.TestCase):
    PAYLOAD = {"data": {
        "upcoming": {"upcomingTable": {"rows": [
            {"dealID": "1", "proposedTickerSymbol": "NEWC", "companyName": "New Co", "proposedExchange": "NYSE",
             "proposedSharePrice": "17.00-19.00", "sharesOffered": "9,722,222", "expectedPriceDate": "10/22/2026",
             "dollarValueOfSharesOffered": "$212,500,000"},
            {"dealID": "0", "proposedTickerSymbol": "OLDC", "companyName": "Old Co", "expectedPriceDate": "10/01/2026"}]}},
        "priced": {"rows": [{"dealID": "1273626-119431", "proposedTickerSymbol": "IAM", "companyName": "Iambic Therapeutics, Inc.",
                             "proposedExchange": "NASDAQ Global Select", "proposedSharePrice": "16.00", "sharesOffered": "9,375,000",
                             "pricedDate": "10/15/2026", "dollarValueOfSharesOffered": "$150,000,000", "dealStatus": "Priced"},
                            {"dealID": "9", "proposedTickerSymbol": "AGED", "companyName": "Aged Co", "pricedDate": "06/01/2026"}]},
        "filed": {"rows": [{"dealID": "1405985-119627", "proposedTickerSymbol": None, "companyName": "EuroSPAC Acquisition Corp.",
                            "filedDate": "10/13/2026", "dollarValueOfSharesOffered": "$143,750,000"}]},
        "withdrawn": None}}

    def test_parse_and_select(self):
        rows = ipo.select(ipo.parse(self.PAYLOAD) + ipo.parse(self.PAYLOAD), "2026-10-18")
        self.assertEqual([(r["symbol"], r["status"]) for r in rows],
                         [("NEWC", "expected"), ("IAM", "priced"), (None, "filed")], "past upcoming and old deals dropped, no duplicates")
        self.assertEqual(rows[0], {"date": "2026-10-22", "symbol": "NEWC", "name": "New Co", "exchange": "NYSE", "price": "17.00-19.00",
                                   "numberOfShares": 9722222, "totalSharesValue": 212500000, "status": "expected"})
        self.assertEqual(rows[1]["date"], "2026-10-15")

    def test_build_writes_file_and_keeps_old_one_on_failure(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ipo.json")
            now = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)
            asked = []
            self.assertEqual(ipo.build(now, path, lambda m: asked.append(m) or self.PAYLOAD), 3)
            self.assertEqual(asked, ["2026-09", "2026-10", "2026-11"])
            with open(path) as f:
                self.assertEqual(len(json.load(f)["ipo"]), 3)
            self.assertEqual(ipo.build(now + timedelta(minutes=30), path, lambda m: self.PAYLOAD), 0, "fresh file is kept")

            def down(m):
                raise OSError("no answer")
            self.assertEqual(ipo.build(now + timedelta(hours=3), path, down), 0)
            with open(path) as f:
                self.assertEqual(len(json.load(f)["ipo"]), 3, "the old file survives an outage")


if __name__ == "__main__":
    unittest.main(verbosity=2)
