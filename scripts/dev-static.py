# Servidor estatico para testar a pasta docs/ (GitHub Pages) localmente, sem cache no navegador.
# Uso: python scripts/dev-static.py [porta] [pasta]   (padrao: 8090, raiz do repositorio)
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.webp': 'image/webp', '.glb': 'model/gltf-binary'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
root = sys.argv[2] if len(sys.argv) > 2 else '.'
ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=root)).serve_forever()
