const COUNTRY_TO_CURRENCY = {
  Australia: "AUD",
  Burundi: "BIF",
  Canada: "CAD",
  DRC: "CDF",
  Ethiopia: "ETB",
  Germany: "EUR",
  Kenya: "KES",
  Rwanda: "RWF",
  Somalia: "SOS",
  "South Sudan": "SSP",
  Tanzania: "TZS",
  UK: "GBP",
  Uganda: "UGX",
  USA: "USD",
};

const COUNTRY_ALIASES = {
  America: "USA",
  Burundi: "Burundi",
  Canada: "Canada",
  Congo: "DRC",
  "Democratic Republic of Congo": "DRC",
  "Democratic Republic of the Congo": "DRC",
  "Dr Congo": "DRC",
  "Dr. Congo": "DRC",
  "Great Britain": "UK",
  "South Sudan": "South Sudan",
  Tanzania: "Tanzania",
  "United Kingdom": "UK",
  "United States": "USA",
  "United States of America": "USA",
  Uk: "UK",
  Usa: "USA",
};

const CURRENCY_META = {
  AUD: { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  BIF: { code: "BIF", label: "Burundian Franc", symbol: "FBu" },
  CAD: { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  CDF: { code: "CDF", label: "Congolese Franc", symbol: "FC" },
  ETB: { code: "ETB", label: "Ethiopian Birr", symbol: "Br" },
  EUR: { code: "EUR", label: "Euro", symbol: "EUR" },
  GBP: { code: "GBP", label: "British Pound", symbol: "GBP" },
  KES: { code: "KES", label: "Kenyan Shilling", symbol: "KSh" },
  RWF: { code: "RWF", label: "Rwandan Franc", symbol: "FRw" },
  SOS: { code: "SOS", label: "Somali Shilling", symbol: "SOS" },
  SSP: { code: "SSP", label: "South Sudanese Pound", symbol: "SSP" },
  TZS: { code: "TZS", label: "Tanzanian Shilling", symbol: "TSh" },
  UGX: { code: "UGX", label: "Ugandan Shilling", symbol: "USh" },
  USD: { code: "USD", label: "US Dollar", symbol: "$" },
};

const COUNTRY_KEYWORDS = {
  australian: "Australia",
  burundi: "Burundi",
  burundian: "Burundi",
  canada: "Canada",
  canadian: "Canada",
  congo: "DRC",
  congolese: "DRC",
  drc: "DRC",
  ethiopia: "Ethiopia",
  ethiopian: "Ethiopia",
  germany: "Germany",
  german: "Germany",
  kenya: "Kenya",
  kenyan: "Kenya",
  rwanda: "Rwanda",
  rwandan: "Rwanda",
  somalia: "Somalia",
  somali: "Somalia",
  "south sudan": "South Sudan",
  "south sudanese": "South Sudan",
  tanzania: "Tanzania",
  tanzanian: "Tanzania",
  uganda: "Uganda",
  ugandan: "Uganda",
  uk: "UK",
  british: "UK",
  "united kingdom": "UK",
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
  american: "USA",
};

const RATE_CACHE_PREFIX = "majuu_currency_rates_v2_";
const FALLBACK_SNAPSHOT_DATE = "2026-03-15";
const FALLBACK_USD_RATES = {
  AUD: 1.535158,
  BIF: 2865.87095,
  CAD: 1.396373,
  CDF: 2854.75525,
  ETB: 131.832328,
  EUR: 0.916488,
  GBP: 0.77243,
  KES: 129.607132,
  RWF: 1432.546747,
  SOS: 571.061515,
  SSP: 4661.921617,
  TZS: 2612.782321,
  UGX: 3689.386557,
  USD: 1,
};

function safeString(value, max = 40) {
  return String(value || "").trim().slice(0, max);
}

function safeCurrencyCode(value) {
  const code = safeString(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cacheKeyFor(baseCurrency) {
  return `${RATE_CACHE_PREFIX}${safeCurrencyCode(baseCurrency)}`;
}

function readRateCache(baseCurrency) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(cacheKeyFor(baseCurrency));
    const parsed = JSON.parse(raw || "null");
    if (!isObject(parsed) || !isObject(parsed.rates)) return null;

    const expiresAt = Number(parsed.expiresAt || 0);
    if (expiresAt && expiresAt > Date.now()) {
      return parsed;
    }
  } catch {
    // ignore cache issues
  }

  return null;
}

function writeRateCache(baseCurrency, payload) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(cacheKeyFor(baseCurrency), JSON.stringify(payload));
  } catch {
    // ignore cache issues
  }
}

function formatRateDate(unixSeconds) {
  const value = Number(unixSeconds || 0);
  if (!value) return "";
  try {
    return new Date(value * 1000).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function normalizeCountryKey(value) {
  return safeString(value, 80).toLowerCase();
}

function normalizeCountryName(country) {
  const raw = safeString(country, 80);
  if (!raw) return "";

  const key = normalizeCountryKey(raw);
  if (!key) return "";

  const aliasMatch =
    COUNTRY_ALIASES[raw] ||
    COUNTRY_ALIASES[
      raw
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    ] ||
    COUNTRY_KEYWORDS[key];

  if (aliasMatch) return aliasMatch;

  for (const [keyword, canonical] of Object.entries(COUNTRY_KEYWORDS)) {
    if (key.includes(keyword)) return canonical;
  }

  return raw;
}

function buildFallbackQuote(amount, from, to) {
  const fromRate = Number(FALLBACK_USD_RATES[from] || 0);
  const toRate = Number(FALLBACK_USD_RATES[to] || 0);
  if (!fromRate || !toRate) return null;

  const rate = toRate / fromRate;
  return {
    amount,
    from,
    to,
    rate,
    convertedAmount: amount * rate,
    date: FALLBACK_SNAPSHOT_DATE,
    sourceLabel: "Fallback snapshot",
    sourceUrl: "https://open.er-api.com/v6/latest/USD",
    isFallback: true,
  };
}

async function fetchRateTable(baseCurrency, signal) {
  const cached = readRateCache(baseCurrency);
  if (cached) {
    return cached;
  }

  const response = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error("Live rates are unavailable right now.");
  }

  const payload = await response.json();
  if (!isObject(payload) || !isObject(payload.rates)) {
    throw new Error("We could not load a fresh exchange table right now.");
  }

  const lastUpdatedAt = Number(payload?.time_last_update_unix || 0);
  const nextUpdatedAt = Number(payload?.time_next_update_unix || 0);
  const nextCacheExpiry =
    nextUpdatedAt > 0 ? nextUpdatedAt * 1000 : Date.now() + 6 * 60 * 60 * 1000;

  const nextState = {
    base: safeCurrencyCode(payload?.base_code || baseCurrency),
    rates: payload.rates,
    date: formatRateDate(lastUpdatedAt),
    expiresAt: Math.max(Date.now() + 10 * 60 * 1000, nextCacheExpiry),
    sourceLabel: "ExchangeRate-API",
    sourceUrl: "https://www.exchangerate-api.com/docs/free",
    isFallback: false,
  };

  writeRateCache(baseCurrency, nextState);
  return nextState;
}

export function getCurrencyForCountry(country) {
  const normalized = normalizeCountryName(country);
  return COUNTRY_TO_CURRENCY[normalized] || "";
}

export function getCurrencyMeta(code) {
  const safeCode = safeCurrencyCode(code);
  return CURRENCY_META[safeCode] || null;
}

export function getSupportedSelfHelpCurrencies() {
  return Object.values(CURRENCY_META).sort((left, right) =>
    left.code.localeCompare(right.code)
  );
}

export function getKnownExchangeRate(from, to) {
  const safeFrom = safeCurrencyCode(from);
  const safeTo = safeCurrencyCode(to);

  if (!safeFrom || !safeTo) return 1;
  if (safeFrom === safeTo) return 1;

  const cached = readRateCache(safeFrom);
  const cachedRate = Number(cached?.rates?.[safeTo] || 0);
  if (Number.isFinite(cachedRate) && cachedRate > 0) {
    return cachedRate;
  }

  const fallback = buildFallbackQuote(1, safeFrom, safeTo);
  return Number(fallback?.rate || 1) || 1;
}

export async function fetchCurrencyQuote({ amount, from, to, signal }) {
  const numericAmount = Number(amount || 0);
  const safeFrom = safeCurrencyCode(from);
  const safeTo = safeCurrencyCode(to);

  if (!safeFrom || !safeTo) {
    throw new Error("Choose both currencies.");
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }

  if (safeFrom === safeTo) {
    return {
      amount: numericAmount,
      from: safeFrom,
      to: safeTo,
      rate: 1,
      convertedAmount: numericAmount,
      date: "",
      sourceLabel: "Same currency",
      sourceUrl: "",
      isFallback: false,
    };
  }

  try {
    const rateTable = await fetchRateTable(safeFrom, signal);
    const rate = Number(rateTable?.rates?.[safeTo] || 0);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("We could not calculate that conversion yet.");
    }

    return {
      amount: numericAmount,
      from: safeFrom,
      to: safeTo,
      rate,
      convertedAmount: numericAmount * rate,
      date: safeString(rateTable?.date, 20),
      sourceLabel: safeString(rateTable?.sourceLabel, 80) || "ExchangeRate-API",
      sourceUrl: safeString(rateTable?.sourceUrl, 240),
      isFallback: Boolean(rateTable?.isFallback),
    };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      throw error;
    }

    const fallbackQuote = buildFallbackQuote(numericAmount, safeFrom, safeTo);
    if (fallbackQuote) {
      return fallbackQuote;
    }

    throw error;
  }
}
