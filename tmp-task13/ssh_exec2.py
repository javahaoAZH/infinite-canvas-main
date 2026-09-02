# Task #2: robust SSH exec with retry + banner_timeout
# Usage: python tmp-task13/ssh_exec2.py "<remote command>"
import sys, time
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

command = sys.argv[1]
last_err = None
for attempt in range(1, 4):
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
                       timeout=30, banner_timeout=60, auth_timeout=60,
                       allow_agent=False, look_for_keys=False)
        stdin, stdout, stderr = client.exec_command(command, timeout=300)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        sys.stdout.write(out)
        if err:
            sys.stdout.write("\n[stderr]\n" + err)
        print(f"\n[exit {code}]")
        client.close()
        sys.exit(0)
    except Exception as e:
        last_err = e
        print(f"[attempt {attempt} failed: {e}]", file=sys.stderr)
        time.sleep(5)
print(f"[all attempts failed: {last_err}]", file=sys.stderr)
sys.exit(1)
