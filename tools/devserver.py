# Lokale testserver zonder cache (alleen voor ontwikkelen).
import http.server, socketserver, sys, os
os.chdir(sys.argv[2] if len(sys.argv) > 2 else '.')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def log_message(self, *a):
        pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', int(sys.argv[1])), H) as s:
    s.serve_forever()
