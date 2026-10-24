// NSE index and index-based instruments that must be excluded from backtest
// and signal stats. Chartink includes these in /backtest/process results because
// they are tradable NSE instruments, but they are not individual stocks.
//
// Applied at ingestion in src/store.js. Pattern-based for maintainability.

// Regex patterns that match index/index-based symbol names.
// No real equity stock contains "NIFTY", "SENSEX", "CASE" (case products),
// "BEES" (ETF), or "FANG" as a substring — these are all index/ETF instruments.
const NIFTY_PATTERNS = [
  /NIFTY/i,                  // NIFTY, NIFTY50, AXISNIFTY, BANKNIFTY, FINNIFTY, etc.
  /SENSEX/i,                // SENSEX, SENSEXADD, SENSEXETF, HDFCSENSEX, etc.
  /BANKNIFTY/i,            // BANKNIFTY, BANKNIFTY1, BANKNIFTYBEES
  /QNIFTY/i,               // QNIFTY
  /CNXNIFTY/i,             // CNXNIFTYJUNIOR
  /CASE$/i,                // TOP100CASE, MID150CASE, LTGILTCASE, SML100CASE, GOLDCASE, SILVERCASE
  /BEES$/i,                // NIFTYBEES, BANKBEES, MID150BEES, LTGILTBEES
  /FANG/i,                 // MAFANG, MINIFASTNIFTY (if any)
  /ETF$/i,                 // Any symbol ending in ETF (index ETFs)
  /GROBTEA/i,              // GROBTEA (case product)
  /HAVISHA/i,              // HAVISHA (case product)
  /MID150/i,               // MID150, MID150BEES, MID150CASE
  /TOP100/i,               // TOP100CASE
  /TOP10ADD/i,             // TOP10ADD
  /TOP15IETF/i,            // TOP15IETF
  /TOP20/i,                // TOP20
  /SML100/i,               // SML100CASE, SML100ETF
  /LIQUIDCASE/i,           // LIQUIDCASE
  /LTGILT/i,               // LTGILTBEES, LTGILTCASE
  /MASPTOP50/i,            // MASPTOP50
  /MONIFTY/i,              // MONIFTY100, MONIFTY500
  /SBINMID150/i,           // SBINMID150
  /HDFCSML250/i,           // HDFCSML250
  /HDFCNIFTY/i,            // HDFCNIFTY
  /HDFSENSEX/i,            // HDFSENSEX
  /HDFCMID150/i,           // HDFCMID150
  /IDFNIFTY/i,             // IDFNIFTYET
  /IVZINNIFTY/i,           // IVZINNIFTY
  /GROWWNIFTY/i,           // GROWWNIFTY
  /LICNMID100/i,           // LICNMID100
  /AONENIFTY/i,            // AONENIFTY
  /AXSENSEX/i,             // AXSENSEX
  /EBANKNIFTY/i,           // EBANKNIFTY
  /ENIFTY/i,               // ENIFTY
  /ESENSEX/i,              // ESENSEX
  /BSLNIFTY/i,             // BSLNIFTY
  /MCAP/i,                 // MCAP indices
];

export function isNiftySymbol(symbol) {
  if (!symbol) return false;
  return NIFTY_PATTERNS.some((re) => re.test(symbol));
}

export { NIFTY_PATTERNS };
