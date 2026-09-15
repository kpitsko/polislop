// Meta oEmbed: turning a public Instagram/Facebook post URL into the embed
// markup Meta itself publishes for it.
//
// Why this exists at all: framing a Meta URL directly does not work, and it is
// easy to mistake that for "Meta content cannot be embedded". It can. Meta's
// supported path is oEmbed - you hand it the public permalink, it hands back a
// placeholder element, and Meta's own script swaps that element for the real
// post. That is the mechanism the official meta-embeds-for-wordpress plugin
// implements, and it is what this module reproduces for the Worker.
//
// What the endpoints are actually worth, measured rather than assumed:
//
//   instagram_oembed  VALIDATES. A live public post returns embed HTML; a
//                     deleted, private or invented shortcode returns
//                     400 "The requested resource does not exist" (code 24).
//                     So a success here is real evidence the post is embeddable.
//
//   oembed_post  }    DO NOT VALIDATE. Both happily template any URL you give
//   oembed_video }    them - including an Instagram URL - into a div and return
//                     200. A success here is evidence of nothing, so Facebook
//                     rows are still only shown once the SDK has actually
//                     rendered something (the page's promote-on-proof pass).
//
// Neither call needs an access token for public content. A token is accepted
// when one is configured, because Meta rate-limits anonymous callers harder.

export const GRAPH_VERSION = "v21.0";

/** Provider scripts. Loaded once per page, and only if a record needs them. */
export const META_PROVIDERS = {
  instagram: {
    label: "Instagram",
    script: "https://platform.instagram.com/en_US/embeds.js",
    // Instagram re-scans for unprocessed blockquotes on demand.
    process: "instgrm.Embeds.process",
    rootClass: "instagram-media",
  },
  facebook: {
    label: "Facebook",
    script: `https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=${GRAPH_VERSION}`,
    process: "FB.XFBML.parse",
    rootClass: "fb-post fb-video",
  },
};

// Facebook splits video-ish permalinks from everything else across two
// endpoints, and sending a reel to oembed_post is an outright error.
const FB_VIDEO_PATH = /\/(reel|videos|video\.php|watch)(\/|\?|$)/i;

/**
 * Which Meta endpoint serves a given URL, or null when the URL is not a public
 * post we can ask about. Ad Library permalinks are deliberately excluded: they
 * are a viewer for an ad, not a public post, and no oEmbed endpoint serves them.
 */
export function metaEndpointFor(url) {
  if (typeof url !== "string") return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|web|m|business)\./, "");

  if (host === "instagram.com") {
    return /^\/(p|reel|reels|tv)\/[^/]+/.test(u.pathname) ? "instagram_oembed" : null;
  }
  if (host === "facebook.com" || host === "fb.watch") {
    if (u.pathname.startsWith("/ads/library")) return null; // not a public post
    return FB_VIDEO_PATH.test(u.pathname) ? "oembed_video" : "oembed_post";
  }
  return null;
}

/** The provider key a URL belongs to, for picking the right script to load. */
export function metaProviderFor(url) {
  const ep = metaEndpointFor(url);
  if (!ep) return null;
  return ep === "instagram_oembed" ? "instagram" : "facebook";
}

/**
 * Meta's HTML is injected into the page, so it is checked rather than trusted.
 * The response is a placeholder that Meta's script later replaces; it has no
 * legitimate reason to carry a script, an event handler, or an iframe, and
 * refusing those keeps a compromised or unexpected response from executing.
 *
 * Returns null when the markup is not the shape we expect.
 */
export function sanitizeEmbedHtml(html, provider) {
  if (typeof html !== "string" || !html.trim()) return null;
  const spec = META_PROVIDERS[provider];
  if (!spec) return null;

  if (/<\s*script/i.test(html)) return null;
  if (/<\s*iframe/i.test(html)) return null;
  if (/<\s*(object|embed|form|link|meta|style)\b/i.test(html)) return null;
  // Inline handlers, and javascript:/data: URLs in any attribute.
  if (/\son[a-z]+\s*=/i.test(html)) return null;
  if (/(href|src)\s*=\s*["']?\s*(javascript|data):/i.test(html)) return null;

  const root = html.trim().match(/^<\s*(blockquote|div)\b[^>]*class\s*=\s*["']([^"']+)["']/i);
  if (!root) return null;
  const classes = root[2].split(/\s+/);
  if (!classes.some((c) => spec.rootClass.split(" ").includes(c))) return null;

  return html.trim();
}

/**
 * Ask Meta for a URL's embed markup.
 *
 * Never throws: a rejection, a network failure and a malformed response all
 * come back as `{ ok: false, reason }`, because every one of them means the
 * same thing to the page - fall back to the watch button.
 */
export async function fetchMetaOEmbed(url, opts = {}) {
  const { token = null, maxwidth = 658, fetchImpl = fetch, version = GRAPH_VERSION } = opts;
  const endpoint = metaEndpointFor(url);
  const provider = metaProviderFor(url);
  if (!endpoint) return { ok: false, url, reason: "not-a-public-meta-post" };

  const qs = new URLSearchParams({ url, omitscript: "true", maxwidth: String(maxwidth) });
  if (token) qs.set("access_token", token);

  let res, body;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${version}/${endpoint}?${qs}`, {
      headers: { accept: "application/json" },
    });
    body = await res.json();
  } catch (err) {
    return { ok: false, url, endpoint, provider, reason: "network", detail: String(err?.message ?? err) };
  }

  if (body?.error) {
    return { ok: false, url, endpoint, provider, reason: "rejected", detail: body.error.message, code: body.error.code };
  }
  if (!res.ok) return { ok: false, url, endpoint, provider, reason: `http-${res.status}` };

  const html = sanitizeEmbedHtml(body?.html, provider);
  if (!html) return { ok: false, url, endpoint, provider, reason: "unexpected-markup" };

  return {
    ok: true,
    url,
    endpoint,
    provider,
    html,
    width: Number(body.width) || maxwidth,
    providerName: body.provider_name ?? META_PROVIDERS[provider].label,
    // Only instagram_oembed proves the post exists; say so on the record rather
    // than letting a Facebook 200 masquerade as verification.
    validates: endpoint === "instagram_oembed",
  };
}
