# Task #2: SFTP download workflow files
import paramiko, os

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"
REMOTE_DIR = "/root/comfyui2api/comfyui-api-workflows"
LOCAL_DIR = r"d:\infinite-canvas-main\tmp-task13"

files = ["noobai-xl-vpred.json", "noobai-xl-lora.json"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
for f in files:
    sftp.get(f"{REMOTE_DIR}/{f}", os.path.join(LOCAL_DIR, f))
    print(f"downloaded {f}")
sftp.close()
client.close()
