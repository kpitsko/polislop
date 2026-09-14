// Resolves what a record's video area should show.
//
// The governing rule, inherited from the ledger's sourcing standard: a player is
// framed only when a human has confirmed the footage *is* the ad in question.
// Parsing an ID out of a URL is not confirmation - it proves a link is
// well-formed, not that the video on the other end is the advertisement rather
// than a news segment about it. So `verified` is a deliberate human act, never
// inferred here, and an unverified record degrades to a labeled link instead of
// silently framing whatever the ID happens to point at.

// Which platforms we can frame in-page, and how their URLs are built. Anything
// not embeddable still gets a "watch original" link - the ad stays reachable,
// it just is not played inside polislop.
export const PLATFORMS = {
  youtube: {
    label: "YouTube",
    embeddable: true,
    embedUrl: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
    watchUrl: (id) => `https://www.youtube.com/watch?v=${id}`,
  },
  "meta-ad-library": { label: "Meta Ad Library", embeddable: false },
  facebook: { label: "Facebook", embeddable: false },
  instagram: { label: "Instagram", embeddable: false },
  x: { label: "X", embeddable: false },
  tiktok: { label: "TikTok", embeddable: false },
  "campaign-site": { label: "Campaign website", embeddable: false },
  "party-committee": { label: "Party committee site", embeddable: false },
  "google-ads-transparency": { label: "Google Ads Transparency Center", embeddable: false },
  archive: { label: "Archived copy", embeddable: false },
  other: { label: "Other", embeddable: false },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

// A record's video block, normalised. `video` is the current shape; `embed` is
// the original YouTube-only field, kept working so old records keep rendering.
function readVideo(record) {
  if (record?.video) return record.video;
  if (record?.embed?.id) {
    // Legacy rows only ever carried a confirmed YouTube ID, so they map across
    // as verified - that was the bar for writing the field at all.
    return {
      platform: "youtube",
      video_id: record.embed.id,
      embed_available: true,
      verified: true,
      original_ad_url: PLATFORMS.youtube.watchUrl(record.embed.id),
    };
  }
  return null;
}

const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u);

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

  for (const key of ["original_ad_url", "archive_url"]) {
    if (v[key] != null && !isHttps(v[key])) errs.push(where(`${key} must be an https URL`));
  }

  // A claim of embeddability that cannot actually be honoured is the failure
  // mode that produces an empty <iframe>, so it is an error, not a warning.
  if (v.embed_available === true) {
    if (!v.video_id) errs.push(where("embed_available is true but no video_id is present"));
    if (v.platform && PLATFORMS[v.platform] && !PLATFORMS[v.platform].embeddable) {
      errs.push(where(`embed_available is true but platform "${v.platform}" cannot be embedded`));
    }
    if (v.verified !== true) errs.push(where("embed_available is true but the footage is not marked verified"));
  }

  // Verification is a statement about a specific piece of footage; it needs
  // something concrete to point at.
  if (v.verified === true && !v.original_ad_url && !v.video_id) {
    errs.push(where("verified is true but neither original_ad_url nor video_id is recorded"));
  }

  return errs;
}

/**
 * Decide what the record's video area renders.
 *
 *   mode "embed" - confirmed original, framed in-page
 *   mode "link"  - original located but not embeddable (or not yet confirmed)
 *   mode "none"  - original not located; say so plainly
 */
export function resolveVideo(record) {
  const v = readVideo(record);
  if (!v) return { mode: "none", platform: null, platformLabel: null, reason: "not-located" };

  const platform = v.platform && PLATFORMS[v.platform] ? v.platform : null;
  const spec = platform ? PLATFORMS[platform] : null;
  const platformLabel = spec ? spec.label : null;
  const archiveUrl = v.archive_url ?? null;

  // Prefer the recorded canonical URL; fall back to one derived from the ID so
  // a YouTube row need not repeat itself.
  const watchUrl =
    v.original_ad_url ?? (spec?.watchUrl && v.video_id ? spec.watchUrl(v.video_id) : null);

  const base = {
    platform,
    platformLabel,
    videoId: v.video_id ?? null,
    watchUrl,
    archiveUrl,
    verified: v.verified === true,
    note: v.verificationNote ?? null,
  };

  const embeddable =
    spec?.embeddable === true &&
    !!v.video_id &&
    v.verified === true &&
    v.embed_available !== false;

  if (embeddable) {
    return { ...base, mode: "embed", embedUrl: spec.embedUrl(v.video_id) };
  }

  if (watchUrl || archiveUrl) {
    return {
      ...base,
      mode: "link",
      // Distinguishing these lets the page explain *why* there is no player,
      // rather than leaving a reader to assume the ad is missing.
      reason: !v.verified ? "unverified" : spec && !spec.embeddable ? "not-embeddable" : "embed-blocked",
    };
  }

  return { ...base, mode: "none", reason: "not-located" };
}

/**
 * Parse a YouTube video ID out of a watch/share/embed URL.
 *
 * Strictly a parser. It says nothing about whether the video is the original
 * ad - that judgement belongs to a human, and `resolveVideo` will not frame a
 * player until one has recorded it.
 */
export function youTubeIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/) ||
    url.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  return m ? m[1] : null;
}
