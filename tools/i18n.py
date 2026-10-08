"""Переводы интерфейса Kingdom (обновление 0.12.5).

  python tools/i18n.py              — сколько строк без английского перевода (по файлам)
  python tools/i18n.py --list       — сами строки без перевода (ключи словаря)
  python tools/i18n.py --json FILE  — то же в JSON {"ключ": ""}: заполнить и добавить через --merge
  python tools/i18n.py --merge FILE — добавить переводы из JSON {"ключ": "перевод"} в src/core/i18n.en.js
                                     («∅» — пустой перевод: слово по-английски не нужно)
  python tools/i18n.py --unused     — ключи словаря, которых больше нет в коде

Строки интерфейса: статичный текст html-шаблонов (между тегами и значения атрибутов в кавычках — переводится сам,
ui/html.js), первый аргумент tr('…') и формы числа ['задача', 'задачи', 'задач'] (core/plural.js; в JSON — ключ
«#plural задача» и значение ["task", "tasks"]). Словарь — src/core/i18n.en.js: по строке на перевод, JSON-синтаксис.
"""

import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT = os.path.join(ROOT, 'src', 'core', 'i18n.en.js')
CYR = re.compile('[Ѐ-ӿ]')


class Scanner:
    """Строки с кириллицей в JS: 'lit' — '…' и "…", 'tlit' — `…` (не html), 'tpl' — статичные куски html`…`."""

    def __init__(self, text):
        self.s = text
        self.n = len(text)
        self.out = []

    def scan(self):
        self.code(0, None)
        return self.out

    def prev_sig(self, i):
        j = i - 1
        while j >= 0 and self.s[j] in ' \t\r\n':
            j -= 1
        return self.s[j] if j >= 0 else ''

    def prev_word(self, i):
        j = i - 1
        while j >= 0 and self.s[j] in ' \t\r\n':
            j -= 1
        k = j
        while k >= 0 and (self.s[k].isalnum() or self.s[k] in '_$'):
            k -= 1
        return self.s[k + 1:j + 1]

    def code(self, i, stop):
        s = self.s
        depth = 0
        while i < self.n:
            c = s[i]
            if stop and c == '}' and depth == 0:
                return i + 1
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            if c == '/' and i + 1 < self.n and s[i + 1] == '/':
                j = s.find('\n', i)
                i = self.n if j < 0 else j
                continue
            if c == '/' and i + 1 < self.n and s[i + 1] == '*':
                j = s.find('*/', i + 2)
                i = self.n if j < 0 else j + 2
                continue
            if c == '/':
                p = self.prev_sig(i)
                w = self.prev_word(i)
                if p in '(,=:[!&|?{};+-*%<>~^' or p == '' or w in ('return', 'typeof', 'case', 'of', 'in'):
                    i = self.regex(i)
                    continue
            if c in '\'"':
                i = self.string(i, c)
                continue
            if c == '`':
                i = self.template(i, self.prev_word(i) == 'html')
                continue
            i += 1
        return i

    def regex(self, i):
        s = self.s
        j = i + 1
        cls = False
        while j < self.n:
            c = s[j]
            if c == '\\':
                j += 2
                continue
            if c == '[':
                cls = True
            elif c == ']':
                cls = False
            elif c == '/' and not cls:
                j += 1
                while j < self.n and s[j].isalpha():
                    j += 1
                return j
            elif c == '\n':
                return i + 1
            j += 1
        return j

    def string(self, i, q):
        s = self.s
        j = i + 1
        while j < self.n and s[j] != q:
            if s[j] == '\\':
                j += 1
            j += 1
        body = s[i + 1:j]
        if CYR.search(body):
            self.out.append({'kind': 'lit', 'start': i, 'end': j + 1, 'text': body})
        return j + 1

    def template(self, i, is_html):
        s = self.s
        j = i + 1
        parts = []
        cur = j
        while j < self.n:
            c = s[j]
            if c == '\\':
                j += 2
                continue
            if c == '`':
                parts.append((cur, j))
                break
            if c == '$' and j + 1 < self.n and s[j + 1] == '{':
                parts.append((cur, j))
                j = self.code(j + 2, '}')
                cur = j
                continue
            j += 1
        if is_html:
            self.html_parts(parts)
        elif CYR.search(''.join(s[a:b] for a, b in parts)):
            self.out.append({'kind': 'tlit', 'start': i, 'end': j + 1})
        return j + 1

    def html_parts(self, parts):
        """Тексты между тегами и значения атрибутов (состояние «в теге / в кавычках» переходит через ${…})."""
        s = self.s
        in_tag = False
        quote = None
        for a, b in parts:
            run = None
            k = a
            while k < b:
                c = s[k]
                if quote:
                    if c == quote:
                        if run is not None:
                            self.add_run(run, k)
                            run = None
                        quote = None
                    elif run is None:
                        run = k
                elif in_tag:
                    if c in '"\'':
                        quote = c
                    elif c == '>':
                        in_tag = False
                else:
                    if c == '<':
                        if run is not None:
                            self.add_run(run, k)
                            run = None
                        in_tag = True
                    elif run is None:
                        run = k
                k += 1
            if run is not None:
                self.add_run(run, b)

    def add_run(self, a, b):
        body = self.s[a:b]
        if CYR.search(body):
            self.out.append({'kind': 'tpl', 'start': a, 'end': b, 'text': body})


def norm(t):
    return re.sub(r'\s+', ' ', t).strip()


TR_CALL = re.compile(r"\btr\(\s*'((?:[^'\\]|\\.)*)'")
FORMS = re.compile(r"\[\s*'([^']*[Ѐ-ӿ][^']*)',\s*'([^']*)',\s*'([^']*)'\s*\]")


def unescape(s):
    return re.sub(r'\\(.)', lambda m: {'n': '\n', 't': '\t'}.get(m.group(1), m.group(1)), s)


def collect():
    """{ключ: [файлы]}, {первая форма: (формы, [файлы])}."""
    keys = {}
    plurals = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'src', '**', '*.js'), recursive=True)):
        if f.endswith('i18n.en.js'):
            continue
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        s = open(f, encoding='utf-8').read()
        for t in Scanner(s).scan():
            if t['kind'] == 'tpl':
                k = norm(t['text'])
                if k:
                    keys.setdefault(k, []).append(rel)
        for m in TR_CALL.finditer(s):
            k = unescape(m.group(1))
            if CYR.search(k):
                keys.setdefault(k, []).append(rel)
        for m in FORMS.finditer(s):
            if re.search(r'(columns|facets)\s*:\s*$', s[max(0, m.start() - 20):m.start()]):
                continue  # колонки и фасеты таблиц — не формы числа
            plurals.setdefault(m.group(1), ([m.group(1), m.group(2), m.group(3)], []))[1].append(rel)
    return keys, plurals


LINE = re.compile(r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*(.+?),?\s*$')


def load_dict():
    text = open(DICT, encoding='utf-8').read()
    plur_part = text.split('export const PLURALS = {', 1)[1].split('\n};', 1)[0]
    main_part = text.split('export default {', 1)[1].rsplit('\n};', 1)[0]

    def parse(part):
        out = {}
        for line in part.split('\n'):
            m = LINE.match(line)
            if m:
                out[json.loads(m.group(1))] = json.loads(m.group(2))
        return out

    return parse(main_part), parse(plur_part)


def save_dict(main_d, plur_d):
    head = open(DICT, encoding='utf-8').read().split('export const PLURALS = {', 1)[0].rstrip()
    lines = [head, '', 'export const PLURALS = {']
    lines += [f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},' for k, v in plur_d.items()]
    lines += ['};', '', 'export default {']
    lines += [f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},' for k, v in main_d.items()]
    lines += ['};', '']
    with open(DICT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))


def main():
    args = sys.argv[1:]
    keys, plurals = collect()
    main_d, plur_d = load_dict()
    if '--merge' in args:
        src = json.load(open(args[args.index('--merge') + 1], encoding='utf-8'))
        added = 0
        for k, v in src.items():
            if not v:
                continue
            if v == '∅':
                v = ''  # пустой перевод (слово по-английски не нужно)
            if k.startswith('#plural '):
                first = k[len('#plural '):].split(' | ')[0]
                if plur_d.get(first) != v:
                    plur_d[first] = v
                    added += 1
            elif main_d.get(k) != v:
                main_d[k] = v
                added += 1
        save_dict(main_d, plur_d)
        print(f'Добавлено переводов: {added}')
        return
    miss = {k: f for k, f in keys.items() if k not in main_d and norm(k) not in main_d}
    pmiss = {k: v for k, v in plurals.items() if k not in plur_d}
    if '--unused' in args:
        for k in main_d:
            if k not in keys:
                print(k)
        return
    if '--json' in args:
        out = {k: '' for k in miss}
        out.update({'#plural ' + ' | '.join(v[0]): [] for k, v in pmiss.items()})
        with open(args[args.index('--json') + 1], 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f'Без перевода: {len(miss)} строк, {len(pmiss)} форм числа')
        return
    if '--list' in args:
        for k, f in miss.items():
            print(f'{k}    [{f[0]}]')
        for k, (forms, f) in pmiss.items():
            print(f'#plural {" | ".join(forms)}    [{f[0]}]')
        return
    by = {}
    for k, f in miss.items():
        by[f[0]] = by.get(f[0], 0) + 1
    for f, n in sorted(by.items()):
        print(f'{f}: {n}')
    print(f'Всего строк: {len(keys)}, без перевода: {len(miss)}; форм числа: {len(plurals)}, без перевода: {len(pmiss)}')
    if miss or pmiss:
        sys.exit(1)


if __name__ == '__main__':
    main()
