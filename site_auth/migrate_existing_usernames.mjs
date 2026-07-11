#!/usr/bin/env node

import {spawnSync} from "node:child_process";


const apply = process.argv.includes("--apply");
const config = "site_auth/wrangler.toml";
const bindingArgs = ["--remote", "--binding", "SMARTSLEEVE_AUTH", "--config", config];

function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `wrangler failed: ${args.join(" ")}`);
  }
  return result.stdout;
}

const keys = JSON.parse(wrangler(["kv", "key", "list", ...bindingArgs, "--prefix", "account:"]));
const usernameKeys = new Set(
  JSON.parse(wrangler(["kv", "key", "list", ...bindingArgs, "--prefix", "profile:username:"]))
    .map((item) => item.name)
);

for (const item of keys) {
  const recordText = wrangler(["kv", "key", "get", item.name, ...bindingArgs, "--text"]);
  const record = JSON.parse(recordText);
  const email = String(record.profile && record.profile.email || "").trim().toLowerCase();
  const oldUsername = String(record.profile && record.profile.username || "").trim().toLowerCase();
  if (!email) throw new Error(`Account ${item.name} has no email`);
  const emailHash = record.email_hash || item.name.slice("account:".length);
  const emailIndexKey = `profile:username:${email}`;
  const indexedOwner = usernameKeys.has(emailIndexKey)
    ? String(wrangler(["kv", "key", "get", emailIndexKey, ...bindingArgs, "--text"])).trim()
    : "";
  if (indexedOwner && indexedOwner !== emailHash) {
    throw new Error(`Refusing to migrate ${email}: its username index belongs to another account`);
  }
  process.stdout.write(`${apply ? "MIGRATE" : "WOULD MIGRATE"} ${oldUsername || "(none)"} -> ${email}\n`);
  if (!apply) continue;

  record.schema_version = 2;
  record.session_epoch = Number(record.session_epoch || 0);
  record.updated_at = new Date().toISOString();
  record.profile = {...record.profile, username: email, account_type: "general_website"};
  try {
    wrangler(["kv", "key", "put", item.name, JSON.stringify(record), ...bindingArgs]);
    wrangler(["kv", "key", "put", `profile:username:${email}`, emailHash, ...bindingArgs]);
    if (oldUsername && oldUsername !== email) {
      wrangler(["kv", "key", "delete", `profile:username:${oldUsername}`, ...bindingArgs]);
    }
  } catch (error) {
    process.stderr.write(`Migration failed for ${email}; restoring its original account record.\n`);
    wrangler(["kv", "key", "put", item.name, recordText, ...bindingArgs]);
    if (oldUsername) {
      wrangler(["kv", "key", "put", `profile:username:${oldUsername}`, emailHash, ...bindingArgs]);
    }
    if (oldUsername !== email) {
      wrangler(["kv", "key", "delete", `profile:username:${email}`, ...bindingArgs]);
    }
    throw error;
  }
}

if (apply) process.stdout.write("Migration complete. Existing passwords and access flags were preserved.\n");
