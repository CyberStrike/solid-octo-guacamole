# Scenario: Rating and warnings interstitial

Relates to: docs/ARCHITECTURE.md § Reading; docs/FRONTEND-DISCOVERY.md § Key journeys (1, step 5), § Page inventory (Warnings screen), § Accessibility and devices

## Setup
- Live works:
  - M rated Mature, no archive warnings
  - E rated Explicit, no archive warnings
  - V rated Teen And Up with archive warning "Graphic Depictions Of Violence"
  - C rated Teen And Up marked "Choose Not To Use Archive Warnings"
  - G rated General Audiences with no archive warnings
- A signed-out reader and a signed-in reader

## Cases

### Mature work shows the interstitial before chapter 1
- GIVEN live work M
- WHEN a reader goes to read chapter 1
- THEN they first see the warnings screen showing the rating "Mature"

### Explicit work shows the interstitial
- GIVEN live work E
- WHEN a reader goes to read chapter 1
- THEN they first see the warnings screen showing the rating "Explicit"

### Work with archive warnings shows the interstitial
- GIVEN live work V
- WHEN a reader goes to read chapter 1
- THEN they first see the warnings screen listing "Graphic Depictions Of Violence"

### Choose Not To Use Archive Warnings shows the interstitial
- GIVEN live work C
- WHEN a reader goes to read chapter 1
- THEN they first see the warnings screen showing "Choose Not To Use Archive Warnings"

### Unwarned general work skips the interstitial
- GIVEN live work G
- WHEN a reader goes to read chapter 1
- THEN chapter 1 opens directly with no warnings screen

### Continue goes to the chapter
- GIVEN a reader on `/works/:id/warnings` for work M
- WHEN they follow "Continue"
- THEN chapter 1 of M opens

### Warnings screen is a full page, not a modal
- GIVEN a reader with JavaScript off
- WHEN they open `/works/:id/warnings` for work V
- THEN it renders as its own full page with a working Continue link and needs no focus trapping

### Signed-out readers get no turn-off option
- GIVEN a signed-out reader
- WHEN they open the warnings screen for work M
- THEN no turn-off checkbox is shown

### Signed-in readers can turn the screen off
- GIVEN a signed-in reader on the warnings screen for work M
- WHEN they tick the turn-off checkbox and continue
- THEN later works rated Mature or Explicit or carrying warnings open chapter 1 without the warnings screen for that reader

### Signed-in readers can turn it off from settings
- GIVEN a signed-in reader on `/settings/reader`
- WHEN they turn off the warnings screen
- THEN chapter 1 of work E opens without the warnings screen for that reader
