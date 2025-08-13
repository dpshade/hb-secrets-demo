/**
 * HyperBEAM HTTP API Client
 * 
 * Comprehensive HTTP API wrapper for HyperBEAM with authentication support,
 * error handling, and AO process integration based on breakthrough discoveries.
 */

class HyperBEAMAPI {
    constructor(config = window.CONFIG) {
        this.config = config;
        this.cookies = new Map();
        this.authHeaders = new Map();
        this.requestCount = 0;
        this.lastSlot = null;
        this.currentNodeIndex = 0; // Track which node we're using
        
        // Performance tracking
        this.performanceMetrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
        
        this.config.log('HyperBEAM API client initialized');
    }

    /**
     * Get current node URL with fallback support
     */
    getCurrentNodeUrl() {
        if (this.currentNodeIndex === 0) {
            return this.config.HYPERBEAM_NODE;
        } else {
            const backupIndex = this.currentNodeIndex - 1;
            return this.config.BACKUP_NODES[backupIndex] || this.config.HYPERBEAM_NODE;
        }
    }

    /**
     * Try next backup node
     */
    switchToNextNode() {
        const totalNodes = 1 + (this.config.BACKUP_NODES?.length || 0);
        this.currentNodeIndex = (this.currentNodeIndex + 1) % totalNodes;
        const newNodeUrl = this.getCurrentNodeUrl();
        this.config.log(`Switched to backup node: ${newNodeUrl}`);
        return newNodeUrl;
    }

    /**
     * Core HTTP request method with comprehensive error handling
     */
    async makeRequest(endpoint, options = {}) {
        const startTime = performance.now();
        const requestId = ++this.requestCount;
        
        const url = `${this.getCurrentNodeUrl()}${endpoint}`;
        const requestOptions = {
            credentials: 'include', // Include credentials through proxy
            mode: 'cors',
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...this.authHeaders,
                ...options.headers
            }
        };

        // Add cookies to headers if we have them
        if (this.cookies.size > 0) {
            const cookieString = Array.from(this.cookies.entries())
                .map(([key, value]) => `${key}=${value}`)
                .join('; ');
            requestOptions.headers['Cookie'] = cookieString;
        }

        this.config.debug(`[${requestId}] Making request to: ${url}`, {
            method: requestOptions.method || 'GET',
            headers: requestOptions.headers,
            bodySize: requestOptions.body ? requestOptions.body.length : 0
        });

        try {
            const response = await fetch(url, requestOptions);
            const responseTime = performance.now() - startTime;
            
            // Parse response
            let responseData = null;
            const contentType = response.headers.get('content-type') || '';
            
            try {
                if (contentType.includes('application/json')) {
                    responseData = await response.json();
                } else {
                    responseData = await response.text();
                }
            } catch (parseError) {
                this.config.debug(`[${requestId}] Failed to parse response:`, parseError);
                responseData = null;
            }

            // Handle cookies from response
            this.extractAndStoreCookies(response);

            // Update performance metrics
            this.updatePerformanceMetrics(responseTime, response.ok);

            const result = {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: Object.fromEntries(response.headers.entries()),
                responseTime,
                requestId
            };

            this.config.debug(`[${requestId}] Response received:`, {
                status: response.status,
                ok: response.ok,
                responseTime: `${responseTime.toFixed(2)}ms`,
                dataType: typeof responseData,
                dataSize: responseData ? JSON.stringify(responseData).length : 0
            });

            if (!response.ok) {
                this.config.debug(`[${requestId}] Request failed:`, result);
            }

            return result;

        } catch (error) {
            const responseTime = performance.now() - startTime;
            this.updatePerformanceMetrics(responseTime, false);
            
            const result = {
                ok: false,
                status: 0,
                statusText: 'Network Error',
                error: error.message,
                data: null,
                responseTime,
                requestId
            };

            this.config.debug(`[${requestId}] Request error:`, error);
            return result;
        }
    }

    /**
     * Extract and store cookies from response headers
     */
    extractAndStoreCookies(response) {
        // Handle HyperBEAM structured cookie responses
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
            const cookiePairs = setCookieHeader.split(';').map(c => c.trim());
            cookiePairs.forEach(pair => {
                if (pair.includes('=')) {
                    const [key, value] = pair.split('=', 2);
                    this.cookies.set(key.trim(), value.trim());
                    this.config.debug(`Cookie stored: ${key.trim()}`);
                }
            });
        }

        // Handle JSON response with cookie data (HyperBEAM specific)
        if (response.headers.get('content-type')?.includes('json') && response.data?.priv?.cookie) {
            const cookieData = response.data.priv.cookie;
            if (typeof cookieData === 'object') {
                Object.entries(cookieData).forEach(([key, value]) => {
                    this.cookies.set(key, value);
                    this.config.debug(`JSON cookie stored: ${key}`);
                });
            }
        }
    }

    /**
     * Update performance metrics
     */
    updatePerformanceMetrics(responseTime, success) {
        this.performanceMetrics.totalRequests++;
        this.performanceMetrics.totalResponseTime += responseTime;
        this.performanceMetrics.averageResponseTime = 
            this.performanceMetrics.totalResponseTime / this.performanceMetrics.totalRequests;

        if (success) {
            this.performanceMetrics.successfulRequests++;
        } else {
            this.performanceMetrics.failedRequests++;
        }
    }

    /**
     * Generate new wallet/secret with cookie-based authentication and keyid detection
     */
    async generateSecret(options = {}) {
        // Step 1: List secrets before generation
        const beforeSecrets = await this.listSecrets();
        const secretsBefore = beforeSecrets.success ? beforeSecrets.secrets : [];
        
        const payload = {
            persist: options.persist || this.config.AUTH.COOKIE.PERSIST,
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            },
            ...options
        };

        this.config.debug('Generating new secret with payload:', payload);

        const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_GENERATE, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            this.config.log('Secret generated successfully');
            
            // For persist=client, extract wallet data from headers
            if (payload.persist === 'client') {
                // Extract wallet address from headers
                const walletAddress = response.headers['wallet-address'];
                if (walletAddress) {
                    this.walletAddress = walletAddress;
                    this.config.debug('Wallet address from headers:', walletAddress);
                }

                // Extract wallet data from set-cookie header
                const setCookieHeader = response.headers['set-cookie'];
                if (setCookieHeader) {
                    const walletCookieMatch = setCookieHeader.match(/wallet-[^=]+="([^"]+)"/);
                    if (walletCookieMatch) {
                        try {
                            const walletData = JSON.parse(walletCookieMatch[1]);
                            response.data = {
                                address: walletAddress,
                                walletData: walletData
                            };
                            this.config.log('Wallet data extracted from cookie for client persistence');
                        } catch (error) {
                            this.config.debug('Failed to parse wallet data from cookie:', error);
                            // Initialize response data even if parsing fails
                            response.data = {
                                address: walletAddress
                            };
                        }
                    }
                } else {
                    // Ensure response.data exists even if no cookie
                    response.data = {
                        address: walletAddress
                    };
                }

                // Extract keyid from signature-input header
                const signatureInput = response.headers['signature-input'];
                if (signatureInput) {
                    const keyidMatch = signatureInput.match(/keyid="([^"]+)"/);
                    if (keyidMatch) {
                        const keyid = keyidMatch[1];
                        this.config.log('Detected keyid from signature headers:', keyid);
                        response.data.secretKeyid = keyid;
                        response.secretKeyid = keyid;
                    }
                }
            } else if (response.data) {
                // For other persist modes, extract wallet address from data
                if (response.data.address) {
                    this.walletAddress = response.data.address;
                    this.config.debug('Wallet address stored:', this.walletAddress);
                }
                
                // Step 2: List secrets after generation to find the new keyid
                const afterSecrets = await this.listSecrets();
                if (afterSecrets.success) {
                    const secretsAfter = afterSecrets.secrets;
                    
                    // Find the new secret by comparing before/after lists
                    const newSecrets = secretsAfter.filter(secret => !secretsBefore.includes(secret));
                    if (newSecrets.length > 0) {
                        const newSecretKeyid = newSecrets[0]; // Take the first new secret
                        this.config.log('Detected new secret keyid:', newSecretKeyid);
                        
                        // Add the keyid to the response data
                        response.data.secretKeyid = newSecretKeyid;
                        response.secretKeyid = newSecretKeyid;
                    } else {
                        this.config.debug('No new secret detected in before/after comparison');
                    }
                } else {
                    this.config.debug('Failed to list secrets after generation for keyid detection');
                }
            }
        }

        return response;
    }

    /**
     * Import existing wallet/secret
     */
    async importSecret(walletData, options = {}) {
        const payload = {
            ...walletData,
            persist: options.persist || this.config.AUTH.COOKIE.PERSIST,
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            },
            ...options
        };

        this.config.debug('Importing secret');

        const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_IMPORT, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.ok && response.data) {
            this.config.log('Secret imported successfully');
            
            if (response.data.address) {
                this.walletAddress = response.data.address;
                this.config.debug('Imported wallet address:', this.walletAddress);
            }
        }

        return response;
    }

    /**
     * Commit message to AO process (reliable message delivery)
     */
    async commitMessage(messageData) {
        const payload = {
            target: this.config.PROCESS_ID,
            data: messageData.data || messageData.content,
            tags: [
                ...this.config.MESSAGES.DEFAULT_TAGS,
                ...this.config.MESSAGES.CHAT_TAGS,
                ...(messageData.tags || [])
            ],
            ...messageData
        };

        this.config.debug('Committing message:', payload);

        const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_COMMIT, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            this.config.log('Message committed successfully to process inbox');
        } else {
            this.config.log('Message commit failed:', response);
        }

        return response;
    }

    /**
     * Get current process slot number
     */
    async getCurrentSlot() {
        const response = await this.makeRequest(
            `/${this.config.PROCESS_ID}/compute/at-slot`,
            {
                method: 'GET'
            }
        );

        if (response.ok && response.data) {
            // Response comes back as a string number, parse it
            const slot = typeof response.data === 'string' ? parseInt(response.data.trim()) : parseInt(response.data);
            this.lastSlot = slot;
            this.config.debug('Current slot:', slot);
            return slot;
        }

        return null;
    }

    // REMOVED: triggerComputation - unused legacy method

    // REMOVED: waitForSlotAdvancement - unused legacy method

    // REMOVED: sendMessageWithExecution - unused legacy method

    /**
     * Direct push message (using &! pattern)
     */
    async pushMessage(message, action = 'chat_message', params = {}) {
        const endpoint = this.config.getEndpoint('PROCESS_PUSH_WITH_PARAMS', 
            this.config.PROCESS_ID, action, { 
                chat: message,
                timestamp: Date.now(),
                ...params 
            });
        
        this.config.debug('Push message endpoint:', endpoint);

        const response = await this.makeRequest(endpoint, {
            method: 'GET' // Using GET for URL-based parameters
        });

        return response;
    }

    /**
     * Get process state (/now endpoint)
     */
    async getProcessState() {
        const response = await this.makeRequest(
            this.config.getEndpoint('PROCESS_NOW', this.config.PROCESS_ID)
        );

        return response;
    }

    // REMOVED: parseHyperBEAMState - unused legacy method

    // REMOVED: healthCheck - unused method

    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            successRate: this.performanceMetrics.totalRequests > 0 
                ? (this.performanceMetrics.successfulRequests / this.performanceMetrics.totalRequests * 100).toFixed(2) + '%'
                : '0%',
            totalCookies: this.cookies.size,
            hasWalletAddress: !!this.walletAddress
        };
    }

    /**
     * Clear authentication state
     */
    clearAuth() {
        this.cookies.clear();
        this.authHeaders.clear();
        this.walletAddress = null;
        this.config.log('Authentication state cleared');
    }

    /**
     * List all available secrets in HyperBEAM
     */
    async listSecrets() {
        this.config.debug('Listing available secrets');
        
        const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_LIST, {
            method: 'GET'
        });

        if (response.ok && response.data) {
            // Parse the response to extract secret keyids
            const secrets = [];
            const data = response.data;
            
            // Look for numbered keys that contain secret: format
            for (const [key, value] of Object.entries(data)) {
                if (!isNaN(key) && typeof value === 'string' && value.startsWith('secret:')) {
                    secrets.push(value);
                }
            }
            
            this.config.debug('Available secrets:', secrets);
            return {
                success: true,
                secrets: secrets,
                response: response
            };
        }

        return {
            success: false,
            error: response.error || response.statusText,
            response: response
        };
    }

    /**
     * Export wallet using keyid (POST method with authentication)
     */
    async exportWallet(keyid) {
        if (!keyid) {
            return {
                success: false,
                error: 'No keyid provided for export'
            };
        }

        this.config.log('Attempting wallet export with keyid:', keyid);

        // Use POST with JSON array format (the approach that worked in testing)
        try {
            const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_EXPORT, {
                method: 'POST',
                body: JSON.stringify({ keyids: [keyid] })
            });

            if (response.ok && response.data) {
                this.config.log('Wallet export successful');
                return {
                    success: true,
                    wallet: response.data,
                    response: response
                };
            } else if (response.status === 400 && response.data && 
                       typeof response.data === 'string' && 
                       response.data.includes('No wallets found')) {
                return {
                    success: false,
                    error: 'Wallet not found or access denied. The wallet may have been created with different authentication.',
                    keyid: keyid
                };
            } else {
                return {
                    success: false,
                    error: `Export failed: ${response.statusText} (${response.status})`,
                    keyid: keyid,
                    response: response
                };
            }
        } catch (error) {
            this.config.debug('Wallet export error:', error);
            return {
                success: false,
                error: `Export request failed: ${error.message}`,
                keyid: keyid
            };
        }
    }

    /**
     * Import wallet to HyperBEAM memory from client-side storage
     */
    async importWalletToMemory(walletData, options = {}) {
        if (!walletData) {
            return {
                success: false,
                error: 'No wallet data provided for import'
            };
        }

        this.config.log('Importing wallet to HyperBEAM memory');

        const payload = {
            ...walletData,
            persist: options.persist || 'in-memory', // Store in HyperBEAM memory
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            },
            ...options
        };

        const response = await this.makeRequest(this.config.ENDPOINTS.SECRET_IMPORT, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.ok && response.data) {
            this.config.log('Wallet imported to HyperBEAM memory successfully');
            
            if (response.data.address) {
                this.walletAddress = response.data.address;
                this.config.debug('Imported wallet address:', this.walletAddress);
            }

            return {
                success: true,
                address: response.data.address,
                response: response
            };
        }

        return {
            success: false,
            error: response.error || response.statusText,
            response: response
        };
    }

    /**
     * Get current authentication status
     */
    isAuthenticated() {
        return this.cookies.size > 0 || this.authHeaders.size > 0 || !!this.walletAddress;
    }

    /**
     * Call whoami endpoint to establish wallet context with HyperBEAM
     * This is crucial for ensuring HyperBEAM has the wallet context for push operations
     */
    async whoami() {
        this.config.log('Making whoami request to establish wallet context with HyperBEAM');
        
        // Make whoami request to HyperBEAM - match the working curl format
        const whoamiUrl = `/${this.config.PROCESS_ID}/push&action=whoami&chat=&timestamp=${Date.now()}&!/serialize~json@1.0`;
        this.config.log('Whoami request URL:', whoamiUrl);
        
        const response = await this.makeRequest(whoamiUrl, {
            method: 'POST'  // Match the curl request method
        });
        
        if (!response.ok) {
            this.config.log('Whoami request failed:', response.statusText);
            return {
                success: false,
                error: response.statusText || 'Unknown error',
                response: response
            };
        }
        
        this.config.debug('Whoami response data:', response.data);
        
        // Extract wallet address from response if available
        if (response.data && typeof response.data === 'object') {
            let walletAddress = null;
            
            // Check outbox array first (primary location based on curl response)
            if (response.data.outbox && Array.isArray(response.data.outbox) && response.data.outbox.length > 0) {
                walletAddress = response.data.outbox[0].wallet_address;
                this.config.log('Found wallet address in outbox[0].wallet_address:', walletAddress);
            }
            
            // Fallback to other possible locations
            if (!walletAddress) {
                walletAddress = response.data.walletAddress || 
                               response.data.wallet_address ||
                               response.data.address ||
                               response.data.from ||
                               response.data.owner;
                
                if (walletAddress) {
                    this.config.log('Found wallet address in fallback location:', walletAddress.substring(0, 8) + '...');
                }
            }
            
            if (walletAddress) {
                this.config.log('🎯 HYPERBEAM API: Wallet address found in whoami response', {
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    fullWalletAddress: walletAddress,
                    previousWalletAddress: this.walletAddress,
                    source: 'whoami response parsing'
                });
                
                // Store the wallet address 
                this.walletAddress = walletAddress;
                
                // Dispatch wallet update event for other components
                if (typeof window !== 'undefined') {
                    this.config.log('📢 HYPERBEAM API: Dispatching wallet update event', {
                        walletAddress: walletAddress.substring(0, 8) + '...',
                        source: 'whoami'
                    });
                    
                    window.dispatchEvent(new CustomEvent('hyperbeam-wallet-update', {
                        detail: {
                            walletAddress: walletAddress,
                            source: 'whoami'
                        }
                    }));
                }
            }
        }
        
        this.config.log('Whoami request completed successfully');
        return {
            success: true,
            walletAddress: this.walletAddress,
            response: response
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HyperBEAMAPI;
}

if (typeof window !== 'undefined') {
    window.HyperBEAMAPI = HyperBEAMAPI;
}