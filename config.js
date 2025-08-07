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
    PROCESS_ID: '08ATSzAzk2yP8VCeCZ_NH85nVkixWlZ_CsPxD6l0BSQ',
    CHAT_PROCESS_ID: '08ATSzAzk2yP8VCeCZ_NH85nVkixWlZ_CsPxD6l0BSQ',
    
    // API Endpoints
    ENDPOINTS: {
        // Secret/Wallet Management
        SECRET_GENERATE: '/~secret@1.0/generate/~json@1.0/serialize',
        SECRET_IMPORT: '/~secret@1.0/import/~json@1.0/serialize',
        SECRET_COMMIT: '/~secret@1.0/commit/~json@1.0/serialize',
        SECRET_LIST: '/~secret@1.0/list/~json@1.0/serialize',
        
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