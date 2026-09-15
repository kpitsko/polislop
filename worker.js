// Cloudflare Worker for polislop.
//
//   GET  /api/ads          published corpus, scores computed server-side
//   GET  /api/rubric       the scoring rubric, for anyone auditing a score
//   GET  /api/oembed       Meta embed markup for a public Instagram/Facebook URL
//   GET  /api/submit/health which submission secrets the Worker can actually see
//   POST /api/submit       reader-submitted ad, forwarded to the review inbox
//   POST /api/triage       draft rubric sub-scores for a candidate ad
//
// /api/triage is a REVIEWER AID, not a publisher. It returns a proposal that a
// human has to accept, and it never writes to the corpus. An automated pipeline
// assigning deception scores to named politicians is exactly the failure mode
// this project exists to document.
import Anthropic from "@anthropic-ai/sdk";
import corpus from "./data/ads.json";
import { scoreRecord, fccApplies, DIMENSIONS, BANDS } from "./src/scoring.js";
import { fetchMetaOEmbed, metaEndpointFor } from "./src/oembed.js";

const MODEL = "claude-opus-5";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

const TRIAGE_SYSTEM = `You help a human reviewer grade how deceptively a US political ad uses AI.

You assign three sub-scores. You do NOT assign the final 1-5 score; it is computed from your sub-scores by a published formula.

fabrication (0-4) — what the ad attributes to a real person:
${DIMENSIONS.fabrication.levels.map((t, i) => `  ${i} = ${t}`).join("\n")}

realism (0-2) — could a reasonable viewer mistake it for genuine footage:
${DIMENSIONS.realism.levels.map((t, i) => `  ${i} = ${t}`).join("\n")}

disclosure (0-3) — how clearly the synthetic content is labeled ON THE ARTIFACT:
${DIMENSIONS.disclosure.levels.map((t, i) => `  ${i} = ${t}`).join("\n")}

Rules:
- Grade only what the supplied evidence states. Never infer a disclosure that is not described, and never infer what an ad depicts from its sponsor's politics.
- If the evidence does not settle a dimension, say so in that dimension's note and set "confident" to false. A worst-case guess presented confidently is worse than an admitted gap.
- Judge the depiction, not the politics. Whether the ad's political claims are true is a separate job.
- Notes are one sentence, factual, and cite the evidence they rest on.`;

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    fabrication: { type: "integer", minimum: 0, maximum: 4 },
    fabricationNote: { type: "string" },
    realism: { type: "integer", minimum: 0, maximum: 2 },
    realismNote: { type: "string" },
    disclosure: { type: "integer", minimum: 0, maximum: 3 },
    disclosureNote: { type: "string" },
    techniques: { type: "array", items: { type: "string" } },
    confident: { type: "boolean", description: "false if any dimension is unsettled by the evidence" },
    gaps: { type: "array", items: { type: "string" }, description: "What a reviewer must confirm before publishing" },
  },
  required: ["fabrication", "fabricationNote", "realism", "realismNote",
    "disclosure", "disclosureNote", "techniques", "confident", "gaps"],
  additionalProperties: false,
};

async function triage(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Worker missing ANTHROPIC_API_KEY secret" }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Body must be JSON: {description, disclosureEvidence?, sources?}" }, 400); }

  const { description, disclosureEvidence = "", sources = [] } = body;
  if (!description || typeof description !== "string" || description.length < 40) {
    return json({ error: "'description' must describe the ad in at least 40 characters" }, 400);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const evidence = [
    `AD DESCRIPTION:\n${description}`,
    disclosureEvidence ? `DISCLOSURE EVIDENCE:\n${disclosureEvidence}` : "DISCLOSURE EVIDENCE: none supplied.",
    sources.length ? `SOURCES:\n${sources.map((s) => `- ${s}`).join("\n")}` : "SOURCES: none supplied.",
  ].join("\n\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
      system: TRIAGE_SYSTEM,
      messages: [{ role: "user", content: evidence }],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const rubric = JSON.parse(text);
    const computed = scoreRecord({ rubric, reviewStatus: "needs-verification" });

    return json({
      status: "proposal",
      publishable: false,
      requires: sources.length >= 2
        ? ["human confirmation of every sub-score"]
        : ["at least two independent sources", "human confirmation of every sub-score"],
      rubric,
      computed,
    });
  } catch (err) {
    const status = err?.status ?? 502;
    return json({ error: err?.message ?? String(err) }, status >= 400 && status < 600 ? status : 502);
  }
}

/**
 * Meta oEmbed, proxied.
 *
 * The site itself does not need this at request time - build.mjs bakes the
 * markup in from data/oembed-cache.json - but the mechanism belongs in the
 * Worker so the cache can be refreshed, a URL can be checked before it is added
 * to the corpus, and the site is never one Meta outage away from a broken page.
 *
 * Responses are held in Cloudflare's edge cache so repeated lookups for the same
 * ad do not become repeated calls to Meta.
 */
const OEMBED_TTL = 60 * 60 * 24; // a day; the underlying posts change rarely

async function oembedRoute(request, env, ctx) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return json({ error: "Pass ?url= a public Instagram or Facebook post URL" }, 400);
  if (!metaEndpointFor(url)) {
    // Being specific here matters: an Ad Library link is a viewer for an ad, not
    // a post, and no amount of retrying will make it embeddable.
    return json({
      ok: false,
      reason: "not-a-public-meta-post",
      detail: "Only public instagram.com and facebook.com post, reel or video URLs have an oEmbed. Ad Library permalinks do not.",
    }, 422);
  }

  const key = new Request(`https://polislop.org/api/oembed?url=${encodeURIComponent(url)}`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const result = await fetchMetaOEmbed(url, { token: env.META_OEMBED_TOKEN || null });
  const res = json(result, result.ok ? 200 : 502);
  // Only successes are cached: a rejection may be a transient Meta error, and
  // caching that for a day would strand an ad that is actually embeddable.
  if (result.ok) {
    res.headers.set("cache-control", `public, max-age=${OEMBED_TTL}`);
    ctx?.waitUntil?.(cache.put(key, res.clone()));
  }
  return res;
}

/**
 * Reader submissions.
 *
 * The review inbox is a secret (SUBMISSIONS_TO), never a constant in this file.
 * This repository is public, and a recipient address committed here would be
 * scraped off GitHub within days. It is also never sent to the browser: the
 * page posts to polislop and gets back {ok:true}, and no response on any path -
 * success, validation failure or misconfiguration - names where it went.
 *
 * Configure with:
 *   wrangler secret put SUBMISSIONS_TO      the review inbox
 *   wrangler secret put SUBMISSIONS_FROM    a verified sender on your domain
 *   wrangler secret put RESEND_API_KEY      transactional email key
 */
const SUBMIT_LIMITS = { url: 2000, notes: 2000, perIpPerHour: 5 };
const SUBMIT_SECRETS = ["SUBMISSIONS_TO", "SUBMISSIONS_FROM", "RESEND_API_KEY"];

/**
 * Which submission secrets this Worker can see. Booleans only — never a value,
 * never the inbox.
 *
 * This exists because the failure it diagnoses is otherwise invisible: every
 * error path here returns the same opaque message on purpose, so a
 * misconfigured Worker and a rejected submission look identical from outside.
 * Reporting presence costs nothing an attacker can use and turns "it doesn't
 * work" into a named missing variable.
 */
function submitHealth(env) {
  const configured = Object.fromEntries(SUBMIT_SECRETS.map((k) => [k, Boolean(env[k])]));
  const missing = SUBMIT_SECRETS.filter((k) => !env[k]);
  return json({
    ok: missing.length === 0,
    configured,
    missing,
    hint: missing.length
      ? `Set with: wrangler secret put ${missing[0]} — and confirm you are targeting the Worker named in wrangler.jsonc ("polislop"), not a preview environment.`
      : "All three secrets are visible to the Worker. If submissions still fail, the rejection is coming from Resend; run `wrangler tail` and submit again to see the reason.",
  });
}

const submitError = (status) => json({ ok: false, error: "Could not accept that submission." }, status);

// A public form that emails someone is an abuse vector, so submissions are
// rate-limited per IP. The Cache API is per-colocation rather than global,
// which makes this a speed bump rather than a wall - enough to stop a naive
// script without adding a KV round trip to every submission.
async function overSubmitLimit(ip) {
  if (!ip) return false;
  const key = new Request(`https://polislop.org/__submit-rate/${encodeURIComponent(ip)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const count = hit ? Number(await hit.text()) || 0 : 0;
  if (count >= SUBMIT_LIMITS.perIpPerHour) return true;
  await cache.put(key, new Response(String(count + 1), {
    headers: { "cache-control": "max-age=3600", "content-type": "text/plain" },
  }));
  return false;
}

async function submit(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return submitError(400); }

  const url = String(body?.url ?? "").trim();
  const notes = String(body?.notes ?? "").trim();
  const honeypot = String(body?.website ?? "").trim();

  // A filled honeypot is a bot. It gets the same {ok:true} a person gets, so
  // the script has nothing to learn and nothing to retry against.
  if (honeypot) return json({ ok: true });

  if (!url || url.length > SUBMIT_LIMITS.url || notes.length > SUBMIT_LIMITS.notes) return submitError(400);
  let parsed;
  try { parsed = new URL(url); } catch { return submitError(400); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return submitError(400);
  if (!parsed.hostname.includes(".")) return submitError(400);

  const ip = request.headers.get("cf-connecting-ip");
  if (await overSubmitLimit(ip)) return submitError(429);

  const missing = SUBMIT_SECRETS.filter((k) => !env[k]);
  if (missing.length) {
    // Deliberately not "ok": telling a reader their ad was received when it was
    // not is the one outcome worse than an error. The reason goes to the Worker
    // log, where an operator can see it, and never to the browser.
    console.error(`/api/submit not configured — missing: ${missing.join(", ")}`);
    return submitError(503);
  }

  const cf = request.cf ?? {};
  const lines = [
    `Ad URL: ${url}`,
    "",
    notes ? `Notes from submitter:\n${notes}` : "Notes from submitter: (none)",
    "",
    "---",
    `Received: ${new Date().toISOString()}`,
    `Origin: ${[cf.city, cf.region, cf.country].filter(Boolean).join(", ") || "unknown"}`,
    `User agent: ${request.headers.get("user-agent") ?? "unknown"}`,
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.SUBMISSIONS_FROM,
        to: [env.SUBMISSIONS_TO],
        subject: `polislop submission: ${parsed.hostname}`,
        text: lines.join("\n"),
      }),
    });
    if (!res.ok) {
      // Resend's rejection is the single most useful line when this breaks —
      // an unverified sending domain and a bad API key fail identically from
      // the browser's side. Logged for `wrangler tail`, never returned.
      const detail = await res.text().catch(() => "(no body)");
      console.error(`/api/submit — Resend rejected: HTTP ${res.status} ${detail.slice(0, 500)}`);
      return submitError(502);
    }
  } catch (err) {
    console.error(`/api/submit — could not reach Resend: ${err?.message ?? err}`);
    return submitError(502);
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/api/ads") {
      return json({
        updated: corpus.updated,
        records: corpus.records.map((r) => ({ ...r, computed: scoreRecord(r), fccApplies: fccApplies(r) })),
      });
    }
    if (request.method === "GET" && pathname === "/api/rubric") {
      return json({ dimensions: DIMENSIONS, bands: BANDS });
    }
    if (request.method === "GET" && pathname === "/api/oembed") return oembedRoute(request, env, ctx);
    if (request.method === "GET" && pathname === "/api/submit/health") return submitHealth(env);
    if (request.method === "POST" && pathname === "/api/submit") return submit(request, env);
    if (request.method === "POST" && pathname === "/api/triage") return triage(request, env);

    return json({ error: "Not found", routes: ["GET /api/ads", "GET /api/rubric", "GET /api/oembed", "GET /api/submit/health", "POST /api/submit", "POST /api/triage"] }, 404);
  },
};
