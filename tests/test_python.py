"""Тесты разборщиков данных для терминала: python3 -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import ai          # noqa: E402
import rates       # noqa: E402
import stocks      # noqa: E402

FX = os.path.join(HERE, "fixtures")


def fx(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return f.read()


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
        self.assertGreater(m["mcap"], 1_000_000)          # Apple: больше триллиона (в млн $)
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
        self.assertEqual([x["s"] for x in out], ["JPM", "MSFT", "AAPL"])   # по дате, до открытия раньше
        self.assertEqual(out[2]["n"], "Apple")
        self.assertEqual(out[2]["rev_e"], 115327453620)

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
        self.assertEqual(a["rev"], 400)                     # свежий показатель, а не устаревший «Revenues»
        self.assertEqual(a["fcf"], 110 - 20)
        self.assertEqual(a["cash"], 55)
        self.assertEqual(a["eps"], 6.5)
        q = {r["end"]: r for r in fin["quarterly"]}
        self.assertEqual(q["2025-09-30"]["rev"], 400 - 120 - 90 - 95)   # 4-й квартал = год − 3 квартала
        self.assertEqual(q["2025-03-31"]["ocf"], 20)                     # из нарастающего итога
        self.assertEqual(q["2025-06-30"]["ocf"], 30)
        self.assertEqual(q["2025-09-30"]["ocf"], 30)
        self.assertEqual(q["2025-06-30"]["fcf"], 30 - 5)
        self.assertEqual(fin["quarterly"][0]["end"], "2025-12-31")      # новые сверху

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
                # второй запуск: цена выросла — капитализация пересчитана, мультипликаторы обновляются дальше
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
        self.assertIsNotNone(c["w"])                       # неделю назад есть в выборке
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
        # ставка 3,88; заседание 28 октября (конец месяца → берём ноябрь), 9 декабря (середина месяца)
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
            self.assertEqual(news_bot.code_hash(d), h1)          # данные не считаются кодом
            with open(os.path.join(d, "a.py"), "w") as f:
                f.write("x = 2")
            self.assertNotEqual(news_bot.code_hash(d), h1)

    def test_loop_reloads_after_pull_and_keeps_deadline(self):
        import news_bot
        hashes = iter(["old", "new"])
        with mock.patch.object(news_bot, "code_hash", side_effect=lambda repo: next(hashes)), \
                mock.patch.object(news_bot, "git_sync"), \
                mock.patch.object(news_bot, "run") as run, \
                mock.patch.object(news_bot.os, "execv", side_effect=SystemExit("reloaded")) as ex, \
                mock.patch.dict(os.environ, {"LOOP_DEADLINE": "123456.5"}):
            news_bot.loop(5, True)
            ex.assert_called_once()
            run.assert_not_called()
            self.assertEqual(os.environ["LOOP_DEADLINE"], "123456.5")


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
