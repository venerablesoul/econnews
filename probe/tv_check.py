import json, sys, threading, http.server, socketserver, os, time
from playwright.sync_api import sync_playwright
CANDS = {
 "S&P": ["SP:SPX", "FOREXCOM:SPXUSD", "CAPITALCOM:US500", "OANDA:SPX500USD", "AMEX:SPY"],
 "Nasdaq": ["NASDAQ:IXIC", "NASDAQ:NDX", "FOREXCOM:NSXUSD", "CAPITALCOM:US100"],
 "DJI": ["DJ:DJI", "FOREXCOM:DJI", "CAPITALCOM:US30", "TVC:DJI"],
 "RTY": ["TVC:RUT", "CAPITALCOM:RTY", "AMEX:IWM"], "VIX": ["TVC:VIX", "CAPITALCOM:VIX"],
 "SX5E": ["TVC:SX5E", "CAPITALCOM:EU50"], "DAX": ["XETR:DAX", "CAPITALCOM:DE40", "TVC:DEU40"],
 "UKX": ["TVC:UKX", "CAPITALCOM:UK100"], "CAC": ["EURONEXT:PX1", "CAPITALCOM:FR40", "TVC:CAC40"],
 "NKY": ["TVC:NI225", "CAPITALCOM:J225"], "HSI": ["TVC:HSI", "CAPITALCOM:HK50"], "SHCOMP": ["SSE:000001", "TVC:SHCOMP"],
 "SENSEX": ["BSE:SENSEX", "TVC:SENSEX"], "IMOEX": ["MOEX:IMOEX", "RUS:IMOEX"], "DXY": ["TVC:DXY", "CAPITALCOM:DXY"],
 "EUR/USD": ["FX:EURUSD"], "USDJPY": ["FX:USDJPY"], "Brent": ["TVC:UKOIL"], "WTI": ["TVC:USOIL"], "Gas": ["CAPITALCOM:NATURALGAS"],
 "Gold": ["TVC:GOLD"], "Silver": ["TVC:SILVER"], "Platinum": ["TVC:PLATINUM"], "Copper": ["CAPITALCOM:COPPER"], "Wheat": ["CAPITALCOM:WHEAT"],
 "UST10": ["TVC:US10Y"], "UST3M": ["TVC:US03MY"], "BTC": ["BINANCE:BTCUSDT"], "AAPL": ["NASDAQ:AAPL"], "SBER": ["MOEX:SBER"],
}
os.chdir("probe")
srv = socketserver.TCPServer(("127.0.0.1", 8765), http.server.SimpleHTTPRequestHandler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
out = {}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 950, "height": 560})
    for key, syms in CANDS.items():
        for s in syms:
            p = ctx.new_page()
            p.goto("http://127.0.0.1:8765/tv.html?s=" + s)
            verdict, txt = "ok?", ""
            for _ in range(12):
                time.sleep(1)
                txt = " ".join(f.evaluate("() => document.body ? document.body.innerText : ''") for f in p.frames[1:] if True)[:3000]
                if "only available on TradingView" in txt:
                    verdict = "RESTRICTED"; break
                if "Invalid symbol" in txt or "invalid symbol" in txt.lower():
                    verdict = "INVALID"; break
            if verdict == "ok?" and not any(c.isdigit() for c in txt):
                verdict = "EMPTY"
            out[s] = verdict
            p.close()
    b.close()
print(json.dumps(out))
