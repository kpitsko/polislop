import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveVideo, validateVideo, youTubeIdFromUrl, PLATFORMS } from "../src/video.js";

const corpus = JSON.parse(readFileSync(new URL("../data/ads.json", import.meta.url), "utf8"));

const rec = (video, id = "test-record") => ({ id, video });

test("video: a confirmed YouTube original is framed in-page", () => {
  const r = resolveVideo(
    rec({ platform: "youtube", video_id: "dQw4w9WgXcQ", embed_available: true, verified: true }),
  );
  assert.equal(r.mode, "embed");
  assert.ok(r.embedUrl.includes("dQw4w9WgXcQ"));
  assert.ok(r.embedUrl.startsWith("https://www.youtube-nocookie.com/"), "embeds stay on the no-cookie host");
});

test("video: an unverified ID is never framed, even when otherwise embeddable", () => {
  const r = resolveVideo(
    rec({
      platform: "youtube",
      video_id: "dQw4w9WgXcQ",
      verified: false,
      original_ad_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
  );
  assert.equal(r.mode, "link", "unconfirmed footage must degrade to a link");
  assert.equal(r.reason, "unverified");
});

test("video: a non-embeddable platform yields a watch link, not a player", () => {
  const r = resolveVideo(
    rec({ platform: "x", original_ad_url: "https://x.com/example/status/123", verified: true }),
  );
  assert.equal(r.mode, "link");
  assert.equal(r.platformLabel, "X");
  assert.equal(r.watchUrl, "https://x.com/example/status/123");
});

test("video: no located original reports 'none' rather than an empty frame", () => {
  assert.equal(resolveVideo(rec(null)).mode, "none");
  assert.equal(resolveVideo({ id: "bare" }).mode, "none");
  assert.equal(resolveVideo({ id: "bare", embed: null }).mode, "none");
});

test("video: an archive copy alone still gives the reader somewhere to go", () => {
  const r = resolveVideo(
    rec({ platform: "archive", archive_url: "https://web.archive.org/web/2026/https://example.org/ad" }),
  );
  assert.equal(r.mode, "link");
  assert.ok(r.archiveUrl);
});

test("video: embed mode always carries a usable embed URL", () => {
  // Guards the one failure the page must never produce: a framed player with
  // nothing to play.
  const shapes = [
    { platform: "youtube", video_id: "dQw4w9WgXcQ", verified: true, embed_available: true },
    { platform: "youtube", video_id: "dQw4w9WgXcQ", verified: true },
  ];
  for (const s of shapes) {
    const r = resolveVideo(rec(s));
    if (r.mode === "embed") assert.ok(r.embedUrl && r.videoId, `embed mode needs a URL: ${JSON.stringify(s)}`);
  }
});

test("video: legacy embed field keeps rendering", () => {
  const r = resolveVideo({ id: "legacy", embed: { id: "dQw4w9WgXcQ" } });
  assert.equal(r.mode, "embed");
  assert.equal(r.platform, "youtube");
});

test("validate: embed_available without an ID is rejected", () => {
  const errs = validateVideo(rec({ platform: "youtube", embed_available: true, verified: true }));
  assert.ok(errs.some((e) => e.includes("no video_id")), errs.join("; "));
});

test("validate: embed_available on a platform we cannot frame is rejected", () => {
  const errs = validateVideo(
    rec({ platform: "tiktok", video_id: "123", embed_available: true, verified: true }),
  );
  assert.ok(errs.some((e) => e.includes("cannot be embedded")), errs.join("; "));
});

test("validate: claiming an embed without verified footage is rejected", () => {
  const errs = validateVideo(rec({ platform: "youtube", video_id: "dQw4w9WgXcQ", embed_available: true }));
  assert.ok(errs.some((e) => e.includes("not marked verified")), errs.join("; "));
});

test("validate: unknown platforms and non-https URLs are rejected", () => {
  assert.ok(validateVideo(rec({ platform: "myspace" })).some((e) => e.includes("unknown platform")));
  assert.ok(
    validateVideo(rec({ platform: "x", original_ad_url: "http://example.org/ad" })).some((e) =>
      e.includes("https"),
    ),
  );
});

test("validate: a clean block produces no errors", () => {
  assert.deepEqual(
    validateVideo(
      rec({
        platform: "youtube",
        video_id: "dQw4w9WgXcQ",
        embed_available: true,
        verified: true,
        original_ad_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        archive_url: "https://web.archive.org/web/2026/https://youtu.be/dQw4w9WgXcQ",
      }),
    ),
    [],
  );
});

test("youTubeIdFromUrl: parses the canonical URL shapes", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/watch?v=${id}&t=30s`), id);
  assert.equal(youTubeIdFromUrl(`https://youtu.be/${id}`), id);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(youTubeIdFromUrl(`https://www.youtube.com/shorts/${id}`), id);
});

test("youTubeIdFromUrl: refuses anything that is not an 11-character ID", () => {
  assert.equal(youTubeIdFromUrl("https://www.youtube.com/watch?v=tooshort"), null);
  assert.equal(youTubeIdFromUrl("https://example.org/not-youtube"), null);
  assert.equal(youTubeIdFromUrl(null), null);
  assert.equal(youTubeIdFromUrl(undefined), null);
});

test("corpus: every record's video block is structurally valid", () => {
  const errs = corpus.records.flatMap((r) => validateVideo(r));
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("corpus: no record is framed without confirmed footage", () => {
  for (const r of corpus.records) {
    const v = resolveVideo(r);
    if (v.mode === "embed") {
      assert.equal(v.verified, true, `${r.id} is framed without a verification record`);
      assert.ok(v.embedUrl, `${r.id} is framed with no embed URL`);
    }
  }
});

test("corpus: every platform named by a record is one we know how to present", () => {
  for (const r of corpus.records) {
    const p = r.video?.platform;
    if (p) assert.ok(PLATFORMS[p], `${r.id} names unknown platform "${p}"`);
  }
});
