// Builds the self-contained page. Scores are computed here from each record's
// rubric block so the published HTML can never drift from src/scoring.js.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { scoreRecord, fccApplies, primarySubject, DIMENSIONS, BANDS, MAX_RAW } from "./src/scoring.js";
import { resolveVideo, validateVideo, resolveCoverage, validateCoverage } from "./src/video.js";
import { sanitizeEmbedHtml } from "./src/oembed.js";
import { US_STATES, PARTIES, unknownTaxonomy } from "./src/taxonomy.js";

const here = (p) => new URL(p, import.meta.url);
const corpus = JSON.parse(readFileSync(here("data/ads.json"), "utf8"));

// Meta's embed markup, resolved offline by ingest/meta-oembed.mjs. Read from
// the committed cache so a build never depends on Meta being up, and so the
// exact third-party markup the site ships is reviewable in a diff.
const cachePath = here("data/oembed-cache.json");
const oembed = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")).entries ?? {} : {};

// The cache is re-checked here rather than trusted: it is third-party HTML that
// goes straight into the page, and a build is the last place to catch markup
// that has drifted into a shape we would not knowingly ship.
for (const [url, entry] of Object.entries(oembed)) {
  if (!entry?.ok) continue;
  if (!sanitizeEmbedHtml(entry.html, entry.provider)) {
    throw new Error(`oembed cache: markup for ${url} is not a safe ${entry.provider} embed; re-run ingest/meta-oembed.mjs`);
  }
}

// A malformed video block is the one defect that reaches readers as a broken
// player, so it stops the build rather than shipping.
const videoErrors = corpus.records.flatMap((rec) => [...validateVideo(rec), ...validateCoverage(rec)]);
if (videoErrors.length) {
  throw new Error(`invalid video blocks:\n  ${videoErrors.join("\n  ")}`);
}

const records = corpus.records.map((rec) => ({
  ...rec,
  computed: scoreRecord(rec),
  fccApplies: fccApplies(rec),
  primary: primarySubject(rec),
  // Resolved at build time so the page never re-derives embed policy in the
  // browser - one decision, made once, from the rubric in src/video.js.
  video: resolveVideo(rec, { oembed }),
  // Reporting about the ad, shown only where no player of the ad itself is
  // framed. Resolved separately so it can never stand in for an original.
  coverage: resolveCoverage(rec),
}));

// A record whose state or party is not in the published taxonomy would be
// invisible to the filter that claims to cover it, so this stops the build.
const taxonomyErrors = unknownTaxonomy(corpus.records);
if (taxonomyErrors.length) {
  throw new Error(`records use values missing from src/taxonomy.js:\n  ${taxonomyErrors.join("\n  ")}`);
}

const payload = {
  updated: corpus.updated,
  records,
  states: US_STATES,
  parties: PARTIES,
  dimensions: DIMENSIONS,
  bands: BANDS.map(({ score, label, meaning }) => ({ score, label, meaning })),
  maxRaw: Number(MAX_RAW.toFixed(2)),
};

// The JSON rides inside a <script type="application/json"> block, so the only
// sequence that can break out of it is a literal "</script".
const json = JSON.stringify(payload).replace(/<\/(script)/gi, "<\\/$1");

const html = readFileSync(here("src/page.html"), "utf8");
if (!html.includes("<!--POLISLOP_DATA-->")) throw new Error("page.html lost its POLISLOP_DATA placeholder");

mkdirSync(here("public"), { recursive: true });
writeFileSync(here("public/index.html"), html.replace("<!--POLISLOP_DATA-->", json));

// Security headers travel with the static assets, not through worker.js: with
// Workers Assets the HTML is served before the Worker ever runs, so a header set
// in the Worker would never reach the page that hosts the embeds.
copyFileSync(here("src/headers"), here("public/_headers"));

const tally = records.reduce((a, r) => ((a[r.computed.score] = (a[r.computed.score] || 0) + 1), a), {});
const video = records.reduce((a, r) => ((a[r.video.mode] = (a[r.video.mode] || 0) + 1), a), {});
console.log(`built public/index.html — ${records.length} records, score distribution ${JSON.stringify(tally)}`);
const kinds = records.reduce((a, r) => (r.video.mode === "embed" ? ((a[r.video.embedKind] = (a[r.video.embedKind] || 0) + 1), a) : a), {});
const withCoverage = records.filter((r) => r.coverage && r.video.mode !== "embed").length;
console.log(`  video: ${video.embed || 0} embedded (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}), ${video.link || 0} linked, ${video.none || 0} original not located; ${withCoverage} carry a news clip`);
