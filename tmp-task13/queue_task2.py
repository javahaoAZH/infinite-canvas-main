# Task #2: inspect queue (running + pending items)
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
        req = it.get("request_json") or {}
        print(f"- job={it['job_id']} status={it['status']} kind={it.get('kind')} wf={it.get('workflow')} "
              f"model={it.get('requested_model')} size={it.get('size')} created={it.get('created_at_utc')} "
              f"prompt={(req.get('prompt') or '')[:30]}")
