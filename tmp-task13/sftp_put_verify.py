# Task #2: upload fixed workflows, read back, validate on server side
import json
import paramiko

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
    sftp.put(f"{LOCAL_DIR}\\{f}", f"{REMOTE_DIR}/{f}")
    print(f"uploaded {f}")

print("--- read-back verification ---")
for f in files:
    with sftp.open(f"{REMOTE_DIR}/{f}") as fh:
        data = json.loads(fh.read().decode("utf-8"))
    vae_loader = data.get("20")
    decode_vae = data["7"]["inputs"]["vae"]
    sampling = data["2"]["inputs"]
    print(f"{f}: valid JSON, nodes={sorted(data.keys())}")
    print(f"  node20={vae_loader}")
    print(f"  node7.vae={decode_vae}")
    print(f"  node2.sampling={sampling.get('sampling')} zsnr={sampling.get('zsnr')}")
    assert vae_loader["class_type"] == "VAELoader"
    assert vae_loader["inputs"]["vae_name"] == "sdxl.vae.safetensors"
    assert decode_vae == ["20", 0]
    assert sampling.get("sampling") == "v_prediction" and sampling.get("zsnr") is True
print("ALL CHECKS PASSED")
sftp.close()
client.close()
