# HyperBEAM Public Chat

A minimal web-based public chat room that uses HyperBEAM's authentication and messaging capabilities. Users can authenticate with wallets and send cryptographically signed messages in real-time.

## Features

- **Multiple Authentication Methods**
  - Generate new Arweave wallets (client-side, in-memory, or persistent storage)
  - Import existing Arweave wallet JSON keys
  - HTTP Basic authentication
  
- **Secure Messaging**
  - All messages cryptographically signed with user wallets
  - Real-time message updates via polling
  - Message history persistence via HyperBEAM
  
- **Modern UI**
  - Clean, responsive interface
  - Real-time status indicators
  - Character counter and input validation
  - Mobile-friendly design

## Prerequisites

1. **Bun Runtime**: Install Bun for the development server
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **HyperBEAM Node**: You need access to a HyperBEAM node with the `~secret@1.0` device enabled (latest version)
   - For local development: Start HyperBEAM on `http://localhost:10000`
   - For production: Use your deployed HyperBEAM node URL
   - **Note**: This version requires HyperBEAM with the recent secret management updates (PR #394)

## Quick Start

### 1. Navigate to Project
```bash
cd Developer/hyperbeam-chat/
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Configure HyperBEAM Node
Edit `config.js` and update the `HYPERBEAM_NODE` URL:

```javascript
CONFIG.HYPERBEAM_NODE = 'http://your-hyperbeam-node:10000';
```

### 4. Start Development Server
```bash
bun run dev
```

The server will start on `http://localhost:3000` with:
- ✅ Automatic CORS headers for HyperBEAM integration
- ✅ Static file serving with proper MIME types
- ✅ Development logging and error handling
- ✅ Hot reloading when files change

### Alternative Server Options
If you prefer other servers:

**Python (Python 3):**
```bash
python -m http.server 8080
```

**Node.js (if you have http-server installed):**
```bash
npx http-server -p 8080
```

**PHP:**
```bash
php -S localhost:8080
```

## Usage

### Authentication Options

1. **Generate New Wallet**
   - Click "Generate Wallet" 
   - Choose storage option:
     - **Client-side**: Key stored in browser only (you're responsible for backup)
     - **In-memory**: Temporary storage (lost on server restart)
     - **Persistent**: Stored permanently on HyperBEAM node

2. **Import Existing Wallet**
   - Paste your Arweave wallet JSON into the text area
   - Click "Import Wallet" 
   - Wallet will be hosted on the HyperBEAM node

3. **HTTP Basic Auth**
   - Enter any username/password combination
   - Useful for testing or simple authentication scenarios

### Chatting

1. After authentication, the chat interface will appear
2. Type your message in the input field (max 500 characters)
3. Press Enter or click "Send" to post your message
4. Messages are automatically signed with your wallet
5. All messages are visible to all users in the public room

## Configuration

### config.js Options

```javascript
const CONFIG = {
    // HyperBEAM node URL
    HYPERBEAM_NODE: 'http://localhost:10000',
    
    // Chat settings
    CHAT_PROCESS_ID: 'public-chat-room-001',
    POLL_INTERVAL: 3000, // Message refresh interval (milliseconds)
    MAX_MESSAGE_LENGTH: 500,
    MAX_MESSAGES_DISPLAY: 100,
    
    // Authentication
    DEFAULT_PERSIST_MODE: 'in-memory',
    AUTH_TIMEOUT: 30000,
    
    // UI preferences
    AUTO_SCROLL: true,
    TIMESTAMP_FORMAT: 'HH:mm:ss'
};
```

## HyperBEAM Setup

### Required Devices
Your HyperBEAM node must have these devices enabled:
- `~secret@1.0` - Wallet hosting and message signing (NEW: Enhanced with TEE support)
- `~cookie@1.0` - Cookie-based authentication (NEW: Structured Fields support)
- `~http-auth@1.0` - HTTP Basic authentication with PBKDF2 key derivation
- `~process@1.0` - Message storage and retrieval
- `~meta@1.0` - Node health checks and metadata

### Example HyperBEAM Configuration
```erlang
% In your HyperBEAM config
{
    port: 10000,
    priv_key_location: "/path/to/your/wallet.json",
    preloaded_devices: [
        "secret@1.0",
        "cookie@1.0", 
        "process@1.0",
        "meta@1.0"
    ]
}
```

## API Endpoints Used

The chat application uses these HyperBEAM endpoints:

- `POST /~secret@1.0/generate/json` - Generate new wallets
- `POST /~secret@1.0/import/json` - Import existing wallets  
- `GET /~secret@1.0/list/json` - List hosted wallets
- `POST /~secret@1.0/commit/json` - Sign and send messages
- `POST /~secret@1.0/export/json` - Export wallet data
- `POST /~secret@1.0/sync/json` - Sync wallets between nodes
- `GET /~process@1.0/messages/json` - Retrieve chat history
- `GET /~meta@1.0/info` - Node health check

## Recent Updates (v1.1)

This version has been updated to support the latest HyperBEAM `~secret@1.0` API changes:

✅ **Authentication Improvements:**
- Enhanced cookie parsing for structured cookie data (`response.priv.cookie`)
- Better HTTP Basic Auth with proper URL embedding format
- Support for new `~http-auth@1.0` device with PBKDF2 key derivation
- Improved error handling for different response formats

✅ **API Updates:**
- Updated endpoint URLs and request formats
- Added wallet sync functionality
- Enhanced health check with `~meta@1.0/info`
- Better handling of `keyid` vs `body` response fields

✅ **Security Enhancements:**
- TEE-compatible secret management
- Improved access control device configuration
- Better credential handling and storage options

## Troubleshooting

### Common Issues

1. **"Cannot connect to HyperBEAM node"**
   - Check that your HyperBEAM node is running
   - Verify the URL in `config.js`
   - Check browser console for CORS errors

2. **Authentication fails**
   - Ensure `~secret@1.0` device is loaded on HyperBEAM
   - Check HyperBEAM logs for authentication errors
   - Try different authentication methods

3. **Messages not sending**
   - Verify wallet is properly authenticated
   - Check browser network tab for failed requests
   - Ensure `~process@1.0` device is available

4. **Messages not loading**
   - Check that the chat process ID exists
   - Verify polling is working (check browser console)
   - Ensure process has message history

### Debug Mode
Add `?debug=1` to your URL to enable debug logging:
```
http://localhost:8080?debug=1
```

This will show detailed API requests and responses in the browser console.

## Security Considerations

- **Wallet Storage**: Be careful with wallet persistence options
  - Client-side: You control the key but must back it up
  - Server-side: Convenient but requires trusting the HyperBEAM node
  
- **HTTPS**: Use HTTPS in production to protect authentication cookies

- **CORS**: Configure HyperBEAM CORS settings for your domain

- **Rate Limiting**: Consider implementing rate limiting for message sending

## Development

### File Structure
```
hyperbeam-chat/
├── index.html              # Main interface
├── config.js              # Configuration
├── package.json           # Bun project configuration
├── server.js              # Development server
├── .gitignore             # Git ignore rules
├── css/
│   └── style.css          # Styling
├── js/
│   ├── hyperbeam-api.js   # HyperBEAM API wrapper
│   ├── auth.js            # Authentication system
│   └── chat.js            # Chat functionality
└── README.md              # This file
```

### Development Commands

```bash
# Start development server
bun run dev

# Start production server  
bun run start

# Install dependencies
bun install

# Enable debug logging
DEBUG=1 bun run dev
```

### Contributing
1. Fork the repository
2. Make your changes
3. Test with a local HyperBEAM node
4. Submit a pull request

## License

This project is provided as-is for educational and development purposes. Use in accordance with HyperBEAM and Arweave licensing terms.

## Support

For issues related to:
- **HyperBEAM**: Check the [HyperBEAM documentation](https://github.com/permaweb/hyperbeam)
- **Arweave**: Visit [Arweave documentation](https://docs.arweave.org/)
- **This chat app**: Open an issue in the repository