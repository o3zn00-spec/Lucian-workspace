// Dependency-free compatibility fixture for LUCIAN's existing WebContainer.
require('node:http').createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>LUCIAN runtime check</title></head><body><h1>LUCIAN runtime verified</h1><p>Served by a real Node process inside WebContainer.</p></body></html>');
}).listen(3111, '0.0.0.0', () => console.log('Runtime fixture listening on port 3111'));
