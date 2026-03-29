const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3333;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown',
};

const server = http.createServer(async (req, res) => {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Fixtures list endpoint
  if (req.url === '/fixtures-list') {
    const fixturesDir = path.join(__dirname, 'tests/fixtures');
    const expectedDir = path.join(__dirname, 'tests/expected');
    try {
      const files = fs.readdirSync(fixturesDir)
        .filter(f => f.endsWith('.html'))
        .filter(f => {
          // Only include if expected file exists
          const expectedPath = path.join(expectedDir, f.replace('.html', '.md'));
          return fs.existsSync(expectedPath);
        })
        .map(f => ({ name: f.replace('.html', '') }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Proxy endpoint: /proxy?url=https://...
  if (req.url.startsWith('/proxy?url=')) {
    const targetUrl = decodeURIComponent(req.url.slice('/proxy?url='.length));
    console.log(`Proxying: ${targetUrl}`);

    try {
      const protocol = targetUrl.startsWith('https') ? https : http;

      const proxyReq = protocol.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      }, (proxyRes) => {
        // Handle redirects
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
          res.writeHead(302, { 'Location': `/proxy?url=${encodeURIComponent(redirectUrl)}` });
          res.end();
          return;
        }

        let data = [];
        proxyRes.on('data', chunk => data.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(data);
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'text/html',
          });
          res.end(body);
        });
      });

      proxyReq.on('error', (e) => {
        console.error(`Proxy error: ${e.message}`);
        res.writeHead(500);
        res.end(`Proxy error: ${e.message}`);
      });
    } catch (e) {
      res.writeHead(500);
      res.end(`Proxy error: ${e.message}`);
    }
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/test-refine.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(500);
      res.end(`Server error: ${e.message}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log(`Proxy available at http://localhost:${PORT}/proxy?url=<encoded-url>`);
});
