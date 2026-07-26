/**
 * Worker entry point for production deployment.
 * Railway runs this as a separate service alongside the API server.
 * It imports the worker logic and also starts a minimal HTTP server
 * so Railway's healthcheck can verify the process is alive.
 */
import http from 'http';
import './worker'; // boots the BullMQ worker

// Minimal health server so Railway knows the worker is up
const PORT = parseInt(process.env.WORKER_PORT || '4001', 10);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'worker running' }));
});

server.listen(PORT, () => {
  console.log(`Worker health server on port ${PORT}`);
});
