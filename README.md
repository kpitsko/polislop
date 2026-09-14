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
letter. The severity ramp already owns the blue lightness scale, and color-coding
party would both collide with it and read as partisan framing.

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
carry it now: the Cornyn "Love Shack" spot (disclosure reported at campaign level,
not confirmed on the spot) and the Platner ad (no on-ad label confirmed in
reporting). The Wall video previously carried it too; the Texas Tribune has since
confirmed the spoken parody disclosure, so it is now corroborated and its disclosure
input moved from 3 to 2 — which moved the computed score from 4 to 3.

## Three things to check before this goes public

1. **X handles.** `xHandle` is filled only where the account is well known, and the
   UI always prints the handle on the button so a user sees who they are about to
   contact. Everything else falls back to an X *search* link on purpose — a wrong
   handle points complaints at an uninvolved person. Verify each one against the
   official account before launch.
2. **Original video.** 15 of 17 records now carry a located original: 12 play in
   the page (5 YouTube, 7 X) and 3 link out to the sponsor's own post. Two are
   still unlocated — the Cornyn "show dog" video and the Wall video — and render the
   explicit "not yet located" state rather than borrowing a reporter's repost. See
   **Original ad video** below for the data shape and the rule that gates embedding.
3. **Scores are editorial.** They are assessments against a published rubric, not
   legal findings, and no record here asserts that any ad broke a law.

## Original ad video

Each record may carry a `video` block. `src/video.js` resolves it into exactly one of
three presentation states, and `build.mjs` refuses to build if a block is incoherent
(for example `embed_available: true` with no `video_id`, or a YouTube `video_id` that
is not 11 characters), so a broken player cannot reach a reader.

```json
"video": {
  "original_ad_url": "https://...",   // canonical link to the ad itself
  "platform": "youtube",              // see PLATFORMS in src/video.js
  "video_id": "...",                  // when the platform has one
  "embed_available": true,            // may we frame it in-page?
  "archive_url": "https://...",       // optional, survives the original going down
  "provenance": "official_source",    // how we know this is the ad; see below
  "verificationNote": "..."           // what established it, in one sentence
}
```

| State | When | What the card shows |
|---|---|---|
| `embed` | platform is embeddable, `video_id` present, **and** provenance embeds | the player, plus a direct link beneath it |
| `link` | original located but not embeddable, or provenance too weak | platform name + **Watch original ad** |
| `none` | original not located | an explicit "not yet located" notice |

### Provenance

Parsing an ID out of a URL proves the link is well-formed, not that the video on the
other end is the advertisement rather than a news segment about it. So every located
original records **how** it was established, and only the grades below marked "frames"
will put a player on the page.

| Grade | Meaning | Frames? |
|---|---|---|
| `official_source` | published on the sponsor's own campaign, committee or candidate account | yes |
| `archive_verified` | captured in a political-ad archive or public ad library | yes |
| `reporting_corroborated` | credible reporting identifies this exact posting as the ad | yes |
| `human_verified` | a person watched the footage against the cited reporting | yes |
| `unverified` | a plausible link nothing has tied to the ad | no |

Provenance, not personal viewing, is the bar. The four strong grades each answer the
question a player has to answer — *is the thing on the other end of this link the
advertisement?* — from an independent direction, and that is the same standard of
evidence the rest of the ledger runs on. A block with no `provenance` is read as
`unverified`; the legacy `verified: true` flag maps to `human_verified` so old rows
keep their meaning. `youTubeIdFromUrl()` exists only to parse and says nothing about
provenance.

A news clip is never shown in place of an ad, and links to reporting are labelled as
reporting. A corpus test enforces this literally: no `original_ad_url` may point at a
host that appears in that record's own source list.

### What is framed, and what is only linked

| Platform | Framed? | Why |
|---|---|---|
| YouTube | yes, `<iframe>` | `youtube-nocookie.com/embed/<id>` renders reliably |
| X | yes, widget | `platform.twitter.com/widgets.js`, **rendered optimistically, shown on proof** |
| Instagram | no | `/embed/` answers `x-frame-options: DENY` — it refuses framing outright |
| Facebook | no | `plugins/video.php` 200s but paints an empty box for `/reel/` URLs |

These were measured against the actual postings in the corpus, not assumed.

**X is the awkward one.** Its widget service answers byte-identical markup with a
fully rendered post one minute and a collapsed 0–4px shell the next — it appears
to throttle. A page that simply dropped an X embed in would therefore show a
blank rectangle where the ad should be, some of the time, for reasons nothing in
this repo controls.

So the page never renders the embed and repairs it afterwards. It renders the
ordinary **Watch original ad** card, builds the post off-screen, and promotes it
only once a `ResizeObserver` reports the widget has reached a sensible height.
Promotion is reversible: the card is hidden rather than destroyed, and a post
that renders and then collapses brings its button straight back. The upshot is
that every failure mode — throttled, blocked, slow, collapsed after render, JS
disabled — lands on a working button, and the empty rectangle is unreachable.

The staged post is positioned off-screen rather than `display: none`, because a
`display: none` element can never measure itself and would never be promoted.

`promoteXPosts()` is extracted from the built page and executed against a DOM
stub in `test/video.test.mjs`. Interval timers, rAF and ResizeObserver are all
suspended in a backgrounded or headless tab, so that logic cannot be exercised
by driving a real page — and the decision it makes is the one that must never be
wrong.

Two research notes worth keeping, both learned the hard way:

- Instagram returns HTTP 200 for *any* shortcode when logged out, so a successful
  fetch proves nothing about whether a post exists. Those rows rest on reporting.
- The Texas Tribune's own Google Drive copies of several ads are permission-gated
  (HTTP 401), so they are unusable as reader-facing links despite being cited.

## Brand

The wordmark and mascot are the supplied artwork; everything in `public/brand/` and
the icon set is derived from it by `build`-time-independent crops, not redrawn.

```
brand/polislop-logo-source.png          the supplied artwork, unmodified
public/brand/polislop-lockup.png        masthead lockup (900x321)
public/brand/polislop-lockup-dark.png   reversed: only the wordmark's ink inverts
public/brand/polislop-mark.png          mascot alone, square
public/icon-{16,32,192,512}.png         favicons
public/apple-touch-icon.png             flattened on white (iOS composites alpha)
public/og-image.png                     1200x630 social card
```

The dark lockup inverts **only** the wordmark. The mascot's navy sits on its own
light-blue body, which does not change between themes, so inverting it would erase
the face. The masthead `<picture>` switches on `prefers-color-scheme`, so exactly one
file is downloaded.

Type is **Poppins** throughout. Colour is a single blue family, which means severity
is carried by **lightness**, not hue: the `--sev-1..5` ramp is monotonic in
luminance, so the scale still reads if the blues themselves are hard to separate.
Every foreground/background pair in the palette meets WCAG AA.

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
src/video.js             original-ad resolution + embed policy
src/page.html            template with the <!--POLISLOP_DATA--> slot
build.mjs                computes scores, inlines data -> public/index.html
worker.js                GET /api/ads · GET /api/rubric · POST /api/triage
ingest/meta-ad-library.mjs   Meta sweep -> review queue
test/scoring.test.mjs    rubric behavior + corpus integrity
test/video.test.mjs      embed policy + corpus video-block validation
public/brand/            logo lockups derived from the supplied artwork
```
