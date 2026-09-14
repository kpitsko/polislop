// Cloudflare Worker for polislop.
//
//   GET  /api/ads          published corpus, scores computed server-side
//   GET  /api/rubric       the scoring rubric, for anyone auditing a score
//   POST /api/triage       draft rubric sub-scores for a candidate ad
//
// /api/triage is a REVIEWER AID, not a publisher. It returns a proposal that a
// human has to accept, and it never writes to the corpus. An automated pipeline
// assigning deception scores to named politicians is exactly the failure mode
// this project exists to document.
import Anthropic from "@anthropic-ai/sdk";
import corpus from "./data/ads.json";
import { scoreRecord, fccApplies, DIMENSIONS, BANDS } from "./src/scoring.js";

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

export default {
  async fetch(request, env) {
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
    if (request.method === "POST" && pathname === "/api/triage") return triage(request, env);

    return json({ error: "Not found", routes: ["GET /api/ads", "GET /api/rubric", "POST /api/triage"] }, 404);
  },
};
