#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const deskPagePath = path.join(root, "src/app/desk/page.tsx");
const localHistoryPath = path.join(root, "src/lib/client/compassLocalHistory.ts");
const conversationRoutePath = path.join(root, "src/app/api/conversations/route.ts");

function fail(message) {
  console.error(`[check-compass-history-limit-contract] ${message}`);
  process.exitCode = 1;
}

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(root, filePath)}`);
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
}

const deskPage = readSource(deskPagePath);
const localHistory = readSource(localHistoryPath);
const conversationRoute = readSource(conversationRoutePath);

if (!deskPage.includes("const COMPASS_CONVERSATION_CONTEXT_LIMIT = 25;")) {
  fail("desk page must keep the in-chat context limit at 25 messages");
}

if (!deskPage.includes("const buildConversationHistoryForAnswer =")) {
  fail("desk page must build answer context from the just-trimmed message list");
}

if (/messages\.find\(\s*msg\s*=>[\s\S]{0,220}msg\.type === ['"]user['"][\s\S]{0,220}content\.trim\(\)\s*===\s*(question|inputValue)\.trim\(\)/.test(deskPage)) {
  fail("desk page must not block a new send because the same question exists anywhere in the last 25 messages");
}

if (deskPage.includes("이미 같은 질문이 있습니다")) {
  fail("desk page must not silently return on repeated user questions");
}

if (deskPage.includes("messages.slice(-COMPASS_CONVERSATION_CONTEXT_LIMIT)")) {
  fail("desk page must not send stale React state as the answer conversation history");
}

const conversationHistoryUsages = deskPage.match(/const conversationHistory = buildConversationHistoryForAnswer\(currentMessages\);/g) || [];
if (conversationHistoryUsages.length < 2) {
  fail("both typed sends and suggested-question sends must use the trimmed conversation history");
}

if (!localHistory.includes("export const COMPASS_CONVERSATION_HISTORY_LIMIT = 25;")) {
  fail("local history limit must remain 25");
}

if (!localHistory.includes("function normalizeCompassLocalConversations")) {
  fail("local history must normalize, sort, and trim persisted entries");
}

if (!localHistory.includes("window.localStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));")) {
  fail("local history load must persist the normalized 25-entry rollover state");
}

if (!localHistory.includes(".slice(0, COMPASS_CONVERSATION_HISTORY_LIMIT)")) {
  fail("local history save/load must slice to the shared history limit");
}

if (!conversationRoute.includes("const COMPASS_CONVERSATION_HISTORY_LIMIT = 25;")) {
  fail("conversation API history limit must remain 25");
}

if (!conversationRoute.includes("await pruneDatabaseHistory(supabase, owner.ownerSubject);")) {
  fail("conversation API must prune database history immediately after writes");
}

if (!conversationRoute.includes("await pruneHistoryStorage(client, ownerSubject);")) {
  fail("conversation API must prune storage fallback history immediately after writes");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("[check-compass-history-limit-contract] history rollover contract passed.");
