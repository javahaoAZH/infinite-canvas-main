# Task #2: restart ONLY comfyui2api (port 8918), never ComfyUI (8188)
import time
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

RESTART = r"""
set -e
T=/root/autodl-tmp
PID=$(ss -ltnp 2>/dev/null | grep ':8918 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
echo "comfyui2api pid on 8918: ${PID:-none}"
if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null || true
  for i in $(seq 1 15); do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then echo "still alive, SIGKILL"; kill -9 "$PID"; sleep 2; fi
fi
echo "8918 after kill: $(ss -ltnp 2>/dev/null | grep ':8918 ' || echo free)"
# ComfyUI 8188 must remain untouched
echo "comfyui 8188 (must stay up): $(ss -ltnp 2>/dev/null | grep ':8188 ' | grep -oE 'pid=[0-9]+' | head -1 || echo MISSING)"
# relaunch comfyui2api
cd $T
nohup bash $T/c2a_launch.sh > $T/comfyui2api.log 2>&1 &
echo "relaunched pid $!"
# wait for healthy
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:8918/openapi.json 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "comfyui2api healthy after ${i}s"; break; fi
  sleep 1
done
echo "final health code: $(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:8918/openapi.json 2>/dev/null)"
"""

CHECK = r"""
echo '===MODELS==='
curl -s http://127.0.0.1:8918/v1/models
echo
echo '===QUEUE==='
curl -s http://127.0.0.1:8918/v1/queue | head -c 400
echo
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)

stdin, stdout, stderr = client.exec_command(RESTART, timeout=180)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("[stderr]", err)

time.sleep(2)
stdin, stdout, stderr = client.exec_command(CHECK, timeout=60)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("[stderr]", err)
client.close()
