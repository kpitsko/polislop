#!/usr/bin/env node
// Refreshes data/oembed-cache.json: the Meta embed markup for every Instagram
// and Facebook original in the corpus.
//
//   node ingest/meta-oembed.mjs            refresh anything stale or missing
//   node ingest/meta-oembed.mjs --force    refetch everything
//   META_OEMBED_TOKEN=... node ...         use an app token (higher rate limit)
//
// The cache is committed so the build is deterministic and works offline, and
// so a human can diff exactly what third-party markup the site ships. A failed
// lookup is cached too - "Meta says no" is a real answer, and re-asking on every
// build would be slower and no more true.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchMetaOEmbed, metaEndpointFor } from "../src/oembed.js";

const here = (p) => new URL(p, import.meta.url);
const CACHE = here("../data/oembed-cache.json");
const MAX_AGE_DAYS = 30;

const force = process.argv.includes("--force");
const corpus = JSON.parse(readFileSync(here("../data/ads.json"), "utf8"));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { entries: {} };
cache.entries ??= {};

// Every Meta URL a record points at, including archive copies.
const urls = [...new Set(
  corpus.records.flatMap((r) => [r.video?.original_ad_url, r.video?.archive_url])
    .filter((u) => u && metaEndpointFor(u)),
)];

const stale = (e) => {
  if (!e?.fetchedAt) return true;
  return (Date.now() - Date.parse(e.fetchedAt)) > MAX_AGE_DAYS * 864e5;
};

let fetched = 0, ok = 0;
for (const url of urls) {
  if (!force && cache.entries[url] && !stale(cache.entries[url])) continue;
  const res = await fetchMetaOEmbed(url, { token: process.env.META_OEMBED_TOKEN || null });
  fetched++;
  if (res.ok) ok++;
  cache.entries[url] = res.ok
    ? { ok: true, provider: res.provider, endpoint: res.endpoint, html: res.html,
        width: res.width, providerName: res.providerName, validates: res.validates,
        fetchedAt: new Date().toISOString() }
    : { ok: false, provider: res.provider ?? null, endpoint: res.endpoint ?? null,
        reason: res.reason, detail: res.detail ?? null, fetchedAt: new Date().toISOString() };
  console.error(`${res.ok ? "ok  " : "miss"}  ${res.endpoint ?? "-"}  ${url}${res.ok ? "" : `  (${res.reason}${res.detail ? `: ${res.detail}` : ""})`}`);
  await new Promise((r) => setTimeout(r, 400));
}

// Drop entries for URLs no longer in the corpus, so the cache cannot rot.
for (const key of Object.keys(cache.entries)) if (!urls.includes(key)) delete cache.entries[key];

cache.$comment = "Meta oEmbed responses for the corpus's Instagram/Facebook originals. Refresh with: node ingest/meta-oembed.mjs. Committed so the build is deterministic and the third-party markup is reviewable in a diff.";
cache.updated = new Date().toISOString().slice(0, 10);
writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");
console.error(`\n${urls.length} Meta URLs, ${fetched} fetched, ${ok} embeddable, ${urls.length - Object.values(cache.entries).filter((e) => e.ok).length} not.`);
