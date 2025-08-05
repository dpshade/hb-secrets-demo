#!/usr/bin/env bun

/**
 * HyperBEAM Chat Development Server
 * A simple static file server with CORS support and development features
 */

import { file, serve } from "bun";
import { join, extname } from "path";

const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || "localhost";
const PUBLIC_DIR = process.cwd();

// MIME types mapping
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

function getMimeType(filepath) {
  const ext = extname(filepath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

function logRequest(req, status, size = 0) {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userAgent = req.headers.get('user-agent') || 'Unknown';
  
  // Color coding for status
  let statusColor = '\x1b[32m'; // Green for 2xx
  if (status >= 400) statusColor = '\x1b[31m'; // Red for 4xx/5xx
  else if (status >= 300) statusColor = '\x1b[33m'; // Yellow for 3xx
  
  console.log(
    `\x1b[36m[${timestamp}]\x1b[0m ${method} ${url} ${statusColor}${status}\x1b[0m ${size}b`
  );
  
  if (process.env.DEBUG) {
    console.log(`  User-Agent: ${userAgent}`);
  }
}

const server = serve({
  port: PORT,
  hostname: HOST,
  
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    
    // Default to index.html for root path
    if (pathname === '/') {
      pathname = '/index.html';
    }
    
    // Security: prevent directory traversal
    if (pathname.includes('..')) {
      logRequest(req, 403);
      return new Response('Forbidden', { status: 403 });
    }
    
    const filepath = join(PUBLIC_DIR, pathname);
    
    try {
      const fileObj = file(filepath);
      const exists = await fileObj.exists();
      
      if (!exists) {
        // Try to serve index.html for SPA routing
        if (!pathname.includes('.')) {
          const indexFile = file(join(PUBLIC_DIR, 'index.html'));
          if (await indexFile.exists()) {
            const content = await indexFile.text();
            logRequest(req, 200, content.length);
            return new Response(content, {
              headers: {
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
                'Cache-Control': 'no-cache'
              }
            });
          }
        }
        
        logRequest(req, 404);
        return new Response('Not Found', { status: 404 });
      }
      
      const content = await fileObj.arrayBuffer();
      const mimeType = getMimeType(filepath);
      
      // Set cache headers based on file type
      let cacheControl = 'no-cache';
      if (pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
        cacheControl = 'public, max-age=31536000'; // 1 year for assets
      }
      
      logRequest(req, 200, content.byteLength);
      
      return new Response(content, {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
          'Cache-Control': cacheControl,
          'X-Served-By': 'HyperBEAM-Chat-Server'
        }
      });
      
    } catch (error) {
      console.error(`Error serving ${pathname}:`, error);
      logRequest(req, 500);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
  
  error(error) {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Startup message
console.log('\n🚀 HyperBEAM Chat Development Server');
console.log(`📂 Serving files from: ${PUBLIC_DIR}`);
console.log(`🌐 Server running at: http://${HOST}:${PORT}`);
console.log(`🔗 Open in browser: http://${HOST}:${PORT}`);

// Development tips
console.log('\n💡 Development Tips:');
console.log('   • Add ?debug=1 to enable debug mode in the chat app');
console.log('   • Update config.js to point to your HyperBEAM node');
console.log('   • Press Ctrl+C to stop the server');

// Environment info
if (process.env.DEBUG) {
  console.log('\n🐛 Debug mode enabled');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down HyperBEAM Chat server...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down HyperBEAM Chat server...');
  server.stop();
  process.exit(0);
});

export default server;