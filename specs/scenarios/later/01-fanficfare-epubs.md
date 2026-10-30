# Scenario: FanFicFare epubs of AO3 works

Relates to: docs/ARCHITECTURE.md § Decisions so far (Accepted files), § EPUB processor (Scope for v1), § MVP vs later (Later)

## Setup
- A second preface parser for FanFicFare files is deployed alongside the AO3-native parser
- A FanFicFare epub of AO3 work 12345 whose `dc:source` is `archiveofourown.org/works/12345`
- A FanFicFare epub of a work from another site (non-AO3 `dc:source`)
- An existing live work W with `ao3_work_id` 12345

## Cases

### FanFicFare epub of an AO3 work is accepted
- GIVEN the FanFicFare epub of AO3 work 12345 and no existing work 12345
- WHEN it is processed
- THEN the second preface parser reads it and the work is keyed by `ao3_work_id` 12345 from `dc:source`

### FanFicFare epub of a non-AO3 work is still rejected
- GIVEN the FanFicFare epub whose `dc:source` is not an AO3 work URL
- WHEN it is processed
- THEN it is rejected with `not_ao3`

### FanFicFare upload of an existing work goes through versioning
- GIVEN live work W with `ao3_work_id` 12345
- WHEN the FanFicFare epub of work 12345 is processed
- THEN it is replaced, held for review or marked duplicate under the normal versioning rules

### FanFicFare uploads respect opt-outs
- GIVEN an active opt-out for the FanFicFare work's pseud
- WHEN the FanFicFare epub is processed
- THEN it is rejected with `opted_out`
