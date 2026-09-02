# Task #2: poll jobs until done, download output images
import json, time, sys
import requests, urllib3
urllib3.disable_warnings()

BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
HDR = {"Authorization": f"Bearer {TOKEN}"}
OUT = r"d:\infinite-canvas-main\tmp-task13"

jobs = {
    "6d38bc3303af4d659969c3879fcc5ad7": "noobai-xl-lora",
    "be429e8b688b4d63afd66fa16a35a799": "noobai-xl-vpred",
}

done = set()
deadline = time.time() + 3600  # 1h max
while len(done) < len(jobs) and time.time() < deadline:
    for job_id, model in jobs.items():
        if job_id in done:
            continue
        try:
            r = requests.get(f"{BASE}/v1/jobs/{job_id}", headers=HDR, timeout=30, verify=False)
        except Exception as e:
            print(f"[{model}] poll error: {e}", flush=True)
            continue
        if r.status_code != 200:
            print(f"[{model}] GET job -> {r.status_code}: {r.text[:200]}", flush=True)
            continue
        j = r.json()
        # tolerate {job: {...}} or flat
        data = j.get("job") if isinstance(j, dict) and "job" in j else j
        status = data.get("status")
        prog = data.get("progress") or {}
        pct = data.get("progress_percent")
        print(f"[{model}] status={status} node={data.get('current_node')} progress={prog.get('value')}/{prog.get('max')} ({pct}%)", flush=True)
        if status == "completed":
            outs = data.get("outputs") or []
            if not outs:
                print(f"[{model}] completed but no outputs! full={json.dumps(data)[:800]}", flush=True)
            for i, o in enumerate(outs):
                url = o.get("url")
                fname = o.get("filename", f"out_{i}.png")
                local = f"{OUT}\\task2_{model}_{fname}"
                img = requests.get(url, headers=HDR, timeout=120, verify=False)
                open(local, "wb").write(img.content)
                print(f"[{model}] saved {local} ({len(img.content)} bytes, http {img.status_code})", flush=True)
            done.add(job_id)
        elif status in ("failed", "error", "cancelled"):
            print(f"[{model}] FAILED: {data.get('error')}", flush=True)
            done.add(job_id)
    if len(done) < len(jobs):
        time.sleep(30)
print("ALL DONE" if len(done) == len(jobs) else "TIMEOUT", flush=True)
