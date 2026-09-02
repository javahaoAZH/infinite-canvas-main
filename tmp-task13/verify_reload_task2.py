# Task #2: verify workflow file state, reload log history, and registry reload semantics
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===FILE_STATE==='
ls -la --time-style=full-iso /root/comfyui2api/comfyui-api-workflows/noobai-xl-vpred.json /root/comfyui2api/comfyui-api-workflows/noobai-xl-lora.json /root/comfyui2api/comfyui-api-workflows/noobai-xl-ipadapter.json
echo '===VPRED_HEAD==='; head -c 120 /root/comfyui2api/comfyui-api-workflows/noobai-xl-vpred.json; echo
echo '===LORA_HEAD==='; head -c 120 /root/comfyui2api/comfyui-api-workflows/noobai-xl-lora.json; echo
echo '===VPRED_VAECHECK==='; grep -c 'VAELoader' /root/comfyui2api/comfyui-api-workflows/noobai-xl-vpred.json; grep -oE '"vae":\s*\[[^]]*\]' /root/comfyui2api/comfyui-api-workflows/noobai-xl-vpred.json
echo '===LORA_VAECHECK==='; grep -c 'VAELoader' /root/comfyui2api/comfyui-api-workflows/noobai-xl-lora.json; grep -oE '"vae":\s*\[[^]]*\]' /root/comfyui2api/comfyui-api-workflows/noobai-xl-lora.json
echo '===RELOAD_LOG_HISTORY(noobai)==='
grep -nE 'reload|noobai-xl-(vpred|lora)\.json' /root/autodl-tmp/comfyui2api.log | grep -ivE 'GET /v1|POST /v1' | tail -n 40
echo '===REGISTRY_SOURCE==='
sed -n '1,140p' /root/comfyui2api/src/comfyui2api/workflow_registry.py
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
