#!/usr/bin/env node
/**
 * Audit of the Studio forms against the model catalogue — « every select has something to select ».
 *
 *   node scripts/audit-studio-forms.mjs            # dev: orazaka_studio_db blueprints × orazaka_db models (read only)
 *
 * For the latest PUBLISHED blueprint of every Studio, each field that should be a list (an `enum`, or `x-options`
 * fed by the model catalogue) is checked: it has at least one choice (a catalogue category with at least one
 * `available` model), its words exist in English and French (`x-i18n`), and its helper is one line (≤ 140
 * characters). Exits 1 on a finding. Secrets come from secret.sh @dev (or --env-file, as dev-deploy),
 * never printed.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { devSecrets, envFileFromArgs } from "./lib/dev-secrets.mjs";

// @fixed: a helper is one line of the form (≤ 140 characters, the same limit as orazaka-packs/tests/closed-sets)
export const HELPER_MAX = 140;

/**
 * @param {{ studioKey: string, version: string, inputSchema: object }[]} blueprints latest published blueprints
 * @param {{ model_name: string, category: string, status: string }[]} models the catalogue rows
 * @returns {string[]} one line per finding; empty when every select is sound
 */
export function auditForms(blueprints, models) {
  const findings = [];
  const offered = (category) => models.filter((m) => m.category === category && m.status === "available");
  for (const { studioKey, version, inputSchema } of blueprints) {
    for (const [key, def] of Object.entries(inputSchema?.properties ?? {})) {
      const where = `${studioKey}@${version}#${key}`;
      const options = def["x-options"];
      const isList = Array.isArray(def.enum) || options?.source === "models";
      if (!isList) continue;
      if (Array.isArray(def.enum) && def.enum.length === 0) findings.push(`${where}: an empty enum draws an empty select`);
      if (options) {
        const category = String(options.category);
        if (category !== category.toLowerCase()) findings.push(`${where}: category « ${category} » is not lowercase`);
        if (offered(category.toLowerCase()).length === 0) findings.push(`${where}: no available model in the « ${category} » category`);
      }
      for (const lang of ["en", "fr"]) {
        const words = def["x-i18n"]?.[lang];
        if (!words?.title || !words?.description) {
          findings.push(`${where}: no ${lang} title and helper (x-i18n.${lang})`);
          continue;
        }
        if (words.description.length > HELPER_MAX) findings.push(`${where}: ${lang} helper is ${words.description.length} characters (max ${HELPER_MAX})`);
        for (const value of def.enum ?? []) if (!words.options?.[value]) findings.push(`${where}: no ${lang} label for « ${value} »`);
      }
    }
  }
  return findings;
}

function query(env, db, passwordKey, sql) {
  const conn = `host=${env.DATABASE_HOST} port=${env.DATABASE_PORT} dbname=${db} user=${db} sslmode=require`;
  const psql = process.env.PSQL ?? "psql";
  const r = spawnSync(psql, [conn, "-X", "-q", "-A", "-t", "-c", sql], { encoding: "utf8", env: { ...process.env, PGPASSWORD: env[passwordKey] } });
  if (r.status !== 0) throw new Error(`psql on ${db} failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout.trim() || "[]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { envFile } = envFileFromArgs(process.argv.slice(2));
  const env = devSecrets({ envFile });
  const blueprints = query(
    env,
    "orazaka_studio_db",
    "DATABASE_PASSWORD_ORAZAKA_STUDIO_DB",
    `select coalesce(json_agg(json_build_object('studioKey', studio_key, 'version', version, 'inputSchema', input_schema)), '[]') from studio_blueprint b
      where status = 'PUBLISHED' and string_to_array(version, '.')::int[] = (select max(string_to_array(c.version, '.')::int[]) from studio_blueprint c where c.studio_key = b.studio_key and c.status = 'PUBLISHED')`,
  );
  const models = query(env, "orazaka_db", "DATABASE_PASSWORD_ORAZAKA_DB", "select coalesce(json_agg(json_build_object('model_name', model_name, 'category', category, 'status', status)), '[]') from orazaka_models");
  const findings = auditForms(blueprints, models);
  console.log(`${blueprints.length} Studios, ${models.length} models: ${findings.length} finding(s)`);
  for (const line of findings) console.log(`  - ${line}`);
  process.exit(findings.length ? 1 : 0);
}
