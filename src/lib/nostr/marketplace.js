import { nostrClient } from './client.js';
import pkg from '@rust-nostr/nostr-sdk';
const { Tag, EventBuilder, Kind, PublicKey, loadWasmAsync } = pkg;

// Order states
export const ORDER_STATES = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING', 
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
};

// Channel states
export const CHANNEL_STATES = {
    PENDING: 'PENDING',
    OPEN: 'OPEN',
    CLOSED: 'CLOSED'
};

export class MarketplaceClient {
    constructor() {
        this.advertisements = new Map();
        this.privateMessageSubscription = null;
        this.orderResponseCallback = null;
        this.channelUpdateCallback = null;
    }

    async initialize() {
        console.log('Initializing marketplace client...');
        await nostrClient.initializeClient();
        
        // Start listening for private messages with error handling
        try {
            this.privateMessageSubscription = await nostrClient.subscribeToPrivateMessages(
                (rumor) => this.handlePrivateMessage(rumor)
            );
        } catch (error) {
            console.warn('Failed to set up private message subscription:', error);
        }
    }

    async disconnect() {
        if (this.privateMessageSubscription) {
            try {
                await nostrClient.client.unsubscribe(this.privateMessageSubscription);
            } catch (error) {
                console.warn('Failed to unsubscribe from private messages:', error);
            }
        }
        await nostrClient.disconnect();
    }

    // Parse LSP advertisement from Nostr event
    parseAdvertisement(event) {
        // Get tags from the event (WASM object) - use forEach approach like in client.js
        const tagMap = new Map();

        // If tag map is still empty, try parsing from JSON representation as fallback
        try {
            if (typeof event.asJson === 'function') {
                const eventJson = event.asJson();
                const eventObj = JSON.parse(eventJson);
                
                if (eventObj.tags && Array.isArray(eventObj.tags)) {
                    for (const tag of eventObj.tags) {
                        if (Array.isArray(tag) && tag.length >= 2) {
                            let tagVal = tag[1];

                            if (typeof tagVal === 'string') {
                                if (tagVal.toLowerCase() === 'true') {
                                    tagVal = true;
                                } else if (tagVal.toLowerCase() === 'false') {
                                    tagVal = false;
                                }
                            }
                            tagMap.set(tag[0], tagVal);
                        }
                    }
                }
            }
        } catch (jsonError) {
            console.error('JSON fallback failed:', jsonError);
        }

        // Create basic ad object
        const ad = {
            d: tagMap.get('d'),
            lsp_pubkey: tagMap.get('lsp_pubkey'),
            supports_private_channels: tagMap.get('supports_private_channels'),
            fixed_cost_sats: parseInt(tagMap.get('fixed_cost_sats') || '0'),
            variable_cost_ppm: parseInt(tagMap.get('variable_cost_ppm') || '0'),
            min_initial_client_balance_sat: parseInt(tagMap.get('min_initial_client_balance_sat') || '0'),
            max_initial_client_balance_sat: parseInt(tagMap.get('max_initial_client_balance_sat') || '0'),
            min_initial_lsp_balance_sat: parseInt(tagMap.get('min_initial_lsp_balance_sat') || '0'),
            max_initial_lsp_balance_sat: parseInt(tagMap.get('max_initial_lsp_balance_sat') || '0'),
            min_channel_balance_sat: parseInt(tagMap.get('min_channel_balance_sat') || '0'),
            max_channel_balance_sat: parseInt(tagMap.get('max_channel_balance_sat') || '0'),
            max_channel_expiry_blocks: parseInt(tagMap.get('max_channel_expiry_blocks') || '0'),
            min_funding_confirms_within_blocks: parseInt(tagMap.get('min_funding_confirms_within_blocks') || '2'),
            max_promised_fee_rate: parseInt(tagMap.get('max_promised_fee_rate') || '0'),
            max_promised_base_fee: parseInt(tagMap.get('max_promised_base_fee') || '0'),
            
            // Extract real metadata from the event
            nostr_pubkey: event.author.toHex(),
            
            // Extract node info from content
            ...this.extractNodeInfo(event),
        };

        // Calculate APR values
        ad.min_apr = this.calculateAPR(ad.fixed_cost_sats, ad.variable_cost_ppm, ad.min_channel_balance_sat, ad.max_channel_expiry_blocks);
        ad.max_apr = this.calculateAPR(ad.fixed_cost_sats, ad.variable_cost_ppm, ad.max_channel_balance_sat, ad.max_channel_expiry_blocks);

        return ad;
    }

    // Extract node stats from event content
    extractNodeInfo(event) {
        const contentObj = JSON.parse(event.content);
        if (contentObj.node_stats) {
            const stats = contentObj.node_stats;
            return {
                lsp_alias: stats.alias,
                total_capacity: parseInt(stats.total_capacity || '0'),
                num_channels: parseInt(stats.num_channels || '0'),
                median_outbound_ppm: parseInt(stats.median_outbound_ppm || '0'),
                median_inbound_ppm: parseInt(stats.median_inbound_ppm || '0'),
                value_prop: contentObj.lsp_message || undefined
            };
        }
    }

    calculateAPR(fixedCostSats, variableCostPpm, capacitySats, maxExpiryBlocks) {
        if (!capacitySats || !maxExpiryBlocks) return 0;
        
        const yearlyBlocks = 24 * 60 / 10 * 365; // ~52560 blocks per year
        const capacityCost = fixedCostSats + (variableCostPpm * capacitySats / 1000000);
        return (capacityCost / capacitySats) * (yearlyBlocks / maxExpiryBlocks) * 100;
    }

    // Fetch all LSP advertisements
    async fetchAdvertisements() {
        try {
            const events = await nostrClient.getLSPAds();
            this.advertisements.clear();
            
            for (const event of events || []) {
                try {
                    const ad = this.parseAdvertisement(event);
                    if (ad && ad.d) {
                        this.advertisements.set(ad.d, ad);
                    } else {
                        console.warn('Advertisement missing ID (d tag) or parse failed:', ad);
                    }
                } catch (e) {
                    console.warn('Failed to parse advertisement event:', e, event);
                }
            }
            
            const finalAds = Array.from(this.advertisements.values());
            return finalAds;
        } catch (error) {
            throw error;
        }
    }

    // Create and send order request via NIP-17
    async submitOrder(orderRequest) {
        if (!orderRequest.d) {
            throw new Error('Order must specify ad ID (d)');
        }
        
        const ad = this.advertisements.get(orderRequest.d);
        if (!ad) {
            throw new Error(`Advertisement ${orderRequest.d} not found`);
        }

        // Create order tags
        const tags = [
            Tag.parse(['d', orderRequest.d]),
            Tag.parse(['lsp_balance_sat', orderRequest.lsp_balance_sat.toString()]),
            Tag.parse(['client_balance_sat', orderRequest.client_balance_sat.toString()]),
            Tag.parse(['channel_expiry_blocks', orderRequest.channel_expiry_blocks.toString()]),
            Tag.parse(['target_pubkey_uri', orderRequest.target_pubkey_uri]),
            Tag.parse(['required_channel_confirmations', orderRequest.required_channel_confirmations.toString()]),
            Tag.parse(['funding_confirms_within_blocks', orderRequest.funding_confirms_within_blocks.toString()]),
            Tag.parse(['announce_channel', orderRequest.announce_channel.toString()]),
            Tag.parse(['token', '']),
            Tag.parse(['refund_onchain_address', '']),
        ];

        // Send private message to LSP
        try {
            await nostrClient.client.sendPrivateMsg(
                PublicKey.parse(ad.nostr_pubkey),
                "order request",
                tags
            );
        } catch (error) {
            throw error;
        }

        return {
            status: 'submitted'
        };
    }

    // Handle incoming private messages (order responses, channel updates)
    async handlePrivateMessage(rumor) {
        try {
            let rumorData = {};
            
            try {
                // Parse the rumor as JSON to get a plain object
                if (typeof rumor.asJson === 'function') {
                    const rumorJson = rumor.asJson();
                    rumorData = JSON.parse(rumorJson);
                } else {
                    console.error('No way to extract JSON from rumor');
                    return;
                }
            } catch (jsonError) {
                console.error('Failed to parse rumor JSON:', jsonError);
                return;
            }

            // Convert tags array to simple object for easier access
            const tags = {};
            if (rumorData.tags && Array.isArray(rumorData.tags)) {
                for (const tag of rumorData.tags) {
                    if (Array.isArray(tag) && tag.length >= 2) {
                        tags[tag[0]] = tag[1];
                    }
                }
            }

            // Check if this is an order response
            if (this.isOrderResponse(tags)) {
                await this.handleOrderResponse(rumorData, tags);
            }
            // Check if this is a channel update
            else if (this.isChannelUpdate(tags)) {
                await this.handleChannelUpdate(rumorData, tags);
            } else {
                console.warn('Message does not match order response or channel update pattern');
            }
            
        } catch (error) {
            console.error('Failed to handle private message:', error);
        }
    }

    isOrderResponse(tags) {
        return ((tags.order_id && tags.payment) || (tags.code && tags.error_message));
    }

    isChannelUpdate(tags) {
        return tags.channel_state &&
               (tags.txid_hex || tags.output_index);
    }

    async handleOrderResponse(rumorData, tags) {
        if (tags.error_message) {
            // Error response
            const errorResponse = {
                error_message: tags.error_message,
                code: tags.code || 'unknown_error'
            };
            
            // Notify callback
            if (this.orderResponseCallback) {
                this.orderResponseCallback(errorResponse);
            }
        } else {
            // Parse the payment JSON string from tags
            let paymentData = {};
            try {
                if (tags.payment) {
                    paymentData = JSON.parse(tags.payment);
                }
            } catch (err) {
                console.warn('Failed to parse payment JSON from tags:', err);
            }

            // Success response
            const orderResponse = {
                order_id: tags.order_id,
                order_state: tags.order_state || ORDER_STATES.PROCESSING,
                lsp_balance_sat: parseInt(tags.lsp_balance_sat || '0'),
                client_balance_sat: parseInt(tags.client_balance_sat || '0'), 
                channel_expiry_blocks: parseInt(tags.channel_expiry_blocks || '0'),
                announce_channel: tags.announce_channel === 'true' || tags.announce_channel === 'True',
                payment: paymentData
            };
            
            // Notify callback
            if (this.orderResponseCallback) {
                this.orderResponseCallback(orderResponse);
            }
        }
    }

    async handleChannelUpdate(rumorData, tags) {
        if (tags.channel_state == "PENDING" || tags.channel_state == "OPEN") {
            const channelUpdate = {
                channel_state: tags.channel_state,
                txid_hex: tags.txid_hex,
                output_index: parseInt(tags.output_index || '0')
            };
            // Notify callback
            if (this.channelUpdateCallback) {
                this.channelUpdateCallback(channelUpdate);
            }
        } else {
            // Error response
            const errorResponse = {
                error_message: tags.error_message
            };

            // Notify callback
            if (this.channelUpdateCallback) {
                this.channelUpdateCallback(errorResponse);
            }
        }
    }

    // Register callbacks for order responses and channel updates  
    onOrderResponse(callback) {
        this.orderResponseCallback = callback;
    }

    onChannelUpdate(callback) {
        this.channelUpdateCallback = callback;
    }

    // Remove callbacks
    removeOrderCallback() {
        this.orderResponseCallback = null;
        this.channelUpdateCallback = null;
    }

    getPublicHexKey() {
        return nostrClient.keys.publicKey.toHex();
    }

    getNpub() {
        return nostrClient.keys.publicKey.toBech32();
    }
}

export const marketplaceClient = new MarketplaceClient();
