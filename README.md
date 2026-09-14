# polislop

**Political AI slop you should know about.**

A public record of US political ads that used AI to depict real people: what the AI
did, what in the ad was real, what was invented, how honestly it was labeled, and
where to complain.

The name is blunt on purpose; the method is not. Nothing enters this ledger without
two independent sources, and every score is arithmetic you can check.

```
npm test          # rubric tests + corpus integrity checks
npm run build     # -> public/index.html (self-contained, no runtime fetch)
npm run dev       # worker + static site locally
```

## The deception score

Scores are **computed, never hand-assigned**. Each record stores three sub-scores in
its `rubric` block; `src/scoring.js` rolls them up. Nobody can nudge a score without
changing a sub-score that is published next to it.

Records sort by **candidate A–Z** (the person the ad *portrays*, not the sponsor —
`primarySubject()` picks it, skipping non-US figures used as props), by **state**, by
**sponsor party**, by score, or by date. Filters cover candidate, sponsor party,
technique, state, disclosure and free text. Party renders as an uncolored outlined
letter: warm is already the severity ramp, and color-coding party would both collide
with it and read as partisan framing.

| Dimension | Range | Question |
|---|---|---|
| `fabrication` | 0–4 | How far does the ad go in attributing words or actions to a real person? |
| `realism` | 0–2 | Could a reasonable viewer mistake it for genuine footage? |
| `disclosure` | 0–3 | How clearly is the synthetic content labeled on the artifact itself? |

```
raw = fabrication × realismGate[0.4, 0.7, 1.0] + disclosure × 0.6     (0 … 5.8)
```

Realism **gates** fabrication rather than adding to it: a cartoon that puts words in
someone's mouth deceives less than photoreal footage doing the same. Disclosure is
additive — a clear label mitigates but never fully excuses. Raw then falls into a
band: 1 Minimal · 2 Low · 3 Moderate · 4 High · 5 Severe.

The score grades **how an ad depicts real people**. It does not grade whether the
ad's political claims are true — that is fact-checking, a separate job with a
separate method.

## "Pull all political ads in the United States" — what is actually possible

No source gives you every US political ad, and any site claiming otherwise is
guessing. What exists:

| Source | Covers | Real limits |
|---|---|---|
| **Meta Ad Library API** | Facebook/Instagram political & issue ads | The only mature API. Needs a token from an identity-confirmed app. Creative text only — no frame or audio analysis, so AI use is detectable only when someone *says* so. |
| **Google political ads (BigQuery `google_political_ads`)** | Search, YouTube, Display | Public dataset, but no Transparency Center API; records are thin and most non-political ads age out in ~30 days. |
| **FCC Political Files** | Broadcast/cable buys | Legally required and rich on spend and station, but PDFs per station — heavy to parse, and it covers broadcast only. |
| **AdImpact / Wesleyan Media Project** | TV + digital, classified | The best AI-in-ads tracking available (Wesleyan put AI ad spend at ~$20M for the 2026 cycle), but licensed, not free. |
| **Reporting** | Everything above plus organic posts | Most high-deception cases in this corpus were *never paid ads* — they were campaign social posts, which no ad library indexes at all. |

So the pipeline here is deliberately **hybrid, not automated**:

```
ingest/meta-ad-library.mjs   broad keyword sweep  ->  review queue (never published)
POST /api/triage             drafts rubric sub-scores from evidence -> proposal only
human review                 confirm ad, find 2+ sources, set rubric -> data/ads.json
npm run build                -> public/index.html
```

**Nothing publishes itself.** `/api/triage` returns `publishable: false` and refuses
to write to the corpus. An automated pipeline stamping deception scores onto named
politicians is precisely the failure mode this project documents.

## Adding a record

Append to `data/ads.json`, then `npm test && npm run build`. Tests enforce:

- **at least two independent, reputable sources** — single-sourced ads do not enter;
- a `howAiUsed` that explains the technique concretely;
- a `reviewNote` on anything marked `needs-verification`.

Set `reviewStatus: "needs-verification"` whenever a rubric input is unsettled. The
page renders those with a provisional banner and the stated reason. Two records
carry it now: the Cornyn spot (disclosure reported at campaign level, not confirmed
on the spot) and the Wall video (disclosure unconfirmed, scored worst-case, which
may be grading it unfairly).

## Three things to check before this goes public

1. **X handles.** `xHandle` is filled only where the account is well known, and the
   UI always prints the handle on the button so a user sees who they are about to
   contact. Everything else falls back to an X *search* link on purpose — a wrong
   handle points complaints at an uninvolved person. Verify each one against the
   official account before launch.
2. **Embeds.** `embed` is `null` on every record. The renderer supports
   `{"provider":"youtube","id":"..."}` and frames it via `youtube-nocookie.com`, but
   an unverified ID would put the wrong footage under a named person's name. Confirm
   each video against the cited reporting, then fill it in.
3. **Scores are editorial.** They are assessments against a published rubric, not
   legal findings, and no record here asserts that any ad broke a law.

## Complaint routing

**FCC jurisdiction covers broadcast, cable, satellite and radio only.** Ads that ran
solely on social or web video are outside it and a complaint would be closed without
action — so `fccApplies()` keys off the carriage channel, and records outside
jurisdiction say so and point elsewhere instead. Of the current corpus, exactly one
record is in FCC jurisdiction.

- File: <https://consumercomplaints.fcc.gov/hc/en-us>
- Which TV issue to pick: <https://consumercomplaints.fcc.gov/hc/en-us/articles/27646986117268-TV-Form-Descriptions-of-Complaint-Issues>
- Rules background: <https://www.fcc.gov/media/policy/political-programming>

A broadcast complaint needs the **station call sign plus the date and time** you saw
the ad; without those the FCC cannot act.

Worth knowing: the FCC's AI-disclosure rulemaking for political ads is still at the
NPRM stage with no final rule, and there is no federal statute requiring AI
disclosure in political advertising. Roughly 33 states have their own deepfake
disclosure or distribution laws, most operating only inside a 60–90 day window
before an election — so for many ads the state route matters more than the federal
one.

## Layout

```
data/ads.json            corpus (rubric inputs + sources; no stored scores)
src/scoring.js           rubric, roll-up, FCC jurisdiction test
src/page.html            template with the <!--POLISLOP_DATA--> slot
build.mjs                computes scores, inlines data -> public/index.html
worker.js                GET /api/ads · GET /api/rubric · POST /api/triage
ingest/meta-ad-library.mjs   Meta sweep -> review queue
test/scoring.test.mjs    rubric behavior + corpus integrity
```
