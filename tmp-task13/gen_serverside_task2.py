# Task #2: server-side generation via curl to localhost:8918, decode to PNG on server
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"
TOKEN = "255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006"

CMD = r"""
PYBIN=/root/comfyui2api/.venv/bin/python
cd /tmp
$PYBIN - <<'PY'
import json
prompt="二十五岁左右的青年男子，黑色短发微乱，眼下带青黑眼袋，面色苍白疲惫，穿灰色连帽卫衣，赛璐璐画风，清晰封闭描边，大色块平涂"
for model in ["noobai-xl-lora","noobai-xl-vpred"]:
    body={"model":model,"prompt":prompt,"size":"1024x1536","response_format":"b64_json"}
    open(f"/tmp/body_{model}.json","w",encoding="utf-8").write(json.dumps(body,ensure_ascii=False))
print("bodies written")
PY

echo '===PRE_QUEUE==='
curl -s http://127.0.0.1:8918/v1/queue | head -c 200; echo

for m in noobai-xl-lora noobai-xl-vpred; do
  echo "=== GEN $m ==="
  curl -s --max-time 600 -X POST http://127.0.0.1:8918/v1/images/generations \
    -H "Authorization: Bearer __TOKEN__" -H "Content-Type: application/json" \
    --data @/tmp/body_$m.json -o /tmp/gen_$m.json
  echo "curl_exit=$? bytes=$(wc -c < /tmp/gen_$m.json)"
done

$PYBIN - <<'PY'
import json,base64
for m in ["noobai-xl-lora","noobai-xl-vpred"]:
    f=f"/tmp/gen_{m}.json"
    try:
        d=json.load(open(f))
    except Exception as e:
        print(m,"load_error",e,"head:",open(f).read()[:200]); continue
    items=d.get("data",[])
    if not items:
        print(m,"no data, err:",str(d.get("error"))[:300]); continue
    for i,it in enumerate(items):
        b=it.get("b64_json")
        out=f"/tmp/img_{m}_{i}.png"
        if b:
            open(out,"wb").write(base64.b64decode(b)); print(m,"saved",out)
        else:
            print(m,"no b64 in item",str(it)[:200])
PY
echo '===RESULTS==='
ls -la /tmp/img_*.png 2>/dev/null
"""
CMD = CMD.replace("__TOKEN__", TOKEN)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = client.exec_command(CMD, timeout=1400)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("[stderr]", err)
client.close()
