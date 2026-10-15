"""Тесты разборщиков данных для терминала: python3 -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
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

    def test_earnings_calendar_split_when_cut_off(self):
        # Finnhub keeps only the last 1500 rows of a long range: JPM (early) would be lost without splitting
        def get(a, b):
            days = (date.fromisoformat(b) - date.fromisoformat(a)).days + 1
            rows = [{"symbol": "JPM", "date": "2026-10-13"}] if a <= "2026-10-13" <= b else []
            rows += [{"symbol": "AAPL", "date": "2026-11-02"}] if a <= "2026-11-02" <= b else []
            rows += [{"symbol": "ZZZ", "date": b}] * (60 * days)   # ~60 small companies a day
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
        self.assertEqual(item["lang"], "en")
        self.assertEqual(item["title_ru"], "Акции Tesla обвалились после отзыва")


class NewsBotRunBothLanguages(unittest.TestCase):
    """A whole run without network: every reader gets the messages in their own language."""

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
                   "DIGEST_HOUR": "0", "MORNING_HOUR": "-1", "CALENDAR": "no", "TRADES": "no", "ANTHROPIC_API_KEY": "",
                   "FRED_API_KEY": "", "QUIET_HOURS": "0-0"}
            with mock.patch.dict(os.environ, env), \
                    mock.patch.object(news_bot, "collect", side_effect=lambda now: (batches.pop(0), {})), \
                    mock.patch.object(news_bot, "fetch_quotes", return_value=[]), \
                    mock.patch.object(news_bot, "fetch_subscribers", return_value=(["200", "300"], {"300": "ru"})), \
                    mock.patch.object(news_bot, "translate", side_effect=fake_translate), \
                    mock.patch.object(news_bot, "update_extras", return_value=""), \
                    mock.patch.object(news_bot, "push_live"), \
                    mock.patch.object(news_bot.Telegram, "_call", fake_call):
                news_bot.run()                       # first run: the owner gets the start message
                first = [s for s in sent]
                with open(env["STATE_FILE"], encoding="utf-8") as f:
                    st = json.load(f)
                st["last_digest"] = ""               # let the evening digest go out on the next run
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
        self.assertIn("[en] ЦБ сохранил ключевую ставку", en)          # Russian story translated for English readers
        self.assertIn("#BankOfRussia", en)
        self.assertIn("Bank of Russia", en)
        self.assertIn("Top stories of", en)                          # the digest
        self.assertIn("Экономика ·", ru)
        self.assertIn("[ru] Oil jumps after OPEC", ru)                # English story translated for Russian readers
        self.assertIn("ЦБ сохранил ключевую ставку на уровне 16%", ru)
        self.assertIn("#нефть", ru)
        self.assertIn("ЦБ РФ", ru)
        self.assertIn("Главное за", ru)
        self.assertEqual(owner, en, "the owner has no language set — English")
        buttons = [json.loads(f["reply_markup"]) for c, _, f in sent if c == "300" and f.get("reply_markup")]
        self.assertTrue(buttons and "lang=ru" in buttons[0]["inline_keyboard"][0][0]["web_app"]["url"])
        # data.json for the terminal: original + translation, English tags and sources
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


class CompanyData(unittest.TestCase):
    """company.py: Yahoo quoteSummary, dividend events, Nasdaq short interest -> docs/co/<T>.json"""

    def setUp(self):
        import company
        self.co = company
        self.aapl = json.loads(fx("yahoo_qs_AAPL.json"))

    def test_summary_sections(self):
        s = self.co.clean(self.co.parse_summary(self.aapl))
        self.assertEqual(s["profile"]["name"], "Apple Inc.")
        self.assertEqual(s["profile"]["officers"][0]["n"], "Mr. Timothy D. Cook")
        self.assertEqual(s["stats"]["gm"], 48.65)            # 0.4865 -> percent
        self.assertIsInstance(s["targets"]["n"], int)
        self.assertEqual(s["targets"]["key"], "buy")
        self.assertEqual(s["ratings"][0]["d"], "2026-10-12")  # newest first
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
            with open(os.path.join(d, "MSFT.json"), "w") as f:   # fresh: skipped
                json.dump({"s": "MSFT", "updated": "2026-10-15T08:00:00+00:00"}, f)
            with open(os.path.join(d, "AAPL.json"), "w") as f:   # old: refreshed, short rows kept
                json.dump({"s": "AAPL", "updated": "2026-10-14T00:00:00+00:00", "short": {"rows": [{"d": "2026-08-29", "sh": 1}]}}, f)
            fs = FakeSession()
            n = co.build(now, limit=5, sleep=0, tickers=["MSFT", "AAPL", "BRK.B"], out_dir=d, session=fs)
            self.assertEqual(n, 1)
            self.assertEqual(fs.calls, ["BRK-B", "AAPL"])          # never-built first, MSFT is fresh
            out = co.load(os.path.join(d, "AAPL.json"))
            self.assertEqual(out["updated"], now.isoformat())
            self.assertEqual(out["div"]["hist"][0], ["2026-08-10", 0.27])
            self.assertEqual(out["short"]["rows"], [{"d": "2026-08-29", "sh": 1}])
            self.assertEqual(out["wiki"]["ru"]["x"], "Американская корпорация")
            self.assertFalse(os.path.exists(os.path.join(d, "BRK.B.json")))


def cboe_payload():
    """A tiny Cboe chain: price 100, two expiries, strikes 90/100/110 (+ one expired, one junk code)."""
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
        # calls pay above their strike, puts below: the cheapest expiry price for writers here is 100
        self.assertEqual(options.max_pain({90: 100, 100: 300, 110: 800}, {90: 500, 100: 300, 110: 10}), 100)

    def test_snapshot(self):
        import options
        s = options.summarize(cboe_payload(), date(2026, 10, 15))
        self.assertEqual([e["d"] for e in s["exp"]], ["2026-10-16", "2026-11-20"])   # the expired one is skipped
        e = s["exp"][0]
        self.assertEqual((e["dte"], e["atm"], e["c_vol"], e["p_vol"], e["c_oi"], e["p_oi"]), (1, 100.0, 80, 71, 1200, 810))
        self.assertEqual(e["iv"], 32.0)
        self.assertEqual(e["move"], 4.0)            # ATM straddle: 2.1 + 1.9
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

            now = datetime(2026, 10, 15, 15, tzinfo=timezone.utc)   # Thursday, market open
            with open(os.path.join(d, "SPY.json"), "w") as f:
                json.dump({"updated": "2026-10-15T14:30:00+00:00"}, f)   # fresh
            with open(os.path.join(d, "AAPL.json"), "w") as f:
                json.dump({"updated": "2026-10-15T13:00:00+00:00"}, f)   # 2 h old core ticker: due
            with open(os.path.join(d, "KO.json"), "w") as f:
                json.dump({"updated": "2026-10-15T08:00:00+00:00"}, f)   # 7 h old other ticker: not due
            summ = os.path.join(d, "options.json")
            n = options.build(now, sleep=0, tickers=["SPY", "AAPL", "KO", "BAD"], out_dir=d, summary_path=summ, fetcher=fetcher)
            self.assertEqual((n, sorted(got)), (1, ["AAPL", "BAD"]))
            rows = options.load(summ)["rows"]
            self.assertEqual(rows[0]["s"], "AAPL")
            self.assertEqual(rows[0]["n"], "Apple")


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
            self.assertNotIn("LUR", out["ind"])                      # the failed indicator is left out
            usa = next(r for r in out["rows"] if r["c"] == "USA")
            self.assertEqual((usa["en"], usa["ru"]), ("United States", "США"))
            self.assertEqual(usa["v"]["NGDP_RPCH"][-1], None)
            fetched.clear()
            self.assertEqual(macro.build(now + timedelta(hours=3), path=path, fetcher=fetcher), 0)   # fresh: no requests
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
            # same data 20 minutes later: nothing is rewritten
            self.assertEqual(moex.build(now + timedelta(minutes=20), path=path, fetcher=fetcher), 0)


class GitSync(unittest.TestCase):
    """The bot's push to GitHub survives a race with other commits and a rebase that got stuck."""

    def git(self, cwd, *a):
        import subprocess
        r = subprocess.run(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", *a], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def test_race_and_stuck_rebase(self):
        import news_bot
        with tempfile.TemporaryDirectory() as d:
            remote, bot, dev = (os.path.join(d, x) for x in ("remote.git", "bot", "dev"))
            self.git(d, "init", "-q", "--bare", "-b", "main", remote)
            self.git(d, "clone", "-q", remote, dev)
            os.makedirs(os.path.join(dev, "docs"))
            for name, text in (("code.py", "v1"), ("state.json", "{}"), ("docs/data.json", "{}")):
                with open(os.path.join(dev, name), "w") as f:
                    f.write(text)
            self.git(dev, "add", "-A"); self.git(dev, "commit", "-qm", "init"); self.git(dev, "push", "-q", "origin", "main")
            self.git(d, "clone", "-q", remote, bot)

            # the bot writes data while a developer pushes code and (to force a clash) touches the same data file
            with open(os.path.join(bot, "docs", "data.json"), "w") as f:
                f.write('{"bot": 1}')
            os.makedirs(os.path.join(bot, "docs", "co"))
            with open(os.path.join(bot, "docs", "co", "AAPL.json"), "w") as f:
                f.write("{}")
            with open(os.path.join(dev, "code.py"), "w") as f:
                f.write("v2")
            with open(os.path.join(dev, "docs", "data.json"), "w") as f:
                f.write('{"dev": 1}')
            self.git(dev, "commit", "-qam", "code"); self.git(dev, "push", "-q", "origin", "main")
            news_bot.git_sync("push", bot)
            self.git(dev, "pull", "-q")
            with open(os.path.join(dev, "code.py")) as f:
                self.assertEqual(f.read(), "v2", "the developer's code is kept")
            with open(os.path.join(dev, "docs", "data.json")) as f:
                self.assertEqual(f.read(), '{"bot": 1}', "the bot's data wins")
            self.assertTrue(os.path.exists(os.path.join(dev, "docs", "co", "AAPL.json")))

            # a rebase stuck half-way (HEAD detached) is aborted and the push still goes through
            with open(os.path.join(dev, "code.py"), "w") as f:
                f.write("v3")
            self.git(dev, "commit", "-qam", "code 3"); self.git(dev, "push", "-q", "origin", "main")
            with open(os.path.join(bot, "state.json"), "w") as f:
                f.write('{"x": 1}')
            self.git(bot, "commit", "-qam", "local")
            self.git(bot, "fetch", "-q")
            import subprocess
            subprocess.run(["git", "-C", bot, "-c", "user.name=t", "-c", "user.email=t@t", "rebase", "-q", "-i", "--exec", "false", "origin/main"],
                           capture_output=True, env={**os.environ, "GIT_SEQUENCE_EDITOR": "true"})
            self.assertTrue(os.path.isdir(os.path.join(bot, ".git", "rebase-merge")), "the test set up a stuck rebase")
            news_bot.git_sync("pull", bot)
            news_bot.git_sync("push", bot)
            self.git(dev, "pull", "-q")
            with open(os.path.join(dev, "state.json")) as f:
                self.assertEqual(f.read(), '{"x": 1}')
            with open(os.path.join(dev, "code.py")) as f:
                self.assertEqual(f.read(), "v3")


if __name__ == "__main__":
    unittest.main(verbosity=2)
