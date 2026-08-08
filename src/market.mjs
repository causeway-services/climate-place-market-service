import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { querySettlementRecords, recordSettlementRecord } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";

export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACTOR = "urn:ame:climate-place-market-enterprise";
export const CHANNEL = "urn:ame:climate-youtube-channel-enterprise";
export const BID_CATEGORY = "climate-place-market.bid-admission";
export const CLEARING_CATEGORY = "climate-place-market.daily-clearing";
const WITHHELD = ["climate-research-truth", "research-supplier-selection", "notebooklm-authority", "channel-production-admission", "youtube-credentials", "upload-schedule-publication"];

export function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
export function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
export function contentId(value) { return identifyJsonSemanticContent({ objectKind: "emsweb.climate-place-market.record", value: value, witnessRoot: EMPTY_WITNESS_ROOT }).token; }
function exact(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const { id, ...body } = value; return id === contentId(body); }
function policy(path = join(NODE_ROOT, "content/config/policy.json")) { const value = JSON.parse(readFileSync(path, "utf8")); if (value?.status !== "active" || value.timezone !== "America/Chicago") throw new TypeError("climate place market policy is not active and exact"); return value; }
function text(value) { return typeof value === "string" && value.trim() !== ""; }
function chicagoDay(instant) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)); const get = (type) => parts.find((part) => part.type === type)?.value; return `${get("year")}-${get("month")}-${get("day")}`; }
function dayDistance(left, right) { return Math.round(Math.abs(Date.parse(`${left}T12:00:00Z`) - Date.parse(`${right}T12:00:00Z`)) / 86_400_000); }
async function record(category, row, options) { const at = options.at ?? new Date().toISOString(); if (!/^eip155:[0-9]+:0x[a-f0-9]{40}$/u.test(options.settlement ?? "")) throw new TypeError("climate place market requires its sovereign settlement account"); await recordSettlementRecord({ agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: options.settlement, actor: ACTOR, category, recordedAt: at, record: { ...row } }); }

export async function admitCoverageBid(input = {}, options = {}) {
  const p = policy(options.policyPath), at = options.at ?? new Date().toISOString(), place = input.place, commitment = input.settlementCommitment;
  if (!text(input.bidder) || input.customer !== CHANNEL || !text(place?.id) || !p.placeKinds.includes(place?.kind) || !text(place.name) || !text(place.region) || !text(place.timezone) || !/^[A-Z]{2}$/u.test(place.countryCode ?? "") || !Number.isSafeInteger(place.latitudeE6) || Math.abs(place.latitudeE6) > 90_000_000 || !Number.isSafeInteger(place.longitudeE6) || Math.abs(place.longitudeE6) > 180_000_000) throw new TypeError("coverage bid requires one stable bounded town-or-city identity");
  if (!Number.isSafeInteger(input.coverageBidMicros) || input.coverageBidMicros <= 0 || !Number.isSafeInteger(input.researchBudgetMicros) || input.researchBudgetMicros <= 0 || input.coverageBidMicros < input.researchBudgetMicros || input.accountingUnit !== p.accountingUnit) throw new TypeError("coverage bid requires positive non-loss coverage and research prices");
  const currentYear = Number(chicagoDay(at).slice(0, 4)); if (!Number.isInteger(input.historyStartYear) || input.historyStartYear < p.minimumHistoryStartYear || input.historyStartYear >= currentYear || !Number.isInteger(input.forecastHorizonYear) || input.forecastHorizonYear < currentYear + p.minimumForecastLeadYears || input.forecastHorizonYear > p.maximumForecastHorizonYear) throw new TypeError("coverage bid history or forecast horizon is outside policy");
  if (!Number.isSafeInteger(input.verifiedDemandMicros) || input.verifiedDemandMicros < 0 || !Array.isArray(input.demandSignals) || new Set(input.demandSignals).size !== input.demandSignals.length || input.demandSignals.some((id) => !/^urn:sha256:[a-f0-9]{64}$/u.test(id)) || !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(commitment ?? "") || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(at)) throw new TypeError("coverage bid lacks verified demand, commitment, or live expiry");
  const placeBody = { type: "GeoPlaceIdentity", sourceId: place.id, kind: place.kind, name: place.name, region: place.region, countryCode: place.countryCode, latitudeE6: place.latitudeE6, longitudeE6: place.longitudeE6, timezone: place.timezone }, stablePlace = { id: contentId(placeBody), ...placeBody };
  const terms = { bidder: input.bidder, customer: CHANNEL, place: stablePlace, coverageBidMicros: input.coverageBidMicros, researchBudgetMicros: input.researchBudgetMicros, accountingUnit: p.accountingUnit, verifiedDemandMicros: input.verifiedDemandMicros, demandSignals: [...input.demandSignals], historyStartYear: input.historyStartYear, forecastHorizonYear: input.forecastHorizonYear, expiresAt: input.expiresAt, settlementMode: input.settlementMode };
  if (typeof options.verifySettlementCommitment !== "function" || (await options.verifySettlementCommitment(commitment, terms)) !== true || !["same-legal-body-cost-allocation", "x402"].includes(input.settlementMode)) throw new TypeError("coverage bid settlement commitment is not verified");
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), prior = (await querySettlementRecords(BID_CATEGORY)).filter((row) => row.settlementCommitment === commitment);
  if (prior.length) { const values = prior; if (values.some((row) => !exact(row)) || new Set(values.map((row) => row.id)).size !== 1) throw new TypeError("coverage bid commitment ledger conflicts"); return values[0]; }
  const body = { type: "ClimatePlaceCoverageBid", market: ACTOR, ...terms, settlementCommitment: commitment, status: "admitted-unspent", authorityWithheld: [...WITHHELD], bidAt: at }, bid = { id: contentId(body), ...body };
  await record(BID_CATEGORY, bid, { ...options, dataRoot, at }); return bid;
}

export async function clearDailyPlace({ civilDay } = {}, options = {}) {
  const p = policy(options.policyPath), at = options.at ?? new Date().toISOString(); if (!/^\d{4}-\d{2}-\d{2}$/u.test(civilDay ?? "") || civilDay !== chicagoDay(at)) throw new TypeError("place clearing day must match America/Chicago now");
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), prior = (await querySettlementRecords(CLEARING_CATEGORY)).filter((row) => row.civilDay === civilDay);
  if (prior.length) { const values = prior; if (values.some((row) => !exact(row)) || new Set(values.map((row) => row.id)).size !== 1) throw new TypeError("daily place clearing ledger conflicts"); return values[0]; }
  const runtimeRoot = resolve(options.runtimeRoot ?? join(dataRoot, "runtime/clearing-locks")); mkdirSync(runtimeRoot, { recursive: true }); const lock = join(runtimeRoot, civilDay); try { mkdirSync(lock); } catch (error) { if (error?.code === "EEXIST") throw new TypeError("daily place clearing is concurrently executing"); throw error; }
  try {
    const samePlace = (left, right) => left?.sourceId === right?.sourceId || (left?.countryCode === right?.countryCode && left?.name?.trim().toLocaleLowerCase("en-US") === right?.name?.trim().toLocaleLowerCase("en-US") && left?.region?.trim().toLocaleLowerCase("en-US") === right?.region?.trim().toLocaleLowerCase("en-US"));
    const clearings = await querySettlementRecords(CLEARING_CATEGORY), recentlyCleared = (place) => clearings.some((row) => samePlace(row.place, place) && dayDistance(row.civilDay, civilDay) < p.placeCooldownDays);
    const bids = (await querySettlementRecords(BID_CATEGORY)).filter((row) => exact(row) && row.type === "ClimatePlaceCoverageBid" && Date.parse(row.expiresAt) >= Date.parse(at) && !clearings.some((clearing) => clearing.winningBid === row.id) && !recentlyCleared(row.place));
    bids.sort((a, b) => b.coverageBidMicros - a.coverageBidMicros || b.verifiedDemandMicros - a.verifiedDemandMicros || Date.parse(a.bidAt) - Date.parse(b.bidAt) || a.id.localeCompare(b.id));
    const winner = bids[0]; if (!winner) throw new TypeError("daily place clearing has no eligible funded bid");
    if (typeof options.verifyBidCommitment !== "function" || (await options.verifyBidCommitment(winner)) !== true) throw new TypeError("winning place bid commitment is not authenticated at clearing");
    const body = { type: "ClimatePlaceDailyClearing", market: ACTOR, customer: CHANNEL, civilDay, timezone: p.timezone, winningBid: winner.id, bidder: winner.bidder, place: winner.place, coverageRevenueMicros: winner.coverageBidMicros, researchProcurementCeilingMicros: winner.researchBudgetMicros, grossSurplusMicros: winner.coverageBidMicros - winner.researchBudgetMicros, accountingUnit: p.accountingUnit, historyStartYear: winner.historyStartYear, forecastHorizonYear: winner.forecastHorizonYear, demandSignals: winner.demandSignals, selectionRule: [...p.ranking], status: "cleared-research-not-procured", authorityWithheld: [...WITHHELD], clearedAt: at }, clearing = { id: contentId(body), ...body };
    await record(CLEARING_CATEGORY, clearing, { ...options, dataRoot, at }); return clearing;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
