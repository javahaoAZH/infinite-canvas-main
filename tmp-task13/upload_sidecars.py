# 临时上传脚本（任务 #13，用完删除）：备份并上传 wan22 sidecar
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"
REMOTE_DIR = "/root/comfyui2api/comfyui-api-workflows/.comfyui2api"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)

# 备份现有 14B sidecar（单文件备份，改前 cp）
stdin, stdout, stderr = client.exec_command(f"cp -n {REMOTE_DIR}/wan22-i2v-14b.params.json {REMOTE_DIR}/wan22-i2v-14b.params.json.bak-task13 && ls -la {REMOTE_DIR}")
print(stdout.read().decode())
print(stderr.read().decode())

sftp = client.open_sftp()
sftp.put(r"d:\infinite-canvas-main\tmp-task13\sidecars\wan22-ti2v-5b.params.json", f"{REMOTE_DIR}/wan22-ti2v-5b.params.json")
sftp.put(r"d:\infinite-canvas-main\tmp-task13\sidecars\wan22-i2v-14b.params.json", f"{REMOTE_DIR}/wan22-i2v-14b.params.json")
sftp.close()

stdin, stdout, stderr = client.exec_command(f"ls -la {REMOTE_DIR}")
print(stdout.read().decode())
client.close()
print("uploaded")
