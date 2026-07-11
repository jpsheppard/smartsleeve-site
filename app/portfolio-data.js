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
        return ingest({
          payload: result.payload,
          sourceUrl: result.url,
          transport: "poll"
        });
      });
    }

    return {
      ingest: ingest,
      poll: poll,
      lastUpdate: function () { return lastUpdate; }
    };
  }

  return {create: create};
});
