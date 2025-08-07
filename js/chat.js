/**
 * HyperBEAM Chat System
 * 
 * Handles chat functionality including message sending, execution monitoring,
 * chat history retrieval, and real-time updates with slot advancement detection.
 */

class ChatSystem {
    constructor(hyperbeamAPI, authSystem) {
        this.api = hyperbeamAPI;
        this.auth = authSystem;
        this.config = hyperbeamAPI.config;
        
        // Message storage and state
        this.messages = [];
        this.lastKnownSlot = null;
        this.lastMessageId = 0;
        this.isPolling = false;
        this.pollInterval = null;
        
        // Track sent messages to prevent duplicates
        this.sentMessageHashes = new Map(); // content+author -> messageId
        
        // Chat history system
        this.chatHistory = new ChatHistory(hyperbeamAPI, this.config.PROCESS_ID);
        
        // Execution monitoring
        this.pendingMessages = new Map(); // Messages waiting for execution
        this.executionQueue = [];
        
        // UI references (will be set by the main application)
        this.messageContainer = null;
        this.statusCallback = null;
        
        // Event handlers
        this.eventHandlers = {
            messageReceived: [],
            messageSent: [],
            executionComplete: [],
            statusUpdate: [],
            error: []
        };
        
        
        this.config.log('Chat system initialized');
    }

    /**
     * Initialize chat system with UI references
     */
    async initialize(messageContainer, statusCallback) {
        this.messageContainer = messageContainer;
        this.statusCallback = statusCallback;
        
        // Get initial slot
        await this.initializeSlotMonitoring();
        
        // Load existing chat history
        await this.loadChatHistory();
        
        // Start message polling
        this.startMessagePolling();
        
        this.config.log('Chat system initialized with UI components');
    }

    /**
     * Initialize slot monitoring
     */
    async initializeSlotMonitoring() {
        try {
            const currentSlot = await this.api.getCurrentSlot();
            if (currentSlot !== null) {
                this.lastKnownSlot = currentSlot;
                this.config.debug(`Initial slot: ${currentSlot}`);
                this.updateStatus(`Connected. Current slot: ${currentSlot}`, 'connected');
            } else {
                throw new Error('Failed to get initial slot');
            }
        } catch (error) {
            this.config.log('Failed to initialize slot monitoring:', error);
            this.updateStatus('Failed to connect to AO process', 'error');
        }
    }

    /**
     * Send a chat message using HyperBEAM direct push
     */
    async sendMessage(messageContent, options = {}) {
        if (!messageContent.trim()) {
            return { success: false, error: 'Message cannot be empty' };
        }

        // Validate message length
        if (messageContent.length > this.config.MESSAGES.MAX_MESSAGE_LENGTH) {
            return { 
                success: false, 
                error: `Message too long. Max ${this.config.MESSAGES.MAX_MESSAGE_LENGTH} characters.` 
            };
        }

        const messageId = ++this.lastMessageId;
        const timestamp = Date.now();
        
        // Get username from the input field or default to 'Chat User'
        const usernameInput = document.getElementById('username-input');
        const username = usernameInput?.value?.trim() || 'Chat User';
        
        this.config.debug(`Sending with username: ${username}`);
        
        this.config.log(`Sending message ${messageId}: "${messageContent}"`);
        this.updateStatus('Sending message...', '');

        try {
            // Create message object with pending state
            const message = {
                id: messageId,
                content: messageContent,
                timestamp: timestamp,
                author: username,
                status: 'pending',
                method: 'direct-push',
                isPending: true
            };
            
            // No longer using hash-based deduplication

            // Add to messages immediately (optimistic update) with pending state
            this.addMessage(message);
            
            // Set a timeout to auto-confirm if no confirmation comes back
            setTimeout(() => {
                const stillPendingMessage = this.messages.find(m => m.id === messageId && m.isPending);
                if (stillPendingMessage) {
                    this.config.debug(`Auto-confirming message ${messageId} after timeout`);
                    this.updateMessageStatus(messageId, 'confirmed', {
                        autoConfirmed: true,
                        reason: 'timeout'
                    });
                    // Auto-confirmation cleanup
                }
            }, 15000); // 15 second timeout

            // Send using direct push method including username as a tag
            const result = await this.api.pushMessage(messageContent, 'chat-message', {
                username: username
            });

            // Update message status
            if (result.ok) {
                this.updateMessageStatus(messageId, 'confirmed', {
                    success: true,
                    method: 'direct-push',
                    response: result
                });
                this.updateStatus(`Message sent successfully!`, 'connected');
                
                // Trigger immediate check for responses
                setTimeout(() => this.checkForNewMessages(), this.config.TIMING.POST_SEND_DELAY);
                
                this.emit('messageSent', { message, result });
                
                return { success: true, method: 'direct-push', response: result };
                
            } else {
                const error = result.error || result.statusText || 'Unknown error';
                this.updateMessageStatus(messageId, 'failed', { error });
                this.updateStatus(`Send failed: ${error}`, 'error');
                this.emit('error', { message, error });
                
                return { success: false, error };
            }

        } catch (error) {
            this.config.log(`Message ${messageId} send error:`, error);
            this.updateMessageStatus(messageId, 'failed', { error: error.message });
            this.updateStatus(`Send error: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }


    /**
     * Start polling for new messages and slot changes
     */
    startMessagePolling() {
        if (this.isPolling) {
            return;
        }
        
        this.isPolling = true;
        this.config.log('Starting message polling');
        
        this.pollInterval = setInterval(() => {
            this.checkForNewMessages();
        }, this.config.TIMING.MESSAGE_POLL_INTERVAL);
    }

    /**
     * Stop message polling
     */
    stopMessagePolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isPolling = false;
        this.config.log('Message polling stopped');
    }

    /**
     * Check for new messages and slot advancement
     */
    async checkForNewMessages() {
        try {
            const currentSlot = await this.api.getCurrentSlot();
            
            if (currentSlot !== null && currentSlot > this.lastKnownSlot) {
                this.config.log(`Slot advanced: ${this.lastKnownSlot} → ${currentSlot}`);
                
                // Check for new messages in advanced slots
                for (let slot = this.lastKnownSlot + 1; slot <= currentSlot; slot++) {
                    await this.checkSlotForMessages(slot);
                }
                
                // Also refresh chat history to catch any missed messages
                await this.refreshLatestHistory();
                
                this.lastKnownSlot = currentSlot;
                
                // Update any pending messages that might have executed
                this.checkPendingMessages(currentSlot);
            }
            
        } catch (error) {
            this.config.debug('Error checking for messages:', error);
        }
    }

    /**
     * Check a specific slot for executed messages
     */
    async checkSlotForMessages(slot) {
        try {
            // Use the new ChatHistory system to get messages from this slot
            const messages = await this.chatHistory.getMessagesFromSlot(slot);
            
            if (messages.length > 0) {
                this.config.debug(`Found ${messages.length} messages in slot ${slot}`);
                
                // Process each message
                for (const message of messages) {
                    await this.processHistoryMessage(message);
                }
            }
            
        } catch (error) {
            this.config.debug(`Error checking slot ${slot}:`, error);
        }
    }

    /**
     * Try alternative methods to retrieve slot results (workaround for serialization bug)
     */
    async tryAlternativeSlotRetrieval(slot) {
        try {
            // Try getting overall process state
            const stateResponse = await this.api.getProcessState();
            
            if (stateResponse.ok && stateResponse.parsedState) {
                const state = stateResponse.parsedState;
                
                if (state.outputData && state.outputData !== 'undefined') {
                    this.config.debug(`Found output data in process state: ${state.outputData}`);
                    
                    // Create synthetic output for processing
                    await this.processSlotOutput(slot, {
                        data: state.outputData,
                        source: 'process-state'
                    });
                }
            }
            
        } catch (error) {
            this.config.debug(`Alternative slot retrieval failed for slot ${slot}:`, error);
        }
    }

    /**
     * Process a message from chat history
     */
    async processHistoryMessage(historyMessage) {
        this.config.debug(`Processing history message from slot ${historyMessage.slot}:`, historyMessage.content);

        // Extract username from message metadata/tags (now properly stored by AO process)
        let username = 'Chat User'; // Default username
        
        if (historyMessage.tags && historyMessage.tags.username) {
            username = historyMessage.tags.username;
        } else if (historyMessage.tags && historyMessage.tags.Username) {
            username = historyMessage.tags.Username;
        } else if (historyMessage.username) {
            username = historyMessage.username;
        }
        
        // Simple approach: Is this message from the current user?
        const usernameInput = document.getElementById('username-input');
        const currentUsername = usernameInput?.value?.trim() || 'Chat User';
        
        this.config.debug(`Processing history: '${historyMessage.content}' from '${username}', current user: '${currentUsername}'`);
        
        // If this message is from the current user, merge it with the existing UI message
        if (username === currentUsername) {
            // Find the most recent matching message regardless of pending/confirmed status
            const existing = this.messages.slice().reverse().find(m =>
                m.content === historyMessage.content &&
                m.author === currentUsername
            );

            if (existing) {
                // If we've already set the same slot/reference, skip re-processing
                if (existing.slot === historyMessage.slot && existing.reference === historyMessage.reference) {
                    this.config.debug('Own history message already processed; skipping');
                    return;
                }

                // Update existing message in place
                existing.status = 'confirmed';
                existing.isPending = false;
                existing.slot = historyMessage.slot;
                existing.reference = historyMessage.reference;
                existing.source = 'chat-history';

                // Update UI
                if (this.messageContainer) {
                    const el = this.messageContainer.querySelector(`[data-message-id="${existing.id}"]`);
                    if (el) {
                        this.updateMessageElement(el, existing);
                        el.classList.remove('pending');
                        el.classList.add('confirmed');
                    }
                }

                this.emit('messageReceived', { message: existing, slot: historyMessage.slot });
                return; // Do not add a second message
            }
        }
        
        // If we get here, this is a NEW message from someone else - add it
        if (false) { // This condition will never be true, removing the old logic
            // This is a confirmation of a message we sent - update the existing message
            const existingMessage = this.messages.find(m => m.id === existingMessageId);
            if (existingMessage && existingMessage.isPending) {
                this.config.debug(`Confirming sent message ${existingMessageId}`);
                this.updateMessageStatus(existingMessageId, 'confirmed', {
                    slot: historyMessage.slot,
                    reference: historyMessage.reference,
                    confirmed: true
                });
                
                // No longer using hash tracking
                
                this.emit('messageReceived', { message: existingMessage, slot: historyMessage.slot });
                return;
            }
        }

        // This is a new message from someone else - add it normally
        const processMessage = {
            id: `history-${historyMessage.slot}-${historyMessage.reference}`,
            content: historyMessage.content,
            timestamp: historyMessage.timestamp,
            author: username,
            status: 'received',
            slot: historyMessage.slot,
            reference: historyMessage.reference,
            source: 'chat-history'
        };

        this.addMessage(processMessage);
        this.emit('messageReceived', { message: processMessage, slot: historyMessage.slot });
    }

    /**
     * Check pending messages for execution completion
     */
    checkPendingMessages(currentSlot) {
        for (const [messageId, messageData] of this.pendingMessages) {
            if (messageData.waitingForExecution) {
                // If slot has advanced beyond when we sent the message, consider it processed
                // but don't change the status from "sent" to maintain iMessage-style simplicity
                const sendSlot = messageData.sendResult?.initialSlot;
                if (sendSlot && currentSlot > sendSlot) {
                    this.pendingMessages.delete(messageId);
                    this.emit('executionComplete', { messageId, messageData, slot: currentSlot });
                }
            }
        }
    }

    /**
     * Create a hash for message deduplication
     */
    // Removed createMessageHash - using simpler username comparison

    /**
     * Add a message to the chat
     */
    addMessage(message) {
        // Prevent duplicate messages
        if (this.messages.find(m => m.id === message.id)) {
            return;
        }
        
        this.messages.push(message);
        
        // Trim messages if we have too many
        if (this.messages.length > this.config.MESSAGES.MAX_MESSAGES_TO_STORE) {
            this.messages = this.messages.slice(-this.config.MESSAGES.MAX_MESSAGES_TO_STORE);
        }
        
        // Update UI
        if (this.messageContainer) {
            this.renderMessage(message);
            this.scrollToBottom();
        }
        
        this.config.debug('Message added:', message);
    }

    /**
     * Update message status
     */
    updateMessageStatus(messageId, status, data = {}) {
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            const oldStatus = message.status;
            message.status = status;
            message.statusData = data;
            
            // Update pending state
            if (status === 'confirmed') {
                message.isPending = false;
            }
            
            // Update UI if message is visible
            if (this.messageContainer) {
                const messageEl = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
                if (messageEl) {
                    this.updateMessageElement(messageEl, message);
                    // Add smooth transition classes
                    if (oldStatus === 'pending' && status === 'confirmed') {
                        messageEl.classList.remove('pending');
                        messageEl.classList.add('confirmed');
                    }
                }
            }
            
            this.config.debug(`Message ${messageId} status updated to: ${status}`);
        }
    }

    /**
     * Render a message in the UI
     */
    renderMessage(message) {
        if (!this.messageContainer) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message message-new';
        messageEl.setAttribute('data-message-id', message.id);
        
        // Add pending/confirmed state classes
        if (message.isPending || message.status === 'pending') {
            messageEl.classList.add('pending');
        } else if (message.status === 'confirmed') {
            messageEl.classList.add('confirmed');
        }
        
        this.updateMessageElement(messageEl, message);
        this.messageContainer.appendChild(messageEl);
        
        // Update grouping for all messages after adding new one
        this.updateAllMessageGrouping();
        
        // Remove animation class after animation completes
        setTimeout(() => {
            messageEl.classList.remove('message-new');
        }, 400);
    }

    /**
     * Update message grouping for all messages - Simplified for minimal style
     */
    updateAllMessageGrouping() {
        // No grouping needed for minimal terminal-style interface
        if (!this.messageContainer) return;
        
        const messageElements = Array.from(this.messageContainer.querySelectorAll('.message'));
        messageElements.forEach(messageEl => {
            messageEl.classList.remove('grouped', 'last-in-group');
        });
    }

    /**
     * Update message element content - Minimal terminal-style format
     */
    updateMessageElement(messageEl, message) {
        const timestamp = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Determine if this is own message or process message
        // Messages with 'direct-push' method are our own messages
        const isOwnMessage = message.method === 'direct-push' || message.source !== 'chat-history';
        messageEl.classList.toggle('own-message', isOwnMessage);
        messageEl.classList.toggle('process-message', !isOwnMessage);
        
        // Get username, fallback to defaults
        const username = message.author || (isOwnMessage ? 'You' : 'System');
        
        // Remove all grouping logic for minimal style
        messageEl.classList.remove('grouped', 'last-in-group');
        
        // Format: username • timestamp: content (no status text - we use visual states)
        messageEl.innerHTML = `
            <span class="message-header">
                <span class="message-username">${this.escapeHtml(username)}</span><span class="message-separator">•</span><span class="message-timestamp">${timestamp}</span><span class="message-colon">:</span>
            </span><span class="message-content">${this.escapeHtml(message.content)}</span>
        `;
    }

    /**
     * Get status text for display
     */
    getStatusText(status) {
        const statusTexts = {
            sending: 'Sending...',
            sent: 'Sent',
            failed: 'Failed',
            pending: 'Pending'
        };
        return statusTexts[status] || status;
    }

    /**
     * Get CSS class for status
     */
    getStatusClass(status) {
        const statusClasses = {
            sending: 'status-pending',
            sent: 'status-sent',
            failed: 'status-error',
            pending: 'status-pending'
        };
        return statusClasses[status] || '';
    }

    /**
     * Apply message grouping - Removed for minimal style
     */
    applyMessageGrouping(messageEl, message) {
        // No grouping needed for minimal terminal-style interface
        messageEl.classList.remove('grouped', 'last-in-group');
    }

    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        if (this.config.UI.AUTO_SCROLL && this.messageContainer) {
            this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }
    }

    /**
     * Update status display
     */
    updateStatus(message, type = '') {
        if (this.statusCallback) {
            this.statusCallback(message, type);
        }
        
        this.emit('statusUpdate', { message, type });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get chat history from current messages
     */
    getChatHistory() {
        return [...this.messages];
    }
    
    /**
     * Load chat history from AO process
     */
    async loadChatHistory() {
        try {
            this.updateStatus('Loading chat history...', '');
            
            const historyMessages = await this.chatHistory.getAllChatHistory();
            this.config.log(`Loaded ${historyMessages.length} messages from chat history`);
            
            // Process each history message
            for (const historyMessage of historyMessages) {
                await this.processHistoryMessage(historyMessage);
            }
            
            this.updateStatus(`Loaded ${historyMessages.length} chat messages`, 'connected');
            
        } catch (error) {
            this.config.log('Error loading chat history:', error);
            this.updateStatus('Failed to load chat history', 'error');
        }
    }
    
    /**
     * Refresh chat history
     */
    async refreshChatHistory() {
        // Clear current messages
        this.messages = [];
        if (this.messageContainer) {
            this.messageContainer.innerHTML = '';
        }
        
        // Clear chat history cache
        this.chatHistory.clearCache();
        
        // Reload history
        await this.loadChatHistory();
    }
    
    /**
     * Refresh only the latest messages (more efficient for slot advancement)
     */
    async refreshLatestHistory() {
        try {
            // Get the latest few slots worth of messages
            const latestMessages = await this.chatHistory.getLatestMessages(5);
            
            // Process any new messages we haven't seen yet
            for (const historyMessage of latestMessages) {
                const messageId = `history-${historyMessage.slot}-${historyMessage.reference}`;
                
                // Check if we already have this message
                if (!this.messages.find(m => m.id === messageId)) {
                    await this.processHistoryMessage(historyMessage);
                }
            }
        } catch (error) {
            this.config.debug('Error refreshing latest history:', error);
        }
    }

    /**
     * Clear chat history
     */
    clearChatHistory() {
        this.messages = [];
        // Removed hash tracking
        if (this.messageContainer) {
            this.messageContainer.innerHTML = '';
        }
        this.config.log('Chat history cleared');
    }

    /**
     * Get chat statistics
     */
    async getStats() {
        const statusCounts = this.messages.reduce((counts, msg) => {
            counts[msg.status] = (counts[msg.status] || 0) + 1;
            return counts;
        }, {});
        
        // Get chat history stats
        const historyStats = await this.chatHistory.getStats();

        return {
            totalMessages: this.messages.length,
            statusCounts,
            lastKnownSlot: this.lastKnownSlot,
            pendingMessages: this.pendingMessages.size,
            isPolling: this.isPolling,
            lastMessageId: this.lastMessageId,
            historyStats: historyStats
        };
    }

    /**
     * Event system for chat events
     */
    on(eventName, handler) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].push(handler);
        }
    }

    off(eventName, handler) {
        if (this.eventHandlers[eventName]) {
            const index = this.eventHandlers[eventName].indexOf(handler);
            if (index > -1) {
                this.eventHandlers[eventName].splice(index, 1);
            }
        }
    }

    emit(eventName, data) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.config.debug(`Error in event handler for ${eventName}:`, error);
                }
            });
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopMessagePolling();
        this.messages = [];
        this.pendingMessages.clear();
        // Removed hash tracking
        this.eventHandlers = {};
        this.config.log('Chat system destroyed');
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatSystem;
}

if (typeof window !== 'undefined') {
    window.ChatSystem = ChatSystem;
}