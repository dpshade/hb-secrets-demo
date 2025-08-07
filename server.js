/**
 * HyperBEAM Chat Development Server
 * Serves static files and proxies requests to HyperBEAM node to avoid CORS issues
 */

const BASE_PORT = Number(process.env.PORT) || 4321;
const MAX_TRIES = 10;

let server;
let selectedPort = BASE_PORT;

function startServer() {
    for (let i = 0; i < MAX_TRIES; i += 1) {
        const tryPort = BASE_PORT + i;
        try {
            selectedPort = tryPort;
            const allowedOrigin = `http://localhost:${selectedPort}`;

            server = Bun.serve({
                port: tryPort,
                hostname: 'localhost',
                async fetch(req) {
                    const url = new URL(req.url);

                    // Proxy requests to HyperBEAM node
                    if (url.pathname.startsWith('/api/hyperbeam/')) {
                        const hyperbeamPath = url.pathname.replace('/api/hyperbeam', '');
                        const hyperbeamUrl = `http://localhost:8734${hyperbeamPath}${url.search}`;

                        console.log(`[Proxy] ${req.method} ${hyperbeamUrl}`);

                        try {
                            const response = await fetch(hyperbeamUrl, {
                                method: req.method,
                                headers: {
                                    ...Object.fromEntries(req.headers.entries()),
                                    // Remove host header to avoid confusion
                                    'host': 'localhost:8734'
                                },
                                body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined
                            });

                            // Create response with CORS headers
                            const corsHeaders = {
                                'Access-Control-Allow-Origin': allowedOrigin,
                                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
                                'Access-Control-Allow-Credentials': 'true'
                            };

                            // Handle preflight requests
                            if (req.method === 'OPTIONS') {
                                return new Response(null, {
                                    status: 200,
                                    headers: corsHeaders
                                });
                            }

                            // Proxy the response with CORS headers
                            const responseHeaders = {
                                ...corsHeaders,
                                ...Object.fromEntries(response.headers.entries())
                            };

                            return new Response(response.body, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: responseHeaders
                            });
                        } catch (error) {
                            console.error(`[Proxy Error] ${error.message}`);
                            return new Response(
                                JSON.stringify({ error: 'Proxy request failed', details: error.message }),
                                {
                                    status: 500,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Access-Control-Allow-Origin': allowedOrigin
                                    }
                                }
                            );
                        }
                    }

                    // Serve static files
                    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;

                    try {
                        const file = Bun.file(`.${filePath}`);

                        if (await file.exists()) {
                            return new Response(file, {
                                headers: {
                                    'Access-Control-Allow-Origin': '*',
                                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                                    'Access-Control-Allow-Headers': 'Content-Type'
                                }
                            });
                        }

                        return new Response('File not found', {
                            status: 404,
                            headers: {
                                'Access-Control-Allow-Origin': '*'
                            }
                        });
                    } catch (error) {
                        console.error(`[Server Error] ${error.message}`);
                        return new Response('Internal server error', {
                            status: 500,
                            headers: {
                                'Access-Control-Allow-Origin': '*'
                            }
                        });
                    }
                }
            });

            // Success if we reached here
            break;
        } catch (error) {
            if (error && error.code === 'EADDRINUSE') {
                // Try next port
                continue;
            }
            throw error;
        }
    }

    if (!server) {
        throw new Error(
            `Failed to start server. Ports ${BASE_PORT}-${BASE_PORT + MAX_TRIES - 1} are in use.`
        );
    }
}

startServer();

console.log(`🚀 HyperBEAM Chat server running at http://localhost:${selectedPort}`);
console.log(`📡 Proxying HyperBEAM requests from /api/hyperbeam/* to http://localhost:8734/*`);
console.log(`🔄 CORS enabled for local development (allowed origin: http://localhost:${selectedPort})`);