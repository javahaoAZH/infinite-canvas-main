# Task #2: tail comfyui2api + comfyui pipeline logs
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===C2A_LOG_TAIL==='; tail -n 60 /root/autodl-tmp/comfyui2api.log
echo '===PIPELINE_LOG_TAIL==='; tail -n 25 /root/autodl-tmp/comfyui_pipeline.log
echo '===COMFY8188_TAIL==='; tail -n 20 /root/autodl-tmp/ComfyUI/user/comfyui_8188.log
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
