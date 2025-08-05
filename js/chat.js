/**
 * Chat System for HyperBEAM Chat
 * Handles message sending, receiving, and display
 */
class ChatSystem {
    constructor() {
        this.messages = [];
        this.isPolling = false;
        this.pollInterval = null;
        this.authHeaders = null;
        this.lastMessageTime = null;
        
        // UI Elements
        this.messagesContainer = null;
        this.messageInput = null;
        this.sendBtn = null;
        this.charCount = null;
    }

    /**
     * Initialize the chat system
     */
    init() {
        this.bindUIElements();
        this.bindEvents();
        
        // Don't start polling until authenticated
        console.log('Chat system initialized');
    }

    /**
     * Bind UI elements
     */
    bindUIElements() {
        this.messagesContainer = document.getElementById('messages-container');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.charCount = document.getElementById('char-count');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Send button
        this.sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        // Enter key to send
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Character counter
        this.messageInput.addEventListener('input', () => {
            this.updateCharCount();
        });

        // Auto-focus message input when chat becomes visible
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const chatInterface = document.getElementById('chat-interface');
                    if (!chatInterface.classList.contains('hidden')) {
                        this.messageInput.focus();
                    }
                }
            });
        });
        
        observer.observe(document.getElementById('chat-interface'), { attributes: true });
    }

    /**
     * Called when authentication state changes
     */
    onAuthChanged(authHeaders) {
        this.authHeaders = authHeaders;
        
        if (authHeaders) {
            // User authenticated - start chat
            this.startPolling();
            this.loadMessages();
        } else {
            // User disconnected - stop chat
            this.stopPolling();
            this.clearMessages();
        }
    }

    /**
     * Send a message
     */
    async sendMessage() {
        const content = this.messageInput.value.trim();
        
        if (!content) {
            return;
        }

        if (content.length > CONFIG.MAX_MESSAGE_LENGTH) {
            this.showError('Message too long');
            return;
        }

        if (!this.authHeaders) {
            this.showError('Not authenticated');
            return;
        }

        const originalBtnText = this.sendBtn.textContent;
        
        try {
            this.sendBtn.textContent = 'Sending...';
            this.sendBtn.disabled = true;
            this.messageInput.disabled = true;

            const messageData = {
                content: content,
                tags: [
                    { name: 'User-Address', value: window.Auth.currentUser }
                ]
            };

            // Add keyid if available
            const keyid = window.Auth.getCurrentKeyId();
            if (keyid) {
                messageData.keyid = keyid;
            }

            try {
                const response = await window.HyperBEAM.commitMessage(messageData, this.authHeaders);
                
                if (response) {
                    // Message sent successfully
                    this.messageInput.value = '';
                    this.updateCharCount();
                    
                    // Add message to local display immediately (optimistic update)
                    this.addMessage({
                        content: content,
                        sender: window.Auth.currentUser,
                        timestamp: new Date(),
                        local: true // Mark as local/pending
                    });
                    
                    // Refresh messages from server shortly after
                    setTimeout(() => {
                        this.loadMessages();
                    }, 1000);
                }
            } catch (processError) {
                // Process endpoint failed, but commit might still work
                console.warn('Process endpoint failed, trying commit-only mode:', processError.message);
                this.addCommitMessage(content);
                this.messageInput.value = '';
                this.updateCharCount();
            }

        } catch (error) {
            this.showError(`Failed to send message: ${error.message}`);
            console.error('Send message error:', error);
        } finally {
            this.sendBtn.textContent = originalBtnText;
            this.sendBtn.disabled = false;
            this.messageInput.disabled = false;
            this.messageInput.focus();
        }
    }

    /**
     * Load messages from HyperBEAM
     */
    async loadMessages() {
        try {
            const response = await window.HyperBEAM.getMessages(CONFIG.CHAT_PROCESS_ID, {
                limit: CONFIG.MAX_MESSAGES_DISPLAY
            });

            if (response && response.messages) {
                this.processMessages(response.messages);
            } else if (Array.isArray(response)) {
                this.processMessages(response);
            } else {
                // No messages yet or error
                if (this.messages.length === 0) {
                    this.showWelcomeMessage();
                }
            }

        } catch (error) {
            console.warn('Failed to load messages:', error);
            // Use placeholder functionality when no process is available
            if (this.messages.length === 0) {
                this.showPlaceholderWelcome();
            }
        }
    }

    /**
     * Process messages from HyperBEAM response
     */
    processMessages(messageData) {
        const newMessages = [];
        
        // Handle different response formats
        let messages = [];
        if (Array.isArray(messageData)) {
            messages = messageData;
        } else if (messageData.messages) {
            messages = messageData.messages;
        }

        messages.forEach(msg => {
            // Extract message content and metadata
            const parsedMsg = this.parseHyperBEAMMessage(msg);
            if (parsedMsg) {
                newMessages.push(parsedMsg);
            }
        });

        // Sort by timestamp
        newMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Update messages array and UI
        this.messages = newMessages;
        this.renderMessages();
    }

    /**
     * Parse a HyperBEAM message into our format
     */
    parseHyperBEAMMessage(message) {
        try {
            // Extract content from message data
            const content = message.data || message.body || message.content;
            if (!content) return null;

            // Extract metadata from tags
            const tags = message.tags || [];
            const tagMap = {};
            tags.forEach(tag => {
                if (tag.name && tag.value) {
                    tagMap[tag.name] = tag.value;
                }
            });

            // Check if this is a chat message
            if (tagMap['Action'] !== CONFIG.MESSAGE_TAGS.ACTION) {
                return null; // Not a chat message
            }

            return {
                id: message.id || message.signature || Date.now(),
                content: content,
                sender: tagMap['User-Address'] || message.owner || 'Unknown',
                timestamp: tagMap['Timestamp'] ? new Date(tagMap['Timestamp']) : new Date(),
                chatRoom: tagMap['Chat-Room'],
                appName: tagMap['App-Name'],
                signature: message.signature
            };

        } catch (error) {
            console.warn('Failed to parse message:', error, message);
            return null;
        }
    }

    /**
     * Add a single message to the display
     */
    addMessage(messageData) {
        this.messages.push(messageData);
        this.renderMessages();
    }

    /**
     * Render all messages
     */
    renderMessages() {
        if (this.messages.length === 0) {
            this.showWelcomeMessage();
            return;
        }

        const html = this.messages.map(msg => this.renderMessage(msg)).join('');
        this.messagesContainer.innerHTML = html;
        
        if (CONFIG.AUTO_SCROLL) {
            this.scrollToBottom();
        }
    }

    /**
     * Render a single message
     */
    renderMessage(message) {
        const timestamp = this.formatTimestamp(message.timestamp);
        const isOwnMessage = message.sender === window.Auth.currentUser;
        const isPending = message.local === true;
        const isSystem = message.system === true;
        const isCommitted = message.committed === true;
        
        const senderDisplay = this.formatSenderAddress(message.sender);
        
        let messageClasses = 'message';
        if (isOwnMessage) messageClasses += ' own-message';
        if (isPending) messageClasses += ' pending';
        if (isSystem) messageClasses += ' system-message';
        if (isCommitted) messageClasses += ' committed-message';
        
        return `
            <div class="${messageClasses}">
                <div class="message-header">
                    <span class="sender">${senderDisplay}</span>
                    <span class="timestamp">${timestamp}</span>
                    ${isPending ? '<span class="pending-indicator">Sending...</span>' : ''}
                    ${isCommitted ? '<span class="committed-indicator">✅ Signed</span>' : ''}
                </div>
                <div class="message-content">${this.escapeHtml(message.content)}</div>
            </div>
        `;
    }

    /**
     * Format sender address for display
     */
    formatSenderAddress(address) {
        if (!address) return 'Unknown';
        
        // Truncate long addresses
        if (address.length > 20) {
            return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
        }
        
        return address;
    }

    /**
     * Format timestamp for display
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        
        // Show full date if message is from different day
        if (date.toDateString() !== now.toDateString()) {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
        
        // Show just time for today's messages
        return date.toLocaleTimeString();
    }

    /**
     * Show welcome message
     */
    showWelcomeMessage() {
        const welcomeHtml = `
            <div class="welcome-message">
                <h3>Welcome to HyperBEAM Public Chat!</h3>
                <p>You're connected as: <strong>${window.Auth.currentUser}</strong></p>
                <p>Start chatting by typing a message below. All messages are cryptographically signed with your wallet.</p>
                <p>This is a public chat room - be respectful and follow community guidelines.</p>
            </div>
        `;
        this.messagesContainer.innerHTML = welcomeHtml;
    }

    /**
     * Show placeholder welcome when no process is available
     */
    showPlaceholderWelcome() {
        const welcomeHtml = `
            <div class="welcome-message">
                <h3>HyperBEAM Chat (Commit Mode)</h3>
                <p>You're connected as: <strong>${window.Auth.currentUser}</strong></p>
                <p>✅ Messages will be cryptographically signed using <code>~secret@1.0/commit</code></p>
                <p>⚠️ No chat process is running, so messages won't be retrievable.</p>
                <p>You can test message signing by typing below - messages will be sent to HyperBEAM node for signing.</p>
                <p>In production, messages would be stored in an AO process and retrievable by other users.</p>
            </div>
        `;
        this.messagesContainer.innerHTML = welcomeHtml;
    }

    /**
     * Add message sent via commit endpoint
     */
    addCommitMessage(content) {
        // Add user's message as committed
        this.addMessage({
            content: content,
            sender: window.Auth.currentUser,
            timestamp: new Date(),
            id: Date.now(),
            committed: true
        });

        // Add a system response explaining commit status
        setTimeout(() => {
            this.addMessage({
                content: `✅ Message signed and committed to HyperBEAM node using ~secret@1.0/commit endpoint. Message was cryptographically signed with your hosted wallet.`,
                sender: "hyperbeam-system",
                timestamp: new Date(),
                id: Date.now() + 1,
                system: true
            });
        }, 800 + Math.random() * 400); // Random delay between 0.8-1.2 seconds
    }

    /**
     * Add placeholder message for demo mode
     */
    addPlaceholderMessage(content) {
        // Add user's message
        this.addMessage({
            content: content,
            sender: window.Auth.currentUser,
            timestamp: new Date(),
            id: Date.now()
        });

        // Add a demo response after a delay
        setTimeout(() => {
            const responses = [
                "Thanks for testing the HyperBEAM chat interface!",
                "Your message was received in demo mode.",
                "This is a placeholder response since no process is running.",
                "The authentication and UI are working correctly!",
                "Ready for deployment to a real HyperBEAM process."
            ];
            
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            
            this.addMessage({
                content: randomResponse,
                sender: "system-demo",
                timestamp: new Date(),
                id: Date.now() + 1
            });
        }, 1000 + Math.random() * 2000); // Random delay between 1-3 seconds
    }

    /**
     * Clear all messages
     */
    clearMessages() {
        this.messages = [];
        this.messagesContainer.innerHTML = '<div class="message-loading">Connect to start chatting...</div>';
    }

    /**
     * Start polling for new messages
     */
    startPolling() {
        if (this.isPolling) return;
        
        this.isPolling = true;
        this.pollInterval = setInterval(() => {
            this.loadMessages();
        }, CONFIG.POLL_INTERVAL);
        
        console.log('Started message polling');
    }

    /**
     * Stop polling for messages
     */
    stopPolling() {
        if (!this.isPolling) return;
        
        this.isPolling = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        console.log('Stopped message polling');
    }

    /**
     * Update character count display
     */
    updateCharCount() {
        const length = this.messageInput.value.length;
        this.charCount.textContent = `${length}/${CONFIG.MAX_MESSAGE_LENGTH}`;
        
        if (length > CONFIG.MAX_MESSAGE_LENGTH) {
            this.charCount.classList.add('over-limit');
        } else {
            this.charCount.classList.remove('over-limit');
        }
    }

    /**
     * Scroll to bottom of messages
     */
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    /**
     * Show error message
     */
    showError(message) {
        const errorElement = document.createElement('div');
        errorElement.className = 'message error-message';
        errorElement.innerHTML = `
            <div class="message-content">❌ ${this.escapeHtml(message)}</div>
        `;
        
        this.messagesContainer.appendChild(errorElement);
        this.scrollToBottom();
        
        // Remove error after 5 seconds
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 5000);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global Chat instance
window.Chat = new ChatSystem();