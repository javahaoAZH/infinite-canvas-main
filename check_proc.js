const { exec } = require('child_process');

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = Object.assign({ encoding: 'utf-8', windows: 'latin1' }, opts);
    exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        reject({
          message: err.message,
          code: err.code,
          output: (stderr ? stderr.trim() : '') + ' | STDOUT: ' + (stdout || ''),
        });
      } else {
        resolve(stdout);
      }
    });
  });
}

(async () => {
  const port = 18080;
  const pid = {};
  try {
    // Use netstat with -b on port for all interfaces
    const allListeners = await run('netstat -aon | find "' + port + '"');
    console.log('=== Ports matching ' + port + ' ===');
    console.log(allListeners.trim());
  } catch (e) {
    console.error('ERR:', e);
  }

  try {
    const procList = await run('powershell -Command "Get-Process | Where-Object { $_.ProcessName }"');
    console.log('\n=== Processes list ===');
    console.log(procList);
  } catch (e) {
    console.error('ERR2:', e);
  }
})();
