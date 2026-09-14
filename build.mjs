// Builds the self-contained page. Scores are computed here from each record's
// rubric block so the published HTML can never drift from src/scoring.js.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { scoreRecord, fccApplies, primarySubject, peopleIn, DIMENSIONS, BANDS, MAX_RAW } from "./src/scoring.js";

const here = (p) => new URL(p, import.meta.url);
const corpus = JSON.parse(readFileSync(here("data/ads.json"), "utf8"));

const records = corpus.records.map((rec) => ({
  ...rec,
  computed: scoreRecord(rec),
  fccApplies: fccApplies(rec),
  primary: primarySubject(rec),
  people: peopleIn(rec),
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
console.log(`built public/index.html — ${records.length} records, score distribution ${JSON.stringify(tally)}`);
