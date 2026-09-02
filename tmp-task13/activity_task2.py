# Task #2: check ComfyUI native activity + GPU + c2a worker log
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===GPU==='
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
echo '===COMFY_NATIVE_QUEUE==='
curl -s http://127.0.0.1:8188/queue
echo
echo '===C2A_LOG_TAIL(non-http)==='
grep -vE 'GET /v1|POST /v1|GET /runs|GET /openapi|OPTIONS' /root/autodl-tmp/comfyui2api.log | tail -n 25
echo '===COMFY8188_TAIL==='
tail -n 8 /root/autodl-tmp/ComfyUI/user/comfyui_8188.log
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = client.exec_command(CMD, timeout=120)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("[stderr]", err)
client.close()
