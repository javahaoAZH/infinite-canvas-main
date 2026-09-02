# Task #2: grep comfyui2api log for worker/executor lines (non-HTTP), plus DB job states
import paramiko

HOST = "connect.nmb1.seetacloud.com"
PORT = 34474
USER = "root"
PASSWORD = "369369AZh@123"

CMD = r"""
echo '===NON_HTTP_LOG_LINES(last 120)==='
grep -vE 'GET /v1|POST /v1|OPTIONS|HTTP/1.1" 200' /root/autodl-tmp/comfyui2api.log | tail -n 120
echo '===DB_JOBS==='
/root/comfyui2api/.venv/bin/python - <<'PY' 2>/dev/null || python - <<'PY'
PY
"""

# Use sqlite via comfyui2api venv python if available
CMD2 = r"""
cd /root/comfyui2api
PYBIN=$(ls .venv/bin/python 2>/dev/null || echo /root/miniconda3/bin/python)
$PYBIN - <<'PY'
import sqlite3, os
db="/root/comfyui2api/data/comfyui2api.db"
con=sqlite3.connect(db)
cur=con.cursor()
tabs=[r[0] for r in cur.execute("select name from sqlite_master where type='table'")]
print("tables:",tabs)
for t in tabs:
    if 'job' in t.lower() or 'queue' in t.lower() or 'task' in t.lower() or 'run' in t.lower():
        cols=[c[1] for c in cur.execute(f"pragma table_info({t})")]
        print("TABLE",t,"cols",cols)
        try:
            for row in cur.execute(f"select * from {t} order by rowid desc limit 6"):
                print("  ",str(row)[:300])
        except Exception as e:
            print("  err",e)
PY
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
               timeout=30, banner_timeout=60, allow_agent=False, look_for_keys=False)

NONHTTP = r"""
echo '===NON_HTTP_LOG_LINES(last 90)==='
grep -vE 'GET /v1|POST /v1|OPTIONS|DELETE /v1' /root/autodl-tmp/comfyui2api.log | tail -n 90
"""
for c in (NONHTTP, CMD2):
    stdin, stdout, stderr = client.exec_command(c, timeout=120)
    print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err.strip():
        print("[stderr]", err)
client.close()
