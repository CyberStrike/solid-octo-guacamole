# Scenario: Export and shut down once the operator starts the wind-down

Relates to: docs/ARCHITECTURE.md § MVP vs later (Later: Export and shut down); docs/FRONTEND-DISCOVERY.md § Decisions so far (Original AO3 link), § Principles (4. Honest about being temporary)

## Setup
- AO3 is back online
- A live work W with `ao3_work_id` 12345
- The operator has started the wind-down by hand (shutdown mode is switched on), unless a case says otherwise

## Cases

### AO3 returning changes nothing until the operator starts the wind-down
- GIVEN AO3 is back and the operator has not started the wind-down
- WHEN a reader opens W's work page
- THEN the archive's page is served, not a redirect
- AND W's original AO3 link simply works again

### Work pages redirect to AO3
- GIVEN the operator has started the wind-down
- WHEN a reader opens W's work page
- THEN they are redirected to `https://archiveofourown.org/works/12345`

### Chapter pages redirect to AO3
- GIVEN the operator has started the wind-down
- WHEN a reader opens any chapter of W
- THEN they are redirected to W's AO3 URL
