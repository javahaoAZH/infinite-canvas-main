# Task #2: atomically re-touch workflow files to retrigger hot-reload, then verify registration
import time
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

TRIGGER = r"""
cd /root/comfyui2api/comfyui-api-workflows
# atomic rename => watcher sees complete file, no empty-moment race
# temp names have no .json suffix so the watcher ignores them
cp noobai-xl-vpred.json .tmpvpred && mv -f .tmpvpred noobai-xl-vpred.json
cp noobai-xl-lora.json .tmplora && mv -f .tmplora noobai-xl-lora.json
echo triggered
"""

CHECK = r"""
echo '===RELOAD_LOG_AFTER==='
grep -nE 'reload' /root/autodl-tmp/comfyui2api.log | tail -n 12
echo '===MODELS_ENDPOINT==='
curl -s http://127.0.0.1:8918/v1/models
echo
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)

stdin, stdout, stderr = client.exec_command(TRIGGER, timeout=60)
print(stdout.read().decode("utf-8", "replace"))
time.sleep(3)  # let watcher pick up the change

stdin, stdout, stderr = client.exec_command(CHECK, timeout=60)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("[stderr]", err)
client.close()
