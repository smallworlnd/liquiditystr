import { writable } from 'svelte/store';
import { verifyMessage } from "ln-verifymessagejs";
import pkg from '@rust-nostr/nostr-sdk';
const { 
    Client, 
    Duration,
    Keys, 
    NostrSigner,
    Filter, 
    Kind,
    EventBuilder,
    Tag,
    Timestamp,
    UnwrappedGift,
    loadWasmAsync,
    PublicKey
} = pkg;

const DEFAULT_RELAYS = [
    'ws://localhost:10547',
    //'wss://relay.damus.io',
    //'wss://nostr.mom',
    //'wss://nostr.bitcoiner.social',
];

const AD_KIND = 39735;

const REQ_AD_TAGS = [
    'd',
    'lsp_pubkey',
    // 'lsp_sig',  // activate after lsps adopt ad hardening
    'status',
    'min_required_channel_confirmations',
    'min_funding_confirms_within_blocks',
    'supports_zero_channel_reserve',
    'max_channel_expiry_blocks',
    'min_initial_client_balance_sat',
    'max_initial_client_balance_sat',
    'min_initial_lsp_balance_sat',
    'max_initial_lsp_balance_sat',
    'min_channel_balance_sat',
    'max_channel_balance_sat',
    'fixed_cost_sats',
    'variable_cost_ppm',
    'max_promised_fee_rate',
    'max_promised_base_fee',
];

export class NostrClientWrapper {
    constructor() {
        this.client = null;
        this.keys = null;
        this.signer = null;
        this.connected = writable(false);
        this.isInitialized = false;
    }

    async initializeClient() {
        if (this.isInitialized) return;
        
        try {
            await loadWasmAsync();
            
            this.keys = Keys.generate();
            this.signer = NostrSigner.keys(this.keys);
            
            this.client = new Client(this.signer);

            // Add relays
            for (const relay of DEFAULT_RELAYS) {
                try {
                    await this.client.addRelay(relay);
                } catch (relayError) {
                    console.warn(`Failed to add relay ${relay}:`, relayError);
                }
            }

            await this.client.connect();
            this.connected.set(true);
            this.isInitialized = true;

        } catch (error) {
            console.error('Failed to initialize Nostr client:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            this.connected.set(false);
        }
    }

    async getLSPAds() {
        if (!this.client) throw new Error('Client not initialized');
        
        try {
            const filter = new Filter().kind(new Kind(AD_KIND));
            
            const events = await this.client.fetchEvents(filter, Duration.fromSecs(10));
            
            const eventsArray = [];
            events.forEach((e) => {
                const adTags = e.tags.toVec().map(tag => tag.kind());
                // can use this after lsps harden ads
                // const adTagsVerified = adTags.every(tag => REQ_AD_TAGS.includes(tag))
                // instead just make sure all the specified tags above are in
                // the ad tags
                const adTagsVerified = REQ_AD_TAGS.every(requiredTag =>
                  adTags.includes(requiredTag)
                );
                // make sure there's an associated pubkey
                const lspPubkey = e.tags.find('lsp_pubkey').content();
                //// add these lines after lsps adopt hardened ads
                // verify the lsp pubkey and lsp_sig
                //const lspSig = e.tags.find('lsp_sig').content();
                //const nostrPubkey = e.author.toHex();
                //const adIsAuthentic = verifyMessage(lspSig, nostrPubkey, lspPubkey);
                //if (adTagsVerified && lspPubkey && adIsAuthentic) {
                if (adTagsVerified && lspPubkey) {
                    // 1) does ad have every required tag?
                    // 2) drop ads with no lsp pubkey
                    eventsArray.push(e);
                }
            });

            const latestByLSP = eventsArray.reduce((map, ev) => {
                const lspPubkey = ev.tags.find('lsp_pubkey').content();
                const timeSecs  = ev.createdAt.asSecs();

                const prev = map.get(lspPubkey);
                // 3) if we’ve never seen this LSP, or this event is newer, store it
                if (!prev || timeSecs > prev.createdAt.asSecs()) {
                    map.set(lspPubkey, ev);
                }
                return map;
            }, new Map());

            // 4) filter out reduced set of ads for only active ones
            const filteredActiveAds = new Map(
                [...latestByLSP].filter(([pubkey, ev]) =>
                    ev.tags.find('status')?.content() === 'active'
                )
            );

            const filteredEvents = Array.from(filteredActiveAds.values());
            
            return filteredEvents;
        } catch (error) {
            console.error('Error fetching events:', error);
            throw error;
        }
    }

    // Subscribe to gift-wrapped messages
    async subscribeToPrivateMessages(onMessage) {
        if (!this.client) throw new Error('Client not initialized');
        
        const self_dm_filter = new Filter()
            .pubkey(this.keys.publicKey)
            .limit(0);
        const signer = NostrSigner.keys(this.keys);
        const subscriptionId = await this.client.subscribe(self_dm_filter);
        
        this.client.handleNotifications({
            handleEvent: async (relayUrl, subscriptionId, event) => {
                if (event.kind.asU16() == 1059) {
                    try {
                        const content = await UnwrappedGift.fromGiftWrap(signer, event);
                        
                        const rumor = content.rumor;
                        const sender = content.sender;
                        
                        if (rumor.kind.asU16() === 14) { // Private direct message
                            await onMessage(rumor);
                        } else {
                            console.warn('Rumor kind', rumor.kind, 'is not a private DM (14)');
                        }
                        
                    } catch (unwrapError) {
                        console.error('Failed to decrypt:', unwrapError);
                    }
                }
            },
            handleMsg: async (relayUrl, msg) => {
                // console.log('Relay message from', relayUrl, ':', msg);
            }
        });
        
        return subscriptionId;
    }
}

export const nostrClient = new NostrClientWrapper();
