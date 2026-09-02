# Task #2 URGENT: rescue-download fixed workflows + backups + sidecars before server shutdown
import os
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

LOCAL = r"d:\infinite-canvas-main\tmp-task13\server-backup-20260901"
os.makedirs(LOCAL, exist_ok=True)
os.makedirs(os.path.join(LOCAL, "sidecars"), exist_ok=True)

WF = "/root/comfyui2api/comfyui-api-workflows"
# (remote, local-subpath)
files = [
    (f"{WF}/noobai-xl-vpred.json", "noobai-xl-vpred.json"),
    (f"{WF}/noobai-xl-lora.json", "noobai-xl-lora.json"),
    (f"{WF}/noobai-xl-vpred.json.bak-20260901", "noobai-xl-vpred.json.bak-20260901"),
    (f"{WF}/noobai-xl-lora.json.bak-20260901", "noobai-xl-lora.json.bak-20260901"),
    (f"{WF}/noobai-xl-ipadapter.json", "noobai-xl-ipadapter.json"),
    (f"{WF}/.comfyui2api/wan22-ti2v-5b.params.json", "sidecars/wan22-ti2v-5b.params.json"),
    (f"{WF}/.comfyui2api/wan22-i2v-14b.params.json", "sidecars/wan22-i2v-14b.params.json"),
    (f"{WF}/.comfyui2api/noobai-xl-lora.params.json", "sidecars/noobai-xl-lora.params.json"),
    (f"{WF}/.comfyui2api/noobai-xl-ipadapter.params.json", "sidecars/noobai-xl-ipadapter.params.json"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=20, banner_timeout=30, allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
for remote, sub in files:
    local = os.path.join(LOCAL, sub)
    try:
        sftp.get(remote, local)
        sz = os.path.getsize(local)
        print(f"OK  {sub}  ({sz} bytes)")
    except Exception as e:
        print(f"ERR {remote}: {e}")
sftp.close()
client.close()
print("RESCUE COMPLETE")
