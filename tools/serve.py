"""Локальный сервер разработки LifeTasks.

Запуск из корня проекта:  python tools/serve.py
Открывать:               http://localhost:8080/

Почему не `python -m http.server`: на Windows он берёт MIME-типы из реестра и иногда
отдаёт .js как text/plain — браузер тогда не загружает ES-модули. Здесь типы заданы явно,
а кэширование выключено, чтобы правки в коде были видны сразу после перезагрузки.
"""

import http.server
import os
import socket
import socketserver
import sys
import threading

PORT = 8080  # Строго 8080: именно этот адрес разрешён в Google Cloud (Authorized JavaScript origins).
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Короткий лог: только ошибки, чтобы не засорять консоль.
        if len(args) >= 2 and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("%s %s\n" % (args[1], args[0]))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


class Server6(Server):
    address_family = socket.AF_INET6

    def server_bind(self):
        # Только IPv6-loopback (::1), без двойного стека — чтобы не открывать порт в локальную сеть.
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def main():
    # Консоль Windows или перенаправленный вывод могут быть не в UTF-8 — русский текст не должен ронять сервер.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"Не удалось занять порт {PORT}: {e}")
        print("Скорее всего, сервер уже запущен в другом окне. Закрой его и запусти снова.")
        print("Другой порт не подойдёт: вход Google разрешён только для http://localhost:8080")
        sys.exit(1)
    # «localhost» браузер может сначала искать по IPv6 (::1). Слушаем и там, чтобы запросы не обрывались.
    httpd6 = None
    try:
        httpd6 = Server6(("::1", PORT), Handler)
        threading.Thread(target=httpd6.serve_forever, daemon=True).start()
    except OSError:
        pass  # IPv6 нет — хватит IPv4
    print(f"LifeTasks: http://localhost:{PORT}/   (тесты: http://localhost:{PORT}/tests/)")
    print("Остановить: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")


if __name__ == "__main__":
    main()
