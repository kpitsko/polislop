// Deception scoring for AI use in political advertising.
//
// The score is DERIVED, never hand-assigned. Every published number must be
// reproducible from the three sub-scores recorded on the record, so a reader
// who disagrees can point at the dimension they'd grade differently instead of
// arguing with an opaque verdict.
//
// Core question, per the rubric's design: how much does this ad show a real
// person saying or doing something they did not say or do, how convincingly,
// and how honestly is that flagged?

export const DIMENSIONS = {
  fabrication: {
    label: "Fabrication",
    question: "How far does the ad go in attributing words or actions to a real person?",
    max: 4,
    levels: [
      "No real person depicted, or the subject depicts themselves with consent",
      "A real person's own verbatim words, re-delivered synthetically",
      "A real person's real words materially recontextualized",
      "A real person shown doing something they did not do",
      "A real person shown saying words they never said",
    ],
  },
  realism: {
    label: "Realism",
    question: "Could a reasonable viewer mistake it for genuine footage?",
    max: 2,
    levels: [
      "Obviously synthetic - caricature, cartoon, visible artifacts",
      "Stylized but plausible enough to pass in a fast scroll",
      "Photoreal; indistinguishable from real footage at a glance",
    ],
  },
  disclosure: {
    label: "Disclosure",
    question: "How clearly is the synthetic content labeled on the artifact itself?",
    max: 3,
    levels: [
      "Prominent on-ad label plus platform/provenance metadata",
      "Clear, legible on-ad label",
      "Label present but small, brief, or buried",
      "No disclosure on the artifact",
    ],
  },
};

// Realism gates fabrication rather than adding to it: a cartoon that puts words
// in someone's mouth is a weaker deception than a photoreal one doing the same.
// Disclosure is additive - a clear label mitigates but never fully excuses.
const REALISM_GATE = [0.4, 0.7, 1.0];
const DISCLOSURE_WEIGHT = 0.6;

export const MAX_RAW =
  DIMENSIONS.fabrication.max * REALISM_GATE[REALISM_GATE.length - 1] +
  DIMENSIONS.disclosure.max * DISCLOSURE_WEIGHT; // 5.8

export const BANDS = [
  { score: 1, label: "Minimal", max: 1.2, meaning: "Synthetic production technique with no misattribution." },
  { score: 2, label: "Low", max: 2.3, meaning: "Real statements or self-depiction; little risk of false belief." },
  { score: 3, label: "Moderate", max: 3.4, meaning: "Fabricated depiction, but signalled as constructed or clearly labeled." },
  { score: 4, label: "High", max: 4.5, meaning: "Convincing fabrication with weak or missing disclosure." },
  { score: 5, label: "Severe", max: Infinity, meaning: "Words or acts invented for a real person and presented without an honest label." },
];

function requireLevel(dimension, value) {
  const dim = DIMENSIONS[dimension];
  if (!Number.isInteger(value) || value < 0 || value > dim.max) {
    throw new Error(`${dimension} must be an integer 0-${dim.max}, received ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Compute a deception score from a record's rubric block.
 * Returns the band plus the full arithmetic, so the UI can show its work.
 */
export function scoreRecord(record) {
  const r = record.rubric ?? {};
  const fabrication = requireLevel("fabrication", r.fabrication);
  const realism = requireLevel("realism", r.realism);
  const disclosure = requireLevel("disclosure", r.disclosure);

  const gate = REALISM_GATE[realism];
  const fabricationPoints = fabrication * gate;
  const disclosurePoints = disclosure * DISCLOSURE_WEIGHT;
  const raw = fabricationPoints + disclosurePoints;
  const band = BANDS.find((b) => raw < b.max) ?? BANDS[BANDS.length - 1];

  return {
    score: band.score,
    label: band.label,
    meaning: band.meaning,
    raw: Number(raw.toFixed(2)),
    maxRaw: MAX_RAW,
    provisional: record.reviewStatus === "needs-verification",
    breakdown: [
      {
        key: "fabrication",
        label: DIMENSIONS.fabrication.label,
        level: fabrication,
        max: DIMENSIONS.fabrication.max,
        levelText: DIMENSIONS.fabrication.levels[fabrication],
        points: Number(fabricationPoints.toFixed(2)),
        note: r.fabricationNote ?? "",
        math: `${fabrication} x ${gate}`,
      },
      {
        key: "realism",
        label: DIMENSIONS.realism.label,
        level: realism,
        max: DIMENSIONS.realism.max,
        levelText: DIMENSIONS.realism.levels[realism],
        points: null,
        note: r.realismNote ?? "",
        math: `gate x${gate}`,
      },
      {
        key: "disclosure",
        label: DIMENSIONS.disclosure.label,
        level: disclosure,
        max: DIMENSIONS.disclosure.max,
        levelText: DIMENSIONS.disclosure.levels[disclosure],
        points: Number(disclosurePoints.toFixed(2)),
        note: r.disclosureNote ?? "",
        math: `${disclosure} x ${DISCLOSURE_WEIGHT}`,
      },
    ],
  };
}

/**
 * FCC jurisdiction covers broadcast, cable and satellite TV and radio. An ad
 * that ran only on social or web video is outside it, and telling someone to
 * file there anyway wastes their complaint.
 */
const FCC_CHANNELS = new Set(["broadcast", "cable", "satellite", "radio", "tv"]);

export function fccApplies(record) {
  return (record.channels ?? []).some((c) => FCC_CHANNELS.has(c));
}

/**
 * The record sorts under the person the ad PORTRAYS — that is what this ledger
 * is about — falling back to the sponsor when nobody real is depicted.
 * Non-US figures used as props (a foreign leader in a satire spot) are skipped.
 */
export function primarySubject(record) {
  const depicted = record.depicted ?? [];
  const subject = depicted.find((d) => d.party === "D" || d.party === "R") ?? depicted[0];
  if (subject) return { ...subject, role: subject.role, source: "depicted" };
  const s = record.sponsor;
  return { name: s.name, sortName: s.sortName, party: s.party, role: s.type, source: "sponsor" };
}

/** Every real person a record touches, for the candidate filter. */
export function peopleIn(record) {
  const out = new Map();
  for (const d of record.depicted ?? []) out.set(d.name, d);
  const s = record.sponsor;
  if (s.type !== "party committee") out.set(s.name, { name: s.name, sortName: s.sortName, party: s.party, role: s.type });
  return [...out.values()];
}
