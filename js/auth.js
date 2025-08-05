/**
 * Authentication System for HyperBEAM Chat
 * Handles wallet generation, import, and authentication state
 */
class AuthSystem {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.authMethod = null;
        this.authData = {};
        this.keyid = null;
        
        // UI Elements
        this.authPanel = null;
        this.chatInterface = null;
        this.authIndicator = null;
        this.authText = null;
        this.userAddress = null;
        this.currentUserSpan = null;
    }

    /**
     * Initialize the authentication system
     */
    init() {
        this.bindUIElements();
        this.bindEvents();
        this.checkExistingAuth();
        this.updateUI();
        
        // Check HyperBEAM connectivity
        this.checkConnectivity();
    }

    /**
     * Bind UI elements
     */
    bindUIElements() {
        this.authPanel = document.getElementById('auth-panel');
        this.chatInterface = document.getElementById('chat-interface');
        this.authIndicator = document.getElementById('auth-indicator');
        this.authText = document.getElementById('auth-text');
        this.userAddress = document.getElementById('user-address');
        this.currentUserSpan = document.getElementById('current-user');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Generate wallet button
        document.getElementById('generate-wallet-btn').addEventListener('click', () => {
            this.generateWallet();
        });

        // Import wallet button
        document.getElementById('import-wallet-btn').addEventListener('click', () => {
            this.importWallet();
        });

        // Basic auth button
        document.getElementById('basic-auth-btn').addEventListener('click', () => {
            this.basicAuth();
        });

        // Disconnect button
        document.getElementById('disconnect-btn').addEventListener('click', () => {
            this.disconnect();
        });
    }

    /**
     * Check for existing authentication
     */
    checkExistingAuth() {
        // Check for stored auth data
        const storedAuth = localStorage.getItem('hyperbeam-chat-auth');
        if (storedAuth) {
            try {
                const authData = JSON.parse(storedAuth);
                this.restoreAuth(authData);
            } catch (error) {
                console.warn('Failed to restore authentication:', error);
                localStorage.removeItem('hyperbeam-chat-auth');
            }
        }
    }

    /**
     * Check HyperBEAM node connectivity
     */
    async checkConnectivity() {
        try {
            const isHealthy = await window.HyperBEAM.healthCheck();
            if (!isHealthy) {
                this.showStatus('Warning: Cannot connect to HyperBEAM node', 'warning');
            }
        } catch (error) {
            this.showStatus('Error: HyperBEAM node unreachable', 'error');
        }
    }

    /**
     * Generate a new wallet
     */
    async generateWallet() {
        const generateBtn = document.getElementById('generate-wallet-btn');
        const originalText = generateBtn.textContent;
        
        try {
            generateBtn.textContent = 'Generating...';
            generateBtn.disabled = true;
            
            // Get selected persistence mode
            const persistMode = document.querySelector('input[name="persist"]:checked').value;
            
            this.showStatus('Generating new wallet...', 'info');
            
            const response = await window.HyperBEAM.generateWallet({
                persist: persistMode
            });
            
            if (response.body || response.keyid) {
                // Success - wallet generated
                const keyid = response.body || response.keyid;
                const walletAddress = response['wallet-address'] || response.committer || keyid;
                
                this.handleAuthSuccess({
                    method: 'generated-wallet',
                    keyid: keyid,
                    walletAddress: walletAddress,
                    persist: persistMode,
                    cookies: this.extractCookiesFromResponse(response)
                });
                
                this.showStatus('Wallet generated successfully!', 'success');
            } else {
                throw new Error('Invalid response from wallet generation');
            }
            
        } catch (error) {
            this.showStatus(`Failed to generate wallet: ${error.message}`, 'error');
            console.error('Wallet generation error:', error);
        } finally {
            generateBtn.textContent = originalText;
            generateBtn.disabled = false;
        }
    }

    /**
     * Import an existing wallet
     */
    async importWallet() {
        const importBtn = document.getElementById('import-wallet-btn');
        const walletJsonTextarea = document.getElementById('wallet-json');
        const originalText = importBtn.textContent;
        
        try {
            const walletJson = walletJsonTextarea.value.trim();
            if (!walletJson) {
                this.showStatus('Please paste your wallet JSON', 'warning');
                return;
            }

            // Validate JSON
            try {
                JSON.parse(walletJson);
            } catch (error) {
                this.showStatus('Invalid wallet JSON format', 'error');
                return;
            }

            importBtn.textContent = 'Importing...';
            importBtn.disabled = true;
            
            this.showStatus('Importing wallet...', 'info');
            
            const response = await window.HyperBEAM.importWallet(walletJson, {
                persist: 'in-memory' // Default for imported wallets
            });
            
            if (response.body || response.keyid) {
                // Success - wallet imported
                const keyid = response.body || response.keyid;
                const walletAddress = response['wallet-address'] || response.committer || keyid;
                
                this.handleAuthSuccess({
                    method: 'imported-wallet',
                    keyid: keyid,
                    walletAddress: walletAddress,
                    persist: 'in-memory',
                    cookies: this.extractCookiesFromResponse(response)
                });
                
                this.showStatus('Wallet imported successfully!', 'success');
                walletJsonTextarea.value = ''; // Clear the textarea
            } else {
                throw new Error('Invalid response from wallet import');
            }
            
        } catch (error) {
            this.showStatus(`Failed to import wallet: ${error.message}`, 'error');
            console.error('Wallet import error:', error);
        } finally {
            importBtn.textContent = originalText;
            importBtn.disabled = false;
        }
    }

    /**
     * Authenticate with HTTP Basic Auth
     */
    async basicAuth() {
        const basicBtn = document.getElementById('basic-auth-btn');
        const username = document.getElementById('basic-username').value.trim();
        const password = document.getElementById('basic-password').value.trim();
        const originalText = basicBtn.textContent;
        
        try {
            if (!username || !password) {
                this.showStatus('Please enter username and password', 'warning');
                return;
            }

            basicBtn.textContent = 'Connecting...';
            basicBtn.disabled = true;
            
            this.showStatus('Testing HTTP Basic authentication...', 'info');
            
            // Test basic auth by generating a wallet with HTTP auth
            const basicAuthString = window.HyperBEAM.createBasicAuth(username, password);
            
            // Generate wallet using HTTP Basic Auth
            const response = await window.HyperBEAM.generateWallet({
                persist: 'in-memory',
                'access-control': { device: 'http-auth@1.0' }
            });
            
            // If we get here, auth worked and wallet was generated
            const keyid = response.body || response.keyid;
            const walletAddress = response['wallet-address'] || response.committer || keyid;
            
            this.handleAuthSuccess({
                method: 'basic-auth',
                username: username,
                basicAuth: basicAuthString,
                walletAddress: walletAddress,
                keyid: keyid
            });
            
            this.showStatus('HTTP Basic authentication successful!', 'success');
            
            // Clear password field for security
            document.getElementById('basic-password').value = '';
            
        } catch (error) {
            this.showStatus(`HTTP Basic authentication failed: ${error.message}`, 'error');
            console.error('Basic auth error:', error);
        } finally {
            basicBtn.textContent = originalText;
            basicBtn.disabled = false;
        }
    }

    /**
     * Handle successful authentication
     */
    handleAuthSuccess(authData) {
        this.isAuthenticated = true;
        this.authMethod = authData.method;
        this.authData = authData;
        this.currentUser = authData.walletAddress;
        this.keyid = authData.keyid;
        
        // Store auth data
        localStorage.setItem('hyperbeam-chat-auth', JSON.stringify(authData));
        
        this.updateUI();
        
        // Initialize chat
        if (window.Chat) {
            window.Chat.onAuthChanged(this.getAuthHeaders());
        }
    }

    /**
     * Restore authentication from stored data
     */
    restoreAuth(authData) {
        this.isAuthenticated = true;
        this.authMethod = authData.method;
        this.authData = authData;
        this.currentUser = authData.walletAddress;
        this.keyid = authData.keyid;
        
        this.updateUI();
    }

    /**
     * Get authentication headers for API requests
     */
    getAuthHeaders() {
        if (!this.isAuthenticated) return {};
        
        const headers = {};
        
        switch (this.authMethod) {
            case 'generated-wallet':
            case 'imported-wallet':
                if (this.authData.cookies) {
                    headers.cookie = this.formatCookies(this.authData.cookies);
                }
                break;
            case 'basic-auth':
                headers.basic = this.authData.basicAuth;
                break;
        }
        
        return headers;
    }

    /**
     * Get current keyid for message signing
     */
    getCurrentKeyId() {
        return this.keyid;
    }

    /**
     * Disconnect from chat
     */
    disconnect() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.authMethod = null;
        this.authData = {};
        this.keyid = null;
        
        // Clear stored auth
        localStorage.removeItem('hyperbeam-chat-auth');
        
        this.updateUI();
        
        // Notify chat system
        if (window.Chat) {
            window.Chat.onAuthChanged(null);
        }
        
        this.showStatus('Disconnected from chat', 'info');
    }

    /**
     * Update UI based on authentication state
     */
    updateUI() {
        if (this.isAuthenticated) {
            // Hide auth panel, show chat
            this.authPanel.classList.add('hidden');
            this.chatInterface.classList.remove('hidden');
            
            // Update status indicator
            this.authIndicator.className = 'status-indicator online';
            this.authText.textContent = 'Connected';
            this.userAddress.textContent = this.currentUser;
            this.userAddress.classList.remove('hidden');
            this.currentUserSpan.textContent = this.currentUser;
        } else {
            // Show auth panel, hide chat
            this.authPanel.classList.remove('hidden');
            this.chatInterface.classList.add('hidden');
            
            // Update status indicator
            this.authIndicator.className = 'status-indicator offline';
            this.authText.textContent = 'Not Connected';
            this.userAddress.classList.add('hidden');
        }
    }

    /**
     * Extract cookies from HyperBEAM response
     */
    extractCookiesFromResponse(response) {
        return window.HyperBEAM.parseCookies(response);
    }

    /**
     * Format cookies for HTTP headers
     */
    formatCookies(cookies) {
        return Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    /**
     * Show status message
     */
    showStatus(message, type = 'info') {
        const statusContainer = document.getElementById('status-messages');
        const statusElement = document.createElement('div');
        statusElement.className = `status-message ${type}`;
        statusElement.textContent = message;
        
        statusContainer.appendChild(statusElement);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (statusElement.parentNode) {
                statusElement.parentNode.removeChild(statusElement);
            }
        }, 5000);
        
        // Also log to console
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Create global Auth instance
window.Auth = new AuthSystem();