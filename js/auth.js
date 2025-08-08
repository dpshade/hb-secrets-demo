/**
 * HyperBEAM Authentication System
 * 
 * Handles multiple authentication methods including cookie-based auth,
 * HTTP Basic auth, wallet generation, and session management.
 */

class AuthSystem {
    constructor(hyperbeamAPI) {
        this.api = hyperbeamAPI;
        this.config = hyperbeamAPI.config;
        this.currentMethod = null;
        this.authState = {
            authenticated: false,
            method: null,
            walletAddress: null,
            username: null,
            sessionStarted: null,
            lastActivity: null
        };
        
        // Load persisted auth state
        this.loadPersistedAuth();
        
        this.config.log('Authentication system initialized');
    }

    /**
     * Auto-authenticate using HyperBEAM automatic authentication
     */
    async autoAuthenticate() {
        this.config.log('Using HyperBEAM automatic authentication');
        
        // HyperBEAM automatically generates secrets when using &! parameter
        // We don't need to authenticate upfront - just mark as authenticated
        // and let HyperBEAM handle it during API calls
        
        await this.handleSuccessfulAuth({
            method: 'hyperbeam-auto',
            walletAddress: 'auto-generated',
            username: 'HyperBEAM User'
        });

        return {
            success: true,
            method: 'hyperbeam-auto',
            walletAddress: 'auto-generated',
            note: 'Using HyperBEAM automatic authentication with &! parameter'
        };
    }

    /**
     * Cookie-based authentication (primary method)
     */
    async authenticateWithCookies(options = {}) {
        this.config.log('Attempting cookie-based authentication');
        
        const response = await this.api.generateSecret({
            persist: options.persist || this.config.AUTH.COOKIE.PERSIST,
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            }
        });

        if (response.ok && response.data) {
            await this.handleSuccessfulAuth({
                method: 'cookie',
                response: response,
                walletAddress: response.data.address,
                data: response.data
            });

            return {
                success: true,
                method: 'cookie',
                walletAddress: response.data.address,
                response: response
            };
        }

        return {
            success: false,
            method: 'cookie',
            error: response.error || response.statusText,
            response: response
        };
    }

    /**
     * HTTP Basic authentication
     */
    async authenticateWithBasicAuth(username, password) {
        this.config.log('Attempting HTTP Basic authentication');
        
        // Generate authentication header
        const credentials = btoa(`${username}:${password}`);
        this.api.authHeaders.set('Authorization', `Basic ${credentials}`);

        // Store username for session
        this.authState.username = username;

        try {
            // Test the authentication by making a simple request
            const testResponse = await this.api.getCurrentSlot();
            
            if (testResponse !== null) {
                await this.handleSuccessfulAuth({
                    method: 'http-basic',
                    username: username,
                    walletAddress: 'generated-from-credentials'
                });

                return {
                    success: true,
                    method: 'http-basic',
                    username: username,
                    walletAddress: 'generated-from-credentials'
                };
            } else {
                throw new Error('Authentication test failed');
            }
        } catch (error) {
            // Clear the failed auth header
            this.api.authHeaders.delete('Authorization');
            this.authState.username = null;
            
            return {
                success: false,
                method: 'http-basic',
                error: error.message
            };
        }
    }

    /**
     * Generate new wallet
     */
    async generateNewWallet(options = {}) {
        this.config.log('Generating new wallet');
        
        const response = await this.api.generateSecret({
            persist: options.persist || 'client',
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            },
            ...options
        });

        if (response.ok && response.data) {
            await this.handleSuccessfulAuth({
                method: 'generated',
                response: response,
                walletAddress: response.data.address,
                data: response.data
            });

            return {
                success: true,
                method: 'generated',
                walletAddress: response.data.address,
                response: response,
                isNewWallet: true
            };
        }

        return {
            success: false,
            method: 'generated',
            error: response.error || response.statusText,
            response: response
        };
    }

    /**
     * Import existing wallet
     */
    async importWallet(walletData, options = {}) {
        this.config.log('Importing existing wallet');
        
        // Validate wallet data format
        if (!this.validateWalletData(walletData)) {
            return {
                success: false,
                method: 'import',
                error: 'Invalid wallet data format'
            };
        }

        const response = await this.api.importSecret(walletData, {
            persist: options.persist || 'client',
            'access-control': {
                device: this.config.AUTH.COOKIE.ACCESS_CONTROL_DEVICE
            },
            ...options
        });

        if (response.ok && response.data) {
            await this.handleSuccessfulAuth({
                method: 'imported',
                response: response,
                walletAddress: response.data.address,
                data: response.data
            });

            return {
                success: true,
                method: 'imported',
                walletAddress: response.data.address,
                response: response,
                isImported: true
            };
        }

        return {
            success: false,
            method: 'imported',
            error: response.error || response.statusText,
            response: response
        };
    }

    /**
     * Validate wallet data format
     */
    validateWalletData(walletData) {
        if (!walletData) return false;
        
        // Check for Arweave wallet format
        if (walletData.kty && walletData.n && walletData.e && walletData.d) {
            return true;
        }
        
        // Check for private key format
        if (typeof walletData === 'string' && walletData.length >= 32) {
            return true;
        }
        
        // Check for mnemonic format
        if (typeof walletData === 'string' && walletData.split(' ').length >= 12) {
            return true;
        }
        
        return false;
    }

    /**
     * Handle successful authentication
     */
    async handleSuccessfulAuth(authData) {
        this.currentMethod = authData.method;
        
        // Preserve existing wallet address if the new one is 'auto-generated'
        const preservedWalletAddress = (authData.walletAddress === 'auto-generated' && this.authState.walletAddress && this.authState.walletAddress !== 'auto-generated') 
            ? this.authState.walletAddress 
            : authData.walletAddress;
            
        this.authState = {
            authenticated: true,
            method: authData.method,
            walletAddress: preservedWalletAddress,
            username: authData.username,
            sessionStarted: Date.now(),
            lastActivity: Date.now(),
            data: authData.data
        };

        // Persist auth state
        this.persistAuthState();
        
        this.config.log(`Authentication successful using ${authData.method}`, {
            walletAddress: authData.walletAddress,
            username: authData.username
        });

        // Emit auth event if available
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('hyperbeam-auth-success', {
                detail: {
                    method: authData.method,
                    walletAddress: authData.walletAddress,
                    username: authData.username
                }
            }));
        }
    }

    /**
     * Sign out and clear authentication
     */
    async signOut() {
        this.config.log('Signing out');
        
        // Clear API authentication
        this.api.clearAuth();
        
        // Clear auth state
        this.authState = {
            authenticated: false,
            method: null,
            walletAddress: null,
            username: null,
            sessionStarted: null,
            lastActivity: null
        };
        
        this.currentMethod = null;
        
        // Clear persisted auth
        this.clearPersistedAuth();
        
        // Emit signout event if available
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('hyperbeam-auth-signout'));
        }
    }

    /**
     * Validate current session
     */
    async validateSession() {
        if (!this.authState.authenticated) {
            return false;
        }

        // Check session age (optional timeout)
        const maxSessionAge = 24 * 60 * 60 * 1000; // 24 hours
        if (Date.now() - this.authState.sessionStarted > maxSessionAge) {
            this.config.debug('Session expired due to age');
            return false;
        }

        try {
            // Test authentication with a simple API call
            const response = await this.api.getCurrentSlot();
            if (response !== null) {
                // Update last activity
                this.authState.lastActivity = Date.now();
                this.persistAuthState();
                return true;
            }
        } catch (error) {
            this.config.debug('Session validation failed:', error);
        }

        return false;
    }

    /**
     * Persist authentication state to localStorage
     */
    persistAuthState() {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const persistData = {
                    authenticated: this.authState.authenticated,
                    method: this.authState.method,
                    walletAddress: this.authState.walletAddress,
                    username: this.authState.username,
                    sessionStarted: this.authState.sessionStarted,
                    lastActivity: this.authState.lastActivity
                    // Note: Don't persist sensitive data like keys or full wallet data
                };
                
                localStorage.setItem('hyperbeam-auth', JSON.stringify(persistData));
                this.config.debug('Auth state persisted');
            } catch (error) {
                this.config.debug('Failed to persist auth state:', error);
            }
        }
    }

    /**
     * Load persisted authentication state
     */
    loadPersistedAuth() {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const stored = localStorage.getItem('hyperbeam-auth');
                if (stored) {
                    const persistData = JSON.parse(stored);
                    this.authState = {
                        ...this.authState,
                        ...persistData
                    };
                    this.currentMethod = persistData.method;
                    this.config.debug('Auth state loaded from storage');
                    
                    // If wallet address exists, dispatch event to update UI
                    if (persistData.walletAddress) {
                        this.config.log('Restored wallet address from localStorage:', persistData.walletAddress);
                        setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('hyperbeam-wallet-restore', {
                                detail: {
                                    walletAddress: persistData.walletAddress,
                                    source: 'localStorage-restore'
                                }
                            }));
                        }, 100); // Small delay to ensure UI is ready
                    }
                }
            } catch (error) {
                this.config.debug('Failed to load persisted auth state:', error);
                this.clearPersistedAuth();
            }
        }
    }

    /**
     * Clear persisted authentication state
     */
    clearPersistedAuth() {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                localStorage.removeItem('hyperbeam-auth');
                this.config.debug('Persisted auth state cleared');
            } catch (error) {
                this.config.debug('Failed to clear persisted auth state:', error);
            }
        }
    }

    /**
     * Get current authentication status
     */
    getAuthStatus() {
        return {
            authenticated: this.authState.authenticated,
            method: this.authState.method,
            walletAddress: this.authState.walletAddress,
            username: this.authState.username,
            sessionAge: this.authState.sessionStarted 
                ? Date.now() - this.authState.sessionStarted 
                : 0,
            lastActivity: this.authState.lastActivity,
            isSessionValid: this.authState.authenticated // Simple check, use validateSession() for thorough validation
        };
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        // HyperBEAM handles authentication automatically with &! parameter
        // Always return true to allow message sending
        return true;
    }

    /**
     * Get wallet address
     */
    getWalletAddress() {
        return this.authState.walletAddress;
    }
    
    /**
     * Update the wallet address in auth state (from message responses)
     */
    updateWalletAddress(walletAddress) {
        if (!walletAddress) return;
        
        this.config.log('Updating wallet address in auth state:', walletAddress);
        this.authState.walletAddress = walletAddress;
        this.authState.lastActivity = Date.now();
        
        // Use the same persistAuthState method for consistency
        this.persistAuthState();
    }

    /**
     * Get username (for basic auth)
     */
    getUsername() {
        return this.authState.username;
    }

    /**
     * Get authentication method
     */
    getAuthMethod() {
        return this.authState.method;
    }

    /**
     * Update activity timestamp
     */
    updateActivity() {
        if (this.authState.authenticated) {
            this.authState.lastActivity = Date.now();
            this.persistAuthState();
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthSystem;
}

if (typeof window !== 'undefined') {
    window.AuthSystem = AuthSystem;
}