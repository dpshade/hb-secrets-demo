/**
 * HyperBEAM Chat Configuration
 * Central configuration for all application settings
 */

const CONFIG = {
    // HyperBEAM Node Configuration  
    HYPERBEAM_NODE: '/api/hyperbeam',  // Always use proxy for localhost:8734
    
    // Backup nodes in case primary fails
    BACKUP_NODES: [
        'https://hyperbeam.ao-testnet.xyz',
        'https://ao-hyperbeam.dev'
    ],
    
    // AO Process Configuration
    _processId: 'xN8_ogs9ZfznfG6Eg2508cukOz_f65HvOkIiT9RsKLI',
    
    get PROCESS_ID() {
        return this._processId;
    },
    
    set PROCESS_ID(newProcessId) {
        if (!newProcessId || typeof newProcessId !== 'string') {
            throw new Error('Process ID must be a non-empty string');
        }
        if (newProcessId.length !== 43) {
            throw new Error('Process ID must be exactly 43 characters long');
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newProcessId)) {
            throw new Error('Process ID can only contain letters, numbers, underscores, and hyphens');
        }
        
        const oldProcessId = this._processId;
        this._processId = newProcessId;
        
        this.log(`Process ID changed from ${oldProcessId.substring(0, 6)}... to ${newProcessId.substring(0, 6)}...`);
        
        // Dispatch event for components that need to know about the change
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('hyperbeam-process-id-changed', {
                detail: { oldProcessId, newProcessId }
            }));
        }
    },
    
    // API Endpoints
    ENDPOINTS: {
        // Secret/Wallet Management
        SECRET_GENERATE: '/~secret@1.0/generate/~json@1.0/serialize',
        SECRET_IMPORT: '/~secret@1.0/import/~json@1.0/serialize',
        SECRET_COMMIT: '/~secret@1.0/commit/~json@1.0/serialize',
        SECRET_LIST: '/~secret@1.0/list/~json@1.0/serialize',
        SECRET_EXPORT: '/~secret@1.0/export/~json@1.0/serialize',
        
        // Process Operations
        PROCESS_NOW: (processId) => `/${processId}/now/~json@1.0/serialize`,
        PROCESS_PUSH: (processId, action) => `/${processId}/push&action=${action}&!/serialize~json@1.0`,
        PROCESS_PUSH_WITH_PARAMS: (processId, action, params) => {
            // Manual parameter construction to avoid unnecessary URL encoding
            const queryParams = Object.entries(params)
                .map(([key, value]) => `${key}=${value}`)
                .join('&');
            return `/${processId}/push&action=${action}&${queryParams}&!/serialize~json@1.0`;
        },
        PROCESS_SLOT_COMPUTE: (processId, slot) => 
            `/${processId}~process@1.0/compute&slot=${slot}/results/serialize~json@1.0`,
        
        // Meta Operations
        META_HEALTH: '/~meta@1.0/health/~json@1.0/serialize'
    },
    
    // Helper function to get full endpoint
    getEndpoint: function(endpointName, ...params) {
        const endpoint = this.ENDPOINTS[endpointName];
        if (typeof endpoint === 'function') {
            return endpoint(...params);
        }
        return endpoint;
    },
    
    // Helper function to get full URL
    getFullUrl: function(endpoint) {
        return `${this.HYPERBEAM_NODE}${endpoint}`;
    },
    
    // Authentication Configuration
    AUTH: {
        COOKIE: {
            PERSIST: 'in-memory',
            ACCESS_CONTROL_DEVICE: '~cookie@1.0'
        },
        BASIC: {
            DEVICE: '~http-auth@1.0'
        },
        AUTO_CONNECT: true,
        PREFERRED_METHOD: 'generated'
    },
    
    // Message Configuration
    MESSAGES: {
        MAX_MESSAGE_LENGTH: 1000,
        MAX_MESSAGES_TO_STORE: 100,
        DEFAULT_TAGS: [
            { name: 'Protocol', value: 'HyperBEAM-Chat' },
            { name: 'Version', value: '1.0' }
        ],
        CHAT_TAGS: [
            { name: 'Action', value: 'chat-message' },
            { name: 'Type', value: 'text' }
        ]
    },
    
    // Timing Configuration
    TIMING: {
        MESSAGE_POLL_INTERVAL: 2000,
        STATS_UPDATE_INTERVAL: 5000,
        SLOT_POLL_INTERVAL: 500,
        SLOT_ADVANCEMENT_TIMEOUT: 10000,
        POST_SEND_DELAY: 1000,
        HEALTH_CHECK_INTERVAL: 30000
    },
    
    // UI Configuration
    UI: {
        SHOW_TIMESTAMPS: true,
        AUTO_SCROLL: true,
        SHOW_SLOT_INFO: true,
        SHOW_PERFORMANCE_METRICS: true,
        ENABLE_SOUND: false
    },
    
    // Debug/Logging Configuration
    DEBUG: window.location.search.includes('debug=1'),
    
    // Process ID management
    updateProcessId: function(newProcessId) {
        try {
            this.PROCESS_ID = newProcessId;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // Validation function
    validate: function() {
        if (!this.PROCESS_ID) {
            throw new Error('PROCESS_ID not configured');
        }
        if (!this.HYPERBEAM_NODE) {
            throw new Error('HYPERBEAM_NODE not configured');
        }
        return true;
    },
    
    // Logging functions
    log: function(...args) {
        console.log('[HyperBEAM]', ...args);
    },
    
    debug: function(...args) {
        if (this.DEBUG) {
            console.debug('[HyperBEAM Debug]', ...args);
        }
    }
};

// Export for use in other scripts
window.CONFIG = CONFIG;