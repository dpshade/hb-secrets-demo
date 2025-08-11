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
                isPending: true,
                walletAddress: this.auth.getWalletAddress()
            };
            
            // No longer using hash-based deduplication

            // Add to messages immediately (optimistic update) with pending state
            this.addMessage(message);
            
            // Set a timeout to auto-confirm if no confirmation comes back
            setTimeout(() => {
                const stillPendingMessage = this.messages.find(m => m.id === messageId && m.isPending);
                if (stillPendingMessage) {
                    this.config.debug(`Auto-confirming message ${messageId} after timeout`);
                    
                    // Update message properties
                    stillPendingMessage.status = 'confirmed';
                    stillPendingMessage.isPending = false;
                    stillPendingMessage.source = 'auto-confirmed';
                    
                    // Update UI element smoothly
                    if (this.messageContainer) {
                        const messageEl = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
                        if (messageEl) {
                            messageEl.classList.remove('pending');
                            messageEl.classList.add('confirmed');
                            this.updateMessageElement(messageEl, stillPendingMessage);
                        }
                    }
                }
            }, 15000); // 15 second timeout

            // Send using direct push method including username as a tag
            const result = await this.api.pushMessage(messageContent, 'chat-message', {
                username: username
            });

            // Update message status
            if (result.ok) {
                // Update sent message count
                this.updateSentMessageCount();
                this.updateStatus(`Message sent successfully!`, 'connected');
                
                // Extract wallet address from response if available, or use default for successful connection
                let walletAddress = 'Connected'; // Default for successful 200 response
                
                // First check the outbox array
                if (result.data && result.data.outbox && result.data.outbox.length > 0) {
                    const outboxMessage = result.data.outbox[0];
                    if (outboxMessage.cache && outboxMessage.cache.wallet_address) {
                        walletAddress = outboxMessage.cache.wallet_address;
                        this.config.debug('Using wallet address from outbox:', walletAddress);
                    }
                }
                
                // Also check numbered slot responses (like "1": {...})
                if (walletAddress === 'Connected' && result.data) {
                    for (const [key, value] of Object.entries(result.data)) {
                        if (!isNaN(key) && value.message && value.message.cache && value.message.cache.wallet_address) {
                            walletAddress = value.message.cache.wallet_address;
                            this.config.debug(`Using wallet address from slot [${key}]:`, walletAddress);
                            break;
                        }
                    }
                }
                
                // Always emit wallet update event on successful 200 response
                this.config.debug('Updating wallet status - successful response with address:', walletAddress);
                window.dispatchEvent(new CustomEvent('hyperbeam-wallet-update', {
                    detail: {
                        walletAddress: walletAddress,
                        source: 'push-response'
                    }
                }));
                
                // IMMEDIATELY check slots and replace pending message with computed result
                this.checkForNewMessagesAndReplacePending(messageId, messageContent, username);
                
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
     * Check for new messages and smoothly confirm pending message with computed result
     */
    async checkForNewMessagesAndReplacePending(pendingMessageId, messageContent, username) {
        try {
            // Wait a brief moment for the message to be processed
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check current slot and get latest messages
            const currentSlot = await this.api.getCurrentSlot();
            const latestMessages = await this.chatHistory.getLatestMessages(3);
            
            // Look for our message in the latest results
            const computedMessage = latestMessages.find(msg => 
                msg.content === messageContent && 
                (msg.tags?.username === username || msg.tags?.Username === username || msg.username === username)
            );
            
            if (computedMessage) {
                this.config.debug(`Found computed message for pending ${pendingMessageId}:`, computedMessage);
                
                // Update the existing pending message in-place to confirmed state
                const pendingMessage = this.messages.find(m => m.id === pendingMessageId);
                if (pendingMessage) {
                    // Generate the new ID that matches what polling system expects
                    const newId = `history-${computedMessage.slot}-${computedMessage.reference}`;
                    
                    // Update message properties with slot information
                    pendingMessage.id = newId; // Critical: update ID to prevent duplicates
                    pendingMessage.status = 'confirmed';
                    pendingMessage.isPending = false;
                    pendingMessage.slot = computedMessage.slot;
                    pendingMessage.reference = computedMessage.reference;
                    pendingMessage.source = 'chat-history-confirmed';
                    
                    // Update UI element smoothly
                    if (this.messageContainer) {
                        const messageEl = this.messageContainer.querySelector(`[data-message-id="${pendingMessageId}"]`);
                        if (messageEl) {
                            // Update the data attribute to match new ID
                            messageEl.setAttribute('data-message-id', newId);
                            
                            // Remove pending state and add confirmed state
                            messageEl.classList.remove('pending');
                            messageEl.classList.add('confirmed');
                            
                            // Update the message element content if needed
                            this.updateMessageElement(messageEl, pendingMessage);
                        }
                    }
                    
                    this.config.debug(`Smoothly confirmed pending message ${pendingMessageId} -> ${newId} with computed result`);
                } else {
                    this.config.debug(`Could not find pending message ${pendingMessageId} to confirm`);
                }
            } else {
                this.config.debug(`No computed message found yet for pending ${pendingMessageId}, will auto-confirm on timeout`);
            }
            
        } catch (error) {
            this.config.debug('Error checking for computed messages:', error);
        }
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
                
                // Prepare new messages without displaying them yet
                const newMessages = [];
                for (const message of messages) {
                    const messageId = `history-${message.slot}-${message.reference}`;
                    
                    // Check if we already have this message
                    if (!this.messages.find(m => m.id === messageId)) {
                        const preparedMessage = await this.prepareHistoryMessage(message);
                        if (preparedMessage) {
                            newMessages.push(preparedMessage);
                        }
                    }
                }
                
                if (newMessages.length > 0) {
                    // Add new messages to existing messages and sort all together
                    const allMessages = [...this.messages, ...newMessages];
                    
                    // Sort all messages by timestamp
                    allMessages.sort((a, b) => {
                        if (a.timestamp !== b.timestamp) {
                            return a.timestamp - b.timestamp;
                        }
                        if (a.slot !== b.slot) {
                            return a.slot - b.slot;
                        }
                        return parseInt(a.reference || '0') - parseInt(b.reference || '0');
                    });
                    
                    // Display all messages in sorted order
                    this.displayMessages(allMessages);
                    
                    this.config.debug(`Added ${newMessages.length} new messages from slot ${slot}`);
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
     * Prepare a message from chat history without adding it to UI
     */
    async prepareHistoryMessage(historyMessage) {
        this.config.debug(`Preparing history message from slot ${historyMessage.slot}:`, historyMessage.content);

        // Extract username from message metadata/tags (now properly stored by AO process)
        let username = 'Chat User'; // Default username
        
        if (historyMessage.tags && historyMessage.tags.username) {
            username = historyMessage.tags.username;
        } else if (historyMessage.tags && historyMessage.tags.Username) {
            username = historyMessage.tags.Username;
        } else if (historyMessage.username) {
            username = historyMessage.username;
        }
        
        // Extract wallet address from message metadata/tags
        let messageWalletAddress = null;
        if (historyMessage.tags && historyMessage.tags.wallet_address) {
            messageWalletAddress = historyMessage.tags.wallet_address;
        } else if (historyMessage.tags && historyMessage.tags.Wallet_Address) {
            messageWalletAddress = historyMessage.tags.Wallet_Address;
        } else if (historyMessage.walletAddress) {
            messageWalletAddress = historyMessage.walletAddress;
        }
        
        // Get current user info for comparison
        const usernameInput = document.getElementById('username-input');
        const currentUsername = usernameInput?.value?.trim() || 'Chat User';
        const currentWalletAddress = this.auth.getWalletAddress();
        
        this.config.debug(`Preparing history: '${historyMessage.content}' from '${username}' (wallet: ${messageWalletAddress}), current user: '${currentUsername}' (wallet: ${currentWalletAddress})'`);
        
        // Check if this message is from the current user - prioritize wallet address comparison
        let isOwnMessage = false;
        if (messageWalletAddress && currentWalletAddress && 
            messageWalletAddress !== 'auto-generated' && currentWalletAddress !== 'auto-generated' &&
            messageWalletAddress.length === 43 && currentWalletAddress.length === 43) {
            // Use wallet address comparison when both are valid 43-char addresses
            isOwnMessage = messageWalletAddress === currentWalletAddress;
            this.config.debug(`History message own check via wallet: ${isOwnMessage} (${messageWalletAddress} vs ${currentWalletAddress})`);
        } else {
            // Fallback to username comparison
            isOwnMessage = username === currentUsername;
            this.config.debug(`History message own check via username: ${isOwnMessage} (${username} vs ${currentUsername})`);
        }
        
        // If this message is from the current user, check for existing message
        if (isOwnMessage) {
            // Find existing message with same slot/reference to avoid duplicates
            const existing = this.messages.find(m => 
                m.slot === historyMessage.slot && 
                m.reference === historyMessage.reference
            );

            if (existing) {
                this.config.debug('Own history message already processed; skipping');
                return null;
            }
            
            // Don't merge with pending messages - they should be handled by checkForNewMessagesAndReplacePending
        }
        
        // This is a new message from someone else - prepare it
        const processMessage = {
            id: `history-${historyMessage.slot}-${historyMessage.reference}`,
            content: historyMessage.content,
            timestamp: historyMessage.timestamp,
            author: username,
            status: 'received',
            slot: historyMessage.slot,
            reference: historyMessage.reference,
            source: 'chat-history',
            walletAddress: messageWalletAddress
        };

        return processMessage;
    }

    /**
     * Display multiple messages at once after they've been loaded and sorted
     */
    displayMessages(messages) {
        // Clear existing messages from UI but keep them in memory for deduplication
        if (this.messageContainer) {
            this.messageContainer.innerHTML = '';
        }
        
        // Reset messages array and add all prepared messages
        this.messages = [...messages];
        
        // Render all messages at once
        if (this.messageContainer) {
            // Create document fragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            
            messages.forEach(message => {
                const messageEl = document.createElement('div');
                messageEl.className = 'message';
                messageEl.setAttribute('data-message-id', message.id);
                
                // Add pending/confirmed state classes
                if (message.isPending || message.status === 'pending') {
                    messageEl.classList.add('pending');
                } else if (message.status === 'confirmed') {
                    messageEl.classList.add('confirmed');
                }
                
                this.updateMessageElement(messageEl, message);
                fragment.appendChild(messageEl);
            });
            
            // Add all messages to DOM at once
            this.messageContainer.appendChild(fragment);
            
            // Update grouping for all messages
            this.updateAllMessageGrouping();
            
            // Smooth scroll to bottom following message stagger animation (slower than messages)
            this.scrollToBottom(true, 1200);
        }
        
        this.config.debug(`Displayed ${messages.length} messages`);
    }
    
    /**
     * Display messages with staggered animation
     */
    displayMessagesWithAnimation(messages) {
        // Reset messages array and add all prepared messages
        this.messages = [...messages];
        
        // Render messages with progressive content revelation
        if (this.messageContainer) {
            
            // Create document fragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            
            messages.forEach((message, index) => {
                const messageEl = document.createElement('div');
                messageEl.className = 'message message-stagger';
                messageEl.setAttribute('data-message-id', message.id);
                
                // Add pending/confirmed state classes
                if (message.isPending || message.status === 'pending') {
                    messageEl.classList.add('pending');
                } else if (message.status === 'confirmed') {
                    messageEl.classList.add('confirmed');
                }
                
                this.updateMessageElement(messageEl, message);
                fragment.appendChild(messageEl);
            });
            
            // Add all messages to container at once
            this.messageContainer.appendChild(fragment);
            
            // Update grouping for all messages
            this.updateAllMessageGrouping();
            
            
            // Start smooth scroll immediately to follow the stagger animation (slower than messages)
            this.scrollToBottom(true, Math.min(messages.length * 40, 500) + 700);
        }
        
        this.config.debug(`Displayed ${messages.length} messages with smooth transition`);
    }
    
    
    /**
     * Show loading skeleton while messages are being fetched
     */
    showLoadingSkeleton() {
        if (!this.messageContainer) return;
        
        this.messageContainer.innerHTML = '<div class="loading">Loading chat history...</div>';
    }
    
    /**
     * Hide loading skeleton with smooth transition
     */
    async hideLoadingSkeleton() {
        if (!this.messageContainer) return;

        const skeletonItems = this.messageContainer.querySelectorAll('.skeleton-message');
        if (skeletonItems.length === 0) {
            this.messageContainer.innerHTML = ''; // Just clean up if no skeleton
            return;
        }

        // Create a promise that resolves when the last skeleton item finishes its transition
        await new Promise(resolve => {
            const lastSkeletonItem = skeletonItems[skeletonItems.length - 1];

            // Listen for the 'transitionend' event
            lastSkeletonItem.addEventListener('transitionend', resolve, { once: true });

            // Failsafe: if the event doesn't fire for some reason, resolve after a timeout
            setTimeout(resolve, 300); 

            // Add the class that triggers the animation on all skeleton items
            this.messageContainer.classList.add('skeleton-transitioning');
            this.messageContainer.classList.remove('skeleton-active');
        });

        // This code now runs *only after* the animation is truly finished
        this.messageContainer.classList.remove('loading', 'skeleton-transitioning');
        this.messageContainer.classList.add('content-preparing');
        this.messageContainer.innerHTML = '';
    }
    
    /**
     * Show empty state when no messages are found
     */
    showEmptyState() {
        if (!this.messageContainer) return;
        
        const emptyStateHTML = `
            <div class="empty-state">
                <h4>Welcome to the chat!</h4>
                <p>No messages yet. Start the conversation by typing something below.</p>
            </div>
        `;
        
        this.messageContainer.innerHTML = emptyStateHTML;
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
        
        // Extract wallet address from message metadata/tags
        let messageWalletAddress = null;
        if (historyMessage.tags && historyMessage.tags.wallet_address) {
            messageWalletAddress = historyMessage.tags.wallet_address;
        } else if (historyMessage.tags && historyMessage.tags.Wallet_Address) {
            messageWalletAddress = historyMessage.tags.Wallet_Address;
        } else if (historyMessage.walletAddress) {
            messageWalletAddress = historyMessage.walletAddress;
        }
        
        // Get current user info for comparison
        const usernameInput = document.getElementById('username-input');
        const currentUsername = usernameInput?.value?.trim() || 'Chat User';
        const currentWalletAddress = this.auth.getWalletAddress();
        
        this.config.debug(`Processing history: '${historyMessage.content}' from '${username}' (wallet: ${messageWalletAddress}), current user: '${currentUsername}' (wallet: ${currentWalletAddress})'`);
        
        // Check if this message is from the current user - prioritize wallet address comparison
        let isOwnMessage = false;
        if (messageWalletAddress && currentWalletAddress && 
            messageWalletAddress !== 'auto-generated' && currentWalletAddress !== 'auto-generated' &&
            messageWalletAddress.length === 43 && currentWalletAddress.length === 43) {
            // Use wallet address comparison when both are valid 43-char addresses
            isOwnMessage = messageWalletAddress === currentWalletAddress;
            this.config.debug(`Processing history own check via wallet: ${isOwnMessage} (${messageWalletAddress} vs ${currentWalletAddress})`);
        } else {
            // Fallback to username comparison
            isOwnMessage = username === currentUsername;
            this.config.debug(`Processing history own check via username: ${isOwnMessage} (${username} vs ${currentUsername})`);
        }
        
        // If this message is from the current user, merge it with the existing UI message
        if (isOwnMessage) {
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
            source: 'chat-history',
            walletAddress: messageWalletAddress
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
        
        // Determine if this is own message using multiple methods
        let isOwnMessage = false;
        
        // Get current user info for comparison
        const currentWalletAddress = this.auth.getWalletAddress();
        const usernameInput = document.getElementById('username-input');
        const currentUsername = usernameInput?.value?.trim() || 'Chat User';
        
        // Method 1: Wallet address comparison (most reliable)
        if (message.walletAddress && currentWalletAddress && 
            message.walletAddress !== 'auto-generated' && currentWalletAddress !== 'auto-generated' &&
            message.walletAddress.length === 43 && currentWalletAddress.length === 43) {
            isOwnMessage = message.walletAddress === currentWalletAddress;
            this.config.debug(`Own message check via wallet: ${message.walletAddress === currentWalletAddress} (${message.walletAddress} vs ${currentWalletAddress})`);
        } 
        // Method 2: Method/source-based detection (for sent messages)
        else if (message.method === 'direct-push' || (message.source && message.source !== 'chat-history')) {
            isOwnMessage = true;
            this.config.debug(`Own message check via method/source: true (${message.method || message.source})`);
        }
        // Method 3: Username comparison (fallback)
        else if (message.author && currentUsername && message.author === currentUsername) {
            isOwnMessage = true;
            this.config.debug(`Own message check via username: true (${message.author} === ${currentUsername})`);
        }
        
        this.config.debug(`Final own message determination: ${isOwnMessage} for message from ${message.author} (wallet: ${message.walletAddress})`);
        
        messageEl.classList.toggle('own-message', isOwnMessage);
        messageEl.classList.toggle('process-message', !isOwnMessage);
        
        // Get username, fallback to defaults
        let username = message.author || (isOwnMessage ? 'You' : 'System');
        
        // For own messages, show current username instead of 'You' to be consistent
        if (isOwnMessage && currentUsername && currentUsername !== 'Chat User') {
            username = currentUsername;
        }
        
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
    scrollToBottom(smooth = false, duration = 900) {
        if (this.config.UI.AUTO_SCROLL && this.messageContainer) {
            if (smooth) {
                // Animate scroll to follow message stagger animation
                this.animateScroll(this.messageContainer.scrollHeight, duration);
            } else {
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
            }
        }
    }

    /**
     * Animate scroll to match message stagger timing
     */
    animateScroll(targetScrollTop, duration = 900) {
        const container = this.messageContainer;
        const startScrollTop = container.scrollTop;
        const distance = targetScrollTop - startScrollTop;
        const startTime = performance.now();

        const animateStep = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Use easing function that matches message animation
            const easeProgress = this.easeOutCubic(progress);
            
            container.scrollTop = startScrollTop + (distance * easeProgress);

            if (progress < 1) {
                requestAnimationFrame(animateStep);
            } else {
                // Ensure we're exactly at the bottom
                container.scrollTop = container.scrollHeight;
            }
        };

        requestAnimationFrame(animateStep);
    }

    /**
     * Easing function for scroll - more gradual start to follow message stagger
     */
    easeOutCubic(t) {
        // Slower start to follow message reveals, then speed up
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
            // Show loading skeleton (without the loading text artifact)
            this.showLoadingSkeleton();
            this.updateStatus('Loading chat history...', '');
            
            // Step 1: Load ALL messages first
            const historyMessages = await this.chatHistory.getAllChatHistory();
            this.config.log(`Loaded ${historyMessages.length} messages from chat history`);
            
            if (historyMessages.length === 0) {
                await this.hideLoadingSkeleton();
                this.showEmptyState();
                this.updateStatus('No chat history found', 'connected');
                return;
            }
            
            // Step 2: Process and prepare ALL messages without displaying them
            const processedMessages = [];
            const chronologicalMessages = historyMessages.slice().reverse();
            
            for (const historyMessage of chronologicalMessages) {
                const processedMessage = await this.prepareHistoryMessage(historyMessage);
                if (processedMessage) {
                    processedMessages.push(processedMessage);
                }
            }
            
            // Step 3: Sort all processed messages
            processedMessages.sort((a, b) => {
                // Sort by timestamp primarily
                if (a.timestamp !== b.timestamp) {
                    return a.timestamp - b.timestamp;
                }
                // If timestamps are same, sort by slot then reference
                if (a.slot !== b.slot) {
                    return a.slot - b.slot;
                }
                return parseInt(a.reference || '0') - parseInt(b.reference || '0');
            });
            
            // Step 4: Hide loading and display messages
            await this.hideLoadingSkeleton();
            this.displayMessagesWithAnimation(processedMessages);
            
            this.updateStatus(`Loaded ${processedMessages.length} chat messages`, 'connected');
            
        } catch (error) {
            this.config.log('Error loading chat history:', error);
            await this.hideLoadingSkeleton();
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
        
        // Reload history using the improved load-all-then-sort-then-display pattern
        await this.loadChatHistory();
    }
    
    /**
     * Refresh only the latest messages (more efficient for slot advancement)
     */
    async refreshLatestHistory() {
        try {
            // Get the latest few slots worth of messages
            const latestMessages = await this.chatHistory.getLatestMessages(5);
            
            // Prepare new messages without displaying them yet
            const newMessages = [];
            for (const historyMessage of latestMessages) {
                const messageId = `history-${historyMessage.slot}-${historyMessage.reference}`;
                
                // Check if we already have this message
                if (!this.messages.find(m => m.id === messageId)) {
                    const preparedMessage = await this.prepareHistoryMessage(historyMessage);
                    if (preparedMessage) {
                        newMessages.push(preparedMessage);
                    }
                }
            }
            
            if (newMessages.length > 0) {
                // Add new messages to existing messages and sort all together
                const allMessages = [...this.messages, ...newMessages];
                
                // Sort all messages by timestamp
                allMessages.sort((a, b) => {
                    if (a.timestamp !== b.timestamp) {
                        return a.timestamp - b.timestamp;
                    }
                    if (a.slot !== b.slot) {
                        return a.slot - b.slot;
                    }
                    return parseInt(a.reference || '0') - parseInt(b.reference || '0');
                });
                
                // Display all messages in sorted order
                this.displayMessages(allMessages);
                
                this.config.debug(`Added ${newMessages.length} new messages from latest history`);
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
        
        // Get current user's wallet address for sent/received calculation
        const currentUserWalletAddress = this.auth ? this.auth.getWalletAddress() : null;
        
        // Get chat history stats with current user's wallet address
        const historyStats = await this.chatHistory.getStats(currentUserWalletAddress);

        return {
            totalMessages: this.messages.length,
            statusCounts,
            lastKnownSlot: this.lastKnownSlot,
            pendingMessages: this.pendingMessages.size,
            isPolling: this.isPolling,
            lastMessageId: this.lastMessageId,
            historyStats: historyStats,
            // Include sent/received/total from history stats for easy access
            sent: historyStats.sentMessages || 0,
            received: historyStats.receivedMessages || 0,
            total: historyStats.totalMessages || 0
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
     * Update sent message count in localStorage
     */
    updateSentMessageCount() {
        if (typeof localStorage !== 'undefined') {
            try {
                const stats = JSON.parse(localStorage.getItem('hyperbeam-chat-stats') || '{}');
                stats.totalSent = (stats.totalSent || 0) + 1;
                stats.lastMessageTime = Date.now();
                localStorage.setItem('hyperbeam-chat-stats', JSON.stringify(stats));
                this.config.debug(`Updated sent message count: ${stats.totalSent}`);
            } catch (error) {
                this.config.debug('Failed to update sent message count:', error);
            }
        }
    }
    
    /**
     * Get sent message statistics
     */
    getSentMessageStats() {
        if (typeof localStorage !== 'undefined') {
            try {
                return JSON.parse(localStorage.getItem('hyperbeam-chat-stats') || '{}');
            } catch (error) {
                this.config.debug('Failed to load sent message stats:', error);
                return {};
            }
        }
        return {};
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