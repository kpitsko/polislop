import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveVideo, validateVideo, youTubeIdFromUrl, xStatusIdFromUrl, provenanceEmbeds,
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
  // Instagram answers /embed/ with x-frame-options: DENY, and Facebook's video
  // plugin paints an empty box for /reel/ URLs, so both link out by design.
  for (const [platform, url, label] of [
    ["instagram", "https://www.instagram.com/reel/ABCdefGHIjk/", "Instagram"],
    ["facebook", "https://www.facebook.com/reel/845246751375832", "Facebook"],
  ]) {
    const r = resolveVideo(rec({ platform, original_ad_url: url, provenance: "official_source" }));
    assert.equal(r.mode, "link", `${platform} must not be framed`);
    assert.equal(r.reason, "not-embeddable");
    assert.equal(r.platformLabel, label);
    assert.equal(r.watchUrl, url);
  }
});

test("video: an X post is framed as a widget, not an iframe", () => {
  const url = "https://x.com/KenPaxtonTX/status/2012168725630165435";
  const r = resolveVideo(rec({ platform: "x", original_ad_url: url, provenance: "official_source" }));
  assert.equal(r.mode, "embed");
  assert.equal(r.embedKind, "x-post");
  assert.equal(r.videoId, "2012168725630165435", "the status ID is derived from the canonical URL");
  assert.equal(r.embedUrl, null, "a widget platform must not carry an iframe URL");
  assert.equal(r.watchUrl, url);
});

test("video: an X row with no resolvable status ID never claims to embed", () => {
  const r = resolveVideo(rec({ platform: "x", original_ad_url: "https://x.com/someone", provenance: "official_source" }));
  assert.equal(r.mode, "link");
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
    { platform: "x", original_ad_url: "https://x.com/a/status/2012168725630165435", provenance: "official_source" },
    { platform: "instagram", original_ad_url: "https://www.instagram.com/reel/ABCdefGHIjk/", provenance: "official_source" },
  ];
  for (const s of shapes) {
    const r = resolveVideo(rec(s));
    if (r.mode !== "embed") continue;
    assert.ok(r.videoId, `embed mode needs a reference: ${JSON.stringify(s)}`);
    if (r.embedKind === "iframe") assert.ok(r.embedUrl, `iframe embed needs a URL: ${JSON.stringify(s)}`);
    else assert.equal(r.embedUrl, null, `widget embed must not carry an iframe URL: ${JSON.stringify(s)}`);
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
  assert.ok(errs.some((e) => e.includes("no post reference")), errs.join("; "));
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
      assert.ok(v.videoId, `${r.id} is framed with nothing to point the player at`);
      if (v.embedKind === "iframe") assert.ok(v.embedUrl, `${r.id} is framed with no embed URL`);
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
    assert.ok(r.video.watchUrl, `${r.id} is framed with no fallback link beneath the player`);
    if (r.video.embedKind === "iframe") {
      assert.match(r.video.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/,
        `${r.id} would frame a malformed embed URL`);
    } else if (r.video.embedKind === "x-post") {
      assert.match(r.video.videoId, /^\d{15,25}$/, `${r.id} would render a widget with a malformed status ID`);
      assert.equal(r.video.embedUrl, null, `${r.id} carries an iframe URL for a widget platform`);
    } else {
      assert.fail(`${r.id} has unknown embedKind ${r.video.embedKind}`);
    }
  }
  for (const r of payload.records) {
    assert.ok(["embed", "link", "none"].includes(r.video.mode), `${r.id}: unknown video mode`);
    if (r.video.mode === "link") assert.ok(r.video.watchUrl || r.video.archiveUrl, `${r.id}: link mode with nowhere to go`);
  }
});

test("built page: both player templates are guarded so neither can render empty", () => {
  // The players live in client-side templates, so the guards around them are
  // what prevent a src-less iframe or a reference-less widget.
  assert.ok(built.includes('v.mode === "embed" && v.embedKind === "iframe" && v.embedUrl'),
    "the iframe branch is no longer guarded on an embed URL being present");
  assert.ok(built.includes('v.mode === "embed" && v.embedKind === "x-post" && v.videoId'),
    "the X branch is no longer guarded on a status ID being present");

  const tpl = built.match(/<iframe src="\$\{esc\(v\.embedUrl\)\}"[^>]*>/);
  assert.ok(tpl, "the player template no longer interpolates an escaped embed URL");
  assert.match(tpl[0], /title="/, "the player template has no accessible name");
  assert.match(tpl[0], /loading="lazy"/, "the player template lost lazy loading");

  // Before X's script runs the blockquote must still be a link to the ad, so a
  // blocked script degrades to readable text rather than an empty box.
  assert.ok(/<blockquote class="twitter-tweet"[^>]*>\s*<a href="\$\{esc\(v\.watchUrl\)\}"/.test(built),
    "the X blockquote no longer carries a link to the original post");
  assert.ok(built.includes('data-dnt="true"'), "X embeds must opt out of tracking");
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

test("built page: an X record renders the usable card first and upgrades only on proof", () => {
  // X's widget service intermittently returns a 0-4px shell from identical
  // markup. So the page never renders the embed and repairs it afterwards -
  // it renders the working button and promotes the post only once a widget has
  // measurably rendered. That ordering is what makes an empty rectangle
  // unreachable even if the script is blocked, throttled, or simply slow.
  assert.ok(built.includes('NO_EMBED_REASON["pending-x"]'),
    "the X branch no longer renders a watch card as its default state");
  assert.ok(built.includes("function promoteXPosts()"), "the promotion pass is gone");
  // Hidden, not destroyed: X reloads widgets, and a post that renders and then
  // collapses must be able to bring its button back.
  assert.ok(built.includes("card.hidden = rendered;"), "the fallback card is not toggled by render state");
  assert.ok(!/\.embed-x-card"\)\?\.remove\(\)/.test(built),
    "the fallback card must never be destroyed, only hidden");
  assert.ok(built.includes('rendered === (host.dataset.promoted === "1")'),
    "promotion is no longer re-evaluated, so a collapse cannot restore the button");

  assert.ok(/X_MIN_HEIGHT\s*=\s*(\d+)/.test(built), "the collapse threshold is gone");
  const min = Number(built.match(/X_MIN_HEIGHT\s*=\s*(\d+)/)[1]);
  assert.ok(min >= 100, `threshold ${min}px is too low to tell a real post from a collapsed shell`);
  assert.ok(built.includes("frame.getBoundingClientRect().height >= X_MIN_HEIGHT"),
    "promotion is no longer gated on the widget's measured height");

  // Layout, not a clock, is the trigger. Interval timers are frozen outright in
  // a background tab, so a poll-only design can leave a rendered post stuck
  // behind the fallback card until the reader interacts with the page.
  assert.ok(built.includes("new ResizeObserver("), "promotion is no longer driven by layout");
  assert.ok(built.includes("ro.observe(stage)"), "nothing observes the staged post for a size change");

  // Staging must keep layout: a display:none stage can never measure itself, so
  // the post would stay at zero height and never be promoted at all.
  const stage = built.match(/\.embed-x-stage\s*\{([^}]*)\}/);
  assert.ok(stage, "the off-screen stage rule is gone");
  assert.ok(/position:\s*absolute/.test(stage[1]) && /left:\s*-\d{4,}px/.test(stage[1]),
    `stage must be positioned off-screen, got: ${stage[1].trim()}`);
  assert.ok(!/display:\s*none/.test(stage[1]), "a display:none stage can never measure itself");
});

test("built page: the watch card is the single shared control", () => {
  // One control, one appearance. If link mode and the X fallback diverge a
  // reader meets two different widgets that mean the same thing.
  assert.ok(built.includes("function watchCard(v, platform, reason)"), "watchCard() is gone");
  assert.ok(built.includes("return watchCard(v, platform, NO_EMBED_REASON"), "link mode no longer uses watchCard()");
  assert.equal((built.match(/class="btn btn-watch"/g) ?? []).length, 1,
    "the watch button markup should exist in exactly one place");
});

test("built page: the X widget script is requested only when a record needs it", () => {
  assert.ok(!/<script[^>]+src=["']https:\/\/platform\.twitter\.com/.test(built),
    "widgets.js must not be a static script tag");
  assert.ok(built.includes('if (!out.querySelector(".embed-x")) return;'),
    "the loader no longer short-circuits when no X post is on screen");
  assert.ok(built.includes("https://platform.twitter.com/widgets.js"), "the loader lost the widget script URL");
  assert.ok(built.includes('data-dnt="true"'), "X embeds must opt out of tracking");
});

// ---------------------------------------------- X promotion logic, executed

// The browser in CI may be headless or backgrounded, where interval timers,
// rAF and ResizeObserver are all suspended - so the promotion branch cannot be
// exercised by driving a real page. It is extracted from the built file and run
// here against a DOM stub instead, because the decision it makes (show the
// player, or keep the button) is the one thing that must never be wrong.
function loadPromote() {
  const src = built.match(/function promoteXPosts\(\)\s*\{[\s\S]*?\n  \}/)[0];
  const X_MIN_HEIGHT = Number(built.match(/X_MIN_HEIGHT\s*=\s*(\d+)/)[1]);
  return (hosts) => {
    const out = { querySelectorAll: () => hosts };
    // eslint-disable-next-line no-new-func
    return new Function("out", "X_MIN_HEIGHT", `${src}; return promoteXPosts();`)(out, X_MIN_HEIGHT);
  };
}

function makeHost({ frameHeight = null } = {}) {
  const classes = new Set(["embed-x-stage"]);
  const stage = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector: () => (frameHeight === null ? null : { getBoundingClientRect: () => ({ height: frameHeight }) }),
  };
  const card = { hidden: false };
  return {
    dataset: {},
    stage, card, classes,
    querySelector(sel) {
      if (sel.includes("embed-x-card")) return card;
      if (sel.includes("embed-x-stage")) return stage;
      return null;
    },
    setFrame(h) { frameHeight = h; },
  };
}

test("promote: a collapsed or missing widget keeps the button and stays staged", () => {
  for (const frameHeight of [null, 0, 4, 119]) {
    const host = makeHost({ frameHeight });
    const pending = loadPromote()([host]);
    assert.equal(pending, 1, `height ${frameHeight} should count as still pending`);
    assert.equal(host.card.hidden, false, `height ${frameHeight} must not hide the watch button`);
    assert.ok(host.classes.has("embed-x-stage"), `height ${frameHeight} must stay off-screen`);
    assert.equal(host.stage.attrs["aria-hidden"] ?? "true", "true", "a staged post stays out of the a11y tree");
  }
});

test("promote: a rendered widget hides the button and goes live", () => {
  const host = makeHost({ frameHeight: 600 });
  const pending = loadPromote()([host]);
  assert.equal(pending, 0);
  assert.equal(host.card.hidden, true, "the button should be hidden once the post renders");
  assert.ok(host.classes.has("embed-x-live"), "the post should be promoted into the layout");
  assert.ok(!host.classes.has("embed-x-stage"), "the promoted post must leave the off-screen stage");
  assert.equal(host.stage.attrs["aria-hidden"], undefined, "a live post must be readable by assistive tech");
});

test("promote: a post that renders and then collapses brings its button back", () => {
  // X reloads its widgets, and a reloaded widget can come back collapsed. If
  // promotion were one-way that would leave a hole where the ad had been.
  const promote = loadPromote();
  const host = makeHost({ frameHeight: 600 });
  promote([host]);
  assert.equal(host.card.hidden, true);

  host.setFrame(0);
  const pending = promote([host]);
  assert.equal(pending, 1);
  assert.equal(host.card.hidden, false, "the watch button must return when the embed collapses");
  assert.ok(host.classes.has("embed-x-stage"), "the collapsed post must go back off-screen");
  assert.equal(host.stage.attrs["aria-hidden"], "true");
});

test("promote: repeated runs on a settled host are stable", () => {
  const promote = loadPromote();
  const host = makeHost({ frameHeight: 600 });
  for (let i = 0; i < 5; i++) promote([host]);
  assert.equal(host.card.hidden, true);
  assert.ok(host.classes.has("embed-x-live"));
  assert.equal(host.dataset.promoted, "1");
});

test("promote: counts every unrendered host so the watcher knows to keep waiting", () => {
  const hosts = [makeHost({ frameHeight: 600 }), makeHost({ frameHeight: 0 }), makeHost({ frameHeight: null })];
  assert.equal(loadPromote()(hosts), 2);
});
