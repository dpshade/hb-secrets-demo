# HyperBEAM Chat

A real-time decentralized chat application built with HyperBEAM and AO (Autonomous Objects) infrastructure. Demonstrates slot-based message persistence with a clean, modern terminal-style interface.

## Features

- **Real-time messaging** via HyperBEAM direct push API
- **Decentralized storage** using AO process backend
- **Automatic authentication** with wallet generation
- **Slot-based persistence** for message history
- **Optimized polling** - only checks for new messages when AO slot advances
- **Message ownership detection** via wallet addresses
- **Clean terminal UI** with dismissible welcome banner

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) runtime
- HyperBEAM node running on localhost:8734

### Installation

```bash
bun install
```

### Development

```bash
bun run dev
```

Server runs on http://localhost:4321 with hot reload enabled.

### Production

```bash
bun run start
```

## Architecture

### 3-Tier System
1. **Frontend**: Vanilla JavaScript with modular components (`ChatSystem`, `AuthSystem`, `ChatHistory`, `HyperBEAMAPI`)
2. **HyperBEAM Middleware**: HTTP API gateway handling authentication and AO communication
3. **AO Process Backend**: Lua-based autonomous object for message persistence

### Message Flow
1. User input → Validation & sanitization
2. Optimistic UI update (pending state)
3. HyperBEAM direct push using `&!` pattern
4. AO process storage with indexed array
5. Slot-triggered polling for new messages
6. Message confirmation and UI state update

## Configuration

Edit `config.js` to customize:
- **Process ID**: Target AO process for message storage
- **HyperBEAM Node**: Primary endpoint (defaults to `/api/hyperbeam` proxy)
- **Polling Intervals**: Message and slot checking frequencies
- **Message Limits**: Display and storage constraints

## Performance Optimizations

- **Slot-triggered polling**: 99% reduction in API calls
- **Individual message fetching**: Bandwidth-efficient `/now/messages/N` endpoints
- **Smart caching**: Message count cached until slot advancement
- **Efficient DOM updates**: Fragment-based rendering for smooth scrolling
- **Message deduplication**: Hash-based duplicate prevention

## Recent Enhancements

- **Code cleanup**: Removed redundant functions and consolidated duplicates
- **Statistics accuracy**: Wallet-based sent message counting
- **Repository cleanup**: Removed development artifacts and cache files
- **Documentation updates**: Comprehensive E2E workflow documentation

## Files Structure

```
/
├── index.html              # Main application interface
├── config.js               # Configuration settings
├── server.js               # Bun server with HyperBEAM proxy
├── js/
│   ├── auth.js            # Authentication system
│   ├── chat.js            # Core chat functionality  
│   ├── chat-history.js    # Message retrieval system
│   └── hyperbeam-api.js   # HyperBEAM API client
├── CLAUDE.md              # Development instructions
└── HYPERBEAM_E2E_WORKFLOW.md  # Architecture documentation
```

## Development

This project uses:
- **Bun** for JavaScript runtime and package management
- **HyperBEAM** for decentralized infrastructure
- **AO** for autonomous object message processing
- **Vanilla JS** for lightweight, fast frontend

## License

MIT License - see project for details.

## Contributing

1. Follow existing code conventions
2. Test changes thoroughly
3. Update documentation as needed
4. Ensure all JavaScript files pass syntax validation

---

*Built with [HyperBEAM](https://hyperbeam.com) decentralized infrastructure*