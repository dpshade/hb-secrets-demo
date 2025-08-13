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
     * Fetch messages using the improved /now/messages endpoint
     * This returns a clean structured format: { "1": { content, timestamp, username, wallet_address }, "device": "json@1.0" }
     */
    async fetchMessagesFromNowEndpoint() {
        try {
            const endpoint = this.api.config.getEndpoint('PROCESS_NOW_MESSAGES', this.processId);
            console.log('Fetching messages from /now/messages endpoint:', endpoint);
            
            const response = await this.api.makeRequest(endpoint, {
                method: 'GET'
            });

            if (response.ok && response.data) {
                const data = response.data;
                console.log('Raw /now/messages response:', data);
                
                // Parse the new structured format
                const messages = [];
                for (const [key, messageData] of Object.entries(data)) {
                    // Skip system fields like "device"
                    if (key === 'device' || !messageData || typeof messageData !== 'object') {
                        continue;
                    }
                    
                    // Convert to our standard message format
                    const message = {
                        content: messageData.content,
                        username: messageData.username || 'Chat User',
                        timestamp: parseInt(messageData.timestamp) || Date.now(),
                        walletAddress: messageData.wallet_address || null,
                        id: key // Use the key as message ID
                    };
                    
                    messages.push(message);
                }
                
                // Sort by timestamp (most recent first for display)
                messages.sort((a, b) => a.timestamp - b.timestamp);
                
                console.log(`Fetched ${messages.length} messages via /now/messages endpoint`);
                
                // Update cache
                this.messageCache = messages;
                this.lastFetchTime = Date.now();
                
                return messages;
            }
        } catch (error) {
            console.error('Error fetching messages from /now/messages endpoint:', error);
        }
        
        return [];
    }

    // Legacy function - no longer used since we have /now/messages endpoint
    async getRawMessagesFromSlot(slot) {
        return []; // Stub for compatibility
    }

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
     * Get all chat history - now uses the /now/messages endpoint primarily
     * Falls back to slot-based retrieval only if needed
     */
    async getAllChatHistory(maxSlots = 40, startFromSlot = null) {
        if (this.isLoading) return [];
        
        this.isLoading = true;
        
        try {
            // Try the new /now/messages endpoint first - this is much more efficient
            const messages = await this.fetchMessagesFromNowEndpoint();
            if (messages.length > 0) {
                console.log(`Loaded ${messages.length} messages via /now/messages endpoint`);
                return messages.slice(-maxSlots); // Return the most recent messages up to maxSlots
            }

            // Fallback to slot-based method only if /now/messages fails
            console.log('Falling back to slot-based message retrieval');
            const currentSlot = await this.getCurrentSlot();
            
            // Determine slot range - work backwards from current slot
            let startSlot, endSlot;
            if (startFromSlot) {
                startSlot = Math.max(1, startFromSlot - maxSlots);
                endSlot = startFromSlot;
            } else {
                // Default: get most recent messages by working backwards
                startSlot = Math.max(1, currentSlot - maxSlots + 1);
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
     * Get the latest N messages - simplified to use the primary /now/messages endpoint
     */
    async getLatestMessages(count = 10, forceFetch = false) {
        try {
            // Use the cached messages if available and not forcing fetch
            if (!forceFetch && this.messageCache.length > 0) {
                return this.messageCache.slice(-count).reverse(); // Get last N messages, newest first
            }
            
            // Fetch fresh messages from the /now/messages endpoint
            const messages = await this.fetchMessagesFromNowEndpoint();
            if (messages.length > 0) {
                // Return the latest messages, up to the requested count
                return messages.slice(-count).reverse(); // Get last N messages, newest first
            }
            
            // If /now/messages fails, return empty array (no complex fallback for getLatestMessages)
            console.warn('No messages available from /now/messages endpoint');
            return [];
            
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

    // Get chat statistics
    async getStats(currentUserWalletAddress = null) {
        const allMessages = await this.getAllChatHistory();
        const currentSlot = await this.getCurrentSlot();
        
        // Calculate sent/received statistics
        let sent = 0;
        let received = 0;
        let total = allMessages.length;
        
        if (currentUserWalletAddress) {
            // Count messages from current user's wallet
            sent = allMessages.filter(msg => 
                msg.walletAddress && msg.walletAddress === currentUserWalletAddress
            ).length;
            
            // Received = Total slots computed and displayed - Sent
            received = total - sent;
        }
        
        return {
            totalMessages: total,
            sentMessages: sent,
            receivedMessages: received,
            currentSlot: currentSlot,
            cachedSlots: this.cachedMessages.size,
            latestMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatHistory;
} else {
    window.ChatHistory = ChatHistory;
}