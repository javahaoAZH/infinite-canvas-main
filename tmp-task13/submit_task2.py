# Task #2: submit test generations via /v1/images/generations, print response shape
import json, sys
import requests, urllib3
urllib3.disable_warnings()

BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
PROMPT = "二十五岁左右的青年男子，黑色短发微乱，眼下带青黑眼袋，面色苍白疲惫，穿灰色连帽卫衣，赛璐璐画风，清晰封闭描边，大色块平涂"
HDR = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

models = sys.argv[1:] or ["noobai-xl-lora", "noobai-xl-vpred"]
for model in models:
    body = {"model": model, "prompt": PROMPT, "size": "1024x1536"}
    print(f"--- submitting {model} ---")
    try:
        r = requests.post(f"{BASE}/v1/images/generations", headers=HDR, json=body, timeout=30, verify=False)
    except Exception as e:
        print("submit error:", e)
        continue
    print("status:", r.status_code)
    text = r.text
    # don't dump full b64 payloads
    print("body:", text[:600].replace("\\n", " "))
    open(rf"d:\infinite-canvas-main\tmp-task13\submit_resp_{model}.json", "w", encoding="utf-8").write(text)

# also probe queue
try:
    q = requests.get(f"{BASE}/v1/queue", headers=HDR, timeout=30, verify=False)
    print("--- /v1/queue ---", q.status_code)
    print(q.text[:1500])
except Exception as e:
    print("queue error:", e)
