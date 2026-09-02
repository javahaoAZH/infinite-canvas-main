# Task #2: queue snapshot with running job progress
import json
import requests, urllib3
urllib3.disable_warnings()
BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
HDR = {"Authorization": f"Bearer {TOKEN}"}
q = requests.get(f"{BASE}/v1/queue", headers=HDR, timeout=30, verify=False).json()
print("counts:", q.get("counts"))
for it in q.get("items", []):
    if it.get("status") in ("running", "pending", "queued"):
        p = it.get("progress") or {}
        print(f"- {it.get('job_id')[:8]} {it.get('status')} wf={it.get('workflow')} started={it.get('started_at_utc')} "
              f"node={it.get('current_node')} progress={p.get('value')}/{p.get('max')} ({it.get('progress_percent')}%)")
