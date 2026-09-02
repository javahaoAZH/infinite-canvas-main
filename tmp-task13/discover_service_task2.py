# Task #2: discover how comfyui2api is managed before restarting it
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===PROC_TREE==='
ps -o pid,ppid,user,cmd -p 19345 2>/dev/null
PPID=$(ps -o ppid= -p 19345 2>/dev/null | tr -d ' ')
echo "parent pid: $PPID"
ps -o pid,ppid,user,cmd -p $PPID 2>/dev/null
echo '===SYSTEMD_UNITS==='
systemctl list-units --type=service --all 2>/dev/null | grep -iE 'comfy|c2a' || echo 'no systemd match'
echo '===SUPERVISOR==='
which supervisorctl 2>/dev/null && supervisorctl status 2>/dev/null || echo 'no supervisor'
echo '===CRON/STARTUP_SCRIPTS==='
ls -la /root/*.sh /root/autodl-tmp/*.sh 2>/dev/null | grep -iE 'comfy|start|c2a|api' || echo 'no obvious sh'
echo '===GREP_STARTUP==='
grep -rIlE 'comfyui2api serve|comfyui2api' /root --include='*.sh' --include='*.service' 2>/dev/null | head
grep -rIlE 'comfyui2api' /etc/systemd /etc/supervisor* 2>/dev/null | head
echo '===HOW_PARENT_STARTED==='
cat /proc/19345/cgroup 2>/dev/null | head -3
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
