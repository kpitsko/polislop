// Resolves what a record's video area should show.
//
// The governing rule is the ledger's sourcing standard applied to footage: a
// player is framed only when the *provenance* of a URL establishes that it is
// the advertisement itself rather than a news segment about it. Parsing an ID
// out of a URL is not provenance - it proves a link is well-formed, nothing
// more. So every video block records HOW the original was established, and a
// block whose provenance is too weak degrades to a labelled link instead of
// silently framing whatever the ID happens to point at.
//
// Provenance, not personal viewing, is the bar. A video sitting on the
// sponsor's own verified channel, or an ad archived by a credible newsroom, is
// established as the original by the same kind of evidence the rest of the
// ledger runs on. Requiring a human to sit through every clip would leave ads
// unwatchable on the page for no gain in accuracy.

import { metaEndpointFor, metaProviderFor } from "./oembed.js";

// Which platforms we can frame in-page, and how their URLs are built. Anything
// not embeddable still gets a "watch original" link - the ad stays reachable,
// it just is not played inside polislop.
//
// `embedKind` says HOW a platform is embedded, because the two that work do it
// differently: YouTube takes an <iframe> we build ourselves, while X is a
// <blockquote> that its own widget script upgrades into a player. Both are
// tested against the real postings in the corpus, not assumed:
//
//   youtube    iframe       youtube-nocookie.com/embed/<id>
//   x          widget       platform.twitter.com/widgets.js
//   instagram  meta-embed   graph.facebook.com instagram_oembed + embeds.js
//   facebook   meta-embed   graph.facebook.com oembed_post/oembed_video + SDK
//
// Meta content IS embeddable; what does not work is framing a Meta URL in an
// <iframe> yourself. Meta's supported route is oEmbed - see src/oembed.js - and
// a `meta-embed` row carries the markup that call returned, which Meta's own
// script then upgrades into the post.
//
// Only the Ad Library stays unembeddable, because an Ad Library permalink is a
// viewer for an ad rather than a public post, and no oEmbed endpoint serves one.
export const PLATFORMS = {
  youtube: {
    label: "YouTube",
    embeddable: true,
    embedKind: "iframe",
    idFromUrl: (url) => youTubeIdFromUrl(url),
    idPattern: /^[A-Za-z0-9_-]{11}$/,
    idLabel: "11-character YouTube ID",
    embedUrl: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
    watchUrl: (id) => `https://www.youtube.com/watch?v=${id}`,
  },
  x: {
    label: "X",
    embeddable: true,
    // The widget script renders the post itself - author, verification badge and
    // video - so the embed carries its own provenance on its face.
    embedKind: "x-post",
    idFromUrl: (url) => xStatusIdFromUrl(url),
    idPattern: /^\d{15,25}$/,
    idLabel: "numeric X status ID",
    watchUrl: (id) => `https://x.com/i/status/${id}`,
  },
  // Both Meta platforms embed through oEmbed rather than through a URL we
  // build, so their reference is the canonical permalink itself.
  instagram: {
    label: "Instagram",
    embeddable: true,
    embedKind: "meta-embed",
    idFromUrl: (url) => (metaEndpointFor(url) === "instagram_oembed" ? url : null),
    idLabel: "public Instagram post or reel URL",
  },
  facebook: {
    label: "Facebook",
    embeddable: true,
    embedKind: "meta-embed",
    idFromUrl: (url) => (metaProviderFor(url) === "facebook" ? url : null),
    idLabel: "public Facebook post, video or reel URL",
  },
  "meta-ad-library": { label: "Meta Ad Library", embeddable: false },
  tiktok: { label: "TikTok", embeddable: false },
  "campaign-site": { label: "Campaign website", embeddable: false },
  "party-committee": { label: "Party committee site", embeddable: false },
  "google-ads-transparency": { label: "Google Ads Transparency Center", embeddable: false },
  archive: { label: "Archived copy", embeddable: false },
  other: { label: "Other", embeddable: false },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

/**
 * How a URL was established as the original ad.
 *
 * `embeds` is the whole point of the classification: it says whether this grade
 * of evidence is strong enough to frame a player. The three strong grades all
 * answer the same question - "is the thing on the other end of this link the
 * advertisement?" - from independent directions: the sponsor published it, a
 * credible third party captured it, or a person watched it.
 */
export const PROVENANCE = {
  official_source: {
    label: "Official account",
    embeds: true,
    note: "Published on the sponsor's own campaign, committee or candidate account.",
  },
  archive_verified: {
    label: "Archive",
    embeds: true,
    note: "Captured in a political-ad archive or public ad library.",
  },
  human_verified: {
    label: "Human-reviewed",
    embeds: true,
    note: "A person watched the footage against the cited reporting and confirmed it is the ad.",
  },
  reporting_corroborated: {
    label: "Reporting",
    embeds: true,
    note: "Credible reporting identifies this exact URL or posting as the ad.",
  },
  unverified: {
    label: "Unverified",
    embeds: false,
    note: "A plausible link that nothing has yet established as the ad itself.",
  },
};

export const PROVENANCE_KEYS = Object.keys(PROVENANCE);

// A record's video block, normalised. `video` is the current shape; `embed` is
// the original YouTube-only field, kept working so old records keep rendering.
function readVideo(record) {
  const v = record?.video ?? null;
  if (v) {
    // `verified: true` predates the provenance field and meant exactly one
    // thing: a person had watched it. Map it across so old blocks keep their
    // meaning instead of silently losing their grade.
    const provenance = v.provenance ?? (v.verified === true ? "human_verified" : "unverified");
    return { ...v, provenance };
  }
  if (record?.embed?.id) {
    // Legacy rows only ever carried a confirmed YouTube ID, so they map across
    // as human-verified - that was the bar for writing the field at all.
    return {
      platform: "youtube",
      video_id: record.embed.id,
      embed_available: true,
      provenance: "human_verified",
      original_ad_url: PLATFORMS.youtube.watchUrl(record.embed.id),
    };
  }
  return null;
}

const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u);

/** Whether a grade of provenance is strong enough to frame a player. */
export function provenanceEmbeds(provenance) {
  return PROVENANCE[provenance]?.embeds === true;
}

/**
 * What the embed actually points at: an explicit `video_id` when the record
 * carries one, otherwise the ID parsed out of the canonical URL. Letting an X
 * row derive its status ID from `original_ad_url` keeps one canonical fact in
 * the data instead of the same number written twice and free to drift.
 */
function embedRef(v) {
  if (v?.video_id) return v.video_id;
  const spec = v?.platform ? PLATFORMS[v.platform] : null;
  return spec?.idFromUrl && v.original_ad_url ? spec.idFromUrl(v.original_ad_url) : null;
}

/**
 * Structural check on a record's video block. Returns a list of problems -
 * empty means usable. The build runs this so a malformed block fails the build
 * rather than rendering a broken player to readers.
 */
export function validateVideo(record) {
  const v = readVideo(record);
  const id = record?.id ?? "(unknown record)";
  if (!v) return [];
  const errs = [];
  const where = (msg) => `${id}: ${msg}`;

  if (!v.platform) errs.push(where("video block has no platform"));
  else if (!PLATFORMS[v.platform]) {
    errs.push(where(`unknown platform "${v.platform}" (expected one of: ${PLATFORM_KEYS.join(", ")})`));
  }

  if (!PROVENANCE[v.provenance]) {
    errs.push(where(`unknown provenance "${v.provenance}" (expected one of: ${PROVENANCE_KEYS.join(", ")})`));
  }

  for (const key of ["original_ad_url", "archive_url"]) {
    if (v[key] != null && !isHttps(v[key])) errs.push(where(`${key} must be an https URL`));
  }

  // An ID of the wrong shape produces a player that loads and then reports the
  // post as unavailable - visually identical to a broken embed.
  const spec = v.platform ? PLATFORMS[v.platform] : null;
  const ref = embedRef(v);
  if (spec?.idPattern && ref != null && !spec.idPattern.test(ref)) {
    errs.push(where(`"${ref}" is not a ${spec.idLabel}`));
  }
  // An embeddable platform whose URL does not yield an ID would silently fall
  // back to a link, which is a data error rather than an editorial decision.
  if (spec?.embeddable && v.embed_available !== false && provenanceEmbeds(v.provenance) && !ref) {
    errs.push(where(`platform "${v.platform}" is embeddable but no ${spec.idLabel} could be resolved`));
  }

  // A claim of embeddability that cannot actually be honoured is the failure
  // mode that produces an empty player, so it is an error, not a warning.
  if (v.embed_available === true) {
    if (!ref) errs.push(where("embed_available is true but no post reference is present"));
    if (spec && !spec.embeddable) {
      errs.push(where(`embed_available is true but platform "${v.platform}" cannot be embedded`));
    }
    if (!provenanceEmbeds(v.provenance)) {
      errs.push(where(`embed_available is true but provenance "${v.provenance}" is not strong enough to frame`));
    }
  }

  // Provenance is a statement about a specific artifact; it needs something
  // concrete to point at.
  if (provenanceEmbeds(v.provenance) && !v.original_ad_url && !v.video_id) {
    errs.push(where(`provenance is "${v.provenance}" but neither original_ad_url nor video_id is recorded`));
  }

  return errs;
}

/**
 * Decide what the record's video area renders.
 *
 *   mode "embed" - established original, framed in-page
 *   mode "link"  - original located but not embeddable (or provenance too weak)
 *   mode "none"  - original not located; say so plainly
 */
export function resolveVideo(record, opts = {}) {
  // `oembed` is the cached Meta lookup, keyed by URL. Absent it, a Meta row has
  // no markup to stage and degrades to a link - which is also what happens when
  // Meta rejected the URL.
  const oembedFor = opts.oembed ?? {};
  const v = readVideo(record);
  if (!v) return { mode: "none", platform: null, platformLabel: null, reason: "not-located" };

  const platform = v.platform && PLATFORMS[v.platform] ? v.platform : null;
  const spec = platform ? PLATFORMS[platform] : null;
  const platformLabel = spec ? spec.label : null;
  const archiveUrl = v.archive_url ?? null;
  const prov = PROVENANCE[v.provenance] ?? PROVENANCE.unverified;
  const ref = embedRef(v);

  // Prefer the recorded canonical URL; fall back to one derived from the ID so
  // a row need not repeat itself.
  const watchUrl = v.original_ad_url ?? (spec?.watchUrl && ref ? spec.watchUrl(ref) : null);

  const base = {
    platform,
    platformLabel,
    videoId: ref,
    watchUrl,
    archiveUrl,
    provenance: v.provenance,
    provenanceLabel: prov.label,
    provenanceNote: prov.note,
    verified: provenanceEmbeds(v.provenance),
    note: v.verificationNote ?? null,
  };

  // A Meta row is only embeddable if Meta actually handed us markup for it.
  const meta = spec?.embedKind === "meta-embed" ? oembedFor[v.original_ad_url] ?? null : null;
  const metaReady = spec?.embedKind !== "meta-embed" || (meta?.ok === true && !!meta.html);

  const embeddable =
    spec?.embeddable === true &&
    !!ref &&
    metaReady &&
    provenanceEmbeds(v.provenance) &&
    v.embed_available !== false;

  if (embeddable) {
    // `embedUrl` is only meaningful for platforms we frame ourselves. A widget
    // platform carries its reference instead, and the page decides how to
    // render it - so nothing can accidentally put an X status ID in an iframe.
    return {
      ...base,
      mode: "embed",
      embedKind: spec.embedKind,
      embedUrl: spec.embedUrl ? spec.embedUrl(ref) : null,
      embedHtml: meta?.html ?? null,
      metaProvider: meta ? metaProviderFor(v.original_ad_url) : null,
    };
  }

  if (watchUrl || archiveUrl) {
    return {
      ...base,
      mode: "link",
      // Distinguishing these lets the page explain *why* there is no player,
      // rather than leaving a reader to assume the ad is missing.
      reason: !provenanceEmbeds(v.provenance)
        ? "unverified"
        : spec && !spec.embeddable
          ? "not-embeddable"
          // A located original that Meta will not serve is its own case: the ad
          // exists and is reachable, Meta simply will not hand over an embed.
          : spec?.embedKind === "meta-embed" && !metaReady
            ? "meta-refused"
            : "embed-blocked",
    };
  }

  return { ...base, mode: "none", reason: "not-located" };
}

/**
 * Parse a YouTube video ID out of a watch/share/embed URL.
 *
 * Strictly a parser. It says nothing about whether the video is the original
 * ad - that judgement rests on the record's provenance grade, and
 * `resolveVideo` will not frame a player until one has been recorded.
 */
export function youTubeIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
    url.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  return m ? m[1] : null;
}

/**
 * Parse an X status ID out of a post URL, on either the x.com or the legacy
 * twitter.com host. Same contract as the YouTube parser: strictly a parser,
 * silent on whether the post is the ad.
 */
export function xStatusIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const m = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{15,25})(?![\d])/i);
  return m ? m[1] : null;
}
