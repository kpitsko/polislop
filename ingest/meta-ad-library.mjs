#!/usr/bin/env node
// Pulls US political/issue ads from the Meta Ad Library and flags ones whose
// text suggests AI involvement. Output is a REVIEW QUEUE, never a published
// record: nothing reaches data/ads.json without a human confirming the ad,
// sourcing it twice, and setting the rubric by hand.
//
//   META_AD_LIBRARY_TOKEN=... node ingest/meta-ad-library.mjs --days 30 > queue.json
//
// Requires a Meta access token from an app whose user has completed Meta's
// identity confirmation. See README for why this cannot cover "all" US ads.

const API = "https://graph.facebook.com/v21.0/ads_archive";

const FIELDS = [
  "id", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
  "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions",
  "bylines", "currency", "delivery_by_region", "impressions", "languages",
  "page_id", "page_name", "publisher_platforms", "spend", "ad_snapshot_url",
].join(",");

// Deliberately broad. Recall matters more than precision here because a human
// reads every hit; a missed ad is invisible, a false positive costs one glance.
const AI_HINTS = [
  /\bA\.?I\.?[- ]?(generated|created|assisted|altered|enhanced)\b/i,
  /\b(deepfake|deep fake|synthetic (media|video|voice|audio))\b/i,
  /\b(generated|altered) (using|with) artificial intelligence\b/i,
  /\bvoice (clone|cloned|cloning)\b/i,
  /\bdoes not represent real events\b/i,
  /\bdigitally (generated|altered)\b/i,
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

function hits(ad) {
  const text = [
    ...(ad.ad_creative_bodies ?? []),
    ...(ad.ad_creative_link_titles ?? []),
    ...(ad.ad_creative_link_descriptions ?? []),
  ].join("\n");
  return AI_HINTS.filter((re) => re.test(text)).map((re) => String(re));
}

async function* pages(token, since) {
  let url = `${API}?${new URLSearchParams({
    access_token: token,
    ad_type: "POLITICAL_AND_ISSUE_ADS",
    ad_reached_countries: JSON.stringify(["US"]),
    ad_delivery_date_min: since,
    search_terms: "",
    fields: FIELDS,
    limit: "250",
  })}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Meta Ad Library ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const body = await res.json();
    yield body.data ?? [];
    url = body.paging?.next ?? null;
  }
}

async function main() {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) {
    console.error("Set META_AD_LIBRARY_TOKEN. See README for how to get one.");
    process.exit(2);
  }
  const days = Number(arg("days", "30"));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  const queue = [];
  let scanned = 0;
  for await (const batch of pages(token, since)) {
    scanned += batch.length;
    for (const ad of batch) {
      const matched = hits(ad);
      if (!matched.length) continue;
      queue.push({
        source: "meta-ad-library",
        metaAdId: ad.id,
        sponsorPage: ad.page_name,
        bylines: ad.bylines ?? null,
        firstSeen: ad.ad_delivery_start_time,
        platforms: ad.publisher_platforms ?? [],
        spend: ad.spend ?? null,
        impressions: ad.impressions ?? null,
        snapshot: ad.ad_snapshot_url,
        matchedPatterns: matched,
        bodies: ad.ad_creative_bodies ?? [],
        // Everything below is for a human to fill in before publication.
        reviewStatus: "unreviewed",
        rubric: null,
        sources: [],
      });
    }
    process.stderr.write(`\rscanned ${scanned} ads, queued ${queue.length}`);
  }
  process.stderr.write("\n");
  process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), since, scanned, queue }, null, 2));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
