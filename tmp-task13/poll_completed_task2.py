# Task #2: patient poller - wait for completed noobai jobs (created after restart) and download images
import time, sys
import requests, urllib3
urllib3.disable_warnings()

BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
HDR = {"Authorization": f"Bearer {TOKEN}"}
OUT = r"d:\infinite-canvas-main\tmp-task13"
# jobs created after the comfyui2api restart use the VAE-fixed workflows
CUTOFF = 1788229900  # ~2026-09-01 10:31 local

want = {"noobai-xl-lora.json": None, "noobai-xl-vpred.json": None}
deadline = time.time() + 75 * 60
seen_completed = set()

while time.time() < deadline and any(v is None for v in want.values()):
    try:
        q = requests.get(f"{BASE}/v1/queue", headers=HDR, timeout=30, verify=False).json()
    except Exception as e:
        print("queue poll error:", e, flush=True)
        time.sleep(60)
        continue
    counts = q.get("counts", {})
    items = q.get("items", [])
    running = [it for it in items if it.get("status") in ("running", "queued")]
    summary = f"counts={counts} | " + " | ".join(
        f"{it.get('job_id','')[:8]} {it.get('status')} {it.get('workflow')}" for it in running[:4])
    print(time.strftime("%H:%M:%S"), summary, flush=True)
    for it in items:
        wf = it.get("workflow")
        if wf not in want or want[wf] is not None:
            continue
        if it.get("status") != "completed":
            continue
        if int(it.get("created_at", 0)) < CUTOFF:
            continue
        if it.get("job_id") in seen_completed:
            continue
        outs = it.get("outputs") or []
        if not outs:
            print(f"[{wf}] completed but no outputs job={it.get('job_id')}", flush=True)
            seen_completed.add(it.get("job_id"))
            continue
        o = outs[0]
        url = o.get("url")
        fname = o.get("filename", "out.png")
        tag = wf.replace(".json", "").replace("noobai-xl-", "")
        local = f"{OUT}\\task2_validated_{tag}.png"
        try:
            img = requests.get(url, headers=HDR, timeout=300, verify=False)
            if img.status_code == 200 and len(img.content) > 10000:
                open(local, "wb").write(img.content)
                want[wf] = local
                print(f"SAVED [{wf}] job={it.get('job_id')} -> {local} ({len(img.content)} bytes)", flush=True)
            else:
                print(f"[{wf}] download bad status={img.status_code} len={len(img.content)}", flush=True)
                seen_completed.add(it.get("job_id"))
        except Exception as e:
            print(f"[{wf}] download error {e}", flush=True)
            seen_completed.add(it.get("job_id"))
    if any(v is None for v in want.values()):
        time.sleep(60)

print("RESULT:", want, flush=True)
print("ALL_DONE" if all(v is not None for v in want.values()) else "TIMEOUT", flush=True)
