# LifeTasks

A personal task planner: a serverless PWA. Tasks live in the browser (IndexedDB) and sync between devices through a single file in your own Google Drive when you press **Push**. No backend: every user signs in with their own Google account and the app works only with the files it created in that user's Drive. Interface language: Russian.

Live: https://so1ow4y.github.io/lifetasks/

## What's inside (version 0.8)

- **Tasks:** lists (a task can belong to several), nested subtasks, priorities, dates, deadlines, repeating tasks, reminders and nagging, notes with photos, video, files and voice notes, archive and trash, drag-and-drop everywhere.
- **Planning:** the "Today" screen with a week strip, up to three "main" tasks per day, calendar planning.
- **Sync:** one file in Google Drive (`drive.file` scope), field-level last-write-wins merge, conflict journal, backups, offline-first.
- **Game mode** (optional): coins for completed tasks by priority, a shop with your own rewards, levels, streaks and achievements, color schemes.
- **Skills (0.8):** every list is a skill with its own level 1–100; each completed task gives skill XP by priority (configurable). Each next level needs more XP. At level 100 you can raise the prestige, shown in Roman numerals (I, II, … like Payday 2).
- **Pixel village:** a full-screen top-down village behind the app that grows with your purchases (houses, mines, fields, lanterns, decor; free placement, move and sell right on the map), day and night, residents with their own behaviour. Each list has a keeper character who grows older with the skill level and prestige and becomes friendlier as you complete the list's tasks. Talk to residents in a visual-novel style dialog with large pixel-art anime portraits.
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
python tools/release.py 0.8.1
git push origin main
```

`release.py` writes the app version and regenerates the offline file list in `sw.js`. GitHub Pages serves the `main` branch root; open copies of the app will show an "Update available" banner.

## Data format

Data format v3 (JSON Schema: `schemas/v3/db.schema.json`). Newer versions only add optional fields, so older clients keep working and preserve unknown fields.

## Documentation

The full specification, data format description, architecture notes and checklists (in Russian) are kept in a private repository.

Third-party code: see `vendor/LICENSES.md`.
