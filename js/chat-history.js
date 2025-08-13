// Chat History Retrieval System for HyperBEAM
// Retrieves chat messages from AO process compute results

class ChatHistory {
    constructor(hyperbeamApi, processId) {
        this.api = hyperbeamApi;
        this.processId = processId;
        this.cachedMessages = new Map(); // slot -> messages
        this.messageCache = []; // Simple array cache for /now/messages results
        this.currentSlot = 0;
        this.isLoading = false;
        this.lastFetchTime = 0;
        this.lastMessageCount = 0; // Track last known message count for efficient polling
        this.messageCountCache = 0; // Cache the message count
        this.highestMessageId = 0; // Track highest message ID we've seen for pagination
    }

    async getCurrentSlot() {
        try {
            const response = await this.api.makeRequest(
                `/${this.processId}~process@1.0/slot/current/body/serialize~json@1.0`,
                { method: 'POST', body: '{}' }
            );
            
            if (response.ok && response.data) {
                let slot;
                if (typeof response.data === 'string') {
                    slot = parseInt(response.data.trim());
                } else if (typeof response.data === 'object' && response.data !== null) {
                    // HyperBEAM returns slot in 'body' field
                    slot = response.data.body !== undefined ? response.data.body : response.data;
                } else {
                    slot = response.data;
                }
                this.currentSlot = slot;
                return this.currentSlot;
            }
        } catch (error) {
            console.error('Error getting current slot:', error);
        }
        return this.currentSlot;
    }

    /**
     * Get the current message count from the /lenmessages endpoint
     */
    async getMessageCount() {
        try {
            const endpoint = this.api.config.getEndpoint('PROCESS_MESSAGE_COUNT', this.processId);
            const response = await this.api.makeRequest(endpoint, {
                method: 'GET'
            });

            if (response.ok && response.data && response.data.body !== undefined) {
                this.messageCountCache = parseInt(response.data.body);
                console.log(`Current message count: ${this.messageCountCache}`);
                return this.messageCountCache;
            }
        } catch (error) {
            console.error('Error getting message count:', error);
        }
        return this.messageCountCache; // Return cached value on error
    }

    /**
     * Fetch a specific message by its index (1-based)
     */
    async fetchIndividualMessage(messageIndex) {
        try {
            const endpoint = this.api.config.getEndpoint('PROCESS_INDIVIDUAL_MESSAGE', this.processId, messageIndex);
            const response = await this.api.makeRequest(endpoint, {
                method: 'GET'
            });

            if (response.ok && response.data) {
                const messageData = response.data;
                
                // Convert to our standard message format
                const message = {
                    content: messageData.content,
                    username: messageData.username || 'Chat User',
                    timestamp: parseInt(messageData.timestamp) || Date.now(),
                    walletAddress: messageData.wallet_address || null,
                    id: messageIndex.toString() // Use index as message ID
                };
                
                return message;
            }
        } catch (error) {
            console.error(`Error fetching message ${messageIndex}:`, error);
        }
        return null;
    }

    /**
     * Efficiently fetch only new messages since last check
     * Uses individual /N endpoints for bandwidth efficiency
     */
    async fetchNewMessages() {
        return await this.fetchNewMessagesOnly();
    }

    /**
     * Fetch only NEW messages using individual /now/messages/N endpoints
     * This is bandwidth-efficient - fetches each new message individually
     */
    async fetchNewMessagesOnly() {
        try {
            // First get the current total message count
            const currentCount = await this.getMessageCount();
            
            if (currentCount <= this.highestMessageId) {
                console.log(`✅ POLLING: No new messages (current: ${currentCount}, highest: ${this.highestMessageId})`);
                return [];
            }
            
            // Fetch individual messages from highest+1 to current count
            const startId = this.highestMessageId + 1;
            const messages = [];
            
            console.log(`🔄 POLLING: Fetching messages ${startId} to ${currentCount}`);
            
            for (let messageId = startId; messageId <= currentCount; messageId++) {
                const message = await this.fetchIndividualMessage(messageId);
                if (message) {
                    messages.push(message);
                }
            }
            
            // Update our highest ID tracking
            if (messages.length > 0) {
                this.highestMessageId = currentCount;
                console.log(`📬 NEW MESSAGES: Found ${messages.length} new messages (highest ID: ${currentCount})`);
            }
            
            // Sort by timestamp
            messages.sort((a, b) => a.timestamp - b.timestamp);
            
            return messages;
            
        } catch (error) {
            console.error('Error fetching new messages:', error);
        }
        
        return [];
    }

    // REMOVED: fetchMessagesFromNowEndpoint - replaced by individual message fetching

    // REMOVED: getRawMessagesFromSlot - no longer needed

    async getMessagesFromSlot(slot) {
        if (this.cachedMessages.has(slot)) {
            return this.cachedMessages.get(slot);
        }

        try {
            // Try to get the raw message data from process inbox/outbox first
            let messages = await this.getRawMessagesFromSlot(slot);
            if (messages.length > 0) {
                this.cachedMessages.set(slot, messages);
                return messages;
            }

            // Fallback to compute results if raw messages aren't available
            const endpoint = `/${this.processId}~process@1.0/compute&slot=${slot}/results/serialize~json@1.0`;
            const response = await this.api.makeRequest(endpoint, {
                method: 'POST',
                body: '{}'
            });

            if (response.ok && response.data) {
                let messages = [];
                
                // Handle different response formats
                if (response.data.outbox) {
                    // Standard AO outbox format
                    messages = response.data.outbox
                        .filter(item => item.data || item.cache?.data || item.cache?.content)
                        .map(item => {
                            // Handle different data formats
                            let content = item.data || item.cache?.data || item.cache?.content || '';
                            let username = 'Chat User';
                            let walletAddress = null;
                            
                            // Check for username in cache or tags
                            if (item.cache?.username) {
                                username = item.cache.username;
                            } else if (item.tags?.username || item.tags?.Username) {
                                username = item.tags.username || item.tags.Username;
                            }
                            
                            // Check for wallet address in cache or tags
                            if (item.cache?.wallet_address) {
                                walletAddress = item.cache.wallet_address;
                            } else if (item.tags?.wallet_address) {
                                walletAddress = item.tags.wallet_address;
                            } else if (item.tags?.Wallet_Address) {
                                walletAddress = item.tags.Wallet_Address;
                            } else if (item.owner) {
                                walletAddress = item.owner;
                            }
                            
                            return {
                                content: decodeURIComponent(content.replace(/\+/g, ' ')),
                                reference: item.reference,
                                slot: slot,
                                timestamp: item.cache?.timestamp || item.timestamp,
                                tags: item.tags || {},
                                username: username,
                                walletAddress: walletAddress
                            };
                        });
                } else if (response.data.result) {
                    // Alternative result format
                    messages = Array.isArray(response.data.result) 
                        ? response.data.result.map((item, index) => ({
                            content: decodeURIComponent((item.data || item).replace(/\+/g, ' ')),
                            reference: index.toString(),
                            slot: slot,
                            timestamp: Date.now(),
                            tags: item.tags || {},
                            username: item.tags?.username || item.tags?.Username || 'Chat User',
                            walletAddress: item.tags?.wallet_address || item.tags?.Wallet_Address || item.owner || null
                        }))
                        : [{
                            content: decodeURIComponent((response.data.result.data || response.data.result).replace(/\+/g, ' ')),
                            reference: '0',
                            slot: slot,
                            timestamp: Date.now(),
                            tags: response.data.result.tags || {},
                            username: response.data.result.tags?.username || response.data.result.tags?.Username || 'Chat User',
                            walletAddress: response.data.result.tags?.wallet_address || response.data.result.tags?.Wallet_Address || response.data.result.owner || null
                        }];
                } else if (typeof response.data === 'string' && response.data.trim()) {
                    // Simple string response
                    messages = [{
                        content: decodeURIComponent(response.data.trim().replace(/\+/g, ' ')),
                        reference: '0',
                        slot: slot,
                        timestamp: Date.now(),
                        tags: {},
                        username: 'Chat User', // String responses typically don't have tag metadata
                        walletAddress: null // String responses typically don't have wallet metadata
                    }];
                }

                this.cachedMessages.set(slot, messages);
                console.log(`Found ${messages.length} messages in slot ${slot}`);
                
                // Debug: Log wallet addresses found in messages
                messages.forEach((msg, i) => {
                    if (msg.walletAddress) {
                        console.log(`Message ${i} wallet address: ${msg.walletAddress.substring(0, 8)}...`);
                    }
                });
                
                return messages;
            }
        } catch (error) {
            console.error(`Error getting messages from slot ${slot}:`, error);
        }

        return [];
    }

    /**
     * Get all chat history - uses individual message fetching for bandwidth efficiency
     * Falls back to slot-based retrieval if needed
     */
    async getAllChatHistory(maxMessages = 150, startFromSlot = null) {
        if (this.isLoading) return [];
        
        this.isLoading = true;
        
        try {
            // Get total message count first
            const totalMessages = await this.getMessageCount();
            if (totalMessages > 0) {
                console.log(`Loading initial chat history - ${totalMessages} total messages, fetching last ${Math.min(maxMessages, totalMessages)}`);
                
                // Calculate which messages to fetch (last N messages)
                const messagesToFetch = Math.min(maxMessages, totalMessages);
                const startId = Math.max(1, totalMessages - messagesToFetch + 1);
                
                const messages = [];
                
                // Fetch individual messages for bandwidth efficiency
                for (let messageId = startId; messageId <= totalMessages; messageId++) {
                    const message = await this.fetchIndividualMessage(messageId);
                    if (message) {
                        messages.push(message);
                    }
                }
                
                // Update highest ID tracking for future polling
                this.highestMessageId = totalMessages;
                
                console.log(`Loaded ${messages.length} messages via individual /N endpoints (highest ID: ${this.highestMessageId})`);
                return messages;
            }

            // Fallback to slot-based method only if individual message fetching fails
            console.log('Falling back to slot-based message retrieval');
            const currentSlot = await this.getCurrentSlot();
            
            // Determine slot range - work backwards from current slot
            let startSlot, endSlot;
            if (startFromSlot) {
                startSlot = Math.max(1, startFromSlot - maxMessages);
                endSlot = startFromSlot;
            } else {
                // Default: get most recent messages by working backwards
                startSlot = Math.max(1, currentSlot - maxMessages + 1);
                endSlot = currentSlot;
            }
            
            console.log(`Loading chat history backwards from slot ${endSlot} to ${startSlot}`);

            const allMessages = [];
            
            // Process slots in reverse order (most recent first)
            for (let slot = endSlot; slot >= startSlot; slot--) {
                const messages = await this.getMessagesFromSlot(slot);
                allMessages.push(...messages);
            }

            // Sort by slot (descending) and reference to maintain newest-first order
            allMessages.sort((a, b) => {
                if (a.slot !== b.slot) return b.slot - a.slot; // Most recent slot first
                return parseInt(b.reference || '0') - parseInt(a.reference || '0'); // Most recent reference first
            });

            console.log(`Loaded ${allMessages.length} chat messages backwards from slots ${endSlot}-${startSlot}`);
            return allMessages;
            
        } catch (error) {
            console.error('Error loading chat history:', error);
            return [];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Get the latest N messages - uses individual /N fetching for bandwidth efficiency
     */
    async getLatestMessages(count = 10, forceFetch = false) {
        try {
            // Use the cached messages if available and not forcing fetch
            if (!forceFetch && this.messageCache.length > 0) {
                return this.messageCache.slice(-count).reverse(); // Get last N messages, newest first
            }
            
            // Get total message count first
            const totalMessages = await this.getMessageCount();
            if (totalMessages === 0) {
                return [];
            }
            
            // Calculate which messages to fetch (last N messages)
            const messagesToFetch = Math.min(count, totalMessages);
            const startId = Math.max(1, totalMessages - messagesToFetch + 1);
            
            const messages = [];
            
            // Fetch individual messages for bandwidth efficiency
            for (let messageId = startId; messageId <= totalMessages; messageId++) {
                const message = await this.fetchIndividualMessage(messageId);
                if (message) {
                    messages.push(message);
                }
            }
            
            // Sort by timestamp and return newest first
            messages.sort((a, b) => b.timestamp - a.timestamp);
            
            return messages;
            
        } catch (error) {
            console.error('Error getting latest messages:', error);
            return [];
        }
    }

    async waitForNewMessage(previousSlot, timeout = 10000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            const currentSlot = await this.getCurrentSlot();
            if (currentSlot > previousSlot) {
                // New slot available, get its messages
                const newMessages = await this.getMessagesFromSlot(currentSlot);
                if (newMessages.length > 0) {
                    return { slot: currentSlot, messages: newMessages };
                }
            }
            
            // Wait 500ms before checking again
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return null; // Timeout
    }

    clearCache() {
        this.cachedMessages.clear();
    }

    // Get chat statistics - optimized to use cached data
    async getStats(currentUserWalletAddress = null) {
        // Use cached message count instead of refetching all messages
        const currentSlot = await this.getCurrentSlot();
        let total = this.messageCountCache || await this.getMessageCount();
        
        // For detailed sent/received stats, only use cached messages if available
        let sent = 0;
        let received = 0;
        
        if (currentUserWalletAddress && this.messageCache.length > 0) {
            // Use cached messages for detailed stats
            const cachedMessages = this.messageCache;
            total = cachedMessages.length; // Use actual cached count
            
            // Calculate sent/received from cached messages
            sent = cachedMessages.filter(msg => 
                msg.walletAddress && msg.walletAddress === currentUserWalletAddress
            ).length;
            
            received = total - sent;
        } else {
            // No detailed breakdown available without fetching, just use totals
            sent = 0;
            received = total;
        }
        
        return {
            totalMessages: total,
            sentMessages: sent,
            receivedMessages: received,
            currentSlot: currentSlot,
            cachedSlots: this.cachedMessages.size,
            latestMessage: this.messageCache.length > 0 ? this.messageCache[this.messageCache.length - 1] : null
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatHistory;
} else {
    window.ChatHistory = ChatHistory;
}