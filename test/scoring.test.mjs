import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreRecord, fccApplies, primarySubject, peopleIn, BANDS, DIMENSIONS } from "../src/scoring.js";

const corpus = JSON.parse(readFileSync(new URL("../data/ads.json", import.meta.url), "utf8"));

const mk = (fabrication, realism, disclosure, extra = {}) => ({
  rubric: { fabrication, realism, disclosure }, ...extra,
});

test("floor: nothing fabricated, fully disclosed", () => {
  assert.equal(scoreRecord(mk(0, 0, 0)).score, 1);
});

test("ceiling: invented words, photoreal, undisclosed", () => {
  const r = scoreRecord(mk(4, 2, 3));
  assert.equal(r.score, 5);
  assert.equal(r.raw, r.maxRaw);
});

test("realism gates fabrication - a cartoon scores below photoreal at equal fabrication", () => {
  const cartoon = scoreRecord(mk(4, 0, 3)).raw;
  const photoreal = scoreRecord(mk(4, 2, 3)).raw;
  assert.ok(cartoon < photoreal, `${cartoon} should be < ${photoreal}`);
});

test("disclosure mitigates but never fully excuses a photoreal fabrication", () => {
  const labeled = scoreRecord(mk(4, 2, 0));
  assert.ok(labeled.score >= 3, "a perfectly labeled photoreal fabrication is still notable");
  assert.ok(labeled.score < 5, "a clear label must move the score off the ceiling");
});

test("breakdown arithmetic reproduces the raw score", () => {
  const r = scoreRecord(mk(3, 1, 2));
  const summed = r.breakdown.reduce((acc, d) => acc + (d.points ?? 0), 0);
  assert.equal(Number(summed.toFixed(2)), r.raw);
});

test("every band is reachable from some valid input", () => {
  const reached = new Set();
  for (let f = 0; f <= DIMENSIONS.fabrication.max; f++)
    for (let rl = 0; rl <= DIMENSIONS.realism.max; rl++)
      for (let d = 0; d <= DIMENSIONS.disclosure.max; d++)
        reached.add(scoreRecord(mk(f, rl, d)).score);
  for (const band of BANDS) assert.ok(reached.has(band.score), `band ${band.score} unreachable`);
});

test("invalid sub-scores are rejected rather than silently coerced", () => {
  assert.throws(() => scoreRecord(mk(5, 0, 0)), /fabrication/);
  assert.throws(() => scoreRecord(mk(0, 9, 0)), /realism/);
  assert.throws(() => scoreRecord(mk(0, 0, undefined)), /disclosure/);
});

test("FCC jurisdiction tracks the carriage channel, not the ad's content", () => {
  assert.equal(fccApplies({ channels: ["broadcast", "social"] }), true);
  assert.equal(fccApplies({ channels: ["radio"] }), true);
  assert.equal(fccApplies({ channels: ["social", "youtube", "digital"] }), false);
  assert.equal(fccApplies({}), false);
});

test("corpus: every record scores, cites two sources, and is internally consistent", () => {
  for (const rec of corpus.records) {
    const r = scoreRecord(rec);
    assert.ok(r.score >= 1 && r.score <= 5, `${rec.id} scored ${r.score}`);
    assert.ok((rec.sources ?? []).length >= 2, `${rec.id} needs >=2 independent sources`);
    assert.ok(rec.howAiUsed?.length > 40, `${rec.id} must explain how AI was used`);
    assert.equal(r.provisional, rec.reviewStatus === "needs-verification");
  }
});

test("corpus: records flagged needs-verification carry a reviewNote explaining why", () => {
  for (const rec of corpus.records.filter((r) => r.reviewStatus === "needs-verification")) {
    assert.ok(rec.reviewNote?.length > 20, `${rec.id} is provisional but does not say why`);
  }
});

test("primary subject is the person the ad portrays, not the sponsor", () => {
  const rec = {
    sponsor: { name: "Some PAC", type: "party committee", party: "R", sortName: "Some PAC" },
    depicted: [{ name: "Jane Roe", sortName: "Roe", party: "D", role: "Senator" }],
  };
  assert.equal(primarySubject(rec).sortName, "Roe");
  assert.equal(primarySubject(rec).source, "depicted");
});

test("props with no US party affiliation never become the primary subject", () => {
  const rec = {
    sponsor: { name: "X campaign", type: "candidate committee", party: "R", sortName: "X" },
    depicted: [
      { name: "Vladimir Putin", sortName: "Putin", party: "\u2014", role: "prop" },
      { name: "Angelia Orr", sortName: "Orr", party: "R", role: "state Rep." },
    ],
  };
  assert.equal(primarySubject(rec).sortName, "Orr");
});

test("primary subject falls back to the sponsor when nobody is depicted", () => {
  const rec = { sponsor: { name: "Solo Cmte", type: "candidate committee", party: "D", sortName: "Solo" }, depicted: [] };
  assert.equal(primarySubject(rec).source, "sponsor");
  assert.equal(primarySubject(rec).sortName, "Solo");
});

test("peopleIn lists depicted people and candidate sponsors, but not party committees", () => {
  const rec = {
    sponsor: { name: "NRSC", type: "party committee", party: "R", sortName: "NRSC" },
    depicted: [{ name: "Jane Roe", sortName: "Roe", party: "D", role: "Senator" }],
  };
  const names = peopleIn(rec).map((p) => p.name);
  assert.deepEqual(names, ["Jane Roe"]);

  const rec2 = { ...rec, sponsor: { name: "Doe campaign", type: "candidate committee", party: "R", sortName: "Doe" } };
  assert.deepEqual(peopleIn(rec2).map((p) => p.name).sort(), ["Doe campaign", "Jane Roe"]);
});

test("corpus: every person carries a party and a sortable surname", () => {
  for (const rec of corpus.records) {
    assert.ok(rec.sponsor.party, `${rec.id} sponsor has no party`);
    assert.ok(rec.sponsor.sortName, `${rec.id} sponsor has no sortName`);
    for (const d of rec.depicted) {
      assert.ok(d.party, `${rec.id}: ${d.name} has no party`);
      assert.ok(d.sortName, `${rec.id}: ${d.name} has no sortName`);
    }
    assert.ok(primarySubject(rec).sortName, `${rec.id} has no sortable primary subject`);
  }
});

test("corpus: candidate A-Z ordering is total and stable", () => {
  const sorted = [...corpus.records].sort((a, b) =>
    primarySubject(a).sortName.localeCompare(primarySubject(b).sortName));
  assert.equal(sorted.length, corpus.records.length);
  const names = sorted.map((r) => primarySubject(r).sortName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
