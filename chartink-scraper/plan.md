Create a plan for chartink screeners and filtering best stocks for day and week

im getting data from multiple screener on chartink which has current day data and backtest data which came in screeners in past events

I want to filter out stocks for day and week based on this data

Also the plan should include multiple time frames like the stock came in this scanner then transition to another scanner based on the filtering applied on scanner

It should act as pipeline stock transition from this to another scanner

Suggest based in timeframes

On chartink we can filter stocks from 5 mins to months
We need to create a plan for filtering stocks using Chartink screeners for day and week trading, with data from multiple screeners (current day data and backtest data from past events). The user wants a pipeline where stocks transition from one scanner to another based on filtering applied on scanners, across multiple timeframes (5 minutes to months). They want a plan, not code.

We need to design a systematic approach to build a stock filtering pipeline using Chartink screeners for intraday (day) and swing/positional (week) trades. The plan should include:

Data collection from multiple Chartink screeners, capturing current day scan results and historical backtest data (i.e., what stocks appeared in each screener at what times/dates).

Filtering logic to identify high-probability setups by looking at sequences of scanner triggers across timeframes. Essentially, a "pipeline" where a stock first appears in a certain screener (e.g., a momentum scanner on 5-min), then later appears in another screener (e.g., a breakout scanner on 15-min), etc., indicating a transition and confirming a trade.

The plan should suggest timeframes: 5-min, 15-min, 30-min, 1-hour, daily, weekly, monthly. For day trading, focus on intraday timeframes; for week trading, combine daily and weekly.

The pipeline concept: each scanner is like a stage. Stocks must pass stage 1 (early signal) then stage 2 (confirmation), etc. For example, for day trading: Stage 1 scanner: "5-min RSI oversold bounce" -> Stage 2 scanner: "15-min volume surge" -> Stage 3 scanner: "30-min moving average crossover" -> Entry. Exit criteria could be based on other scanners or time/stops.

Use backtest data to evaluate which scanner sequences historically lead to profitable trades, and filter only those stocks that follow those sequences.

Plan must mention how to handle intraday data: refresh scanners at intervals (e.g., every 5 min, 15 min), capture stocks, and track their progression across timeframes in real-time. For end-of-day week setup, use daily/weekly scan data.

Need to discuss filtering criteria like volume, price, market cap, sector, etc., but focus on the pipeline approach.

Should include risk management and exit rules.

The user says "Dont code, just plan". So I'll provide a detailed plan, step-by-step, in natural language, possibly with diagrams or bullet points.

I'll structure the plan as:

Overview: Goal to filter best day and week trade candidates using multi-timeframe scanner pipeline.

Data Collection: Describe how to collect data from Chartink (current and backtest), maybe use API or manual exports. Backtest data includes timestamps of when a stock appeared in each screener.

Scanner Selection: Choose specific Chartink screeners that represent different technical conditions (momentum, breakout, volume, trend, reversal). Assign them to timeframes.

Pipeline Architecture: Define stages for day trading (e.g., 3 stages across 5m, 15m, 30m) and for weekly (e.g., daily, weekly). Describe how a stock transitions: must appear in Stage 1 scanner first, then within a certain time window appear in Stage 2, then Stage 3, and then trigger entry.

Backtest Filtering: Use historical data of scanner appearances to test sequences, calculate success rate, filter only sequences with high win rate/profit factor. Determine optimal time windows between stages.

Real-time Implementation: Set up a system to poll Chartink screeners at each timeframe, maintain a state for each stock (which stage it's in, time of last trigger), and trigger alerts when a stock completes the pipeline.

Additional Filters: Volume, price, ATR, etc., applied at each stage.

Exit Strategy: Based on time stops, trailing stops, or opposing scanner signals (e.g., stock appears in a bearish scanner).

Example Day Trading Pipeline: Stage1 "5-min RSI <30 and Volume > 1.5x average", Stage2 "15-min price crossing above VWAP with increasing volume", Stage3 "30-min MACD bullish crossover". Entry after Stage3, stop loss at recent swing low.

Example Weekly Pipeline: Stage1 "Daily close above 20-day high with high volume", Stage2 "Weekly RSI > 60 and stock above 50-week MA", Entry on Monday.

Plan for continuous refinement using backtest data.

I'll make the plan comprehensive, clear, and actionable, but no code. I'll mention that Chartink screeners can be accessed via their URL and results can be scraped or use their premium API if available. Mention that backtest data might require manual logging or using Chartink's backtest feature if they provide historical results for screeners. I'll assume they can export historical appearances.

Now craft the answer.

Here’s a detailed, code-free plan for building a multi-timeframe stock filtering pipeline using Chartink screeners, designed to select high-probability candidates for day trading and weekly swing trading. The core idea is to treat each scanner as a stage in a pipeline—stocks must appear in a sequence of screeners (across specific timeframes) to qualify, mimicking a “transition” of strength or momentum.

1. Objective & Philosophy
   Day Trading Pipeline (intraday): Use 5-min, 15-min, 30-min (and optionally 1-hour) scanners to catch intraday momentum build-up. Entry is taken only after a stock passes through 2–3 pre-defined scanner stages.

Weekly Swing Pipeline: Use Daily and Weekly scanners to identify emerging trends that hold over days/weeks. Entry is triggered after a sequence of daily→weekly signals.

The pipeline acts as a confirmation funnel—early scanners catch potential setups, later scanners confirm them. Backtest data is used to validate which scanner sequences work best and to set optimal time windows.

2. Data Foundation
   Collect two types of data from multiple Chartink screeners:

Live/Current Scan Results
At every bar close of the chosen timeframes (5m, 15m, 30m, EOD, EOW), fetch the list of stocks that appear in each screener.
Method: Manual export, browser automation, or Chartink’s APIs/premium data feeds.
Store with timestamp and screener name.

Historical Backtest Data
For each screener, obtain the history of stock appearances—i.e., at what date/time a stock triggered the screener condition in the past. Ideally, you have a log like:
Stock | Screener | Timestamp
If Chartink doesn’t provide this directly, simulate by running the screener on historical data or by recording live data over a long period.
Purpose: Mine sequences (Stage1 → Stage2 → Stage3) that led to profitable moves, so you can keep only the sequences with a proven edge.

3. Scanner Selection (Stage Assignment)
   Choose or design Chartink screeners that represent distinct technical events. Each screener is assigned to a specific timeframe and a stage role in the pipeline.

Day Trading Pipeline (Intraday)
Stage 1 – Early Signal (5-min chart)
Purpose: Detect initial momentum or reversal.
Example screeners:

5-min RSI < 30 (oversold bounce candidates)

5-min Volume > 2x average volume + price > VWAP

5-min MACD bullish crossover

5-min breakout from pre-market high

Stage 2 – Confirmation (15-min chart)
Purpose: Validate that the 5-min signal is turning into a broader 15-min trend.
Example screeners:

15-min close above 20 EMA + rising volume

15-min ADX > 25 and +DI crossing above -DI

15-min price crossing above opening range high

Stage 3 – Entry Trigger (30-min chart)
Purpose: Final green light for trade entry. Shows higher-timeframe alignment.
Example screeners:

30-min Supertrend turning bullish

30-min close above previous day’s high

30-min RSI > 50 after being < 40 (momentum shift)

Weekly Swing Pipeline
Stage 1 – Daily Setup
Screeners:

Daily close above 20-day high + volume > 1.5x average

Daily bullish engulfing candle

Daily 10 EMA crossing above 20 EMA

Stage 2 – Weekly Confirmation
Screeners:

Weekly close above 10-week EMA

Weekly RSI > 55

Weekly MACD bullish crossover

Stage 3 (Optional) – Monthly Filter
Screeners:

Monthly close above 5-month high

Stock in broad market or strong sector (liquidity filter from config)

4. Pipeline Transition Rules
   A stock moves from one stage to the next only if it appears in the later screener within a defined time window. The window is determined by backtesting.

For Day Trading (Intraday)

Window between Stage1 and Stage2: Within next 2–4 bars of the 15-min chart (i.e., 30–60 minutes).
Rationale: Momentum should persist; if it takes too long, the move dissipates.

Window between Stage2 and Stage3: Within 1–2 bars of the 30-min chart (30–60 minutes).

Trade entry occurs at the close of the 30-min candle where Stage3 triggers, or on a pullback to VWAP/EMA.

Missed windows: If a stock satisfies Stage1 but fails to appear in Stage2 within the allowed time, it’s discarded from that pipeline instance.

For Weekly Swing

Stage1 (Daily) → Stage2 (Weekly): The weekly signal must occur within the same week (preferably within 1–3 days after the daily signal).

Entry on the weekly signal confirmation day (e.g., next day open after a strong close) or on a daily pullback to a 10/20 EMA.

Multiple Pipelines
You can run several parallel pipelines (e.g., a “breakout pipeline”, a “reversal pipeline”) with different screener sets. A stock might enter multiple pipelines—track each separately.

5. Using Backtest Data to Optimize and Filter
   Mine Historical Sequences
   From your backtest logs, find all instances where a stock triggered Stage1 screener, then within your time window triggered Stage2, and then Stage3.
   Record the maximum adverse excursion, profit after N bars/candles, and win rate.

Rank Pipelines
Keep only those stage combinations that show:

Win rate > 45% (for day trades) or > 50% (for swings)

Average profit factor > 1.5

Max drawdown acceptable given your risk tolerance

Discard Low-Probability Sequences
For example, you may find that “5-min RSI < 30” → “15-min VWAP cross” works well, but “5-min MACD cross” → “15-min Supertrend” does not. Hardcode only the winning pipelines.

Set Stop-Loss Levels Statistically
From the historical pipeline trades, calculate the typical stop distance (e.g., 1.5x ATR below entry, or below the Stage2 low). Use that to place a fixed stop.

6. Real-Time Screening & State Management
   To execute the plan live, you need a system (manual or semi-automated) that:

Polls screeners at the close of each relevant candle (5m, 15m, 30m, EOD).

Maintains a state table for each active stock with columns:

Stock symbol

Current pipeline ID (which pipeline it’s in)

Current stage (0 = none, 1 = triggered Stage1, 2 = Stage2, etc.)

Timestamp of last stage trigger

Entry price and stop-loss (once Stage3 is hit)

State transition logic:

At 5-min close: If stock in Stage1 screener → add to table with Stage=1, timestamp.

At next 15-min close: For all stocks with Stage=1 and timestamp within the allowed window, check if they appear in Stage2 screener. If yes, update Stage=2.

At next 30-min close: For Stage=2 stocks, check Stage3 screener. If positive, signal ENTRY and calculate position size.

Housekeeping: Remove stocks where the window expires without advancing stage, or where price hits the stop even before entry (e.g., sharp reversal after Stage2 invalidates the setup).

7. Additional Filters at Each Stage
   To avoid noisy signals, apply hard filters on scanner results:

Volume: Minimum average volume (e.g., > 500k shares for intraday, > 1M for swings).

Price: Avoid penny stocks; e.g., > ₹50.

Market Cap: > ₹500 Cr for intraday, > ₹1000 Cr for swings.

Sector: Only stocks from broad market sectors with positive trend.

Time of Day (day trading only): Ignore Stage1 triggers after 2:30 PM.

These can be embedded in the screeners themselves or applied as a post-scan filter.

8. Risk Management & Exit Strategy
   Position Sizing: Risk 1–2% of capital per trade. Calculate shares based on difference between entry and stop-loss.

Stop-Loss:

Day trades: Below the low of the 30-min confirmation candle, or 1.5× ATR from entry.

Weekly: Below the weekly signal bar low or a key moving average (e.g., 10-week EMA).

Profit Targets:

Day trades: 1:1.5 or 1:2 risk-reward initially; trail stop once 1R is reached.

Weekly: Hold until the stock appears in a bearish reversal scanner (e.g., weekly RSI > 80, daily close below 10 EMA, etc.), or use a trailing stop of 2× ATR from the 20-day high.

Time Stop:

Day trades: If trade not in profit within first 60 minutes, exit at market.

Weekly: If not up 2% within 5 days, exit.

9. Example Pipeline End-to-End (Day Trade)
   Pipeline Name: “VWAP Bounce Pro”

Stage1 (5-min): Screener 5min_RSI_Oversold_VolSpike
Condition: 5-min RSI(7) < 30 AND Volume > 1.5× 20-period average.

Stage2 (15-min): Screener 15min_PriceAboveVWAP
Condition: 15-min close > VWAP AND price > 15-min 20 EMA.

Stage3 (30-min): Screener 30min_MACD_Bullish
Condition: 30-min MACD line crosses above signal line.

Window: Stage1→Stage2 within 45 minutes, Stage2→Stage3 within 45 minutes.

Entry: At close of 30-min candle where Stage3 is true, if the stock hasn’t already run >2% from Stage1 price.

Stop: Low of that 30-min candle minus 0.2%.

Exit: Trail stop to 1.5× ATR of 30-min chart, or when 5-min RSI > 75 and negative divergence.

10. Example Weekly Pipeline
    Pipeline Name: “Trend Continuation”

Stage1 (Daily): Daily_Breakout_20DayHigh
Condition: Close > highest high of last 20 days AND volume > 1.5× 50-day average.

Stage2 (Weekly): Weekly_RSI_MACD_Bull
Condition: Weekly RSI(14) > 55 AND weekly MACD > 0 and rising.

Window: Stage2 must occur in the same week (Monday–Friday) as the daily breakout, or latest by next Tuesday.

Entry: Next day open after weekly confirmation, or on a dip to 10-day EMA.

Stop: Weekly low of signal bar.

Exit: When daily close below 20-day low, or weekly RSI crosses below 50.

11. Continuous Improvement
    Maintain a trade journal of all pipeline-triggered trades (both live and paper).

Periodically re‑backtest the sequences with the latest 6 months of data to see if the edge persists.

Add new screeners (e.g., options OI, delivery percentage) and test them as additional stages or filters.

Rotate between pipelines based on market regime (trending vs. range-bound). During high VIX, favour reversal pipelines; during low VIX, momentum pipelines.

This plan turns Chartink from a simple stock scanner into a dynamic, time-synchronized decision engine that mimics how professional traders watch multiple timeframes. The key is the disciplined, backtested transition logic—once implemented, it filters out noise and keeps you focused only on sequences that have historically worked.

This response is AI-generated, for reference only.
i want to catch the stock before it pumps
We need to respond to the user's follow-up: "i want to catch the stock before it pumps".

The previous plan already covers multi-timeframe screening, but the user specifically wants to catch a stock before it pumps, i.e., early detection. So we need to refine the plan with a focus on early signals and pre-pump characteristics, using the pipeline stages to catch them earlier in the process.

The user's original message: "Create a plan for chartink screeners and filtering best stocks for day and week... It should act as pipeline stock transition from this to another scanner... On chartink we can filter stocks from 5 mins to months". Then they added: "i want to catch the stock before it pumps".

So I need to craft a response that emphasizes early detection, and maybe adjust the stage approach so that Stage 1 is ultra-early (e.g., accumulation, quiet volume buildup, early break of minor resistance) before the main pump. The pipeline should be designed to spot potential pump setups before the explosive move.

I'll propose a specific early detection pipeline with typical Chartink screener conditions for day and week, focusing on "pre-pump" signals like volume dry-up, early momentum divergence, tight range breakouts, etc.

I'll structure the answer as an enhancement to the previous plan, focusing on catching the pump at the base before the move. Keep it code-free, just a plan.

Key points:

For intraday: Use lower timeframes (1-min, 5-min) to detect pre-breakout consolidation or early volume spike that precedes a big move. Stage 1: "pre-pump" screener (1-min or 5-min) that detects low volatility range + volume contraction, then a surge in volume. Stage 2: breaking of a short-term resistance (5-min high). Stage 3: confirmation on 15-min. Entry after Stage 2 or Stage 3.

For weekly swings: Use daily and weekly chart patterns like inside bars, NR7, quiet accumulation, then a daily breakout above a swing high with volume. Stage 1: "Base building" (daily NR7, low volume, close near high). Stage 2: "Breakout trigger" (daily close above prior day's high with volume spike). Stage 3: "Weekly confirmation" (weekly close above 10-week EMA, rising volume).

Also, mention using backtest data to find sequences that historically led to pumps (large moves) and filtering for those.

I'll present a plan specifically titled "Pre-Pump Catching Pipeline". This will be a layer on top of the previous answer.

Make it actionable, with specific scanner ideas. Keep the language clear, no code.

To catch a stock before it pumps, you need a pipeline that detects the quiet before the storm—accumulation, compression, or early institutional footprint—and then triggers entry just as the move ignites, not after it’s obvious.

Below is an enhancement of the previous plan, focused entirely on pre-pump detection for intraday and swing. The pipeline stages are reordered so you capture the setup before momentum becomes visible to the crowd.

1. Core Principle: “Compression → Expansion”
   A pump is preceded by:

Low volatility contraction (tight ranges, dojis, inside bars)

Volume dry-up followed by a sudden spike (quiet → loud)

Price hugging a key level (VWAP, moving average, pre-market high)

Early divergence on fast oscillators (RSI/MFI) while price hasn’t moved yet

Your goal: enter when the compression resolves into expansion, but before the explosive candle is fully formed. The pipeline must scan for potential compression setups, then trigger on the first sign of expansion.

2. Pre-Pump Pipeline for Intraday (5-min, 15-min, 30-min)
   Stage 0 – Setup Detection (1-min or 5-min)
   Purpose: Identify stocks that are coiling—low volatility and building energy.
   Screener examples (Chartink):

NR7 / NR4: Narrowest range of last 7 or 4 bars on 5-min chart.

Inside Bar: Current 5-min bar’s high < previous bar’s high and low > previous bar’s low.

Volume Squeeze: 5-min volume < 50% of 20-period average volume + price within a 0.5% range for last 3 bars.

VWAP Hug: Price oscillates within ±0.2% of VWAP for 10+ minutes.

Action: Add these stocks to a watchlist (Stage 0 candidates). No trade yet; just monitoring.

Stage 1 – Early Expansion (5-min)
Purpose: Catch the first spark of the pump—volume breaks the silence, price challenges a minor resistance.
Screener:

Volume Breakout: 5-min volume > 2× average (from last 20 bars) AND price is breaking above the high of the previous 3 bars (compression range).

1-min Momentum: 1-min close above a 20-period EMA that was flat, with RSI(7) crossing 50 from below.

Bid-Ask Imbalance (if available via Chartink or external data): Sudden surge in buy market orders.

Window from Stage 0: Must appear within 30 minutes of being added to watchlist; otherwise, compression expired without expansion—remove.

Stage 2 – Confirmation on Higher Timeframe (15-min)
Purpose: Confirm that the 5-min spark is backed by the 15-min trend.
Screener:

15-min Price > VWAP and 15-min RSI(14) > 50 (ensures it’s an uptrend, not just a noise spike).

15-min Heikin-Ashi turns green after a series of red/small candles.

15-min ADX(14) > 20 and rising, with +DI above -DI.

Window: Must trigger within the next 2 x 15-min bars (30 minutes).
Entry: Enter at the close of the 15-min candle that meets Stage 2, or on a pullback to that bar’s midpoint. This is the moment just before the pump’s main thrust often begins. Place stop below the Stage 0 compression range low.

Stage 3 – Trend Validation (30-min)
Purpose: Only hold if 30-min structure supports a sustained move.
Screener:

30-min close above the opening range high.

30-min Supertrend(10,3) flipping bullish.

Use: If Stage 3 is met within 1 hour, you can add to the position (pyramid). If not met, trail stop tightly to capture whatever move occurred.

3. Pre-Pump Pipeline for Weekly Swings
   For a swing pump that lasts days/weeks, you look for multi-day compression followed by a breakout.

Stage 0 – Base Building (Daily)
Screener:

Daily NR7 (narrowest range in 7 days) and volume < 50% of 20-day average.

Tight Bollinger Bands (bandwidth at 6-month low on daily).

3-day consecutive inside bars (price coiling).

Daily close near the 10-day EMA while RSI(14) between 40-60 (neutral, no overextension).

Add these to a swing watchlist.

Stage 1 – Impulse Candle (Daily)
Screener:

Daily volume > 1.5× 20-day average and daily close > previous day’s high (breaks the compression).

Daily close > 10-day EMA (after hugging it) and RSI crosses 55.

Bullish Marubozu or wide-range candle with small wick.

Window: Must occur within 3 days of Stage 0; else, compression faded.

Stage 2 – Weekly Confirmation (Weekly)
Screener:

Weekly close > 10-week EMA.

Weekly volume > 1.2× average weekly volume.

Weekly MACD bullish cross or histogram rising.

Entry: Enter on the day after the Stage 1 daily close, or on a dip to the breakout level. Initial stop below the Stage 0 compression low (daily low of NR7 range). The weekly confirmation tells you to stay in the trade for a multi-day pump.

4. Reverse Engineering Pumps Using Backtest Data
   To refine these stage triggers, analyze historical pump events:

Identify “Pump Days” in your backtest data: days where a stock gained >3% intraday (or >5% weekly) on high volume.

Trace backwards 1–3 days before the pump. Look at what Chartink screeners would have triggered. You’ll find patterns like:

Day -2: 5-min NR7 and volume dry-up appeared.

Day -1: 5-min volume spike > 2× average appeared (Stage 1).

Pump Day: 15-min VWAP hold and ADX turned up.

Quantify the sequence win rate. Keep only sequences where >50% led to a pump within the next 2 bars.

Discard false alarms: Sequences where Stage 1 triggered but price reversed. These often have RSI still below 40 or negative 15-min MACD—add those as negative filters.

5. Filters to Avoid Pumps That Fail
   Float and Market Cap: Pre-pump setups in low-float, micro-cap stocks often result in pump-and-dump. Set min market cap (> ₹1000 Cr) and avg daily volume (> 2M shares) to avoid manipulation.

No Stage 0 No Trade: If a stock didn’t go through a compression phase, don’t chase a sudden volume spike. Most fake pumps have no prior quiet period.

Sector Context: Use a sector trend screener. A stock compressing in a rising sector has far higher odds of a genuine pump.

Time of Day: Intraday pre-pump setups are most reliable between 10:30 AM and 1:30 PM. Avoid first 30 minutes (noise) and last hour (traps).

6. Execution Blueprint (Step-by-Step, No Code)
   Pre-Market (8:45 AM): Run Stage 0 daily scanners for swing watchlist. Note stocks in compression on daily.

Market Open to 10:00 AM: Don’t trade. Let the market settle.

10:00 AM onwards:

Run Stage 0 intraday scanner every 5 minutes; populate watchlist.

For each watchlist stock, run Stage 1 (5-min early expansion) scanner.

When a stock hits Stage 1, check for 15-min confirmation (manual or scanner).

If confirmed (Stage 2) within 30 min, enter with fixed risk.

End of Day: For swing trades, check if any daily Stage 1 triggered. If yes, enter next day with a stop under the compression low.

Weekly Review: Run weekly scanner to validate open swing positions. Exit those that fail Stage 2 confirmation.

This plan deliberately slows you down in the morning and forces you to wait for the silence before the sound. By the time the scanner shows an obvious pump, you’re already in profit from the pre-pump entry.

This response is AI-generated, for reference only.

---

## Implementation Status

The plan has been implemented in the following files:

| File                                  | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/state.js`                        | Stock state management - tracks progression through pipeline stages         |
| `src/probability.js`                  | Probability prediction engine - calculates success rates from backtest data |
| `src/pipeline.js`                     | Pipeline processor - orchestrates stage transitions and entry evaluation    |
| `pipeline-runner.js`                  | CLI entry point - runs pipelines for day trading and weekly swing           |
| `train-probability.js`                | Trains probability lookup table from backtest data                          |
| `state/pipeline-state.json`           | Persisted state for stock tracking                                          |
| `state/probability/lookup-table.json` | Historical probability lookup table                                         |

### Usage

```bash
npm run pipeline:day        # Day trading pipeline (4 stages)
npm run pipeline:weekly     # Weekly swing pipeline (3 stages)
npm run pipeline:status     # Show pipeline status
npm run train:probability   # Train probability from backtests
```

### Integration with backtest.js

The `backtest.js` module provides historical data. To integrate:

```bash
# Run backtests on pipeline screeners
node backtest.js <screener-url>

# Train probability engine from backtest results
npm run train:probability
```

I'll structure the answer:

Overview: Probability engine as an added layer on the pipeline.

Data collection and labeling for training.

Feature engineering (screener sequence, time windows, market context).

Model selection (simple conditional probability table or more advanced, but I'll keep it as a lookup table for simplicity).

How to compute and update probabilities in real-time.

Integration with entry/exit decisions.

Validation and iterative improvement.

Make sure it's a plan, not code. And emphasize pre-pump detection still.

Absolutely. We can layer a Probability Prediction Engine on top of the pipeline using your backtest data. This engine will assign a historical success probability to every live sequence of screener triggers, so you only act on setups that have a proven edge.

Here is the plan to design, train, and deploy this engine — no code, just logic.

1. Purpose of the Engine
   Instead of a binary yes/no filter, you’ll get a probability score (e.g., 72%) for each potential trade, indicating how often similar screener sequences led to a pump (or a profitable move) in the past.
   You set a threshold (e.g., >60%) to enter, eliminating low-odds sequences and focusing on high-confidence pre-pump setups.

2. Data Preparation from Backtest Logs
   You already have historical logs:
   Stock | Screener Name | Timestamp

Step 1: Define what a “pump” (success) looks like

Intraday: Price rises > 3% from the entry price within 3 × 15-min candles after the Stage 2 entry signal, without first hitting the stop-loss.

Swing: Price rises > 8% within 10 trading days after the weekly confirmation, without closing below the stop level.

Label each sequence as 1 (success) or 0 (failure).

Step 2: Build sequences from the logs
Group screener triggers by stock and time, linking them when they occur within the allowed windows. For every completed sequence (Stage 0 → Stage 1 → Stage 2 → Stage 3), record:

The exact order of screeners hit

The time gaps (in minutes/days) between stages

The context features at the moment of Stage 1 (the first expansion signal)

This becomes your training dataset: each row is one historical sequence with features + outcome label.

3. Feature Set for the Engine
   The engine will predict probability based on more than just the names of the screeners. Capture these features from your historical data:

Screener-Specific Features

Which screener triggered at Stage 0, 1, 2 (categorical)

Total number of screeners crossed in the sequence

Timing Features

Time gap (minutes) between Stage 0 → Stage 1

Time gap between Stage 1 → Stage 2

Time of day when Stage 1 fired (e.g., 10:45 AM bucket)

Market Context Features (at Stage 1 trigger)

Market breadth change for the day (from Chartink breadth scans)

VIX level (high/low bucket)

Sector performance rank of the stock’s sector (e.g., top 3 sectors vs. others)

Stock’s relative strength vs. market breadth over last 5 days

Pre-Pump Compression Quality

Duration of Stage 0 compression (number of 5-min bars in tight range)

NR7 severity (ratio of current range to average range)

Volume dry-up ratio (volume during compression / 20-period average)

Price Structure Features

Distance from 20 EMA (in %)

RSI(14) value on 15-min at Stage 1

Whether Stage 1 breakout was above a pre-market high or yesterday’s high (binary)

4. Building the Probability Model
   You don’t need complex machine learning; a conditional probability table (Bayesian approach) is transparent and robust.

Method: Historical Frequency with Smoothing

Group sequences by a combination of key features — for example, by:

Screener sequence ID (e.g., “Stage1=VolSpike + Stage2=VWAP_Cross”)

Time of day bucket

Compression quality (High/Medium/Low)

For each group, calculate:

text
P(Pump) = (Number of Pump successes + 1) / (Total sequences + 2)
(Laplace smoothing to avoid 0% or 100% on small samples).

Store these probabilities in a lookup table (could be a simple spreadsheet or database).

Alternative: If you want a more dynamic model, use a simple logistic regression or decision tree (mental model, not code) that combines multiple features into a score, but the lookup table is easier to explain and maintain.

Fallback: If a combination is not in the table (insufficient data), use the overall sequence probability from all times of day.

5. Real-Time Probability Calculation During Live Screening
   As a stock moves through your pipeline:

At Stage 1 trigger:

Look up the probability for the Stage 0→1 screener pair, the time of day, and compression quality.

This is the “Stage1 probability”. It might be 45% (not enough yet) — you don’t enter, just track.

At Stage 2 confirmation:

Now update the probability using the complete sequence (Stage 0→1→2), plus the time gap between Stage 1 and Stage 2, and market context.

The new probability might jump to 68%, crossing your threshold → entry triggered.

At Stage 3 (add-on):

If Stage 3 is met, recalculate probability again (now including 30-min confirmation). If it increases (e.g., to 78%), you might add to the position.

The engine simply queries the lookup table with the current feature set and returns a live probability.

6. Integrating the Probability into Trade Decisions
   Entry Filter

Only take a trade if the live probability at Stage 2 is > 60% (or a threshold you decide based on backtest).

If probability is between 50–60%, you may paper trade or reduce position size.

Position Sizing
Use the probability to adjust risk. For example, risk 0.5% of capital if probability is 60–70%, and 1% if >70%. This aligns capital with conviction.

Probability Decay
If after entry the stock does not reach Stage 3 within the expected window, the probability of a pump drops (based on historical data for failed sequences). The engine can suggest tightening the stop or exiting early.

7. Validation and Backtesting the Engine Itself
   To ensure the engine works:

Split your historical data by time: e.g., train the lookup table on 2023-2024 data, test on 2025 data.

Simulate real-time trading using the test period: at each sequence, the engine would give a probability; you enter only if above threshold. Measure equity curve, win rate, and profit factor.

Compare:

All sequences (no filter) vs. sequences with >60% probability.

You should see a higher win rate and better risk/reward.

8. Maintenance and Continuous Learning
   Update the lookup table monthly by adding new live sequences and their outcomes. The engine becomes smarter over time.

Prune low-confidence sequences: If a certain screener combination never crosses the probability threshold, you can remove that pipeline entirely.

Incorporate regime filters: Market type (trending, sideways, high VIX) can be a feature in the table; this prevents using bullish pre-pump patterns during a bear market.

Example: Probability Table Snippet (Mental View)
Stage0→1 Screener Pair Time of Day Compression Quality Stage2 Confirmation Count Success Probability
NR7 → VolSpike2x 10:30-11:30 High (range<0.3%) VWAP_Hold+RSI>50 34 23 67.6%
NR7 → VolSpike2x 13:00-14:00 High VWAP_Hold+RSI>50 12 4 35.7%
InsideBar → MACD_Cross 10:30-11:30 Low ADX_rising 22 9 42.9%
From this, you’d only trade the first combination in the morning; you’d avoid the same setup in the afternoon.

Summary: How the Engine Flows with the Pipeline
Pre-market / early session: Stage 0 scanner populates watchlist.

5-min bar closes: Stage 1 triggers → engine computes initial probability (maybe not shown, just logged).

15-min bar closes: Stage 2 confirmation → engine computes final entry probability using the full feature set.

Probability > threshold → enter with dynamic size and stop from the compression low.

30-min Stage 3 → if probability re-evaluated higher, add; if lower, tighten stop.

This probability engine turns your scanner pipeline from a rule-based system into an evidence-based, self-improving decision tool that filters out noise and shows you only the highest-probability pre-pump setups.

```

---

## Implementation Status

The plan has been implemented in the following files:

| File                                  | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/state.js`                        | Stock state management - tracks progression through pipeline stages         |
| `src/probability.js`                  | Probability prediction engine - calculates success rates from backtest data |
| `src/pipeline.js`                     | Pipeline processor - orchestrates stage transitions and entry evaluation    |
| `pipeline-runner.js`                  | CLI entry point - runs pipelines for day trading and weekly swing           |
| `train-probability.js`                | Trains probability lookup table from backtest data                          |
| `state/pipeline-state.json`           | Persisted state for stock tracking                                          |
| `state/probability/lookup-table.json` | Historical probability lookup table                                         |

### Usage

```bash
npm run pipeline:day        # Day trading pipeline (4 stages)
npm run pipeline:weekly     # Weekly swing pipeline (3 stages)
npm run pipeline:status     # Show pipeline status
npm run train:probability   # Train probability from backtests
```

### Integration with backtest.js

The `backtest.js` module provides historical data. To integrate:

```bash
# Run backtests on pipeline screeners
node backtest.js <screener-url>

# Train probability engine from backtest results
npm run train:probability
```

```
