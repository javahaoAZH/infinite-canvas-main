# Task #2: read app.py startup block to understand job recovery on restart
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===APP_STARTUP_BLOCK==='
sed -n '300,400p' /root/comfyui2api/src/comfyui2api/app.py
echo '===JOBSTORE_LOAD==='
grep -nE 'def |pending|running|list_jobs|load' /root/comfyui2api/src/comfyui2api/job_store.py | head -30
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
