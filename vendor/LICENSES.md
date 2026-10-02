# Сторонние библиотеки

Все библиотеки лежат в проекте, чтобы приложение работало офлайн и не делало сторонних запросов.
Обновление: скачать новый файл, положить вместо старого, поправить версию здесь, `python tools/release.py`.

| Файл | Библиотека | Версия | Источник | Лицензия |
|---|---|---|---|---|
| `htm-preact-standalone.mjs` | htm + Preact (сборка `htm/preact/standalone`) | htm 3.1.1 (Preact 10) | https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js | htm — Apache-2.0; Preact — MIT |

Алгоритм дробных индексов в `src/core/order.js` переписан по мотивам библиотеки
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) (CC0).
