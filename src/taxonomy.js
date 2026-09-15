// Fixed vocabularies for the filter controls.
//
// These deliberately do NOT come from the corpus. A state list derived from the
// records can only ever offer the handful of states an ad has already been
// logged in, which tells a reader looking for their own state nothing - they
// cannot tell "no ads recorded here" apart from "this site does not cover here".
// Offering every state and returning an empty result is the honest answer.
//
// The same applies to parties: a minor-party sponsor is exactly the kind of
// record this ledger would want and does not yet have, and the filter should
// not imply the category is impossible.

/** US states, DC, the territories that send voting-eligible delegations, and
 *  the national scope used by records that are not tied to one state. */
export const US_STATES = [
  { code: "US", name: "National / multi-state" },
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "AS", name: "American Samoa" }, { code: "GU", name: "Guam" },
  { code: "MP", name: "Northern Mariana Islands" }, { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "US Virgin Islands" },
];

/**
 * Party codes a sponsor can carry. The single-letter codes are the ones already
 * in the corpus; the rest are here so a minor-party or nonpartisan sponsor has
 * somewhere to sit the day one is logged.
 *
 * "—" is the existing convention for a sponsor with no party - a private
 * individual, or a candidate in a nonpartisan race.
 */
export const PARTIES = [
  { code: "D", name: "Democratic" },
  { code: "R", name: "Republican" },
  { code: "I", name: "Independent" },
  { code: "L", name: "Libertarian" },
  { code: "G", name: "Green" },
  { code: "C", name: "Constitution" },
  { code: "WF", name: "Working Families" },
  { code: "FW", name: "Forward" },
  { code: "PSL", name: "Socialism and Liberation" },
  { code: "NP", name: "Nonpartisan" },
  { code: "—", name: "None / not applicable" },
];

export const STATE_CODES = US_STATES.map((s) => s.code);
export const PARTY_CODES = PARTIES.map((p) => p.code);

/** Every state/party a record actually uses must exist in the lists above, or a
 *  record becomes unreachable through the filters that claim to cover it. */
export function unknownTaxonomy(records) {
  const errs = [];
  for (const r of records ?? []) {
    if (r.state && !STATE_CODES.includes(r.state)) {
      errs.push(`${r.id}: state "${r.state}" is not in US_STATES`);
    }
    const party = r.sponsor?.party;
    if (party && !PARTY_CODES.includes(party)) {
      errs.push(`${r.id}: sponsor party "${party}" is not in PARTIES`);
    }
  }
  return errs;
}
