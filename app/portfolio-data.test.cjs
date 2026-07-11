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

test("rejects malformed source updates before rendering", () => {
  const layer = create({
    fetchPoll: async () => ({payload: {accounts: []}}),
    applySnapshot: () => {}
  });

  assert.throws(() => layer.ingest({transport: "realtime"}), /object payload/);
});
