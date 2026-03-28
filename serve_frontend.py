#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

class MyHTTPRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # If requesting root or a directory, serve index.html
        if self.path == '/' or self.path.endswith('/'):
            self.path = '/index.html'
        return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server_address = ('127.0.0.1', 8000)
    httpd = HTTPServer(server_address, MyHTTPRequestHandler)
    print(f"Frontend server running at http://127.0.0.1:8000")
    print("Press CTRL+C to stop")
    httpd.serve_forever()
