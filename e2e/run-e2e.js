#!/usr/bin/env node

import { spawn } from 'child_process';
import httpServer from 'http-server';

// Start the HTTP server
const server = httpServer.createServer({
  root: './',
  cache: -1,
  logFn: () => {} // Suppress logs
});

server.listen(3000, '0.0.0.0', () => {
  console.log('HTTP server started on port 3000');
  
  // Run the e2e tests
  const wdio = spawn('npx', ['wdio', 'run', 'e2e/wdio.local.conf.ts'], {
    stdio: 'inherit',
    shell: true
  });

  wdio.on('close', (code) => {
    console.log(`\nE2E tests finished with code ${code}`);
    console.log('Stopping HTTP server...');
    server.close(() => {
      console.log('HTTP server stopped');
      process.exit(code);
    });
  });

  wdio.on('error', (err) => {
    console.error('Failed to start e2e tests:', err);
    server.close(() => {
      process.exit(1);
    });
  });
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server stopped');
    process.exit(0);
  });
});