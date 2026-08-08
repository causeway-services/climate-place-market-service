#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentRmnMessage, extractRmnPart, parseA2aMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
const A2A_CARRIER_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_CARRIER_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_CARRIER_KIND }).value;
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { ACTOR, CHANNEL, CLEARING_CATEGORY, NODE_ROOT, contentId } from "./market.mjs";

function exact(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const { id, ...body } = value; return id === contentId(body); }

export function formDailyClearingDemand(civilDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(civilDay ?? "")) throw new TypeError("daily clearing demand requires one civil day");
  const body = { type: "ClimatePlaceDailyClearingDemand", customer: CHANNEL, provider: ACTOR, civilDay };
  return { id: contentId(body), ...body };
}

export async function deliverDailyClearing(demand, { dataRoot = join(NODE_ROOT, "data") } = {}) {
  if (!exact(demand) || demand.type !== "ClimatePlaceDailyClearingDemand" || demand.customer !== CHANNEL || demand.provider !== ACTOR) return { type: "ClimatePlaceDailyClearingResult", provider: ACTOR, demand: demand?.id ?? null, disposition: "refused", code: "invalid-clearing-demand", externalEffects: [] };
  const candidates = (await querySettlementRecords(CLEARING_CATEGORY)).filter((row) => row.civilDay === demand.civilDay);
  const rows = candidates;
  if (rows.some((row) => !exact(row)) || new Set(rows.map((row) => row.id)).size > 1) return { type: "ClimatePlaceDailyClearingResult", provider: ACTOR, demand: demand.id, disposition: "refused", code: "clearing-ledger-conflict", externalEffects: [] };
  const clearing = rows[0];
  if (!clearing) return { type: "ClimatePlaceDailyClearingResult", provider: ACTOR, demand: demand.id, disposition: "refused", code: "daily-clearing-not-yet-witnessed", retryable: true, externalEffects: [] };
  const body = { type: "ClimatePlaceDailyClearingDelivery", provider: ACTOR, customer: CHANNEL, demand: demand.id, clearing };
  const delivery = { id: contentId(body), ...body };
  return { type: "ClimatePlaceDailyClearingResult", provider: ACTOR, demand: demand.id, disposition: "delivered", delivery, externalEffects: [] };
}

export async function main() {
  const activation = JSON.parse(readFileSync(process.env.CLIMATE_PLACE_MARKET_AGENT_ACTIVATION ?? new URL("../content/config/clearing-agent.json", import.meta.url), "utf8"));
  if (activation.status !== "enabled-active-under-user-systemd") throw new TypeError("climate place clearing A2A face is not active");
  let input = ""; process.stdin.setEncoding("utf8"); for await (const chunk of process.stdin) input += chunk;
  const message = parseA2aMessage(JSON.parse(input)), decoded = decodeSemantic(extractRmnPart(message.parts).bytes);
  if (!semanticBytes(decoded).equals(extractRmnPart(message.parts).bytes) || decoded?.[0] !== "climate-place-daily-clearing-demand" || decoded.length !== 2) throw new TypeError("foreign RMN operation");
  const result = await deliverDailyClearing(decoded[1], { dataRoot: process.env.CLIMATE_PLACE_MARKET_DATA_ROOT });
  process.stdout.write(`${JSON.stringify(agentRmnMessage(semanticBytes(["climate-place-daily-clearing-result", result]), "climate-place-daily-clearing-result.rmn.cbor"))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
