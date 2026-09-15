import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  metaEndpointFor, metaProviderFor, sanitizeEmbedHtml, fetchMetaOEmbed, META_PROVIDERS,
} from "../src/oembed.js";

const cachePath = new URL("../data/oembed-cache.json", import.meta.url);
const corpus = JSON.parse(readFileSync(new URL("../data/ads.json", import.meta.url), "utf8"));

// ------------------------------------------------------- endpoint selection

test("endpoint: Instagram posts and reels route to instagram_oembed", () => {
  for (const u of [
    "https://www.instagram.com/reel/DTuzkrajjXW/",
    "https://instagram.com/p/ABCdefGHIjk/",
    "https://www.instagram.com/tv/ABCdefGHIjk/",
    "https://www.instagram.com/reel/DTuzkrajjXW/?utm_source=ig_embed",
  ]) {
    assert.equal(metaEndpointFor(u), "instagram_oembed", u);
    assert.equal(metaProviderFor(u), "instagram", u);
  }
});

test("endpoint: Facebook video-ish permalinks route to oembed_video, the rest to oembed_post", () => {
  // Sending a reel to oembed_post is an outright error, so the split matters.
  for (const u of [
    "https://www.facebook.com/reel/845246751375832",
    "https://www.facebook.com/watch/?v=123456789",
    "https://www.facebook.com/SomePage/videos/123456789/",
  ]) assert.equal(metaEndpointFor(u), "oembed_video", u);

  for (const u of [
    "https://www.facebook.com/MarcLombardoForStateRepresentative/posts/pfbid0321cmNU",
    "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
    "https://www.facebook.com/photo/?fbid=123",
  ]) assert.equal(metaEndpointFor(u), "oembed_post", u);

  assert.equal(metaProviderFor("https://www.facebook.com/reel/845246751375832"), "facebook");
});

test("endpoint: an Ad Library permalink is never treated as an embeddable post", () => {
  // It is a viewer for an ad, not a public post - no oEmbed endpoint serves one,
  // and asking would return markup for something that cannot render.
  for (const u of [
    "https://www.facebook.com/ads/library/?id=3058070851060058",
    "https://www.facebook.com/ads/library/?active_status=all&id=877434418711912",
  ]) {
    assert.equal(metaEndpointFor(u), null, u);
    assert.equal(metaProviderFor(u), null, u);
  }
});

test("endpoint: non-Meta and malformed URLs are declined", () => {
  for (const u of [
    "https://x.com/KenPaxtonTX/status/2012168725630165435",
    "https://www.youtube.com/watch?v=1-WZIStqImo",
    "https://www.instagram.com/someaccount/",     // a profile, not a post
    "not a url", null, undefined, 42,
  ]) assert.equal(metaEndpointFor(u), null, String(u));
});

// -------------------------------------------------------- markup safety net

test("sanitize: Meta's real placeholder markup is accepted", () => {
  const ig = '<blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="https://www.instagram.com/reel/X/" data-instgrm-version="14" style="background:#FFF"><div style="padding:16px;"><a href="https://www.instagram.com/reel/X/" target="_blank">View</a></div></blockquote>';
  assert.equal(sanitizeEmbedHtml(ig, "instagram"), ig.trim());
  const fb = '<div class="fb-video" data-href="https://www.facebook.com/reel/845246751375832" data-width="658"></div>';
  assert.equal(sanitizeEmbedHtml(fb, "facebook"), fb.trim());
  const fbPost = '<div class="fb-post" data-href="https://www.facebook.com/p/posts/1" data-width="658"></div>';
  assert.equal(sanitizeEmbedHtml(fbPost, "facebook"), fbPost.trim());
});

test("sanitize: anything executable is refused", () => {
  // This markup is third-party HTML injected straight into the page, so the
  // check is the boundary. A placeholder has no reason to carry any of these.
  const bad = [
    '<blockquote class="instagram-media"><script>alert(1)</script></blockquote>',
    '<blockquote class="instagram-media" onload="alert(1)"></blockquote>',
    '<blockquote class="instagram-media"><a href="javascript:alert(1)">x</a></blockquote>',
    '<blockquote class="instagram-media"><iframe src="https://evil.example"></iframe></blockquote>',
    '<blockquote class="instagram-media"><object data="x"></object></blockquote>',
    '<blockquote class="instagram-media"><img src="data:text/html,<script>1</script>"></blockquote>',
  ];
  for (const html of bad) assert.equal(sanitizeEmbedHtml(html, "instagram"), null, html.slice(0, 60));
});

test("sanitize: markup for the wrong provider or wrong shape is refused", () => {
  const ig = '<blockquote class="instagram-media" data-instgrm-permalink="x"></blockquote>';
  assert.equal(sanitizeEmbedHtml(ig, "facebook"), null, "an Instagram blockquote is not a Facebook embed");
  assert.equal(sanitizeEmbedHtml('<div class="something-else"></div>', "facebook"), null);
  assert.equal(sanitizeEmbedHtml("<p>hello</p>", "instagram"), null);
  for (const v of ["", "   ", null, undefined, 12]) assert.equal(sanitizeEmbedHtml(v, "instagram"), null);
  assert.equal(sanitizeEmbedHtml(ig, "tiktok"), null, "unknown providers are refused");
});

// ------------------------------------------------------------ fetch contract

test("fetch: a Meta rejection is reported, never thrown", () => {
  // Deleted, private and invented posts all land here, and they all mean the
  // same thing to the page: keep the watch button.
  const fetchImpl = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { message: "The requested resource does not exist", code: 24 } }),
  });
  return fetchMetaOEmbed("https://www.instagram.com/p/GONE/", { fetchImpl }).then((r) => {
    assert.equal(r.ok, false);
    assert.equal(r.reason, "rejected");
    assert.equal(r.code, 24);
  });
});

test("fetch: a network failure is reported, never thrown", async () => {
  const fetchImpl = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  const r = await fetchMetaOEmbed("https://www.instagram.com/p/X/", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "network");
});

test("fetch: unexpected markup is refused rather than passed through", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ html: "<script>alert(1)</script>" }) });
  const r = await fetchMetaOEmbed("https://www.instagram.com/p/X/", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unexpected-markup");
});

test("fetch: a URL we do not consider a public post is never sent to Meta", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error("should not be called"); };
  const r = await fetchMetaOEmbed("https://www.facebook.com/ads/library/?id=1", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-a-public-meta-post");
  assert.equal(called, false);
});

test("fetch: only instagram_oembed is treated as proof the post exists", async () => {
  // oembed_post/oembed_video return 200 for URLs they never checked, so a
  // success there must not masquerade as verification.
  const html = (cls, href) => `<div class="${cls}" data-href="${href}"></div>`;
  const mk = (body) => async () => ({ ok: true, status: 200, json: async () => body });

  const fb = await fetchMetaOEmbed("https://www.facebook.com/reel/845246751375832", {
    fetchImpl: mk({ html: html("fb-video", "https://www.facebook.com/reel/845246751375832"), width: 658 }),
  });
  assert.equal(fb.ok, true);
  assert.equal(fb.validates, false, "a Facebook 200 is not evidence the post exists");

  const ig = await fetchMetaOEmbed("https://www.instagram.com/reel/X/", {
    fetchImpl: mk({ html: '<blockquote class="instagram-media" data-instgrm-permalink="x"></blockquote>', width: 658 }),
  });
  assert.equal(ig.ok, true);
  assert.equal(ig.validates, true);
});

// -------------------------------------------------------------------- cache

test("cache: covers every Meta URL in the corpus and only those", () => {
  assert.ok(existsSync(cachePath), "data/oembed-cache.json is missing; run node ingest/meta-oembed.mjs");
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const wanted = [...new Set(
    corpus.records.flatMap((r) => [r.video?.original_ad_url, r.video?.archive_url])
      .filter((u) => u && metaEndpointFor(u)),
  )];
  for (const u of wanted) assert.ok(cache.entries[u], `cache is missing ${u}`);
  for (const u of Object.keys(cache.entries)) {
    assert.ok(wanted.includes(u), `cache holds a URL no record points at: ${u}`);
  }
});

test("cache: every stored success is markup we would knowingly ship", () => {
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  for (const [url, e] of Object.entries(cache.entries)) {
    if (!e.ok) { assert.ok(e.reason, `${url}: a failed entry must say why`); continue; }
    assert.ok(META_PROVIDERS[e.provider], `${url}: unknown provider ${e.provider}`);
    assert.equal(metaProviderFor(url), e.provider, `${url}: cached provider disagrees with the URL`);
    assert.equal(metaEndpointFor(url), e.endpoint, `${url}: cached endpoint disagrees with the URL`);
    assert.ok(sanitizeEmbedHtml(e.html, e.provider), `${url}: cached markup fails the safety check`);
    // The placeholder must point back at the ad it claims to be.
    const key = e.provider === "instagram" ? "data-instgrm-permalink" : "data-href";
    assert.ok(e.html.includes(key), `${url}: cached markup carries no ${key}`);
  }
});
