// Builds the self-contained page. Scores are computed here from each record's
// rubric block so the published HTML can never drift from src/scoring.js.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { scoreRecord, fccApplies, primarySubject, peopleIn, DIMENSIONS, BANDS, MAX_RAW } from "./src/scoring.js";
import { resolveVideo, validateVideo } from "./src/video.js";

const here = (p) => new URL(p, import.meta.url);
const corpus = JSON.parse(readFileSync(here("data/ads.json"), "utf8"));

// A malformed video block is the one defect that reaches readers as a broken
// player, so it stops the build rather than shipping.
const videoErrors = corpus.records.flatMap((rec) => validateVideo(rec));
if (videoErrors.length) {
  throw new Error(`invalid video blocks:\n  ${videoErrors.join("\n  ")}`);
}

const records = corpus.records.map((rec) => ({
  ...rec,
  computed: scoreRecord(rec),
  fccApplies: fccApplies(rec),
  primary: primarySubject(rec),
  people: peopleIn(rec),
  // Resolved at build time so the page never re-derives embed policy in the
  // browser - one decision, made once, from the rubric in src/video.js.
  video: resolveVideo(rec),
}));

const payload = {
  updated: corpus.updated,
  records,
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

const tally = records.reduce((a, r) => ((a[r.computed.score] = (a[r.computed.score] || 0) + 1), a), {});
const video = records.reduce((a, r) => ((a[r.video.mode] = (a[r.video.mode] || 0) + 1), a), {});
console.log(`built public/index.html — ${records.length} records, score distribution ${JSON.stringify(tally)}`);
console.log(`  video: ${video.embed || 0} embedded, ${video.link || 0} linked, ${video.none || 0} original not located`);
