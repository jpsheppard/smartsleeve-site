"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("./portfolio-data.js");

test("poll normalizes the existing feed as a poll update", async () => {
  const applied = [];
  const layer = create({
    fetchPoll: async (options) => ({payload: {accounts: [{id: "acct-1"}]}, url: options.url}),
    applySnapshot: (payload, metadata) => applied.push({payload, metadata})
  });

  const update = await layer.poll({url: "/api/app-feed"});

  assert.equal(update.transport, "poll");
  assert.equal(update.sourceUrl, "/api/app-feed");
  assert.deepEqual(applied[0].payload, {accounts: [{id: "acct-1"}]});
  assert.equal(layer.lastUpdate(), update);
});

test("ingest accepts a source-neutral snapshot for a later realtime adapter", () => {
  const applied = [];
  const layer = create({
    fetchPoll: async () => ({payload: {accounts: []}}),
    applySnapshot: (payload, metadata) => applied.push({payload, metadata})
  });

  const update = layer.ingest({
    payload: {accounts: [{id: "acct-2"}]},
    sourceUrl: "portfolio-hub",
    transport: "realtime",
    receivedAt: "2026-07-11T00:00:00.000Z"
  });

  assert.equal(update.transport, "realtime");
  assert.equal(applied[0].metadata.receivedAt, "2026-07-11T00:00:00.000Z");
});

test("realtime replaces only portfolio fields and survives a later poll", async () => {
  const applied = [];
  let fallbackCash = 100;
  const layer = create({
    fetchPoll: async () => ({payload: {accounts: [{accountId: "acct-2", account: "PCRA", broker: "schwab", cash: fallbackCash, positions: [{symbol: "SMPIX", quantity: 8, costBasis: 1800}]}]}}),
    applySnapshot: (payload, metadata) => applied.push({payload, metadata})
  });
  await layer.poll();
  const realtime = {
    schemaVersion: 1,
    accountId: "acct-2",
    broker: "schwab",
    sourceStatus: "live",
    sourceEpoch: "epoch-a",
    sourceSequence: 2,
    positionsAsOf: "2026-07-11T00:00:00Z",
    cashAsOf: "2026-07-11T00:00:00Z",
    priceAsOf: "2026-07-11T00:00:00Z",
    brokerEquityAsOf: "2026-07-11T00:00:00Z",
    collectorReceivedAt: "2026-07-11T00:00:01Z",
    collectorSentAt: "2026-07-11T00:00:02Z",
    hubReceivedAt: "2026-07-11T00:00:03Z",
    clockQuality: "broker",
    valueMethod: "streaming_mark_to_market",
    currency: "USD",
    cash: 250,
    buyingPower: 250,
    brokerEquity: 2200,
    markedEquity: 2300,
    positionsValue: 2050,
    staleAfterSeconds: 90,
    positions: [{symbol: "SMPIX", quantity: 10, price: 205, marketValue: 2050, currency: "USD", priceAsOf: "2026-07-11T00:00:00Z"}]
  };
  const result = layer.ingestRealtime(realtime, {clientReceivedAt: "2026-07-11T00:00:04Z"});

  assert.equal(result.applied, true);
  assert.equal(applied.at(-1).payload.accounts[0].equity, 2300);
  assert.equal(applied.at(-1).payload.accounts[0].cash, 250);
  assert.equal(applied.at(-1).payload.accounts[0].positions[0].costBasis, 1800);
  assert.equal(applied.at(-1).payload.accounts[0].positions[0].quantity, 10);

  layer.ingestRealtime({...realtime, sourceSequence: 3, priceAsOf: "2026-07-11T00:01:00Z", markedEquity: 2350, positions: [{...realtime.positions[0], price: 210, marketValue: 2100, priceAsOf: "2026-07-11T00:01:00Z"}]});
  assert.equal(applied.at(-1).payload.accounts[0].priceAsOf, "2026-07-11T00:01:00Z");
  assert.equal(applied.at(-1).payload.accounts[0].cashAsOf, "2026-07-11T00:00:00Z");
  assert.equal(applied.at(-1).payload.accounts[0].positionsAsOf, "2026-07-11T00:00:00Z");
  assert.equal(applied.at(-1).payload.accounts[0].equity, 2350);

  fallbackCash = 50;
  await layer.poll();
  assert.equal(applied.at(-1).payload.accounts[0].cash, 250);
  assert.equal(applied.at(-1).metadata.transport, "poll");

  layer.ingestRealtime({...realtime, sourceSequence: 4, cash: null, cashAsOf: "2026-07-11T00:02:00Z"});
  assert.equal(applied.at(-1).payload.accounts[0].cash, 50);
  assert.equal(applied.at(-1).payload.accounts[0].realtimeCashFallback, true);
});

test("realtime cannot add an account absent from the scoped fallback feed", async () => {
  const layer = create({fetchPoll: async () => ({payload: {accounts: []}}), applySnapshot: () => {}});
  await layer.poll();
  assert.deepEqual(layer.ingestRealtime({accountId: "not-authorized"}), {applied: false, reason: "unknown_account", accountId: "not-authorized"});
});

test("rejects malformed source updates before rendering", () => {
  const layer = create({
    fetchPoll: async () => ({payload: {accounts: []}}),
    applySnapshot: () => {}
  });

  assert.throws(() => layer.ingest({transport: "realtime"}), /object payload/);
});
