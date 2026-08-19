"""Dev server for FREEWHEEL. Sends no-store on everything.

python -m http.server happily lets Chrome cache ES modules, which produces the
worst class of bug available: a fresh config paired with a stale module, so the
code you are reading is not the code that is running.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

# Serve this directory, not whatever the launcher's cwd happens to be.
os.chdir(os.path.dirname(os.path.abspath(__file__)))

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5812
print('FREEWHEEL on http://localhost:%d' % port, flush=True)
ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
