import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(root, "docs/sql/2026-05-03_compass_schema_v1.sql");
const rollbackPath = path.join(root, "docs/sql/2026-05-03_compass_schema_v1_rollback.sql");

const requiredMigrationFragments = [
  "create schema if not exists compass",
  "create extension if not exists vector",
  "create table if not exists compass.documents",
  "create table if not exists compass.document_metadata",
  "create table if not exists compass.document_chunks",
  "create table if not exists compass.ollama_document_chunks",
  "create table if not exists compass.document_processing_logs",
  "create table if not exists compass.url_templates",
  "create or replace function compass.search_ollama_documents",
];

const forbiddenFragments = [
  /\bprofiles\b/,
  /\badmin_users\b/,
  /\bconversations\b/,
  /\bfeedback\b/,
  /\bapi_usage_logs\b/,
  /\blog_alerts\b/,
  /\bauth\.users\b/,
  /\bpublic\./,
  /\bad_policies\b/,
];

function fail(message) {
  console.error(`[check-compass-schema-readiness] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(migrationPath)) {
  fail(`missing migration file: ${path.relative(root, migrationPath)}`);
}

if (!fs.existsSync(rollbackPath)) {
  fail(`missing rollback file: ${path.relative(root, rollbackPath)}`);
}

if (process.exitCode) {
  process.exit();
}

const migration = fs.readFileSync(migrationPath, "utf8").toLowerCase();
const rollback = fs.readFileSync(rollbackPath, "utf8").toLowerCase();

for (const fragment of requiredMigrationFragments) {
  if (!migration.includes(fragment)) {
    fail(`migration missing required fragment: ${fragment}`);
  }
}

for (const fragment of forbiddenFragments) {
  if (fragment.test(migration)) {
    fail(`migration includes forbidden fragment: ${fragment}`);
  }
}

if (!rollback.includes("drop schema if exists compass cascade")) {
  fail("rollback must be limited to dropping the compass schema");
}

if (!migration.includes("gate 3 confirmed source dimension: vector(1024)")) {
  fail("migration must include Gate 3 vector(1024) verification notes");
}

if (!migration.includes("embedding vector(1024)")) {
  fail("migration must keep vector(1024) embeddings for v1 Compass tables");
}

if (!process.exitCode) {
  console.log("[check-compass-schema-readiness] ok");
}
