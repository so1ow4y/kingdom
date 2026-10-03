"""Подготовка релиза LifeTasks (docs/ARCHITECTURE.md §8.3).

  python tools/release.py            — следующая patch-версия (0.1.0 → 0.1.1)
  python tools/release.py 0.2.0      — конкретная версия
  python tools/release.py --refresh  — только пересобрать список файлов в sw.js, версию не менять

Что делает:
  1. пишет APP_VERSION в src/version.js;
  2. собирает список файлов оболочки и вписывает VERSION и PRECACHE в sw.js между маркерами;
  3. если вырос SCHEMA_VERSION — проверяет, что есть миграция, образец, схема и раздел в DATA_FORMAT.md.
Изменение sw.js заставляет браузеры увидеть новую версию и показать «Доступно обновление».
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_JS = os.path.join(ROOT, "src", "version.js")
SW_JS = os.path.join(ROOT, "sw.js")
LAST = os.path.join(ROOT, "tools", ".last-release.json")

SHELL_FILES = ["index.html", "manifest.webmanifest"]
SHELL_DIRS = ["src", "styles", "vendor", "icons"]
SKIP_EXT = {".md", ".map"}


def fail(msg):
    print("Ошибка: " + msg)
    sys.exit(1)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def parse_semver(v):
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v)
    if not m:
        fail(f"версия должна быть вида 1.2.3, получено «{v}»")
    return tuple(int(x) for x in m.groups())


def current_versions():
    text = read(VERSION_JS)
    app = re.search(r"APP_VERSION\s*=\s*'([^']+)'", text)
    schema = re.search(r"SCHEMA_VERSION\s*=\s*(\d+)", text)
    if not app or not schema:
        fail("не нашёл APP_VERSION / SCHEMA_VERSION в src/version.js")
    return app.group(1), int(schema.group(1))


def collect_files():
    files = ["./"]
    for f in SHELL_FILES:
        if os.path.exists(os.path.join(ROOT, f)):
            files.append("./" + f)
    for d in SHELL_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, _dirs, names in os.walk(base):
            for name in sorted(names):
                if os.path.splitext(name)[1].lower() in SKIP_EXT or name.startswith("."):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")
                files.append("./" + rel)
    return sorted(set(files), key=lambda x: (x != "./", x))


def check_schema(schema, last_schema):
    if last_schema is None or schema <= last_schema:
        return
    for v in range(last_schema + 1, schema + 1):
        need = [
            f"src/data/migrations/m{v - 1:03d}_to_{v:03d}.js",
            f"samples/v{v}/db.json",
            f"schemas/v{v}/db.schema.json",
        ]
        missing = [p for p in need if not os.path.exists(os.path.join(ROOT, p))]
        if missing:
            fail("SCHEMA_VERSION вырос до %d, но нет файлов: %s" % (v, ", ".join(missing)))
        # Документация живёт в ветке docs; если она рядом (docs/ или ../lifetasks-docs/), проверяем журнал формата.
        doc = next((p for p in (os.path.join(ROOT, "docs", "DATA_FORMAT.md"),
                                os.path.join(os.path.dirname(ROOT), "lifetasks-docs", "DATA_FORMAT.md")) if os.path.exists(p)), None)
        if doc is None:
            print(f"Напоминание: в DATA_FORMAT.md (ветка docs) должна быть строка журнала формата для v{v} (§8.5).")
        elif not re.search(rf"\| {v} \|", read(doc)):
            fail(f"в {doc} нет строки журнала изменений формата для v{v} (§8.5)")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    app, schema = current_versions()
    refresh = "--refresh" in args
    args = [a for a in args if a != "--refresh"]

    if refresh:
        new = app
    elif args:
        new = args[0]
        if parse_semver(new) <= parse_semver(app):
            fail(f"новая версия {new} должна быть больше текущей {app}")
    else:
        a, b, c = parse_semver(app)
        new = f"{a}.{b}.{c + 1}"

    last = json.loads(read(LAST)) if os.path.exists(LAST) else {}
    if not refresh:
        check_schema(schema, last.get("schemaVersion"))

    text = read(VERSION_JS)
    text = re.sub(r"APP_VERSION\s*=\s*'[^']+'", f"APP_VERSION = '{new}'", text)
    write(VERSION_JS, text)

    files = collect_files()
    block = "// <generated>\nconst VERSION = '%s';\nconst PRECACHE = [\n%s\n];\n// </generated>" % (
        new, "\n".join("  '%s'," % f for f in files))
    sw = read(SW_JS)
    if "// <generated>" not in sw or "// </generated>" not in sw:
        fail("в sw.js нет маркеров // <generated> … // </generated>")
    sw = re.sub(r"// <generated>.*?// </generated>", lambda _m: block, sw, flags=re.S)
    write(SW_JS, sw)

    if not refresh:
        write(LAST, json.dumps({"appVersion": new, "schemaVersion": schema}, ensure_ascii=False, indent=2) + "\n")

    print(f"Версия: {new} (формат данных v{schema}), файлов в кэше: {len(files)}")
    if not refresh:
        print("Открытые вкладки приложения покажут «Доступно обновление» (или нажми «Проверить обновление» в настройках).")


if __name__ == "__main__":
    main()
