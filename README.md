# Home Organiser

Local-only PWA for organising where things live across the house. No backend,
no accounts, no sync, no network calls after first load. All data stays in the
browser on the device.

Static site — deploy by pushing to GitHub Pages. Works from a subpath
(`/home-organiser/`); every URL in the app is relative.

```bash
npm test
```

```bash
npm run serve
```

## The design constraints that shaped this

**No relational engine.** IndexedDB will happily store an Item pointing at a
deleted Location, so referential integrity is application code. The two
relationships get deliberately opposite policies, decided by whether the
reference is required:

- `locationId` is required, so deleting a Location that still holds anything
  is **refused** (`ON DELETE RESTRICT`, by hand).
- `categoryId` is nullable, so deleting a Category **clears it** on affected
  items and costs them nothing else (`ON DELETE SET NULL`, by hand).

**Cycles are ours to catch.** Locations self-reference through `parentId`, and
a self-referencing foreign key permits A → B → A in Postgres too. A cycle in
the browse tree is an infinite loop rather than a wrong answer, so it is
rejected on save and repaired on import.

**Export is the only backup.** With no server, a cleared browser store is
unrecoverable, so import ships alongside the schema rather than later. Import
replaces everything, so it auto-exports the current state first and shows both
sides before it does. Structural problems reject the file; referential ones
are repaired and reported.

**Dates are strings, never `Date` objects.** `'YYYY-MM-DD'` sorts correctly,
survives JSON round-trips unchanged, and never drifts a day through a timezone
conversion. `todayISO()` is built from local calendar components for the same
reason — `toISOString()` converts to UTC first and returns yesterday for the
first ten hours of every day in Australia.

**Photos are re-encoded, not stored as captured.** Capped at 1600px and
re-encoded as JPEG: a phone photo is 3–6MB and base64 adds a third again on
export. Stripping EXIF is a side benefit worth having on its own — a photo
taken in the house carries the house's GPS coordinates, and an export is a
file you might hand to someone.

**No innerHTML anywhere.** Views are built with a small `el()` helper, so text
can only reach the DOM through `createTextNode`. Escaping is structural rather
than a rule to remember, which matters because item names and notes are free
text and can also arrive from an imported file.

**Precaching is checked by a test.** The service worker's asset list is
hand-written, and a file that is imported but unlisted works perfectly online
and 404s only offline — a bug normal testing never sees.

## Not in scope

No server, API, hosted database or cross-device sync. No accounts. No push
notifications or background reminders — without a server there is no reliable
way to deliver them. No barcode scanning, receipts or valuation fields; that
is an insurance/asset inventory, a different app. Tips content is static and
shipped with the app.
