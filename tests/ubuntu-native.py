"""Exercise the installed release with real WebKitGTK and native IPC in Xvfb."""
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

out = Path(os.environ.get("LIGHTNING_QA_OUTPUT", "/out"))
fixture = "/build/tests/fixtures/reading-sample.pdf"
checks = []
driver_log = (out / "ubuntu-webkit-driver.log").open("w")
port = os.environ.get("LIGHTNING_QA_PORT", "4444")
driver = subprocess.Popen(["WebKitWebDriver", "--port="+port], stdout=driver_log, stderr=subprocess.STDOUT)
session = None


def request(method, route, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request("http://127.0.0.1:"+port + route, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            value = json.load(response)["value"]
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error
    if isinstance(value, dict) and "error" in value:
        raise RuntimeError(value)
    return value


def js(script, *args, asynchronous=False):
    return request("POST", f"/session/{session}/execute/{'async' if asynchronous else 'sync'}",
                   {"script": script, "args": list(args)})


def wait(script, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if js(script):
            return
        time.sleep(0.15)
    raise AssertionError("Timed out: " + script)


def check(name, condition=True):
    assert condition, name
    checks.append(name)
    print("PASS:", name, flush=True)


def ipc(command, args):
    result = js("const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));",
                command, args, asynchronous=True)
    assert "error" not in result, result
    return result["value"]


try:
    for attempt in range(50):
        try:
            request("GET", "/status")
            break
        except (OSError, RuntimeError):
            time.sleep(0.1)
    result = request("POST", "/session", {"capabilities": {"alwaysMatch": {
        "webkitgtk:browserOptions": {
            "binary": os.environ.get("LIGHTNING_QA_BINARY","/usr/bin/lightning"), "args": [fixture]}}}})
    session = result["sessionId"]
    wait("return document.querySelector('.pdf-page')?.dataset.page === '0' && document.querySelector('#pdf-viewport')?.getAttribute('aria-busy') === 'false'")
    check("installed package launches and renders the PDF passed on its command line")
    check("real PNG page is decoded", js("const p=document.querySelector('.pdf-page img')||document.querySelector('img.pdf-page'); return !!p && p.complete && p.naturalWidth>300"))
    if os.environ.get("LIGHTNING_QA_BINARY"):
        before=js("const r=document.querySelector('.pdf-page').getBoundingClientRect();return {x:r.x+80,y:r.y+100,width:r.width}")
        for phase,scale in [(0,1),(1,1.2),(1,1.5),(2,1.5)]:
            ipc("simulate_native_pinch", {"phase":phase,"scale":scale,"x":before["x"],"y":before["y"]})
        wait("return document.querySelector('#pdf-viewport').getAttribute('aria-busy')==='false'")
        width=js("return document.querySelector('.pdf-page').getBoundingClientRect().width")
        check("real GTK touchpad pinch is intercepted and zooms the PDF instead of the WebView", abs(width/before["width"]-1.5)<0.02)
        check("GTK pinch leaves UI and browser scale unchanged",js("return window.visualViewport.scale === 1 && document.querySelector('.titlebar').getBoundingClientRect().height === 40"))
    js("document.querySelector('#next-btn').click()")
    wait("return document.querySelector('.pdf-page')?.dataset.page === '1' && !document.querySelector('.pdf-page[data-moving]')")
    check("next page renders using the installed PDFium resource")
    js("document.querySelector('.document-outline-toggle').click()")
    wait("return document.querySelectorAll('#outline.open .outline-item').length === 2")
    check("native PDF bookmarks appear in the attached directory")
    js("document.querySelector('#outline-close').click();document.querySelector('#reading-mode').click()")
    wait("return !!document.querySelector('.paper-pile-after img')")
    check("paper stack previews render in WebKitGTK")
    info = ipc("open_pdf", {"path": fixture})
    region = {"tabId": info["tabId"], "pageIndex": 0, "x": 0, "y": 0, "width": 1, "height": 0.4, "mode": "png"}
    png = ipc("capture_region", {"region": region})
    check("native region capture returns a PNG", png["dataUrl"].startswith("data:image/png;base64,"))
    region["mode"] = "ocr"
    text = ipc("capture_region", {"region": region})["text"]
    check("offline Tesseract reads the PDF through real IPC", "room" in text.lower())
    ipc("close_pdf", {"tabId": info["tabId"]})
    (out / "ubuntu-native.png").write_bytes(base64.b64decode(request("GET", f"/session/{session}/screenshot")))
    js("document.querySelector('#menu-toggle').click()")
    # The settings window must work in the release WebKit, including custom options.
    js("document.querySelector('#appearance-btn').click()")
    wait("return !!document.querySelector('dialog[open] .themed-select-button')")
    check("rounded theme settings open in the Linux release")
    js("document.querySelector('dialog[open] .themed-select-button').click()")
    wait("return !!document.querySelector('.themed-options:popover-open, .themed-options.options-open')")
    check("custom option popover opens without a native select menu")
    (out / "ubuntu-native-theme.png").write_bytes(base64.b64decode(request("GET", f"/session/{session}/screenshot")))
finally:
    if session:
        try:
            request("DELETE", f"/session/{session}")
        except Exception:
            pass
    driver.terminate()
    driver.wait(timeout=10)
    driver_log.close()
    (out / "ubuntu-native-results.json").write_text(json.dumps({"checks": checks}, ensure_ascii=False, indent=2))
