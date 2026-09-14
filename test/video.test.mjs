import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveVideo, validateVideo, youTubeIdFromUrl, provenanceEmbeds,
  PLATFORMS, PROVENANCE, PROVENANCE_KEYS,
} from "../src/video.js";

const corpus = JSON.parse(readFileSync(new URL("../data/ads.json", import.meta.url), "utf8"));
const built = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const rec = (video, id = "test-record") => ({ id, video });
const ID = "dQw4w9WgXcQ";

// ---------------------------------------------------------------- resolution

test("video: an official-account YouTube original is framed in-page", () => {
  const r = resolveVideo(rec({ platform: "youtube", video_id: ID, embed_available: true, provenance: "official_source" }));
  assert.equal(r.mode, "embed");
  assert.ok(r.embedUrl.includes(ID));
  assert.ok(r.embedUrl.startsWith("https://www.youtube-nocookie.com/"), "embeds stay on the no-cookie host");
});

test("video: every provenance grade that claims to embed actually does", () => {
  for (const grade of PROVENANCE_KEYS) {
    const r = resolveVideo(rec({ platform: "youtube", video_id: ID, provenance: grade }));
    assert.equal(r.mode, PROVENANCE[grade].embeds ? "embed" : "link",
      `${grade} resolved to ${r.mode}, which contradicts PROVENANCE.embeds`);
  }
});

test("video: an unverified ID is never framed, even when otherwise embeddable", () => {
  const r = resolveVideo(rec({
    platform: "youtube", video_id: ID, provenance: "unverified",
    original_ad_url: `https://www.youtube.com/watch?v=${ID}`,
  }));
  assert.equal(r.mode, "link", "unestablished footage must degrade to a link");
  assert.equal(r.reason, "unverified");
});

test("video: a non-embeddable platform yields a watch link, not a player", () => {
  const r = resolveVideo(rec({ platform: "x", original_ad_url: "https://x.com/example/status/123", provenance: "official_source" }));
  assert.equal(r.mode, "link");
  assert.equal(r.reason, "not-embeddable");
  assert.equal(r.platformLabel, "X");
  assert.equal(r.watchUrl, "https://x.com/example/status/123");
});

test("video: no located original reports 'none' rather than an empty frame", () => {
  assert.equal(resolveVideo(rec(null)).mode, "none");
  assert.equal(resolveVideo({ id: "bare" }).mode, "none");
  assert.equal(resolveVideo({ id: "bare", embed: null }).mode, "none");
});

test("video: an archive copy alone still gives the reader somewhere to go", () => {
  const r = resolveVideo(rec({ platform: "archive", archive_url: "https://web.archive.org/web/2026/https://example.org/ad" }));
  assert.equal(r.mode, "link");
  assert.ok(r.archiveUrl);
});

test("video: embed mode always carries a usable embed URL and ID", () => {
  // Guards the one failure the page must never produce: a framed player with
  // nothing to play.
  const shapes = [
    { platform: "youtube", video_id: ID, provenance: "official_source", embed_available: true },
    { platform: "youtube", video_id: ID, provenance: "reporting_corroborated" },
    { platform: "youtube", video_id: ID, provenance: "archive_verified" },
    { platform: "youtube", provenance: "official_source" },
    { platform: "x", video_id: ID, provenance: "official_source" },
  ];
  for (const s of shapes) {
    const r = resolveVideo(rec(s));
    if (r.mode === "embed") assert.ok(r.embedUrl && r.videoId, `embed mode needs a URL: ${JSON.stringify(s)}`);
  }
});

test("video: embed_available:false keeps a strong record as a link", () => {
  const r = resolveVideo(rec({ platform: "youtube", video_id: ID, provenance: "official_source", embed_available: false }));
  assert.equal(r.mode, "link");
  assert.equal(r.reason, "embed-blocked");
});

test("video: legacy embed field keeps rendering, as human-reviewed", () => {
  const r = resolveVideo({ id: "legacy", embed: { id: ID } });
  assert.equal(r.mode, "embed");
  assert.equal(r.platform, "youtube");
  assert.equal(r.provenance, "human_verified");
});

test("video: the legacy `verified` flag still grants an embed", () => {
  const r = resolveVideo(rec({ platform: "youtube", video_id: ID, verified: true }));
  assert.equal(r.mode, "embed");
  assert.equal(r.provenance, "human_verified");
});

test("video: a block with no provenance is treated as unverified", () => {
  const r = resolveVideo(rec({ platform: "x", original_ad_url: "https://x.com/a/status/1" }));
  assert.equal(r.provenance, "unverified");
  assert.equal(r.mode, "link");
});

// ---------------------------------------------------------------- validation

test("validate: embed_available without an ID is rejected", () => {
  const errs = validateVideo(rec({ platform: "youtube", embed_available: true, provenance: "official_source" }));
  assert.ok(errs.some((e) => e.includes("no video_id")), errs.join("; "));
});

test("validate: embed_available on a platform we cannot frame is rejected", () => {
  const errs = validateVideo(rec({ platform: "tiktok", video_id: "123", embed_available: true, provenance: "official_source" }));
  assert.ok(errs.some((e) => e.includes("cannot be embedded")), errs.join("; "));
});

test("validate: claiming an embed on unverified provenance is rejected", () => {
  const errs = validateVideo(rec({ platform: "youtube", video_id: ID, embed_available: true, provenance: "unverified" }));
  assert.ok(errs.some((e) => e.includes("not strong enough")), errs.join("; "));
});

test("validate: a malformed YouTube ID is rejected before it can render", () => {
  // An ID of the wrong shape yields a player that loads and then says "video
  // unavailable" - indistinguishable from a broken embed to a reader.
  for (const bad of ["tooshort", "waaaaaaaytoolongforanid", "has space!!", "dQw4w9WgXc"]) {
    const errs = validateVideo(rec({ platform: "youtube", video_id: bad, provenance: "official_source" }));
    assert.ok(errs.some((e) => e.includes("11-character")), `${bad}: ${errs.join("; ")}`);
  }
  assert.deepEqual(validateVideo(rec({ platform: "youtube", video_id: ID, provenance: "official_source" })), []);
});

test("validate: unknown platforms, unknown provenance and non-https URLs are rejected", () => {
  assert.ok(validateVideo(rec({ platform: "myspace" })).some((e) => e.includes("unknown platform")));
  assert.ok(validateVideo(rec({ platform: "x", provenance: "vibes" })).some((e) => e.includes("unknown provenance")));
  assert.ok(validateVideo(rec({ platform: "x", original_ad_url: "http://example.org/ad" })).some((e) => e.includes("https")));
});

test("validate: a strong grade must point at something concrete", () => {
  const errs = validateVideo(rec({ platform: "x", provenance: "official_source" }));
  assert.ok(errs.some((e) => e.includes("neither original_ad_url nor video_id")), errs.join("; "));
});

test("validate: a clean block produces no errors", () => {
  assert.deepEqual(
    validateVideo(rec({
      platform: "youtube", video_id: ID, embed_available: true, provenance: "official_source",
      original_ad_url: `https://www.youtube.com/watch?v=${ID}`,
      archive_url: `https://web.archive.org/web/2026/https://youtu.be/${ID}`,
    })),
    [],
  );
});

test("provenanceEmbeds: only the four established grades embed", () => {
  assert.equal(provenanceEmbeds("official_source"), true);
  assert.equal(provenanceEmbeds("archive_verified"), true);
  assert.equal(provenanceEmbeds("human_verified"), true);
  assert.equal(provenanceEmbeds("reporting_corroborated"), true);
  assert.equal(provenanceEmbeds("unverified"), false);
  assert.equal(provenanceEmbeds(undefined), false);
  assert.equal(provenanceEmbeds("made-it-up"), false);
});

// -------------------------------------------------------------------- parser

test("youTubeIdFromUrl: parses the canonical URL shapes", () => {
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}&t=30s`), ID);
  assert.equal(youTubeIdFromUrl(`https://youtu.be/${ID}`), ID);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/shorts/${ID}`), ID);
});

test("youTubeIdFromUrl: refuses anything that is not an 11-character ID", () => {
  assert.equal(youTubeIdFromUrl("https://www.youtube.com/watch?v=tooshort"), null);
  assert.equal(youTubeIdFromUrl("https://example.org/not-youtube"), null);
  assert.equal(youTubeIdFromUrl(null), null);
  assert.equal(youTubeIdFromUrl(undefined), null);
});

// -------------------------------------------------------------------- corpus

test("corpus: every record's video block is structurally valid", () => {
  const errs = corpus.records.flatMap((r) => validateVideo(r));
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("corpus: no record is framed without established provenance", () => {
  for (const r of corpus.records) {
    const v = resolveVideo(r);
    if (v.mode === "embed") {
      assert.ok(provenanceEmbeds(v.provenance), `${r.id} is framed on provenance "${v.provenance}"`);
      assert.ok(v.embedUrl, `${r.id} is framed with no embed URL`);
      assert.ok(v.watchUrl, `${r.id} is framed with no fallback link beneath the player`);
    }
  }
});

test("corpus: every located original carries a provenance grade and a note", () => {
  for (const r of corpus.records) {
    if (!r.video) continue;
    assert.ok(PROVENANCE[r.video.provenance], `${r.id} has no usable provenance`);
    assert.ok((r.video.verificationNote ?? "").length > 20,
      `${r.id} records a provenance grade but does not say how it was established`);
  }
});

test("corpus: a YouTube record's recorded URL agrees with its video_id", () => {
  // Catches the copy-paste failure where an ID and a URL drift apart and the
  // player and the fallback link point at two different videos.
  for (const r of corpus.records) {
    const v = r.video;
    if (v?.platform !== "youtube" || !v.original_ad_url) continue;
    assert.equal(youTubeIdFromUrl(v.original_ad_url), v.video_id,
      `${r.id}: original_ad_url and video_id disagree`);
  }
});

test("corpus: every platform named by a record is one we know how to present", () => {
  for (const r of corpus.records) {
    const p = r.video?.platform;
    if (p) assert.ok(PLATFORMS[p], `${r.id} names unknown platform "${p}"`);
  }
});

test("corpus: no record links to reporting in place of the ad", () => {
  // The ledger's hard rule: a news article or segment about an ad is never
  // offered as the ad. Cited source hosts must not appear as ad URLs.
  const hosts = new Set(corpus.records.flatMap((r) => (r.sources ?? []).map((s) => new URL(s.url).host)));
  for (const r of corpus.records) {
    for (const key of ["original_ad_url", "archive_url"]) {
      const u = r.video?.[key];
      if (!u) continue;
      assert.ok(!hosts.has(new URL(u).host),
        `${r.id}: ${key} points at ${new URL(u).host}, which is a cited reporting source`);
    }
  }
});

// ------------------------------------------------------------- rendered page

test("built page: every framed record reaches the page with a player and a fallback", () => {
  // The page renders records in the browser from an embedded JSON payload, so
  // the check that matters is what the payload carries, not the static markup.
  const payload = JSON.parse(
    built.match(/<script type="application\/json" id="polislop-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, "</"),
  );
  const framed = payload.records.filter((r) => r.video.mode === "embed");
  assert.equal(framed.length, corpus.records.map(resolveVideo).filter((v) => v.mode === "embed").length);
  assert.ok(framed.length > 0, "expected at least one framed record in the corpus");
  for (const r of framed) {
    assert.match(r.video.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/,
      `${r.id} would frame a malformed embed URL`);
    assert.ok(r.video.watchUrl, `${r.id} is framed with no fallback link beneath the player`);
  }
  for (const r of payload.records) {
    assert.ok(["embed", "link", "none"].includes(r.video.mode), `${r.id}: unknown video mode`);
    if (r.video.mode === "link") assert.ok(r.video.watchUrl || r.video.archiveUrl, `${r.id}: link mode with nowhere to go`);
  }
});

test("built page: the player template is guarded so it cannot emit an empty frame", () => {
  // The iframe lives in a client-side template, so the guard around it is the
  // thing that prevents a src-less player, and it is worth pinning.
  assert.ok(built.includes('v.mode === "embed" && v.embedUrl'),
    "the player branch is no longer guarded on an embed URL being present");
  const tpl = built.match(/<iframe src="\$\{esc\(v\.embedUrl\)\}"[^>]*>/);
  assert.ok(tpl, "the player template no longer interpolates an escaped embed URL");
  assert.match(tpl[0], /title="/, "the player template has no accessible name");
  assert.match(tpl[0], /loading="lazy"/, "the player template lost lazy loading");
});

test("built page: carries no CSP that would block the players it frames", () => {
  // A frame-src policy that omits the embed host is the silent way this page
  // regresses to blank boxes in production.
  const csp = built.match(/http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"']+)["']/i);
  if (csp) {
    const policy = csp[1];
    const frame = /(?:frame-src|child-src|default-src)([^;]*)/i.exec(policy);
    assert.ok(frame && /youtube-nocookie\.com/.test(frame[1]),
      `page CSP does not allow the YouTube embed host: ${policy}`);
  }
});
