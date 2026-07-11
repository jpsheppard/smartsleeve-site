"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, PROTOCOL, validateAccount, validateTicketResponse } = require("./portfolio-realtime.js");

function account(overrides = {}) {
  return {
    schemaVersion: 1,
    accountId: "john-schwab-pcra",
    broker: "schwab",
    sourceStatus: "live",
    sourceEpoch: "epoch-a",
    sourceSequence: 1,
    positionsAsOf: "2026-07-11T04:20:31.100Z",
    cashAsOf: "2026-07-11T04:20:31.100Z",
    priceAsOf: "2026-07-11T04:20:31.100Z",
    brokerEquityAsOf: "2026-07-11T04:20:31.100Z",
    collectorReceivedAt: "2026-07-11T04:20:31.110Z",
    collectorSentAt: "2026-07-11T04:20:31.150Z",
    hubReceivedAt: "2026-07-11T04:20:31.203Z",
    clockQuality: "collector_receive",
    valueMethod: "broker",
    currency: "USD",
    cash: 1000,
    settledCash: 1000,
    buyingPower: 1000,
    brokerEquity: 25000,
    markedEquity: 25000,
    positionsValue: 24000,
    staleAfterSeconds: 90,
    positions: [{symbol: "SMPIX", quantity: 100, price: 240, marketValue: 24000, currency: "USD", priceAsOf: "2026-07-11T04:20:31.100Z"}],
    ...overrides
  };
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() { this.readyState = 1; this.onopen?.(); }
  message(payload) { this.onmessage?.({data: JSON.stringify(payload)}); }
  close() { this.readyState = 3; this.onclose?.(); }
  send(value) { this.sent.push(value); }
}

function ticket(number = 1) {
  return {
    ok: true,
    protocol: PROTOCOL,
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    connections: [{tenantId: "john", accountIds: ["john-schwab-pcra"], websocketUrl: `wss://example.test/v1/stream?ticket=ticket-${number}`}]
  };
}

function envelope(type, body = {}) {
  return {protocol: PROTOCOL, type, messageId: `message-${type}`, serverTime: "2026-07-11T04:20:31.203Z", tenantId: "john", revision: 18, ...body};
}

async function tick() { await new Promise(resolve => setImmediate(resolve)); }

test("accepts snapshots, rejects rollback, and accepts a new epoch", async () => {
  FakeWebSocket.instances = [];
  const applied = [];
  const diagnostics = [];
  const client = create({enabled: true, fetchTicket: async () => ticket(), WebSocketCtor: FakeWebSocket, onAccount: value => applied.push(value), onDiagnostic: value => diagnostics.push(value)});
  client.start();
  await tick();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(envelope("portfolio.snapshot", {accounts: [account()]}));
  socket.message(envelope("account.update", {account: account({sourceSequence: 1, cash: 500})}));
  socket.message(envelope("account.update", {account: account({sourceSequence: 2, cash: 1200})}));
  socket.message(envelope("account.update", {account: account({sourceEpoch: "epoch-b", sourceSequence: 1, cash: 1300})}));

  assert.deepEqual(applied.map(value => value.cash), [1000, 1200, 1300]);
  assert.equal(diagnostics.filter(value => value.code === "stale_account_ignored").length, 1);
  assert.deepEqual(client.acceptedOrdering()["john-schwab-pcra"], {sourceEpoch: "epoch-b", sourceSequence: 1});
});

test("rejects an account outside the ticket scope", async () => {
  FakeWebSocket.instances = [];
  const applied = [];
  const diagnostics = [];
  const client = create({enabled: true, fetchTicket: async () => ticket(), WebSocketCtor: FakeWebSocket, onAccount: value => applied.push(value), onDiagnostic: value => diagnostics.push(value)});
  client.start();
  await tick();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(envelope("account.update", {account: account({accountId: "other-account"})}));
  assert.equal(applied.length, 0);
  assert.equal(diagnostics[0].code, "unauthorized_account");
});

test("disconnect obtains a new ticket and never logs ticket URLs", async () => {
  FakeWebSocket.instances = [];
  let requests = 0;
  const statuses = [];
  const timers = [];
  const client = create({
    enabled: true,
    fetchTicket: async () => ticket(++requests),
    WebSocketCtor: FakeWebSocket,
    reconnectDelays: [1],
    setTimeoutFn: callback => { timers.push(callback); return timers.length; },
    clearTimeoutFn: () => {},
    onStatus: value => statuses.push(value)
  });
  client.start();
  await tick();
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].close();
  timers.shift()();
  await tick();
  assert.equal(requests, 2);
  assert.equal(FakeWebSocket.instances[1].url.endsWith("ticket-2"), true);
  assert.equal(JSON.stringify(statuses).includes("ticket-1"), false);
});

test("validates finite values and required freshness fields", () => {
  assert.equal(validateAccount(account({futureAdditiveField: {safe: true}})).ok, true);
  assert.equal(validateAccount(account({cash: Infinity})).error, "invalid_cash");
  assert.equal(validateAccount(account({positionsAsOf: "not-a-time"})).error, "invalid_positionsAsOf");
  assert.equal(validateAccount(account({positions: new Array(501).fill({symbol: "X"})})).error, "invalid_positions");
  assert.equal(validateTicketResponse({...ticket(), expiresAt: undefined}).error, "expired_ticket_response");
});
