# Task #2: remote diagnostics (embedded command, avoids PowerShell interpolation)
import sys
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===COMFY_QUEUE==='; curl -s http://127.0.0.1:8188/queue; echo
echo '===C2A_PROC_FD==='; ls -l /proc/19345/fd 2>/dev/null | grep -iE 'log|\.txt' | head
echo '===C2A_PROC_CMDLINE==='; tr '\0' ' ' < /proc/19345/cmdline 2>/dev/null; echo
echo '===RECENT_C2A_RUN_DIRS==='; ls -td /root/comfyui2api/runs/*/ 2>/dev/null | head -4
echo '===VIDEO_RUN_TREE==='; find /root/comfyui2api/runs/32702b8045534cdd823cb0b25a9d5155/ -type f 2>/dev/null
echo '===C2A_DB_OR_STATE==='; ls -la /root/comfyui2api/*.db /root/comfyui2api/*.json /root/comfyui2api/data 2>/dev/null | head
echo '===C2A_LOGFILES==='; find /root -maxdepth 5 -iname '*.log' -mmin -120 2>/dev/null | head -20
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
