// HyperBEAM Chat Configuration
const CONFIG = {
    // HyperBEAM Node Configuration
    HYPERBEAM_NODE: 'http://localhost:8734', // Default local HyperBEAM node
    
    // Chat Configuration
    CHAT_PROCESS_ID: 'public-chat-room-001', // Process ID for the chat room
    POLL_INTERVAL: 3000, // Poll for new messages every 3 seconds
    MAX_MESSAGE_LENGTH: 500, // Maximum message length
    MAX_MESSAGES_DISPLAY: 100, // Maximum messages to display at once
    
    // Authentication Configuration
    DEFAULT_PERSIST_MODE: 'in-memory', // Options: 'client', 'in-memory', 'non-volatile'
    AUTH_TIMEOUT: 30000, // Authentication request timeout (30 seconds)
    DEFAULT_ACCESS_CONTROL: { device: 'cookie@1.0' }, // Default access control device
    DEFAULT_CONTROLLERS: [], // Default controllers for non-volatile storage (empty means user controls)
    DEFAULT_REQUIRED_CONTROLLERS: 1, // Minimum required controllers for non-volatile storage
    
    // UI Configuration
    AUTO_SCROLL: true, // Auto-scroll to new messages
    TIMESTAMP_FORMAT: 'HH:mm:ss', // Message timestamp format
    
    // API Endpoints - Updated for HyperBEAM ~secret@1.0 API (HTTPie Collection Format)
    ENDPOINTS: {
        SECRET_GENERATE: '/~secret@1.0/generate/~json@1.0/serialize',
        SECRET_IMPORT: '/~secret@1.0/import/~json@1.0/serialize', 
        SECRET_LIST: '/~secret@1.0/list/~json@1.0/serialize',
        SECRET_COMMIT: '/~secret@1.0/commit/~json@1.0/serialize',
        SECRET_EXPORT: '/~secret@1.0/export/~json@1.0/serialize',
        SECRET_SYNC: '/~secret@1.0/sync/~json@1.0/serialize',
        PROCESS_MESSAGES: '/~process@1.0/messages/~json@1.0/serialize',
        PROCESS_PUSH: '/~process@1.0/push/~json@1.0/serialize',
        META_INFO: '/~meta@1.0/info/~json@1.0/serialize'
    },
    
    // Message Tags
    MESSAGE_TAGS: {
        ACTION: 'Chat-Message',
        CHAT_ROOM: 'public-room',
        APP_NAME: 'HyperBEAM-Chat',
        VERSION: '1.0.0'
    }
};

// Environment-specific overrides
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    CONFIG.HYPERBEAM_NODE = 'http://localhost:8734';
} else {
    // Update this to your production HyperBEAM node URL
    CONFIG.HYPERBEAM_NODE = 'https://your-hyperbeam-node.com';
}

// Utility function to get full endpoint URL
CONFIG.getEndpointUrl = function(endpoint) {
    return this.HYPERBEAM_NODE + this.ENDPOINTS[endpoint];
};

// Debug mode based on URL parameters
CONFIG.DEBUG = new URLSearchParams(window.location.search).has('debug');

if (CONFIG.DEBUG) {
    console.log('HyperBEAM Chat Configuration:', CONFIG);
}