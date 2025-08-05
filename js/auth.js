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
        this.authPanel = document.querySelector('.auth-builder-panel');
        this.chatInterface = document.getElementById('chat-interface');
        this.authIndicator = document.getElementById('auth-indicator');
        this.authText = document.getElementById('auth-text');
        this.userAddress = document.getElementById('user-address');
        this.currentUserSpan = document.getElementById('current-user');
        this.welcomeState = document.getElementById('welcome-state');
        this.connectedAddress = document.getElementById('connected-address');
        this.connectedDisconnectBtn = document.getElementById('connected-disconnect-btn');
        
        // Wallet management elements
        this.walletsLoading = document.getElementById('wallets-loading');
        this.walletsList = document.getElementById('wallets-list');
        this.refreshWalletsBtn = document.getElementById('refresh-wallets-btn');
        this.exportWalletsBtn = document.getElementById('export-wallets-btn');
        this.syncWalletsBtn = document.getElementById('sync-wallets-btn');
        this.syncFromPeerBtn = document.getElementById('sync-from-peer-btn');
        this.peerNodeInput = document.getElementById('peer-node-input');
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

        // Connected disconnect button  
        document.getElementById('connected-disconnect-btn').addEventListener('click', () => {
            this.disconnect();
        });

        // Wallet management events
        this.refreshWalletsBtn.addEventListener('click', () => {
            this.loadWallets();
        });

        this.exportWalletsBtn.addEventListener('click', () => {
            this.exportAllWallets();
        });

        this.syncWalletsBtn.addEventListener('click', () => {
            this.toggleSyncOptions();
        });

        this.syncFromPeerBtn.addEventListener('click', () => {
            this.syncFromPeer();
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
            
            // Get selected persistence mode from storage tabs
            const activeStorageTab = document.querySelector('.storage-tab.active');
            const persistMode = activeStorageTab ? activeStorageTab.getAttribute('data-persist') : 'in-memory';
            
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
        const privateKeyInput = document.getElementById('private-key-input');
        const mnemonicInput = document.getElementById('mnemonic-input');
        const walletJsonInput = document.getElementById('wallet-json');
        const originalText = importBtn.textContent;
        
        try {
            const privateKey = privateKeyInput ? privateKeyInput.value.trim() : '';
            const mnemonic = mnemonicInput ? mnemonicInput.value.trim() : '';
            const walletJson = walletJsonInput ? walletJsonInput.value.trim() : '';
            
            if (!privateKey && !mnemonic && !walletJson) {
                this.showStatus('Please enter your private key, mnemonic phrase, or wallet JSON', 'warning');
                return;
            }
            
            // Determine which import method to use
            let walletData;
            if (walletJson) {
                // Try to parse as JSON first
                try {
                    JSON.parse(walletJson);
                    walletData = walletJson;
                } catch (error) {
                    this.showStatus('Invalid wallet JSON format', 'error');
                    return;
                }
            } else {
                // Use private key if provided, otherwise use mnemonic
                walletData = privateKey || mnemonic;
            }

            // Basic validation for private key or mnemonic
            if (privateKey && privateKey.length < 32) {
                this.showStatus('Private key appears to be too short', 'warning');
            }
            
            if (mnemonic && mnemonic.split(' ').length < 12) {
                this.showStatus('Mnemonic phrase should have at least 12 words', 'warning');
            }

            importBtn.textContent = 'Importing...';
            importBtn.disabled = true;
            
            this.showStatus('Importing wallet...', 'info');
            
            const response = await window.HyperBEAM.importWallet(walletData, {
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
                // Clear the input fields
                if (privateKeyInput) privateKeyInput.value = '';
                if (mnemonicInput) mnemonicInput.value = '';
                if (walletJsonInput) walletJsonInput.value = '';
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
     * Authenticate with HTTP Basic Auth (Deterministic Wallet)
     */
    async basicAuth() {
        const basicBtn = document.getElementById('basic-auth-btn');
        const usernameInput = document.getElementById('username-input');
        const passwordInput = document.getElementById('password-input');
        const originalText = basicBtn.textContent;
        
        if (!usernameInput || !passwordInput) {
            this.showStatus('Username or password input fields not found', 'error');
            return;
        }
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        try {
            if (!username || !password) {
                this.showStatus('Please enter username and password', 'warning');
                return;
            }

            basicBtn.textContent = 'Connecting...';
            basicBtn.disabled = true;
            
            this.showStatus('Authenticating with deterministic wallet...', 'info');
            
            // The HyperBEAM node will derive the same wallet from these credentials
            // using PBKDF2 with consistent salt and iterations
            const response = await window.HyperBEAM.generateWalletBasicAuth(username, password, {
                persist: 'in-memory',
                'access-control': { device: 'http-auth@1.0' }
            });
            
            // Extract wallet info from response
            const keyid = response.body || response.keyid;
            const walletAddress = response['wallet-address'] || response.committer || keyid;
            
            this.handleAuthSuccess({
                method: 'basic-auth',
                username: username,
                basicAuth: `${username}:${password}`,
                walletAddress: walletAddress,
                keyid: keyid
            });
            
            this.showStatus('HTTP Basic authentication successful! Same credentials will always generate the same wallet.', 'success');
            
            // Clear password field for security
            if (passwordInput) passwordInput.value = '';
            
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
            // Make auth panel smaller and show connected state, show chat
            if (this.authPanel) this.authPanel.classList.add('connected');
            if (this.chatInterface) this.chatInterface.classList.remove('hidden');
            if (this.welcomeState) this.welcomeState.classList.add('hidden');
            
            // Update status indicator
            if (this.authIndicator) this.authIndicator.className = 'status-indicator online';
            if (this.authText) this.authText.textContent = 'Connected';
            if (this.userAddress) {
                this.userAddress.textContent = this.currentUser;
                this.userAddress.classList.remove('hidden');
            }
            if (this.currentUserSpan) this.currentUserSpan.textContent = this.currentUser;
            
            // Update connected summary
            if (this.connectedAddress) this.connectedAddress.textContent = this.currentUser;
        } else {
            // Show auth panel in full size, hide chat
            if (this.authPanel) this.authPanel.classList.remove('connected');
            if (this.chatInterface) this.chatInterface.classList.add('hidden');
            if (this.welcomeState) this.welcomeState.classList.remove('hidden');
            
            // Update status indicator
            if (this.authIndicator) this.authIndicator.className = 'status-indicator offline';
            if (this.authText) this.authText.textContent = 'Not Connected';
            if (this.userAddress) this.userAddress.classList.add('hidden');
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
        if (!statusContainer) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            return;
        }
        
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

    /**
     * Load wallets from HyperBEAM node
     */
    async loadWallets() {
        if (!this.walletsLoading || !this.walletsList) return;
        
        try {
            this.walletsLoading.classList.remove('hidden');
            this.walletsList.innerHTML = '';
            
            const response = await window.HyperBEAM.listWallets();
            
            if (response) {
                const wallets = this.parseWalletsFromResponse(response);
                if (wallets.length > 0) {
                    this.renderWallets(wallets);
                } else {
                    this.showNoWallets();
                }
            } else {
                this.showNoWallets();
            }
            
        } catch (error) {
            console.warn('Failed to load wallets:', error);
            this.showWalletsError('Failed to load wallets from node');
        } finally {
            this.walletsLoading.classList.add('hidden');
        }
    }

    /**
     * Parse wallets from HyperBEAM list response
     */
    parseWalletsFromResponse(response) {
        const wallets = [];
        
        // HyperBEAM returns wallets as numbered properties mixed with headers
        // We need to filter for properties that contain "secret:" values
        if (response && typeof response === 'object') {
            Object.entries(response).forEach(([key, value]) => {
                // Check if this is a wallet entry (numeric key with secret: value)
                if (!isNaN(key) && typeof value === 'string' && value.startsWith('secret:')) {
                    wallets.push({
                        keyid: value,
                        id: key,
                        address: value, // For display purposes
                        'wallet-address': value,
                        persist: 'unknown', // We don't have this info from list response
                        'access-control': { device: 'unknown' }
                    });
                }
            });
        }
        
        return wallets;
    }

    /**
     * Render wallets list
     */
    renderWallets(wallets) {
        if (!wallets || wallets.length === 0) {
            this.showNoWallets();
            return;
        }

        const walletsHtml = wallets.map(wallet => this.renderWalletItem(wallet)).join('');
        this.walletsList.innerHTML = walletsHtml;

        // Add click handlers for wallet actions (only if not already added)
        if (!this.walletsList.hasAttribute('data-handlers-attached')) {
            this.walletsList.addEventListener('click', (e) => {
                if (e.target.classList.contains('wallet-action-btn')) {
                    const action = e.target.dataset.action;
                    const keyid = e.target.closest('.wallet-item').dataset.keyid;
                    this.handleWalletAction(action, keyid);
                } else if (e.target.closest('.wallet-item')) {
                    const keyid = e.target.closest('.wallet-item').dataset.keyid;
                    this.selectWallet(keyid);
                }
            });
            this.walletsList.setAttribute('data-handlers-attached', 'true');
        }
    }

    /**
     * Render individual wallet item
     */
    renderWalletItem(wallet) {
        const keyid = wallet.keyid || wallet.id || 'unknown';
        const address = wallet.address || wallet['wallet-address'] || keyid;
        const isActive = this.keyid === keyid;
        const status = isActive ? 'active' : 'stored';
        const statusText = isActive ? 'Active' : 'Stored';
        
        // Format metadata - show what we know from HyperBEAM
        const walletIndex = wallet.id || 'unknown';
        const persist = wallet.persist || 'hosted'; // We know it's hosted if it's in the list
        const accessControl = wallet['access-control'] || wallet.accessControl || {};
        const device = accessControl.device || 'cookie/http-auth';
        
        // Extract the secret hash part for display
        const secretHash = keyid.startsWith('secret:') ? keyid.substring(7) : keyid;
        const displayHash = this.truncateKeyId(secretHash);
        
        return `
            <div class="wallet-item ${isActive ? 'active' : ''}" data-keyid="${keyid}">
                <div class="wallet-info">
                    <div class="wallet-keyid">Wallet #${walletIndex}</div>
                    <div class="wallet-address">${displayHash}</div>
                    <div class="wallet-meta">
                        <span class="wallet-status ${status}">${statusText}</span>
                        • ${persist} • ${device}
                    </div>
                </div>
                <div class="wallet-actions-item">
                    ${!isActive ? '<button class="wallet-action-btn" data-action="use" title="Connect to this wallet">Connect</button>' : ''}
                    <button class="wallet-action-btn" data-action="export" title="Export wallet data">Export</button>
                    <button class="wallet-action-btn" data-action="copy" title="Copy wallet secret">Copy</button>
                </div>
            </div>
        `;
    }

    /**
     * Handle wallet actions
     */
    async handleWalletAction(action, keyid) {
        switch (action) {
            case 'use':
                await this.useWallet(keyid);
                break;
            case 'export':
                await this.exportWallet(keyid);
                break;
            case 'copy':
                this.copyWalletId(keyid);
                break;
        }
    }

    /**
     * Use a different wallet
     */
    async useWallet(keyid) {
        try {
            this.showStatus('Connecting to wallet...', 'info');
            
            // First disconnect from current wallet (clears UI state)
            this.disconnect();
            
            // Simulate the full connection flow like generateWallet
            const walletAddress = keyid; // The keyid is the wallet address for hosted wallets
            
            // Determine the method based on how this wallet was created
            // For hosted wallets, we'll use the same auth method as current session
            const authMethod = this.authMethod || 'hosted-wallet';
            
            // Create auth data similar to generateWallet success
            const authData = {
                method: authMethod,
                keyid: keyid,
                walletAddress: walletAddress,
                persist: 'hosted', // It's a hosted wallet since it's in the list
                cookies: this.authData?.cookies || {}, // Preserve existing cookies if any
                basicAuth: this.authData?.basicAuth || null // Preserve basic auth if any
            };
            
            // Use the same success handler as generate wallet
            this.handleAuthSuccess(authData);
            
            this.showStatus('Successfully connected to wallet!', 'success');
            
            // Refresh wallet list to show new active state
            setTimeout(() => {
                this.loadWallets();
            }, 500);
            
        } catch (error) {
            this.showStatus(`Failed to connect to wallet: ${error.message}`, 'error');
            console.error('Wallet connection error:', error);
        }
    }

    /**
     * Export specific wallet
     */
    async exportWallet(keyid) {
        try {
            this.showStatus('Exporting wallet...', 'info');
            
            // Format keyids as array for the export API
            const keyidsToExport = [keyid];
            
            // Get authentication headers
            const authHeaders = this.getAuthHeaders();
            
            const response = await window.HyperBEAM.exportWallet(keyidsToExport, authHeaders);
            
            if (response) {
                // Extract a clean filename from the keyid
                const cleanKeyid = keyid.startsWith('secret:') ? keyid.substring(7) : keyid;
                const shortKeyid = cleanKeyid.substring(0, 12);
                const timestamp = new Date().toISOString().split('T')[0];
                
                // Create download link
                const blob = new Blob([JSON.stringify(response, null, 2)], { 
                    type: 'application/json' 
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `hyperbeam-wallet-${shortKeyid}-${timestamp}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                this.showStatus(`Wallet exported successfully: ${this.truncateKeyId(keyid)}`, 'success');
            } else {
                throw new Error('Empty response from export API');
            }
        } catch (error) {
            this.showStatus(`Failed to export wallet: ${error.message}`, 'error');
            console.error('Wallet export error:', error);
        }
    }

    /**
     * Copy wallet ID to clipboard
     */
    async copyWalletId(keyid) {
        try {
            await navigator.clipboard.writeText(keyid);
            this.showStatus('Wallet secret copied to clipboard', 'success');
        } catch (error) {
            // Fallback for browsers that don't support clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = keyid;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.showStatus('Wallet secret copied to clipboard', 'success');
            } catch (fallbackError) {
                this.showStatus('Failed to copy to clipboard', 'error');
            }
            document.body.removeChild(textArea);
        }
    }

    /**
     * Select wallet (highlight it)
     */
    selectWallet(keyid) {
        // Remove active class from all items
        this.walletsList.querySelectorAll('.wallet-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to selected item
        const selectedItem = this.walletsList.querySelector(`[data-keyid="${keyid}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
        }
    }

    /**
     * Export all wallets
     */
    async exportAllWallets() {
        const exportBtn = this.exportWalletsBtn;
        const originalText = exportBtn.textContent;
        
        try {
            exportBtn.textContent = 'Exporting...';
            exportBtn.disabled = true;
            
            const response = await window.HyperBEAM.exportWallet('all', this.getAuthHeaders());
            
            if (response) {
                // Create download link
                const blob = new Blob([JSON.stringify(response, null, 2)], { 
                    type: 'application/json' 
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `hyperbeam-wallets-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                this.showStatus('All wallets exported successfully', 'success');
            }
        } catch (error) {
            this.showStatus(`Failed to export wallets: ${error.message}`, 'error');
        } finally {
            exportBtn.textContent = originalText;
            exportBtn.disabled = false;
        }
    }

    /**
     * Toggle sync options visibility
     */
    toggleSyncOptions() {
        const syncOptions = document.querySelector('.sync-options');
        if (syncOptions) {
            const isVisible = syncOptions.style.display !== 'none';
            syncOptions.style.display = isVisible ? 'none' : 'block';
        }
    }

    /**
     * Sync wallets from peer node
     */
    async syncFromPeer() {
        const peerUrl = this.peerNodeInput.value.trim();
        
        if (!peerUrl) {
            this.showStatus('Please enter a peer node URL', 'warning');
            return;
        }

        const syncBtn = this.syncFromPeerBtn;
        const originalText = syncBtn.textContent;
        
        try {
            syncBtn.textContent = 'Syncing...';
            syncBtn.disabled = true;
            
            const response = await window.HyperBEAM.syncWallets(peerUrl);
            
            if (response) {
                this.showStatus('Wallets synced successfully from peer', 'success');
                // Refresh the wallets list
                setTimeout(() => this.loadWallets(), 1000);
            }
        } catch (error) {
            this.showStatus(`Failed to sync wallets: ${error.message}`, 'error');
        } finally {
            syncBtn.textContent = originalText;
            syncBtn.disabled = false;
        }
    }

    /**
     * Show no wallets message
     */
    showNoWallets() {
        this.walletsList.innerHTML = `
            <div class="no-wallets-message">
                <p>No stored wallets found. Generate or import a wallet to get started.</p>
            </div>
        `;
    }

    /**
     * Show wallets error
     */
    showWalletsError(message) {
        this.walletsList.innerHTML = `
            <div class="no-wallets-message">
                <p>❌ ${message}</p>
                <button onclick="window.Auth.loadWallets()" class="btn secondary small">Retry</button>
            </div>
        `;
    }

    /**
     * Truncate key ID for display
     */
    truncateKeyId(keyid) {
        if (!keyid) return 'unknown';
        
        // Remove secret: prefix if present for display
        const cleanKeyid = keyid.startsWith('secret:') ? keyid.substring(7) : keyid;
        
        if (cleanKeyid.length <= 20) return cleanKeyid;
        return `${cleanKeyid.substring(0, 8)}...${cleanKeyid.substring(cleanKeyid.length - 8)}`;
    }

    /**
     * Truncate address for display
     */
    truncateAddress(address) {
        if (!address) return 'unknown';
        
        // Remove secret: prefix if present for display
        const cleanAddress = address.startsWith('secret:') ? address.substring(7) : address;
        
        if (cleanAddress.length <= 24) return cleanAddress;
        return `${cleanAddress.substring(0, 12)}...${cleanAddress.substring(cleanAddress.length - 8)}`;
    }
}

// Create global Auth instance
window.Auth = new AuthSystem();