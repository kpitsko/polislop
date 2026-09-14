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

// Which platforms we can frame in-page, and how their URLs are built. Anything
// not embeddable still gets a "watch original" link - the ad stays reachable,
// it just is not played inside polislop.
//
// Only YouTube is marked embeddable, and deliberately so. X, Instagram and
// Facebook all publish embed widgets, but each of them renders a login wall or
// an empty box for a logged-out visitor often enough that framing them would
// reintroduce the one failure this module exists to prevent. Those platforms
// get a prominent "watch original ad" button instead.
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

  // A YouTube ID that is not a YouTube ID produces a player that loads and then
  // shows "video unavailable" - visually identical to a broken embed.
  if (v.platform === "youtube" && v.video_id != null && !/^[A-Za-z0-9_-]{11}$/.test(v.video_id)) {
    errs.push(where(`video_id "${v.video_id}" is not an 11-character YouTube ID`));
  }

  // A claim of embeddability that cannot actually be honoured is the failure
  // mode that produces an empty <iframe>, so it is an error, not a warning.
  if (v.embed_available === true) {
    if (!v.video_id) errs.push(where("embed_available is true but no video_id is present"));
    if (v.platform && PLATFORMS[v.platform] && !PLATFORMS[v.platform].embeddable) {
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
export function resolveVideo(record) {
  const v = readVideo(record);
  if (!v) return { mode: "none", platform: null, platformLabel: null, reason: "not-located" };

  const platform = v.platform && PLATFORMS[v.platform] ? v.platform : null;
  const spec = platform ? PLATFORMS[platform] : null;
  const platformLabel = spec ? spec.label : null;
  const archiveUrl = v.archive_url ?? null;
  const prov = PROVENANCE[v.provenance] ?? PROVENANCE.unverified;

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
    provenance: v.provenance,
    provenanceLabel: prov.label,
    provenanceNote: prov.note,
    verified: provenanceEmbeds(v.provenance),
    note: v.verificationNote ?? null,
  };

  const embeddable =
    spec?.embeddable === true &&
    !!v.video_id &&
    provenanceEmbeds(v.provenance) &&
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
      reason: !provenanceEmbeds(v.provenance)
        ? "unverified"
        : spec && !spec.embeddable
          ? "not-embeddable"
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
