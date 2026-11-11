"""Build-only loopback cache. HTTPS to fixed official artifact repositories."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import subprocess
import threading
import urllib.parse
import os

root = Path(__file__).resolve().parents[2] / "test-results" / "android-artifact-cache"
origins = {"google": "https://dl.google.com/dl/android/maven2/", "central": "https://repo.maven.apache.org/maven2/", "plugins": "https://plugins.gradle.org/m2/", "gradle": "https://downloads.gradle.org/distributions/"}
locks = {}
guard = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_HEAD(self): self.serve(False)
    def do_GET(self): self.serve(True)
    def serve(self, body):
        path = urllib.parse.urlsplit(self.path).path.lstrip("/")
        parts = path.split("/")
        if len(parts)<2 or parts[0] not in origins or any(p in ("", ".", "..") for p in parts):
            self.send_error(400); return
        target = root.joinpath(*parts)
        with guard: lock=locks.setdefault(path, threading.Lock())
        with lock:
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary=target.with_name(target.name+".download")
                url=origins[parts[0]]+"/".join(parts[1:])
                arguments=["curl","-4","-fLsS","--connect-timeout","15","--max-time","180","--speed-time","20","--speed-limit","10000",url,"-o",str(temporary)]
                result=subprocess.run(arguments,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if result.returncode and parts[0]=="gradle" and path.endswith(".zip"):
                    arguments[-3]="https://mirrors.huaweicloud.com/gradle/"+parts[-1]
                    result=subprocess.run(arguments,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if result.returncode:
                    temporary.unlink(missing_ok=True); self.send_error(404); return
                os.replace(temporary,target)
        self.send_response(200); self.send_header("Content-Length",str(target.stat().st_size));self.end_headers()
        if body:
            with target.open("rb") as stream:
                while chunk:=stream.read(1024*1024): self.wfile.write(chunk)
    def do_POST(self):
        if self.path!="/stop":self.send_error(404);return
        self.send_response(200);self.end_headers();threading.Thread(target=self.server.shutdown,daemon=True).start()

print("Build artifact cache listening on 127.0.0.1:19272",flush=True)
server=ThreadingHTTPServer(("127.0.0.1",19272),Handler)
try:server.serve_forever()
finally:server.server_close()
