"""Достаёт JSON Schema из docs/DATA_FORMAT.md (§10.1–10.3) в schemas/v<N>/*.schema.json.

  python tools/extract_schemas.py        — записать файлы
  python tools/extract_schemas.py --check — только проверить, что файлы совпадают с документом (код выхода 1, если нет)

Источник истины — документ: правишь схему в DATA_FORMAT.md, затем запускаешь этот скрипт.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs", "DATA_FORMAT.md")
SECTIONS = {"10.1": "manifest.schema.json", "10.2": "db.schema.json", "10.3": "export.schema.json"}


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    check = "--check" in sys.argv
    with open(DOC, encoding="utf-8") as f:
        text = f.read()
    version = re.search(r"schemaVersion = (\d+)", text)
    out_dir = os.path.join(ROOT, "schemas", "v" + (version.group(1) if version else "1"))
    os.makedirs(out_dir, exist_ok=True)
    ok = True
    for sec, name in SECTIONS.items():
        m = re.search(r"### " + re.escape(sec) + r"\b.*?```json\n(.*?)\n```", text, re.S)
        if not m:
            print(f"Ошибка: в DATA_FORMAT.md нет блока ```json в разделе {sec}")
            sys.exit(1)
        schema = json.loads(m.group(1))
        body = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
        path = os.path.join(out_dir, name)
        if check:
            same = os.path.exists(path) and open(path, encoding="utf-8").read() == body
            print(("совпадает: " if same else "РАСХОДИТСЯ: ") + os.path.relpath(path, ROOT))
            ok = ok and same
        else:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(body)
            print("записан: " + os.path.relpath(path, ROOT))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
