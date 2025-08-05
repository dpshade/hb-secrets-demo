// HyperBEAM Chat Configuration
const CONFIG = {
    // HyperBEAM Node Configuration
    HYPERBEAM_NODE: 'http://localhost:10000', // Default local HyperBEAM node
    
    // Chat Configuration
    CHAT_PROCESS_ID: 'public-chat-room-001', // Process ID for the chat room
    POLL_INTERVAL: 3000, // Poll for new messages every 3 seconds
    MAX_MESSAGE_LENGTH: 500, // Maximum message length
    MAX_MESSAGES_DISPLAY: 100, // Maximum messages to display at once
    
    // Authentication Configuration
    DEFAULT_PERSIST_MODE: 'in-memory', // Options: 'client', 'in-memory', 'non-volatile'
    AUTH_TIMEOUT: 30000, // Authentication request timeout (30 seconds)
    DEFAULT_ACCESS_CONTROL: { device: 'cookie@1.0' }, // Default access control device
    
    // UI Configuration
    AUTO_SCROLL: true, // Auto-scroll to new messages
    TIMESTAMP_FORMAT: 'HH:mm:ss', // Message timestamp format
    
    // API Endpoints - Updated for latest HyperBEAM (~secret@1.0 API)
    ENDPOINTS: {
        SECRET_GENERATE: '/~secret@1.0/generate/json',
        SECRET_IMPORT: '/~secret@1.0/import/json', 
        SECRET_LIST: '/~secret@1.0/list/json',
        SECRET_COMMIT: '/~secret@1.0/commit/json',
        SECRET_EXPORT: '/~secret@1.0/export/json',
        SECRET_SYNC: '/~secret@1.0/sync/json',
        PROCESS_MESSAGES: '/~process@1.0/messages/json',
        PROCESS_PUSH: '/~process@1.0/push/json',
        META_INFO: '/~meta@1.0/info'
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
    CONFIG.HYPERBEAM_NODE = 'http://localhost:10000';
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