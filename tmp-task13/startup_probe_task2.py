# Task #2: inspect comfyui2api startup job-recovery behavior
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===FILES==='
ls /root/comfyui2api/src/comfyui2api/
echo '===STARTUP_GREP==='
grep -rnE "lifespan|on_event|startup|requeue|_recover|resume|stale" /root/comfyui2api/src/comfyui2api/ | head -40
echo '===WORKER_PICKUP==='
sed -n '280,360p' /root/comfyui2api/src/comfyui2api/jobs.py
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
