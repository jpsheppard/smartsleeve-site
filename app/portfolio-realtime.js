(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SmartSleevePortfolioRealtime = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var PROTOCOL = "smartsleeve.portfolio.v1";
  var SOURCE_STATUSES = ["live", "delayed", "stale", "degraded", "dormant"];
  var VALUE_METHODS = ["broker", "streaming_mark_to_market", "fallback"];
  var CLOCK_QUALITIES = ["broker", "collector_receive", "mixed"];
  var REQUIRED_STRINGS = ["accountId", "broker", "sourceStatus", "sourceEpoch", "collectorReceivedAt", "collectorSentAt", "hubReceivedAt", "clockQuality", "valueMethod", "currency"];
  var OPTIONAL_NUMBERS = ["cash", "settledCash", "buyingPower", "brokerEquity", "markedEquity", "positionsValue"];

  function byteLength(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
    return unescape(encodeURIComponent(value)).length;
  }

  function validTimestamp(value) {
    if (value == null) return true;
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
  }

  function validateAccount(account) {
    if (!account || typeof account !== "object" || Array.isArray(account)) return {ok: false, error: "invalid_account"};
    if (account.schemaVersion !== 1) return {ok: false, error: "unsupported_account_schema"};
    for (var i = 0; i < REQUIRED_STRINGS.length; i += 1) {
      var key = REQUIRED_STRINGS[i];
      if (typeof account[key] !== "string" || !account[key]) return {ok: false, error: "missing_" + key};
    }
    if (!Number.isSafeInteger(account.sourceSequence) || account.sourceSequence < 0) return {ok: false, error: "invalid_sourceSequence"};
    if (!Number.isFinite(account.staleAfterSeconds) || account.staleAfterSeconds <= 0) return {ok: false, error: "invalid_staleAfterSeconds"};
    if (SOURCE_STATUSES.indexOf(account.sourceStatus) === -1) return {ok: false, error: "invalid_sourceStatus"};
    if (VALUE_METHODS.indexOf(account.valueMethod) === -1) return {ok: false, error: "invalid_valueMethod"};
    if (CLOCK_QUALITIES.indexOf(account.clockQuality) === -1) return {ok: false, error: "invalid_clockQuality"};
    if (!Array.isArray(account.positions) || account.positions.length > 500) return {ok: false, error: "invalid_positions"};
    var timestamps = ["positionsAsOf", "cashAsOf", "priceAsOf", "brokerEquityAsOf", "collectorReceivedAt", "collectorSentAt", "hubReceivedAt"];
    for (var t = 0; t < timestamps.length; t += 1) {
      if (!validTimestamp(account[timestamps[t]])) return {ok: false, error: "invalid_" + timestamps[t]};
    }
    for (var n = 0; n < OPTIONAL_NUMBERS.length; n += 1) {
      var number = account[OPTIONAL_NUMBERS[n]];
      if (number != null && !Number.isFinite(number)) return {ok: false, error: "invalid_" + OPTIONAL_NUMBERS[n]};
    }
    for (var p = 0; p < account.positions.length; p += 1) {
      var position = account.positions[p];
      if (!position || typeof position !== "object" || Array.isArray(position)) return {ok: false, error: "invalid_position"};
      if (typeof position.symbol !== "string" || !position.symbol) return {ok: false, error: "invalid_position_symbol"};
      var positionNumbers = ["quantity", "price", "marketValue"];
      for (var q = 0; q < positionNumbers.length; q += 1) {
        var field = positionNumbers[q];
        if (position[field] != null && !Number.isFinite(position[field])) return {ok: false, error: "invalid_position_number"};
      }
      if (!validTimestamp(position.priceAsOf)) return {ok: false, error: "invalid_position_priceAsOf"};
    }
    return {ok: true};
  }

  function validateTicketResponse(payload) {
    if (!payload || payload.ok !== true || payload.protocol !== PROTOCOL || !Array.isArray(payload.connections)) {
      return {ok: false, error: "invalid_ticket_response"};
    }
    if (typeof payload.expiresAt !== "string" || !validTimestamp(payload.expiresAt) || new Date(payload.expiresAt).getTime() <= Date.now()) {
      return {ok: false, error: "expired_ticket_response"};
    }
    for (var i = 0; i < payload.connections.length; i += 1) {
      var connection = payload.connections[i];
      if (!connection || typeof connection.tenantId !== "string" || !connection.tenantId || !Array.isArray(connection.accountIds)) {
        return {ok: false, error: "invalid_ticket_connection"};
      }
      if (connection.accountIds.some(function (accountId) { return typeof accountId !== "string" || !accountId; })) {
        return {ok: false, error: "invalid_ticket_connection"};
      }
      try {
        var url = new URL(connection.websocketUrl);
        if (url.protocol !== "wss:" || !url.searchParams.get("ticket")) return {ok: false, error: "invalid_websocket_url"};
      } catch (_err) {
        return {ok: false, error: "invalid_websocket_url"};
      }
    }
    return {ok: true};
  }

  function create(options) {
    options = options || {};
    var fetchTicket = options.fetchTicket;
    var WebSocketCtor = options.WebSocketCtor || (typeof WebSocket !== "undefined" ? WebSocket : null);
    var onStatus = typeof options.onStatus === "function" ? options.onStatus : function () {};
    var onAccount = typeof options.onAccount === "function" ? options.onAccount : function () {};
    var onDiagnostic = typeof options.onDiagnostic === "function" ? options.onDiagnostic : function () {};
    var setTimer = options.setTimeoutFn || setTimeout;
    var clearTimer = options.clearTimeoutFn || clearTimeout;
    var reconnectDelays = options.reconnectDelays || [1000, 2000, 5000, 10000, 30000];
    var emptyRetryMs = options.emptyRetryMs || 300000;
    var active = false;
    var generation = 0;
    var sockets = [];
    var reconnectTimer = null;
    var reconnectAttempt = 0;
    var accepted = {};
    var status = {state: options.enabled === false ? "disabled" : "fallback", detail: "Polling fallback"};

    if (typeof fetchTicket !== "function") throw new TypeError("Realtime client requires fetchTicket.");
    if (!WebSocketCtor) throw new TypeError("Realtime client requires WebSocket support.");

    function emitStatus(state, detail, extra) {
      status = Object.assign({state: state, detail: detail || "", attempt: reconnectAttempt}, extra || {});
      onStatus(status);
    }

    function diagnostic(code, extra) {
      onDiagnostic(Object.assign({code: code, at: new Date().toISOString()}, extra || {}));
    }

    function closeSockets() {
      var closing = sockets.slice();
      sockets = [];
      closing.forEach(function (entry) {
        try {
          entry.socket.onopen = null;
          entry.socket.onmessage = null;
          entry.socket.onerror = null;
          entry.socket.onclose = null;
          entry.socket.close(1000, "client_reset");
        } catch (_err) {}
      });
    }

    function clearReconnect() {
      if (reconnectTimer != null) clearTimer(reconnectTimer);
      reconnectTimer = null;
    }

    function scheduleReconnect(reason, explicitDelay) {
      if (!active || reconnectTimer != null) return;
      closeSockets();
      var delay = explicitDelay == null
        ? reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)]
        : explicitDelay;
      reconnectAttempt += 1;
      emitStatus("fallback", reason || "Realtime disconnected; polling fallback active", {retryInMs: delay});
      reconnectTimer = setTimer(function () {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function acceptAccount(account, connection, envelope) {
      var serialized;
      try { serialized = JSON.stringify(account); } catch (_err) { return diagnostic("invalid_account_json"); }
      if (byteLength(serialized) > 262144) return diagnostic("account_too_large", {accountId: account && account.accountId});
      var validation = validateAccount(account);
      if (!validation.ok) return diagnostic(validation.error, {accountId: account && account.accountId});
      if (connection.accountIds.indexOf(account.accountId) === -1) return diagnostic("unauthorized_account", {accountId: account.accountId});
      var current = accepted[account.accountId];
      if (current && current.sourceEpoch === account.sourceEpoch && account.sourceSequence <= current.sourceSequence) {
        return diagnostic("stale_account_ignored", {accountId: account.accountId, sourceSequence: account.sourceSequence});
      }
      accepted[account.accountId] = {sourceEpoch: account.sourceEpoch, sourceSequence: account.sourceSequence};
      onAccount(account, {
        tenantId: connection.tenantId,
        messageType: envelope.type,
        messageId: envelope.messageId,
        serverTime: envelope.serverTime,
        revision: envelope.revision,
        clientReceivedAt: new Date().toISOString()
      });
    }

    function handleMessage(raw, connection) {
      if (typeof raw !== "string") return diagnostic("binary_message_ignored");
      if (byteLength(raw) > 1048576) return diagnostic("server_message_too_large");
      var envelope;
      try { envelope = JSON.parse(raw); } catch (_err) { return diagnostic("invalid_server_json"); }
      if (!envelope || envelope.protocol !== PROTOCOL || typeof envelope.type !== "string") return diagnostic("invalid_server_envelope");
      if (typeof envelope.messageId !== "string" || !envelope.messageId || typeof envelope.serverTime !== "string" || !validTimestamp(envelope.serverTime) || !Number.isSafeInteger(envelope.revision) || envelope.revision < 0) {
        return diagnostic("invalid_server_envelope");
      }
      if (envelope.tenantId !== connection.tenantId) return diagnostic("tenant_mismatch");
      if (envelope.type === "connection.hello") {
        emitStatus("live", "Realtime connected", {connections: sockets.length});
        return;
      }
      if (envelope.type === "portfolio.snapshot") {
        if (!Array.isArray(envelope.accounts)) return diagnostic("invalid_snapshot");
        envelope.accounts.forEach(function (account) { acceptAccount(account, connection, envelope); });
        return;
      }
      if (envelope.type === "account.update") {
        acceptAccount(envelope.account, connection, envelope);
        return;
      }
      if (envelope.type === "connection.error") {
        diagnostic("server_" + String(envelope.code || "error"), {recoverable: envelope.recoverable === true});
      }
    }

    function openConnections(payload, currentGeneration) {
      if (!active || currentGeneration !== generation) return;
      if (!payload.connections.length) {
        reconnectAttempt = 0;
        emitStatus("fallback", "No realtime accounts enabled; polling fallback active", {connections: 0});
        scheduleReconnect("No realtime accounts enabled; polling fallback active", emptyRetryMs);
        return;
      }
      var expectedConnections = payload.connections.length;
      sockets = payload.connections.map(function (connection) {
        var socket = new WebSocketCtor(connection.websocketUrl);
        var safeConnection = {tenantId: connection.tenantId, accountIds: connection.accountIds.slice()};
        var entry = {socket: socket, connection: safeConnection};
        socket.onopen = function () {
          if (!active || currentGeneration !== generation) return;
          reconnectAttempt = 0;
          var openCount = sockets.filter(function (candidate) { return candidate.socket.readyState === 1; }).length;
          emitStatus("live", "Realtime connected", {connections: openCount, expectedConnections: expectedConnections});
        };
        socket.onmessage = function (event) {
          if (!active || currentGeneration !== generation) return;
          handleMessage(event.data, safeConnection);
        };
        socket.onerror = function () {
          if (!active || currentGeneration !== generation) return;
          diagnostic("websocket_error", {tenantId: safeConnection.tenantId});
          scheduleReconnect("Realtime connection failed; polling fallback active");
        };
        socket.onclose = function () {
          if (!active || currentGeneration !== generation) return;
          scheduleReconnect("Realtime disconnected; polling fallback active");
        };
        return entry;
      });
    }

    function connect() {
      if (!active) return;
      clearReconnect();
      generation += 1;
      var currentGeneration = generation;
      closeSockets();
      emitStatus("connecting", "Connecting realtime; polling remains active");
      Promise.resolve(fetchTicket()).then(function (payload) {
        if (!active || currentGeneration !== generation) return;
        var validation = validateTicketResponse(payload);
        if (!validation.ok) throw new Error(validation.error);
        openConnections(payload, currentGeneration);
      }).catch(function () {
        if (!active || currentGeneration !== generation) return;
        diagnostic("ticket_request_failed", {reason: "connection_setup_failed"});
        scheduleReconnect("Realtime unavailable; polling fallback active");
      });
    }

    function start() {
      if (options.enabled === false) {
        emitStatus("disabled", "Realtime disabled; polling active");
        return;
      }
      if (active && (status.state === "connecting" || sockets.length || reconnectTimer != null)) return;
      active = true;
      connect();
    }

    function pause(reason) {
      active = false;
      generation += 1;
      clearReconnect();
      closeSockets();
      emitStatus("fallback", reason || "Realtime paused; polling fallback active", {connections: 0});
    }

    function stop() {
      pause("Realtime stopped; polling fallback active");
      accepted = {};
    }

    function resync() {
      var requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
      sockets.forEach(function (entry) {
        if (entry.socket.readyState === 1) {
          entry.socket.send(JSON.stringify({protocol: PROTOCOL, type: "client.resync", requestId: requestId}));
        }
      });
    }

    return {
      start: start,
      pause: pause,
      stop: stop,
      resync: resync,
      status: function () { return status; },
      acceptedOrdering: function () { return Object.assign({}, accepted); }
    };
  }

  return {
    PROTOCOL: PROTOCOL,
    create: create,
    validateAccount: validateAccount,
    validateTicketResponse: validateTicketResponse
  };
});
