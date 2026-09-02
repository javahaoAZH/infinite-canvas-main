# Task #2: resubmit both noobai test generations (blocking), save images locally
import base64, json, sys, time
import requests, urllib3
urllib3.disable_warnings()

BASE = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"
PROMPT = "二十五岁左右的青年男子，黑色短发微乱，眼下带青黑眼袋，面色苍白疲惫，穿灰色连帽卫衣，赛璐璐画风，清晰封闭描边，大色块平涂"
HDR = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
OUT = r"d:\infinite-canvas-main\tmp-task13"

models = sys.argv[1:] or ["noobai-xl-lora", "noobai-xl-vpred"]
for model in models:
    body = {"model": model, "prompt": PROMPT, "size": "1024x1536", "response_format": "b64_json"}
    print(f"=== {model}: submitting (blocking) ===", flush=True)
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}/v1/images/generations", headers=HDR, json=body, timeout=900, verify=False)
    except Exception as e:
        print(f"{model}: ERROR {e}", flush=True)
        continue
    print(f"{model}: status={r.status_code} elapsed={time.time()-t0:.0f}s", flush=True)
    if r.status_code != 200:
        print(f"{model}: body={r.text[:500]}", flush=True)
        continue
    payload = r.json()
    saved = 0
    for i, item in enumerate(payload.get("data", [])):
        path = f"{OUT}\\task2_final_{model}_{i}.png"
        if item.get("b64_json"):
            open(path, "wb").write(base64.b64decode(item["b64_json"]))
            saved += 1
        elif item.get("url"):
            img = requests.get(item["url"], headers={"Authorization": f"Bearer {TOKEN}"}, timeout=300, verify=False)
            open(path, "wb").write(img.content)
            saved += 1
        print(f"{model}: saved {path}", flush=True)
    print(f"{model}: saved_count={saved}", flush=True)
print("DONE", flush=True)
