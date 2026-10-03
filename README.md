# LifeTasks

A personal task planner: a serverless PWA. Tasks live in the browser (IndexedDB) and sync between devices through a single file in your own Google Drive when you press **Push**. Interface language: Russian.

Version 0.6: planning by calendar day, device/session cleanup, inline list editing, achievements for every list, achievement notifications, collectible pets, background worlds and decorations. Includes note attachments, reminders, coins/levels and analytics.

Live: https://so1ow4y.github.io/lifetasks/

## Run locally

Requirements: Python 3 and a modern browser (Chrome or Edge). No build step, no Node.

```
python tools/serve.py
```

Open http://localhost:8080. Tests: http://localhost:8080/tests/

Google sign-in works only on origins registered for the OAuth client (`http://localhost:8080` and the GitHub Pages URL). Opening `index.html` from disk (`file://`) will not work.

## Release and deploy

```
python tools/release.py 0.6.1
git push origin main
```

`release.py` writes the app version and regenerates the offline file list in `sw.js`. GitHub Pages serves the `main` branch root; open copies of the app will show an "Update available" banner.

## Documentation

Full documentation (in Russian) lives in the separate `docs` branch: specification, data format, architecture, roadmap, manual checklist, Google Cloud setup.

```
git switch docs
```

Third-party code: see `vendor/LICENSES.md`.
