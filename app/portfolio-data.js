(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SmartSleevePortfolioData = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function create(options) {
    options = options || {};
    if (typeof options.fetchPoll !== "function") {
      throw new TypeError("Portfolio data layer requires fetchPoll.");
    }
    if (typeof options.applySnapshot !== "function") {
      throw new TypeError("Portfolio data layer requires applySnapshot.");
    }

    var lastUpdate = null;
    var fallbackPayload = null;
    var realtimeSlices = {};

    function ingest(update) {
      if (!update || !update.payload || typeof update.payload !== "object") {
        throw new TypeError("Portfolio source update requires an object payload.");
      }
      var normalized = {
        payload: update.payload,
        sourceUrl: String(update.sourceUrl || update.url || ""),
        transport: String(update.transport || "unknown"),
        receivedAt: update.receivedAt || new Date().toISOString()
      };
      lastUpdate = normalized;
      options.applySnapshot(normalized.payload, normalized);
      return normalized;
    }

    function poll(pollOptions) {
      return Promise.resolve(options.fetchPoll(pollOptions || {})).then(function (result) {
        if (!result || !result.payload) {
          throw new TypeError("Portfolio poll returned no payload.");
        }
        fallbackPayload = result.payload;
        return ingest({
          payload: mergePayload(fallbackPayload, realtimeSlices),
          sourceUrl: result.url,
          transport: "poll"
        });
      });
    }

    function ingestRealtime(account, metadata) {
      metadata = metadata || {};
      if (!account || typeof account.accountId !== "string" || !account.accountId) {
        throw new TypeError("Realtime account update requires accountId.");
      }
      if (!fallbackPayload) return {applied: false, reason: "no_fallback"};
      var accounts = Array.isArray(fallbackPayload.accounts) ? fallbackPayload.accounts : [];
      var match = accounts.some(function (row) { return accountId(row) === account.accountId; });
      if (!match) return {applied: false, reason: "unknown_account", accountId: account.accountId};
      realtimeSlices[account.accountId] = {account: account, metadata: metadata};
      var update = ingest({
        payload: mergePayload(fallbackPayload, realtimeSlices),
        sourceUrl: "PortfolioHub",
        transport: "realtime",
        receivedAt: metadata.clientReceivedAt
      });
      return {applied: true, accountId: account.accountId, update: update};
    }

    function clearRealtime() {
      realtimeSlices = {};
      return null;
    }

    return {
      clearRealtime: clearRealtime,
      ingest: ingest,
      ingestRealtime: ingestRealtime,
      poll: poll,
      lastUpdate: function () { return lastUpdate; },
      realtimeAccounts: function () { return Object.keys(realtimeSlices); }
    };
  }

  function accountId(row) {
    return String(row && (row.accountId || row.account_id || row.id || row.account) || "");
  }

  function realtimePositions(fallback, account) {
    var bySymbol = {};
    (fallback.positions || []).forEach(function (position) {
      var symbol = String(position.symbol || position.ticker || "").toUpperCase();
      if (symbol) bySymbol[symbol] = position;
    });
    return (account.positions || []).map(function (position) {
      var symbol = String(position.symbol || "").toUpperCase();
      var merged = Object.assign({}, bySymbol[symbol] || {}, position, {symbol: symbol});
      if (position.quantity != null) {
        merged.shares = position.quantity;
        merged.quantity = position.quantity;
      }
      if (position.price != null) merged.price = position.price;
      if (position.marketValue != null) {
        merged.value = position.marketValue;
        merged.marketValue = position.marketValue;
        merged.market_value_usd = position.marketValue;
      }
      if (position.priceAsOf || account.priceAsOf) {
        merged.priceAsOf = position.priceAsOf || account.priceAsOf;
        merged.marketDataAsOf = position.priceAsOf || account.priceAsOf;
      }
      merged.priceSource = position.priceSource || account.broker;
      merged.quotePrice = null;
      merged.quoteAsOf = null;
      merged.quoteSource = null;
      return merged;
    });
  }

  function firstPresent(values) {
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] != null && values[i] !== "") return values[i];
    }
    return null;
  }

  function mergeAccount(fallback, entry) {
    var account = entry.account;
    var metadata = entry.metadata || {};
    var displayedEquity = account.valueMethod === "streaming_mark_to_market" && account.markedEquity != null
      ? account.markedEquity
      : account.brokerEquity != null ? account.brokerEquity : account.markedEquity;
    var accountValueSource = account.valueMethod === "streaming_mark_to_market"
      ? "streaming_mark_to_market"
      : account.valueMethod === "fallback" ? "realtime_fallback" : "broker_reported_equity";
    var preserveEmptyPositions = ["stale", "degraded", "dormant"].indexOf(account.sourceStatus) !== -1
      && !(account.positions || []).length
      && (fallback.positions || []).length;
    var cashFallback = account.cash == null;
    var brokerEquityFallback = account.brokerEquity == null;
    var valueFallback = displayedEquity == null;
    var priceFallback = account.priceAsOf == null
      || (account.positions || []).some(function (position) { return position.price == null || position.marketValue == null; });
    if (valueFallback) {
      displayedEquity = firstPresent([fallback.equity, fallback.accountEquity, fallback.account_equity, fallback.accountValue, fallback.account_value, fallback.portfolioValue, fallback.portfolio_value]);
    }
    return Object.assign({}, fallback, account, {
      id: fallback.id || account.accountId,
      accountId: account.accountId,
      broker: account.broker,
      status: account.sourceStatus,
      generatedAt: account.collectorReceivedAt,
      portfolioSource: "realtime",
      sourceFreshness: account.sourceStatus,
      sourceIsStale: account.sourceStatus === "stale" || account.sourceStatus === "degraded",
      equity: displayedEquity,
      cash: cashFallback ? firstPresent([fallback.cash, fallback.cashBalance, fallback.cash_balance, fallback.cashUsd, fallback.cash_usd]) : account.cash,
      settledCash: account.settledCash == null ? fallback.settledCash : account.settledCash,
      buyingPower: account.buyingPower == null ? firstPresent([fallback.buyingPower, fallback.buying_power, fallback.buyPower, fallback.buy_power]) : account.buyingPower,
      brokerEquity: brokerEquityFallback ? firstPresent([fallback.brokerEquity, fallback.broker_equity]) : account.brokerEquity,
      brokerReportedEquity: brokerEquityFallback ? firstPresent([fallback.brokerReportedEquity, fallback.broker_reported_equity, fallback.brokerEquity, fallback.broker_equity]) : account.brokerEquity,
      markedEquity: account.markedEquity == null ? fallback.markedEquity : account.markedEquity,
      holdingsValue: account.positionsValue == null ? firstPresent([fallback.holdingsValue, fallback.holdings_value, fallback.positionValue, fallback.position_value]) : account.positionsValue,
      positionsValue: account.positionsValue == null ? fallback.positionsValue : account.positionsValue,
      accountValueSource: accountValueSource,
      accountValueAuthority: account.valueMethod === "streaming_mark_to_market" ? "Streaming mark-to-market from broker quantities" : "Realtime broker portfolio",
      equitySource: accountValueSource,
      cashSource: "realtime_broker_cash",
      marketDataAsOf: account.priceAsOf,
      positions: preserveEmptyPositions ? fallback.positions : realtimePositions(fallback, account),
      realtime: true,
      realtimePositionsFallback: Boolean(preserveEmptyPositions),
      realtimeCashFallback: Boolean(cashFallback),
      realtimePriceFallback: Boolean(priceFallback),
      realtimeBrokerEquityFallback: Boolean(brokerEquityFallback),
      realtimeValueFallback: Boolean(valueFallback),
      realtimeClientReceivedAt: metadata.clientReceivedAt || null,
      realtimeServerTime: metadata.serverTime || null,
      realtimeRevision: metadata.revision == null ? null : metadata.revision
    });
  }

  function mergePayload(payload, slices) {
    if (!payload || typeof payload !== "object") return payload;
    var accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    return Object.assign({}, payload, {
      accounts: accounts.map(function (fallback) {
        var entry = slices[accountId(fallback)];
        return entry ? mergeAccount(fallback, entry) : fallback;
      })
    });
  }

  return {create: create, mergePayload: mergePayload};
});
