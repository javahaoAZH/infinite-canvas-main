# Task #2: check running video job progress (estimate wait)
import requests, urllib3
urllib3.disable_warnings()
BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
HDR = {"Authorization": f"Bearer {TOKEN}"}
r = requests.get(f"{BASE}/v1/jobs/32702b8045534cdd823cb0b25a9d5155", headers=HDR, timeout=30, verify=False)
j = r.json()
print("status:", j.get("status"), "progress:", j.get("progress"), "pct:", j.get("progress_percent"), "node:", j.get("current_node"))
print("started:", j.get("started_at_utc"))
