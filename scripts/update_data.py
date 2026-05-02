"""
Updates data.json with the latest 9-1 month momentum signal for the web app.
Filters S&P 500 to Shariah-compliant companies only.
Runs daily via GitHub Actions.
"""
import json, time, os, sys
from datetime import datetime, timezone
import pandas as pd
import numpy as np
import yfinance as yf

# SPUS ETF (SP Funds S&P 500 Sharia Industry Exclusions ETF) holdings.
# Source: sp-funds.com — updated May 2026. ~221 constituents.
# The index excludes: financials (banks, insurance, asset managers, exchanges),
# defense/aerospace, alcohol, tobacco, gambling, and applies debt/interest-income
# ratio screens quarterly. Cross-check individual holdings at Zoya or Islamicly
# before buying, as financial-ratio compliance can change each quarter.
HALAL_SP500 = [
    "NVDA","AAPL","MSFT","GOOGL","AVGO","TSLA","LLY","XOM","MU","AMD",
    "JNJ","ABBV","CSCO","PG","HD","LRCX","AMAT","GEV","ORCL","MRK",
    "TXN","LIN","KLAC","PEP","IBM","ADI","QCOM","TMO","ANET","TJX",
    "GILD","CRM","ISRG","UNP","ABT","COP","UBER","SNDK","WELL","STX",
    "PANW","BKNG","LOW","PLD","GLW","VRT","NEM","DHR","ACN","CRWD",
    "SYK","PWR","VRTX","TT","MDT","EQIX","ADBE","MCK","CEG","NOW",
    "CDNS","JCI","CMI","SNPS","WM","BSX","ORLY","SLB","CSX","FCX",
    "CRH","EMR","UPS","MMM","MDLZ","SHW","EOG","NXPI","CIEN","ROST",
    "MPWR","CL","NSC","BKR","ITW","REGN","ECL","APD","DASH","FIX",
    "TEL","TGT","COHR","AZO","URI","CTAS","COR","MNST","CARR","TER",
    "CTVA","FAST","MCHP","NKE","NUE","FTNT","ADSK","EW","GWW","EBAY",
    "CAH","IDXX","ROK","WAB","BDX","DHI","ON","RSG","GRMN","HAL",
    "ROP","ODFL","VMC","MLM","A","KVUE","ADM","DVN","JBL","KMB",
    "RMD","OTIS","DOV","TPR","STLD","CPRT","CTSH","WAT","CTRA","IR",
    "EXPE","HUBB","HSY","GEHC","XYL","BIIB","WDAY","ULTA","PHM","PPG",
    "AVB","TPL","CHD","DXCM","VLTO","CHRW","LH","FICO","EFX","MTD",
    "VRSN","FSLR","EXPD","WSM","DD","WST","CF","STE","JBHT","NTAP",
    "ALB","EL","PKG","TRMB","CDW","PTC","ROL","FFIV","WY","LII",
    "TSCO","LULU","MAS","SMCI","CSGP","INCY","NDSN","MKC","GNRC","TYL",
    "MAA","RL","GPC","COO","AVY","DECK","PNR","IEX","AKAM","TECH",
    "ALLE","PODD","IT","TTD","RVTY","BBY","ZBRA","CLX","CPT","ALGN",
    "GDDY","SWKS","BLDR","CRL","POOL","AOS","EPAM",
]

print(f"Shariah-compliant universe: {len(HALAL_SP500)} tickers")

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data.json")
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

def download(tickers):
    frames = []
    bs = 50
    for i in range(0, len(tickers), bs):
        batch = tickers[i:i+bs]
        for attempt in range(3):
            try:
                d = yf.download(batch, period="2y", auto_adjust=True,
                                progress=False, threads=True)
                if isinstance(d.columns, pd.MultiIndex):
                    frames.append(d["Close"])
                else:
                    df = d[["Close"]]; df.columns = batch[:1]; frames.append(df)
                break
            except Exception as e:
                print(f"  batch {i} attempt {attempt}: {e}")
                time.sleep(3)
    p = pd.concat(frames, axis=1)
    p = p.loc[:, ~p.columns.duplicated()].dropna(axis=1, how="all")
    p.index = pd.to_datetime(p.index)
    return p

def main():
    print("Downloading 2y of data...")
    tickers = HALAL_SP500 + ["SPY"]
    daily = download(tickers)
    print(f"  {daily.shape[1]} tickers, {daily.shape[0]} trading days")

    # Monthly resample
    monthly = daily.resample("ME").last()

    # Trend filter: SPY vs 200-day MA
    spy_d = daily["SPY"].dropna()
    spy_ma200 = spy_d.rolling(200).mean()
    spy_current = float(spy_d.iloc[-1])
    spy_ma_current = float(spy_ma200.iloc[-1])
    pct_above = (spy_current / spy_ma_current - 1.0) * 100
    above = spy_current > spy_ma_current

    print(f"  SPY={spy_current:.2f}  200MA={spy_ma_current:.2f}  "
          f"{'ABOVE' if above else 'BELOW'} by {pct_above:+.2f}%")

    # 9-1 momentum signal using the most recent complete month
    # Skip last month: use prices from 10 months ago -> 1 month ago
    if len(monthly) < 11:
        print("Not enough monthly data")
        return

    p_start = monthly.iloc[-10]  # 10 months ago (= start of 9-month window, skipping last)
    p_end = monthly.iloc[-2]     # 1 month ago (skip last)
    signal = (p_end / p_start - 1).dropna()

    # Remove SPY from ranking
    if "SPY" in signal.index:
        signal = signal.drop("SPY")

    # Current prices for share-count calculation
    latest_prices = daily.iloc[-1]

    # Rank top 30
    top30 = signal.sort_values(ascending=False).head(30)
    ranked = []
    for rank, (tkr, sig) in enumerate(top30.items(), 1):
        price = float(latest_prices.get(tkr, float("nan")))
        if pd.isna(price): continue
        ranked.append({
            "rank": rank,
            "ticker": tkr,
            "momentum_pct": round(float(sig) * 100, 2),
            "price_usd": round(price, 2),
        })

    data = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "signal_date": monthly.index[-2].strftime("%Y-%m-%d"),
        "latest_price_date": daily.index[-1].strftime("%Y-%m-%d"),
        "universe_size": len(HALAL_SP500),
        "usd_to_sar": 3.75,
        "spy": {
            "price": round(spy_current, 2),
            "ma200": round(spy_ma_current, 2),
            "above_ma200": bool(above),
            "percent_diff": round(pct_above, 2),
        },
        "strategy": {
            "name": "9-1 Month Momentum",
            "description": "Rank SPUS universe (SP Funds S&P 500 Sharia Industry Exclusions ETF constituents) by cumulative return from t-10 months to t-1 month (skip last month). Buy top K equal-weighted. Hold for 1 month. If SPY < 200-day MA, go to 100% cash.",
            "lookback_months": 9,
            "skip_months": 1,
        },
        "ranked_stocks": ranked,
    }

    with open(OUT_PATH, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote {OUT_PATH}")
    print(f"Top 5 momentum stocks:")
    for r in ranked[:5]:
        print(f"  #{r['rank']}: {r['ticker']:6s}  {r['momentum_pct']:+7.2f}%  ${r['price_usd']:,.2f}")

if __name__ == "__main__":
    main()
