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
        
        this.config.log(`Sending message ${messageId}: "${messageContent}"`);
        this.updateStatus('Sending message...', '');

        try {
            // Create message object
            const message = {
                id: messageId,
                content: messageContent,
                timestamp: timestamp,
                author: username,
                status: 'sending',
                method: 'direct-push'
            };

            // Add to messages immediately (optimistic update)
            this.addMessage(message);

            // Send using direct push method including username as a tag
            const result = await this.api.pushMessage(messageContent, 'chat-message', {
                username: username
            });

            // Update message status
            if (result.ok) {
                this.updateMessageStatus(messageId, 'sent', {
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

        // Try to extract username from message metadata or content
        let username = 'Chat User'; // Default username
        
        // If the message has metadata/tags, try to extract username
        if (historyMessage.tags && historyMessage.tags.username) {
            username = historyMessage.tags.username;
        } else if (historyMessage.username) {
            username = historyMessage.username;
        }

        // Create message from history data
        const processMessage = {
            id: `history-${historyMessage.slot}-${historyMessage.reference}`,
            content: historyMessage.content,
            timestamp: historyMessage.timestamp,
            author: username,
            status: 'executed',
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
                // If slot has advanced beyond when we sent the message, mark as executed
                const sendSlot = messageData.sendResult?.initialSlot;
                if (sendSlot && currentSlot > sendSlot) {
                    this.updateMessageStatus(messageId, 'executed', {
                        executedAtSlot: currentSlot,
                        ...messageData.sendResult
                    });
                    
                    this.pendingMessages.delete(messageId);
                    this.emit('executionComplete', { messageId, messageData, slot: currentSlot });
                }
            }
        }
    }

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
            message.status = status;
            message.statusData = data;
            
            // Update UI if message is visible
            if (this.messageContainer) {
                const messageEl = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
                if (messageEl) {
                    this.updateMessageElement(messageEl, message);
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
        messageEl.className = 'message';
        messageEl.setAttribute('data-message-id', message.id);
        
        this.updateMessageElement(messageEl, message);
        this.messageContainer.appendChild(messageEl);
    }

    /**
     * Update message element content
     */
    updateMessageElement(messageEl, message) {
        const statusText = this.getStatusText(message.status);
        const statusClass = this.getStatusClass(message.status);
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        // Add performance info if available
        let performanceInfo = '';
        if (message.statusData?.executionTime) {
            performanceInfo = ` (${message.statusData.executionTime}ms)`;
        }
        
        messageEl.innerHTML = `
            <div class="message-meta">
                <strong>${message.author}</strong> • 
                ${this.config.UI.SHOW_TIMESTAMPS ? timestamp + ' • ' : ''}
                <span class="message-status ${statusClass}">${statusText}${performanceInfo}</span>
                ${message.slot ? ` • Slot ${message.slot}` : ''}
            </div>
            <div class="message-content">${this.escapeHtml(message.content)}</div>
        `;
    }

    /**
     * Get status text for display
     */
    getStatusText(status) {
        const statusTexts = {
            sending: 'Sending...',
            sent: 'Sent',
            executed: 'Executed',
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
            sent: 'status-success',
            executed: 'status-executed',
            failed: 'status-error',
            pending: 'status-pending'
        };
        return statusClasses[status] || '';
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
     * Clear chat history
     */
    clearChatHistory() {
        this.messages = [];
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