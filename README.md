# Kingdom

Two apps in one serverless PWA: **Chronicle** — a personal task planner (formerly LifeTasks), and **Crimson Harvest** — food and calories in the spirit of FatSecret (called Feast in 0.11). Data lives in the browser (IndexedDB) and syncs between devices through files in your own Google Drive when you press **Push**: everything in one `Kingdom` folder, with `Chronicle` (tasks) and `Crimson Harvest` (food diary) inside. No backend: every user signs in with their own Google account and the app works only with the files it created in that user's Drive. Interface language: Russian.

Live: https://so1ow4y.github.io/lifetasks/

## What's inside (version 0.12)

- **Meals, timed multi-food entries and food rewards (0.12):** your own meals next to breakfast, lunch, dinner and snack — for every day or for one day only, inserted between the main ones; every meal can be renamed, reordered, hidden and given a time, and has its own page like a task list (entries by day, frequent foods, settings) that opens in a new tab. A diary entry can hold several foods, has its own time (now by default, editable) and a note; a meal can have a note for the day. Each food gives XP, coins and diamonds 💎 per entry (small by default: 1 XP, 0.2 coins, 0.05 💎; fractions add up) — the same coins and gems as in the village and shop, which are now reachable from Crimson Harvest too. The recommended calorie limit is adjustable (deficit, surplus, floor or your own number); protein, fat and carbs are set as percentages of the limit (grams follow it) or as grams that can't add up to more than the limit. A "Calculate" button fills the limit and the macros from your profile (sex, age, height, weight, activity, goal); every activity level shows how many calories it adds per day, and you can add your own activities. The profile and the goals are the same in Settings and on the "About me" page.
- **Kingdom folder (0.12):** both apps keep their folders inside one `Kingdom` folder in Google Drive; the old folders are renamed (`LifeTasks` → `Chronicle`, `Feast` → `Crimson Harvest`) and can be moved in by hand — they are found anywhere.
- **Two apps, one switch (0.11):** hide the dock with its letter and the other app's letter pops out next to it — tap it to switch between Chronicle (C) and Crimson Harvest (CH). Each app has its own dock, color scheme, theme and letter; the village, Google sign-in and keyboard shortcuts are shared.
- **Crimson Harvest — food and calories (0.11):** a food diary by days and meals with a daily calorie limit shown FatSecret-style ("247 left" or "−247" when over); your own food database with calories, protein, fat, carbs, vitamins and minerals (all zero by default), several barcodes per product, a product table with `field:value` search; barcode scanning with the camera (built-in BarcodeDetector or the app's own EAN-13/EAN-8/UPC-A decoder), manual entry or a photo; quick calorie-only entries, copy yesterday; a diary entry limit that removes old days but keeps their totals in the statistics; analytics (calories by day against the limit, macros, vitamins and minerals vs daily values, top foods) and an "About me" page with weight tracking, BMI, body fat estimate (measured, U.S. Navy tape method or BMI-based), recommended calories and a pixel figure of how that body fat roughly looks.
- **Tasks:** lists (a task can belong to several), nested subtasks, priorities, dates, deadlines, reminders and nagging, notes with photos, video, files and voice notes, archive and trash, drag-and-drop everywhere.
- **Repeating tasks (0.9):** every day, every N days, on chosen weekdays or once a month; checking one off closes only the current occurrence, missed ones don't pile up. All repeating tasks are also listed in a separate Inbox tab where they can be skipped or deleted.
- **Navigation dock (0.10):** a floating Ubuntu-style dock on any screen edge: collapsed icons with tooltips, expanded rows with group titles, or tiles on the top/bottom edge; branches open in place or as a drop-down menu; auto-hide, "hide completely" (only the app letter stays) and a sheet with everything on phones. Village, analytics and the shop live under one "Progress" item with tabs, done tasks and the trash under "Archive & trash".
- **Task explorer (0.10):** search all tasks, done tasks and the trash with `field:value` queries (AND, OR, NOT, brackets, quotes, `*`), a time range, a histogram, top values per field (click to include or exclude), column filters, expandable rows and bulk actions on selected tasks (complete, reopen, move, set priority, trash, restore, delete) with a "what worked and why not" summary and undo.
- **Settings and shortcuts (0.10):** settings as a searchable tree of sections; keyboard shortcuts for common actions (new task, search, push, go to screens, dock, task card), each can be reassigned or turned off, `?` shows them all.
- **Planning:** the "Today" screen with a week strip, up to three "main" tasks per day, calendar planning.
- **Sync:** one file in Google Drive (`drive.file` scope), field-level last-write-wins merge, conflict journal, backups, offline-first.
- **Game mode** (optional): coins for completed tasks by priority, a shop with your own rewards, levels, streaks and achievements, color schemes.
- **Skills (0.8):** every list is a skill with its own level 1–100; each completed task gives skill XP by priority (configurable). Each next level needs more XP. At level 100 you can raise the prestige, shown in Roman numerals (I, II, … like Payday 2).
- **Pixel village:** a full-screen top-down village behind the app that grows with your purchases (houses, mines, fields, lanterns, decor; free placement, move and sell right on the map), day and night, residents with their own behaviour. Each list has a keeper character who grows older with the skill level and prestige and becomes friendlier as you complete the list's tasks; keepers with unfinished tasks show "!" and knock on the screen. Talk to residents in a visual-novel style dialog with large pixel-art anime portraits, pick them up and drop them with a "hand", wake up a house by tapping it. Residents fish, draw water from the well, water the garden, pet the cat and gather mushrooms in the forest.
- **Focus sessions:** a Forest-like timer for a task or your own activity, pause and resume, focus time saved in the task, gems for focus.
- **Analytics:** heatmap, by lists and priorities, streaks.

## Run locally

Requirements: Python 3 and a modern browser (Chrome or Edge). No build step, no Node.

```
python tools/serve.py
```

Open http://localhost:8080. Tests: http://localhost:8080/tests/

Google sign-in works only on origins registered for the OAuth client (`http://localhost:8080` and the GitHub Pages URL). Opening `index.html` from disk (`file://`) will not work. The "Пока без входа" (no sign-in) mode works fully offline in the browser.

## Release and deploy

```
python tools/release.py 0.12.3
git push origin main
```

`release.py` writes the app version and regenerates the offline file list in `sw.js`. GitHub Pages serves the `main` branch root; open copies of the app will show an "Update available" banner.

## Data format

Tasks: data format v3 (JSON Schema: `schemas/v3/db.schema.json`). Newer versions only add optional fields, so older clients keep working and preserve unknown fields. Crimson Harvest: its own database file (`crimson-feast-db`, schema 2 since 0.12: meals, meal notes, multi-food entries) in the `Crimson Harvest` folder, merged with the same field-level rules; 0.11 clients open a schema-2 file read-only.

## Documentation

The full specification, data format description, architecture notes and checklists (in Russian) are kept in a private repository.

Third-party code: see `vendor/LICENSES.md`.
