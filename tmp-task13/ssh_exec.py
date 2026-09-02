# 临时 SSH 执行脚本（任务 #13，用完删除）：python tmp-task13/ssh_exec.py "<remote command>"
import sys
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

command = sys.argv[1]
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = client.exec_command(command, timeout=300)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
code = stdout.channel.recv_exit_status()
sys.stdout.write(out)
if err:
    sys.stdout.write("\n[stderr]\n" + err)
print(f"\n[exit {code}]")
client.close()
