# HyperBEAM Chat - Claude Code Documentation

This project is a real-time chat application built with HyperBEAM and AO (Autonomous Objects) infrastructure. The application demonstrates slot-based message persistence and provides a clean, modern chat experience.

## Project Overview

HyperBEAM Chat is a decentralized chat application that:
- Sends messages directly to AO processes via HyperBEAM
- Uses slot-based persistence for message history
- Provides real-time message polling and updates
- Features a clean, minimal terminal-style interface
- Supports username customization and message history

## Architecture

### Core Components
- **ChatSystem** - Message sending and status tracking
- **ChatHistory** - Slot-based message retrieval and caching
- **HyperBEAMAPI** - HTTP endpoint management and communication
- **AuthSystem** - Wallet generation and authentication

### Message Flow
1. User Interface → Username input + message input
2. Authentication System → Generated/imported wallets
3. HyperBEAM API → Direct push to AO process
4. Message Storage → Slot-based persistence
5. History Retrieval → Multi-slot scanning

## Recent Improvements

### Single Message System Implementation

**Problem Solved**: Fixed critical duplicate message issue where messages appeared twice - once as "Sent" and again as "Executed".

**Solution**: Implemented clean single-message system with:
- Hash-based message deduplication
- Visual state management (pending → confirmed)
- Immediate display with smooth transitions
- 15-second auto-confirmation fallback

**Key Features**:
- ✅ Single Message Display: No more duplicates
- ✅ Immediate Feedback: Messages show instantly in pending state
- ✅ Visual States: Clear pending vs confirmed indication
- ✅ Smooth Transitions: CSS animations for state changes
- ✅ Fallback Logic: Auto-confirmation prevents stuck messages

### Welcome Banner Enhancement

**Recent Changes**:
- Converted welcome message from inline chat message to dismissible sticky banner
- Added clean close button with localStorage persistence
- Improved chat layout with messages hugging bottom of interface
- Increased chat history from 25 to 40 slots (more messages)
- Enhanced message fetching from 75 to 90 messages per load

## Testing & Verification

### Core Functionality ✅ VERIFIED
- **Message Sending**: Successfully sends to AO process via HyperBEAM push API
- **Username Handling**: Proper encoding and parameter handling
- **Slot Polling**: Regular monitoring every 2 seconds for message updates
- **Chat History**: Multi-slot retrieval (1-40 slots) with proper chronological ordering
- **Proxy Setup**: localhost:4321 → localhost:8734 working correctly

### Technical Implementation
- **Process ID**: Uses configurable AO process for message storage
- **Message Format**: action=chat-message with username, content, timestamp
- **Persistence**: Slot-based storage with inbox/outbox retrieval
- **Real-time Updates**: Continuous slot monitoring for new messages

### Performance Characteristics
- Message polling interval: 2 seconds
- History retrieval: 40 slots by default (up to 90 messages)
- Slot monitoring: Continuous
- Message caching: Implemented with deduplication

## File Structure

```
/hyperbeam-chat/
├── index.html              # Main application with inline CSS/JS
├── config.js               # Configuration for HyperBEAM endpoints
├── server.js               # Bun server with HyperBEAM proxy
├── js/
│   ├── auth.js            # Wallet authentication system
│   ├── chat.js            # Chat messaging and state management
│   ├── chat-history.js    # Slot-based message retrieval
│   └── hyperbeam-api.js   # HyperBEAM API client
├── package.json           # Project dependencies
└── CLAUDE.md             # This documentation file
```

## Development Notes

### Running the Application
```bash
bun install
bun run dev  # Starts server on localhost:4321
```

### Key Configuration
- Frontend: `localhost:4321`
- HyperBEAM Backend: `localhost:8734`
- Proxy: `/api/hyperbeam` → HyperBEAM backend
- Process ID: Configurable in `config.js`

### Message States
- **pending**: Just sent, translucent appearance with spinner
- **confirmed**: Confirmed via chat history, full opacity

### Recent Cleanups
Removed unused directories and files:
- `dist/`, `public/`, `src/` - Empty directories
- `css/` - Old unused purple theme
- `tsconfig.json` - No TypeScript in project
- `.users_cache.json`, `.channels_cache_v2.json` - Cache files

## Status

**Current State**: Production ready ✅
**Core Features**: All working and tested
**UI/UX**: Clean, modern interface with dismissible welcome banner
**Performance**: Optimized message loading and real-time updates
**Documentation**: Comprehensive testing and implementation notes

The application successfully demonstrates HyperBEAM's slot-based persistence system and provides a complete decentralized chat experience.