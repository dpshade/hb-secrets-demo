/**
 * HyperBEAM API Wrapper
 * Provides a clean interface to interact with HyperBEAM HTTP endpoints
 */
class HyperBEAMAPI {
    constructor() {
        this.baseUrl = CONFIG.HYPERBEAM_NODE;
        this.timeout = CONFIG.AUTH_TIMEOUT;
    }

    /**
     * Make HTTP request to HyperBEAM endpoint
     */
    async request(endpoint, options = {}) {
        // Handle full URL for Basic Auth or build URL normally
        const url = options.useFullUrl ? endpoint : `${this.baseUrl}${endpoint}`;
        
        const config = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        // Remove custom options that shouldn't be passed to fetch
        delete config.useFullUrl;

        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        config.signal = controller.signal;

        try {
            if (CONFIG.DEBUG) {
                console.log('HyperBEAM Request:', { url, config });
            }

            const response = await fetch(url, config);
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Check content type to determine how to parse response
            const contentType = response.headers.get('content-type');
            let data;
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                // Handle plain text responses (like "secret:xyz...")
                const textResponse = await response.text();
                
                // If response starts with "secret:", parse it as a HyperBEAM secret response
                if (textResponse.startsWith('secret:')) {
                    data = {
                        body: textResponse,
                        keyid: textResponse,
                        'wallet-address': textResponse,
                        committer: textResponse,
                        headers: response.headers // Preserve headers for cookie extraction
                    };
                } else {
                    // Try to parse as JSON, fallback to text
                    try {
                        data = JSON.parse(textResponse);
                        data.headers = response.headers; // Preserve headers
                    } catch (e) {
                        data = { 
                            body: textResponse,
                            headers: response.headers
                        };
                    }
                }
            }
            
            if (CONFIG.DEBUG) {
                console.log('HyperBEAM Response:', data);
            }

            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            if (CONFIG.DEBUG) {
                console.error('HyperBEAM Request Error:', error);
            }
            throw error;
        }
    }

    /**
     * Generate a new wallet
     */
    async generateWallet(options = {}) {
        const persistMode = options.persist || CONFIG.DEFAULT_PERSIST_MODE;
        
        const body = {
            persist: persistMode,
            'access-control': options.accessControl || CONFIG.DEFAULT_ACCESS_CONTROL,
            ...options.extraParams
        };

        // Add specific configurations for different persist modes
        if (persistMode === 'non-volatile') {
            // Non-volatile storage requires controllers configuration
            body.controllers = options.controllers || CONFIG.DEFAULT_CONTROLLERS || [];
            body['required-controllers'] = options.requiredControllers || CONFIG.DEFAULT_REQUIRED_CONTROLLERS || 1;
        }

        // Add query parameter for cookie auth with client persist mode
        let endpoint = CONFIG.ENDPOINTS.SECRET_GENERATE;
        if (persistMode === 'client') {
            endpoint += '?persist=client';
        }

        return await this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    /**
     * Generate wallet with HTTP Basic Auth (deterministic)
     */
    async generateWalletBasicAuth(username, password, options = {}) {
        const body = {
            persist: options.persist || CONFIG.DEFAULT_PERSIST_MODE,
            'access-control': options.accessControl || { device: 'http-auth@1.0' },
            ...options.extraParams
        };

        // Create Authorization header with Base64 encoded credentials
        const credentials = btoa(`${username}:${password}`);
        
        return await this.request(CONFIG.ENDPOINTS.SECRET_GENERATE, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`
            },
            body: JSON.stringify(body)
        });
    }

    /**
     * Import an existing wallet
     */
    async importWallet(walletJson, options = {}) {
        const body = {
            key: walletJson,
            persist: options.persist || CONFIG.DEFAULT_PERSIST_MODE,
            'access-control': options.accessControl || CONFIG.DEFAULT_ACCESS_CONTROL,
            ...options.extraParams
        };

        return await this.request(CONFIG.ENDPOINTS.SECRET_IMPORT, {
            method: 'POST', 
            body: JSON.stringify(body)
        });
    }

    /**
     * List hosted wallets
     */
    async listWallets(keyids = null) {
        const params = keyids ? `?keyids=${Array.isArray(keyids) ? keyids.join(',') : keyids}` : '';
        return await this.request(`${CONFIG.ENDPOINTS.SECRET_LIST}${params}`);
    }

    /**
     * Sign and commit a message
     */
    async commitMessage(messageData, auth = {}) {
        const headers = {};
        
        // Handle different authentication methods
        if (auth.cookie) {
            headers['Cookie'] = auth.cookie;
        }
        if (auth.basic) {
            // Use Authorization header for HTTP Basic auth
            const credentials = btoa(auth.basic);
            headers['Authorization'] = `Basic ${credentials}`;
        }

        const body = {
            keyid: messageData.keyid || 'auto', // Use provided keyid or let HyperBEAM auto-select
            target: CONFIG.CHAT_PROCESS_ID,
            data: messageData.content,
            tags: [
                { name: 'Action', value: CONFIG.MESSAGE_TAGS.ACTION },
                { name: 'Chat-Room', value: CONFIG.MESSAGE_TAGS.CHAT_ROOM },
                { name: 'App-Name', value: CONFIG.MESSAGE_TAGS.APP_NAME },
                { name: 'App-Version', value: CONFIG.MESSAGE_TAGS.VERSION },
                { name: 'Timestamp', value: new Date().toISOString() },
                { name: 'From', value: 'HyperBEAM-Chat-User' },
                ...((messageData.tags || []))
            ],
            ...messageData.extraParams
        };

        // If using HTTP Basic auth, add access-control to body
        if (auth.basic) {
            body['access-control'] = { device: 'http-auth@1.0' };
        }

        return await this.request(CONFIG.ENDPOINTS.SECRET_COMMIT, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
    }

    /**
     * Get messages from a process
     */
    async getMessages(processId = null, options = {}) {
        const pid = processId || CONFIG.CHAT_PROCESS_ID;
        const params = new URLSearchParams();
        
        if (options.limit) params.set('limit', options.limit);
        if (options.from) params.set('from', options.from);
        if (options.to) params.set('to', options.to);

        const query = params.toString() ? `?${params.toString()}` : '';
        
        return await this.request(`${CONFIG.ENDPOINTS.PROCESS_MESSAGES}/${pid}${query}`);
    }

    /**
     * Export wallet data
     */
    async exportWallet(keyids = 'all', auth = {}) {
        const headers = {};
        
        if (auth.cookie) {
            headers['Cookie'] = auth.cookie;
        }
        if (auth.basic) {
            const credentials = btoa(auth.basic);
            headers['Authorization'] = `Basic ${credentials}`;
        }

        const body = { keyids };

        return await this.request(CONFIG.ENDPOINTS.SECRET_EXPORT, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
    }

    /**
     * Create HTTP Basic Auth string
     */
    createBasicAuth(username, password) {
        return `${username}:${password}`;
    }

    /**
     * Parse cookies from response headers or structured cookie data
     */
    parseCookies(response) {
        const cookies = {};
        
        // Check for structured cookie data in response.priv.cookie (new format)
        if (response && response.priv && response.priv.cookie) {
            Object.entries(response.priv.cookie).forEach(([key, value]) => {
                cookies[key] = value;
            });
            return cookies;
        }
        
        // For secret responses, create a cookie from the secret value
        if (response && response.body && response.body.startsWith('secret:')) {
            // Extract the hash part after "secret:"
            const secretHash = response.body.substring(7); // Remove "secret:" prefix
            cookies.secret_hash = `secret:${secretHash}`;
            return cookies;
        }
        
        // Fallback to HTTP headers (Response object from fetch)
        if (response && typeof response.headers === 'object' && response.headers.get) {
            const setCookieHeader = response.headers.get('set-cookie');
            
            if (setCookieHeader) {
                setCookieHeader.split(',').forEach(cookie => {
                    const [nameValue] = cookie.split(';');
                    const [name, value] = nameValue.split('=');
                    if (name && value) {
                        cookies[name.trim()] = value.trim();
                    }
                });
            }
        }
        
        return cookies;
    }

    /**
     * Format cookies for requests
     */
    formatCookies(cookies) {
        return Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    /**
     * Sync wallets from peer node
     */
    async syncWallets(peerNode, options = {}) {
        const body = {
            node: peerNode,
            keyids: options.keyids || 'all',
            ...options.extraParams
        };

        if (options.as) {
            body.as = options.as;
        }

        return await this.request(CONFIG.ENDPOINTS.SECRET_SYNC, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    /**
     * Health check - verify HyperBEAM node is accessible
     */
    async healthCheck() {
        try {
            // Try to access the meta device info endpoint
            await this.request(CONFIG.ENDPOINTS.META_INFO);
            return true;
        } catch (error) {
            console.warn('HyperBEAM health check failed:', error);
            return false;
        }
    }
}

// Create global API instance
window.HyperBEAM = new HyperBEAMAPI();