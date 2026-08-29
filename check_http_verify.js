// Simple HTTP check for the infinite-canvas app - verifies the 3 URLs
// Usage: node check_http_verify.js

const http = require('http');

const targets = [
  { name: '/', url: 'http://127.0.0.1:18080/', expect: { html: true, code: 200 } },
  { name: 'api/health', url: 'http://127.0.0.1:18080/api/health', expect: { ok: true } },
  { name: 'director/index.html', url: 'http://127.0.0.1:18080/director/index.html', expect: { html: true, code: 200 } }
];

function check(target) {
  return new Promise((resolve) => {
    const req = http.get(target.url, { maxRedirects: 0, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ name: target.name, status: res.statusCode, headers: res.headers, body: data.slice(0, 500) });
      });
    });
    req.on('error', (err) => resolve({ name: target.name, error: err.message }));
    req.on('timeout', () => { req.destroy(); });
  });
}

(async () => {
  console.log('Target: http://127.0.0.1:18080');
  for (const t of targets) {
    const result = await check(t);
    let verdict;
    if (result.error) {
      verdict = 'FAIL (error)';
    } else if (result.status === 200) {
      verdict = (result.headers['content-type'] || '').includes('text/html') ? 'HTML (OK)' : 'OK';
    } else if (result.status >= 301 && result.status <= 308) {
      verdict = 'REDIRECT (' + result.headers.location + ')';
    } else {
      verdict = 'UNEXPECTED ' + result.status;
    }
    console.log('=== ' + t.name + ' ===');
    console.log('Status: ' + (result.status || 'N/A'));
    console.log('Verdict: ' + verdict);
    if (result.body) console.log('Body: ' + result.body);
    console.log('');
  }
})();
