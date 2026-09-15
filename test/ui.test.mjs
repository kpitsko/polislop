import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { US_STATES, PARTIES, STATE_CODES, PARTY_CODES, unknownTaxonomy } from "../src/taxonomy.js";

const built = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const corpus = JSON.parse(readFileSync(new URL("../data/ads.json", import.meta.url), "utf8"));
const worker = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const payload = JSON.parse(
  built.match(/<script type="application\/json" id="polislop-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, "</"),
);

// ------------------------------------------------------------------ taxonomy

test("taxonomy: every state is offered, not just the ones with records", () => {
  // A list built from the corpus cannot tell a reader "no ads recorded in your
  // state" apart from "your state is not covered".
  const fifty = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY"];
  for (const code of fifty) assert.ok(STATE_CODES.includes(code), `missing state ${code}`);
  assert.ok(STATE_CODES.includes("DC"), "DC must be offered");
  assert.ok(STATE_CODES.includes("US"), "records with national scope need a home");
  assert.equal(new Set(STATE_CODES).size, STATE_CODES.length, "duplicate state codes");
  for (const s of US_STATES) assert.ok(s.name && s.code, `state entry is incomplete: ${JSON.stringify(s)}`);

  // Most of the list should be empty - that is the point of shipping it.
  const used = new Set(corpus.records.map((r) => r.state));
  assert.ok(STATE_CODES.length > used.size * 3, "the state list is still tracking the corpus");
});

test("taxonomy: minor parties are offered alongside the two majors", () => {
  for (const code of ["D", "R", "L", "G", "I"]) {
    assert.ok(PARTY_CODES.includes(code), `missing party ${code}`);
  }
  const names = PARTIES.map((p) => p.name.toLowerCase());
  assert.ok(names.includes("libertarian") && names.includes("green"));
  assert.equal(new Set(PARTY_CODES).size, PARTY_CODES.length, "duplicate party codes");
  assert.ok(PARTY_CODES.includes("—"), "the existing no-party convention must survive");
});

test("taxonomy: no record uses a state or party the filters do not offer", () => {
  // Such a record would be unreachable through the control that claims to
  // cover it, so the build refuses to ship one.
  assert.deepEqual(unknownTaxonomy(corpus.records), []);
});

test("taxonomy: the guard actually catches an unlisted value", () => {
  const errs = unknownTaxonomy([
    { id: "bad-state", state: "ZZ", sponsor: { party: "D" } },
    { id: "bad-party", state: "TX", sponsor: { party: "Whig" } },
  ]);
  assert.equal(errs.length, 2);
  assert.ok(errs[0].includes("ZZ") && errs[1].includes("Whig"));
});

// ------------------------------------------------------------------- filters

test("built page: the candidate filter is gone", () => {
  assert.ok(!built.includes('id="f-cand"'), "the candidate select is still in the markup");
  assert.ok(!/ctl\.cand/.test(built), "the candidate filter still runs");
  assert.ok(!/>Candidate<\/label>/.test(built), "a stray Candidate label remains");
  // The sort option of the same name is a different control and should stay.
  assert.ok(built.includes('value="candidate"'), "sorting by candidate should be unaffected");
});

test("built page: the surviving filters are all still wired", () => {
  for (const id of ["q", "f-score", "f-party", "f-tech", "f-state", "f-disc", "f-sort"]) {
    assert.ok(built.includes(`id="${id}"`), `filter ${id} is missing`);
  }
});

test("built page: states and parties ship in the payload and drive the options", () => {
  assert.equal(payload.states.length, US_STATES.length);
  assert.equal(payload.parties.length, PARTIES.length);
  assert.ok(built.includes("states.map((st)"), "the state select is no longer built from the taxonomy");
  assert.ok(built.includes("parties.map((pt)"), "the party select is no longer built from the taxonomy");
});

// ------------------------------------------------------------- submission form

test("built page: the score distribution is replaced by the submission form", () => {
  assert.ok(!built.includes('id="dist"'), "the distribution chart is still rendered");
  assert.ok(!built.includes("Records by deception score"), "the old heading remains");
  assert.ok(built.includes('id="submit-form"'), "the submission form is missing");
  assert.ok(built.includes('id="s-url"') && built.includes('id="s-notes"'),
    "the form needs a link field and a comments field");
  // The stats strip shares the section and should have survived.
  assert.ok(built.includes('id="stats"'), "the summary stats were removed along with the chart");
});

test("built page: the form posts to the site, and only to the site", () => {
  assert.ok(built.includes('fetch("/api/submit"'), "the form no longer posts to the Worker");
  assert.ok(!/action\s*=\s*["']https?:/i.test(built), "the form must not post off-site");
});

test("built page: the success copy promises review, not publication", () => {
  assert.ok(/Thanks/.test(built), "no thanks message");
  assert.ok(built.includes("If it is approved it will be posted in the next 1"),
    "the approval-and-timing copy is missing or reworded");
});

test("built page: the form carries a honeypot that people cannot see", () => {
  assert.ok(built.includes('id="s-website"'), "no honeypot field");
  const hp = built.match(/\.hp\s*\{([^}]*)\}/);
  assert.ok(hp, "the honeypot has no styling, so it would be visible");
  assert.ok(/left:\s*-\d{4,}px/.test(hp[1]), `honeypot must be off-screen, got: ${hp[1].trim()}`);
  assert.ok(built.includes('aria-hidden="true"'), "the honeypot must be hidden from assistive tech");
});

// ----------------------------------------------------- destination stays private

test("the review inbox appears nowhere a reader could reach", () => {
  // The address is a Worker secret. Anything else either ships it to every
  // browser or publishes it in a public repository.
  const shipped = [built, worker, JSON.stringify(payload)];
  for (const text of shipped) {
    assert.ok(!/b2bsass/i.test(text), "the review inbox leaked into shipped code");
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text.replace(/@media|@supports|@font-face|@keyframes/g, "")),
      "an email address is present in shipped code");
  }
  assert.ok(worker.includes("env.SUBMISSIONS_TO"), "the recipient should come from a secret");
});

test("worker: no submit response reveals where the mail went", () => {
  // Every failure path returns the same opaque message, so a prober cannot
  // distinguish "misconfigured" from "rejected" from "rate-limited".
  const errFn = worker.match(/const submitError = [^;]+;/);
  assert.ok(errFn, "submitError() is gone");
  assert.ok(!/b2bsass|SUBMISSIONS_TO/.test(errFn[0]), "the error path names the destination");
  assert.ok(worker.includes('json({ ok: false, error: "Could not accept that submission." }'),
    "failures should share one opaque message");
});

test("worker: a filled honeypot is answered exactly like a real submission", () => {
  const body = worker.slice(worker.indexOf("async function submit("));
  const hp = body.indexOf("if (honeypot) return json({ ok: true });");
  assert.ok(hp > -1, "a bot must not be able to tell it was caught");
  assert.ok(hp < body.indexOf("RESEND_API_KEY"), "the honeypot must short-circuit before any mail is sent");
});

test("worker: submissions are validated and rate-limited before anything is sent", () => {
  const body = worker.slice(worker.indexOf("async function submit("), worker.indexOf("export default"));
  const sendAt = body.indexOf("api.resend.com");
  for (const guard of ["new URL(url)", "overSubmitLimit(ip)", "SUBMIT_LIMITS.url", "parsed.protocol"]) {
    const at = body.indexOf(guard);
    assert.ok(at > -1, `missing guard: ${guard}`);
    assert.ok(at < sendAt, `${guard} must run before the mail is sent`);
  }
});

test("worker: an unconfigured inbox reports failure rather than a false thanks", () => {
  // Telling a reader their ad was received when it was not is worse than an
  // error, because they will not send it again.
  const body = worker.slice(worker.indexOf("async function submit("));
  const cfg = body.indexOf("const missing = SUBMIT_SECRETS.filter");
  assert.ok(cfg > -1, "the configuration check is gone");
  assert.ok(/return submitError\(503\);/.test(body.slice(cfg, cfg + 800)),
    "an unconfigured Worker must not answer ok");
});

test("worker: /api/submit is registered and POST-only", () => {
  assert.ok(worker.includes('request.method === "POST" && pathname === "/api/submit"'),
    "the route is missing or not POST-only");
  assert.ok(worker.includes('"POST /api/submit"'), "the route list should advertise it");
});

// --------------------------------------------------------------------- policy

test("built page: the CSP still allows the form to reach its own API", () => {
  const csp = readFileSync(new URL("../public/_headers", import.meta.url), "utf8")
    .match(/Content-Security-Policy: ([^\n]+)/)[1];
  const connect = /connect-src([^;]*)/.exec(csp);
  assert.ok(connect && /'self'/.test(connect[1]), "connect-src must allow the same-origin POST");
});

// ------------------------------------------------- submission diagnostics

test("worker: the health check reports presence only, never a value", () => {
  // The whole point of this endpoint is to be safe to expose. If it ever
  // returned the inbox or the key it would be worse than no endpoint at all.
  const fn = worker.slice(worker.indexOf("function submitHealth("), worker.indexOf("async function submit("));
  assert.ok(fn.includes("Boolean(env[k])"), "health must coerce to booleans");
  assert.ok(!/env\[k\]\s*[,}]/.test(fn.replace(/Boolean\(env\[k\]\)/g, "")), "a raw env value is being returned");
  assert.ok(!/env\.SUBMISSIONS_TO\b(?!\s*\))/.test(fn), "the inbox must not appear in the health payload");
  for (const k of ["SUBMISSIONS_TO", "SUBMISSIONS_FROM", "RESEND_API_KEY"]) {
    assert.ok(worker.includes(`"${k}"`), `health should cover ${k}`);
  }
});

test("worker: failures are logged for the operator and stay opaque to the browser", () => {
  // Every submit error returns the same message on purpose, which makes the
  // Worker log the only place a cause can surface.
  const body = worker.slice(worker.indexOf("async function submit("), worker.indexOf("export default"));
  assert.ok(body.includes("console.error(`/api/submit not configured"), "missing secrets are not logged");
  assert.ok(body.includes("Resend rejected"), "a Resend rejection is not logged");
  assert.ok(body.includes("could not reach Resend"), "a network failure is not logged");
  // The rejection detail must never travel back to the caller.
  assert.ok(!/submitError\(50\d,\s*detail/.test(body), "an error detail is being returned to the browser");
  assert.equal((body.match(/json\(\{ ok: false, error: "Could not accept that submission\." \}/g) ?? []).length, 0,
    "failures should route through the shared submitError helper");
});

test("worker: the health route is GET-only and registered", () => {
  assert.ok(worker.includes('request.method === "GET" && pathname === "/api/submit/health"'));
  assert.ok(worker.includes('"GET /api/submit/health"'), "the route list should advertise it");
});
