<script>
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import { Zap, RefreshCw, Send, Clock, CheckCircle, AlertCircle, Copy, QrCode, Github, ChevronDown, HelpCircle } from 'lucide-svelte';
	import QRCode from 'qrcode';
	import { browser } from '$app/environment';
	
	// Stores for application state
	const ads = writable([]);
	const selectedAd = writable(null);
	const orderRequest = writable({
		lsp_balance_sat: 100000,
		client_balance_sat: 0,
		channel_expiry_blocks: 13000,
		target_pubkey_uri: '',
		required_channel_confirmations: 0,
		funding_confirms_within_blocks: 6,
		announce_channel: true
	});
	const orderResponse = writable(null);
	const channelStatus = writable(null);
	const loading = writable(false);
	const error = writable('');
	
	// Session management
	const sessionInfo = writable({
		sessionId: null,
		npub: null,
		initialized: false
	});
	
	// Current workflow step
	const step = writable(1);
	
	let adsList = [];
	let selectedAdInfo = null;
	let orderData = {
		lsp_balance_sat: 100000,
		client_balance_sat: 0,
		channel_expiry_blocks: 13000,
		target_pubkey_uri: '',
		required_channel_confirmations: 0,
		funding_confirms_within_blocks: 6,
		announce_channel: true
	};
	let orderResult = null;
	let channelResult = null;
	let isLoading = false;
	let errorMessage = '';
	let currentStep = 1;
	let sessionData = {
		sessionId: null,
		npub: null,
		initialized: false
	};
	let qrCodeDataUrl = '';
	let isListeningForChannels = false;

	// Validation state
	let pubkeyValidation = {
		isValid: false,
		message: ''
	};

	// FAQ state
	let expandedFAQ = {};

	// Tooltip state
	let copiedTooltips = {};

	// Popover state
	let showOutboundPopover = false;
	let showAdPopovers = {};

	// API base URL - same origin since frontend and backend are in same container
	let API_BASE = '/api';

	// Subscribe to stores
	ads.subscribe(value => adsList = value);
	selectedAd.subscribe(value => selectedAdInfo = value);
	orderRequest.subscribe(value => orderData = value);
	orderResponse.subscribe(value => orderResult = value);
	channelStatus.subscribe(value => channelResult = value);
	loading.subscribe(value => isLoading = value);
	error.subscribe(value => errorMessage = value);
	step.subscribe(value => currentStep = value);
	sessionInfo.subscribe(value => sessionData = value);

	onMount(async () => {
		await initializeSession();
		// Load ads without forcing refresh on initial load
		await loadAds(false);
	});

	async function initializeSession() {
		if (sessionData.initialized) return;
		
		try {
			// Always call the backend to get/create a session
			const response = await fetch(`${API_BASE}/session/`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			
			if (response.ok) {
				const sessionData = await response.json();
				
				const newSession = {
					sessionId: sessionData.session_id,
					npub: sessionData.nostr_pubkey,
					initialized: true
				};
				
				sessionInfo.set(newSession);
				
				// Store in localStorage for reuse
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('liquiditystr-session', JSON.stringify(newSession));
				}
				
			} else {
				throw new Error(`Failed to create session: ${response.status}`);
			}
		} catch (err) {
			console.error('Failed to initialize session:', err);
			error.set('Failed to initialize session: ' + err.message);
		}
	}

	function generateSessionId() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	function generateTempNpub() {
		// Generate a temporary npub-like string for testing
		// In a real app, this would come from the user's Nostr keys
		return 'npub1temp' + Math.random().toString(36).substring(2, 12);
	}

	async function generateQRCode(text) {
		try {
			const dataUrl = await QRCode.toDataURL(text, {
				width: 200,
				margin: 2,
				color: {
					dark: '#000000',
					light: '#ffffff'
				}
			});
			return dataUrl;
		} catch (err) {
			console.error('QR code generation error:', err);
			return '';
		}
	}

	async function copyToClipboard(text, tooltipId = 'default') {
		try {
			await navigator.clipboard.writeText(text);
			// Show tooltip
			copiedTooltips[tooltipId] = true;
			copiedTooltips = { ...copiedTooltips }; // Trigger reactivity
			
			// Hide tooltip after 2 seconds
			setTimeout(() => {
				copiedTooltips[tooltipId] = false;
				copiedTooltips = { ...copiedTooltips };
			}, 2000);
			
		} catch (err) {
			console.error('Failed to copy to clipboard:', err);
		}
	}

	function shortenInvoice(invoice) {
		if (!invoice) return '';
		if (invoice.length <= 40) return invoice;
		return invoice.substring(0, 20) + '...' + invoice.substring(invoice.length - 20);
	}

	function getApiHeaders() {
		const headers = {
			'Content-Type': 'application/json'
		};
		
		// Add session headers if available - note the lowercase format
		if (sessionData.sessionId) {
			headers['session-id'] = sessionData.sessionId;
		}
		if (sessionData.npub) {
			headers['npub'] = sessionData.npub;
		}
		
		return headers;
	}

	async function loadAds(forceRefresh = true) {
		loading.set(true);
		error.set('');
		try {
			// Only add refresh=true if explicitly requested
			const refreshParam = forceRefresh ? '?refresh=true' : '';
			const response = await fetch(`${API_BASE}/ads/list${refreshParam}`, {
				headers: getApiHeaders()
			});
			if (!response.ok) throw new Error('Failed to fetch ads');
			const data = await response.json();
			ads.set(data.ads || []);
		} catch (err) {
			error.set('Failed to load LSP advertisements: ' + err.message);
		} finally {
			loading.set(false);
		}
	}

	async function selectAd(ad) {
		selectedAd.set(ad);
		// Set default values based on ad constraints and OrderSettings defaults
		orderRequest.update(order => ({
			...order,
			d: ad.d,
			lsp_balance_sat: Math.max(order.lsp_balance_sat, ad.min_channel_balance_sat || 100000),
			channel_expiry_blocks: ad.max_channel_expiry_blocks,
			required_channel_confirmations: 0,  // OrderSettings default
			funding_confirms_within_blocks: 6    // OrderSettings default
		}));
		step.set(2);
	}

	async function submitOrder() {
		if (!selectedAdInfo) return;
		
		loading.set(true);
		error.set('');
		
		try {
			const response = await fetch(`${API_BASE}/orders/create`, {
				method: 'POST',
				headers: getApiHeaders(),
				body: JSON.stringify(orderData)
			});
			
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.detail || 'Failed to create order');
			}
			
			const data = await response.json();
			orderResponse.set(data);
			
			// Generate QR code for the invoice if available
			let invoiceString = null;
			
			// Try multiple possible paths for the invoice
			if (data.payment && data.payment.bolt11 && data.payment.bolt11.invoice) {
				invoiceString = data.payment.bolt11.invoice;
			} else if (data.payment && data.payment.bolt11 && data.payment.bolt11.bolt11_invoice) {
				invoiceString = data.payment.bolt11.bolt11_invoice;
			} else if (data.payment && data.payment.bolt11_invoice) {
				invoiceString = data.payment.bolt11_invoice;
			} else if (data.bolt11_invoice) {
				invoiceString = data.bolt11_invoice;
			} else if (data.payment && data.payment.invoice) {
				invoiceString = data.payment.invoice;
			}
			
			if (invoiceString) {
				qrCodeDataUrl = await generateQRCode(invoiceString);
			} else {
				console.log('Full payment.bolt11 object:', data.payment?.bolt11);
			}
			
			step.set(3);
			
			// Auto-start channel monitoring after a short delay to allow user to see the invoice
			setTimeout(() => {
				startChannelMonitoring();
			}, 1000);
		} catch (err) {
			error.set('Failed to submit order: ' + err.message);
		} finally {
			loading.set(false);
		}
	}

	async function startChannelMonitoring() {
		if (isListeningForChannels) {
			return; // Already listening
		}
		
		if (!sessionData.initialized) {
			error.set('Session not initialized for channel monitoring');
			return;
		}
		
		isListeningForChannels = true;
		await listenForChannelUpdates();
	}

	async function listenForChannelUpdates() {
		
		try {
			const response = await fetch(`${API_BASE}/channels/listen-status`, {
				headers: getApiHeaders()
			});

			if (!response.ok) {
				console.error('Failed to start channel status stream:', response.status, response.statusText);
				isListeningForChannels = false;
				
				// Try fallback polling if stream fails
				startPollingForChannelStatus();
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let heartbeatCount = 0;
			let lastDataTime = Date.now();
			
			// Set up a timeout to detect if stream is stalled
			const staleCheckInterval = setInterval(() => {
				const timeSinceLastData = Date.now() - lastDataTime;
				if (timeSinceLastData > 30000) { // 30 seconds without data
					clearInterval(staleCheckInterval);
					reader.cancel();
					startPollingForChannelStatus();
					return;
				}
			}, 10000); // Check every 10 seconds
			
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					clearInterval(staleCheckInterval);
					isListeningForChannels = false;
					break;
				}
				
				// Decode the chunk and add to buffer
				lastDataTime = Date.now(); // Update last data time
				const chunk = decoder.decode(value, { stream: true });
				buffer += chunk;
				
				// Try to parse JSON objects from the buffer
				// Each JSON object should be on its own "line" but may be concatenated
				let jsonStart = 0;
				let braceCount = 0;
				let inString = false;
				let escaped = false;
				
				for (let i = 0; i < buffer.length; i++) {
					const char = buffer[i];
					
					if (escaped) {
						escaped = false;
						continue;
					}
					
					if (char === '\\') {
						escaped = true;
						continue;
					}
					
					if (char === '"') {
						inString = !inString;
						continue;
					}
					
					if (!inString) {
						if (char === '{') {
							braceCount++;
						} else if (char === '}') {
							braceCount--;
							
							// Found a complete JSON object
							if (braceCount === 0) {
								const jsonStr = buffer.substring(jsonStart, i + 1);
								
								try {
									const channelData = JSON.parse(jsonStr);
									console.log('Parsed channel data:', channelData);
									
									// Smart update: preserve important data from previous updates
									channelStatus.update(prevData => {
										// If we don't have previous data, use the new data as-is
										if (!prevData) {
											return channelData;
										}
										
										// Merge new data with previous data, preserving important fields
										const merged = {
											...prevData,
											...channelData
										};
										
										// Preserve specific fields if they exist in previous data but are missing in new data
										if (prevData.txid_hex && !channelData.txid_hex) {
											merged.txid_hex = prevData.txid_hex;
										}
										if (prevData.output_index !== undefined && channelData.output_index === undefined) {
											merged.output_index = prevData.output_index;
										}
										
										return merged;
									});
									
									// Check if we have a channel_state (not just heartbeat)
									if (channelData.channel_state) {
										console.log('Channel state update:', channelData.channel_state);
										
										// For the first channel update (PENDING), move to step 4
										if (channelData.channel_state === 'PENDING' && currentStep !== 4) {
											console.log('Channel PENDING received! Moving to step 4');
											console.log('Current step before update:', currentStep);
											
											// Use setTimeout to ensure the step update happens in the next tick
											setTimeout(() => {
												step.set(4);
												console.log('Step updated to 4');
											}, 100);
										}
										
										// If channel is OPEN, we can end the stream
										if (channelData.channel_state === 'OPEN') {
											console.log('Channel OPEN received! Ending stream');
											clearInterval(staleCheckInterval);
											isListeningForChannels = false;
											return; // Exit the stream only when OPEN
										}
									}
								} catch (parseError) {
									heartbeatCount++;
								}
								
								// Move to start of next JSON object
								jsonStart = i + 1;
							}
						}
					}
				}
				
				// Remove processed JSON objects from buffer
				buffer = buffer.substring(jsonStart);
			}
		} catch (err) {
			console.error('Channel status stream error:', err);
			error.set('Failed to listen for channel updates: ' + err.message);
			isListeningForChannels = false;
			
			// Try fallback polling if stream fails
			startPollingForChannelStatus();
		}
	}

	// Fallback polling mechanism
	let pollingInterval = null;
	
	async function startPollingForChannelStatus() {
		if (pollingInterval) return; // Already polling
		
		pollingInterval = setInterval(async () => {
			try {
				const response = await fetch(`${API_BASE}/channels/status`, {
					headers: getApiHeaders()
				});
				
				if (response.ok) {
					const channelData = await response.json();
					console.log('Polled channel status:', channelData);
					
					// Smart update: preserve important data from previous updates (same as streaming)
					channelStatus.update(prevData => {
						// If we don't have previous data, use the new data as-is
						if (!prevData) {
							return channelData;
						}
						
						// Merge new data with previous data, preserving important fields
						const merged = {
							...prevData,
							...channelData
						};
						
						// Preserve specific fields if they exist in previous data but are missing in new data
						if (prevData.txid_hex && !channelData.txid_hex) {
							merged.txid_hex = prevData.txid_hex;
						}
						if (prevData.output_index !== undefined && channelData.output_index === undefined) {
							merged.output_index = prevData.output_index;
						}
						
						return merged;
					});
					
					if (channelData.channel_state === 'OPEN') {
						console.log('Channel opened via polling! Moving to step 4');
						step.set(4);
						clearInterval(pollingInterval);
						pollingInterval = null;
						isListeningForChannels = false;
					}
				}
			} catch (err) {
				console.error('Polling error:', err);
			}
		}, 5000); // Poll every 5 seconds
	}

	function formatBigNum(amount) {
		return new Intl.NumberFormat().format(amount);
	}

	function formatCapacity(amount) {
		const millions = amount / 1000000;
		if (millions >= 1) {
			return `${millions.toFixed(2)} M`;
		} else {
			// For values less than 1M, still show in M but with more decimals if needed
			return `${millions.toFixed(3)} M`;
		}
	}

	function getResponsiveText(text, screenSize = 'large') {
		if (!text) return 'N/A';
		
		// Define character limits based on screen size
		const limits = {
			small: 12,   // Mobile screens - show first 6 + last 6 characters
			medium: 20,  // Tablet screens - show first 10 + last 10 characters  
			large: 9999  // Desktop screens - show full text
		};
		
		const limit = limits[screenSize] || limits.large;
		
		if (text.length <= limit) {
			return text;
		}
		
		// For small/medium screens, show first and last parts
		const halfLimit = Math.floor(limit / 2);
		return `${text.slice(0, halfLimit)}...${text.slice(-halfLimit)}`;
	}

	function getTotalCapacity() {
		return orderData.lsp_balance_sat + orderData.client_balance_sat;
	}

	function resetWorkflow() {
		selectedAd.set(null);
		orderRequest.set({
			lsp_balance_sat: 100000,
			client_balance_sat: 0,
			channel_expiry_blocks: 13000,
			target_pubkey_uri: '',
			required_channel_confirmations: 0,
			funding_confirms_within_blocks: 6,
			announce_channel: true
		});
		orderResponse.set(null);
		channelStatus.set(null);
		error.set('');
		step.set(1);
		qrCodeDataUrl = '';
		isListeningForChannels = false;
		
		// Clear any polling
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = null;
		}
		
		// Reset validation
		pubkeyValidation = {
			isValid: false,
			message: ''
		};
	}

	function validatePubkeyUri(uri) {
		if (!uri) {
			pubkeyValidation = {
				isValid: false,
				message: ''
			};
			return false;
		}

		// Check if it contains '@' separator
		if (!uri.includes('@')) {
			pubkeyValidation = {
				isValid: false,
				message: 'Format should be: pubkey@host:port'
			};
			return false;
		}

		const parts = uri.split('@');
		if (parts.length !== 2) {
			pubkeyValidation = {
				isValid: false,
				message: 'Format should be: pubkey@host:port'
			};
			return false;
		}

		const [pubkey, hostPort] = parts;

		// Validate pubkey: should be 66 hex characters (33 bytes * 2)
		if (pubkey.length !== 66) {
			pubkeyValidation = {
				isValid: false,
				message: 'Public key must be exactly 66 characters long'
			};
			return false;
		}

		if (!/^[0-9a-fA-F]+$/.test(pubkey)) {
			pubkeyValidation = {
				isValid: false,
				message: 'Public key must contain only hexadecimal characters'
			};
			return false;
		}

		// Check if hostPort contains ':' separator
		if (!hostPort.includes(':')) {
			pubkeyValidation = {
				isValid: false,
				message: 'Host and port should be separated by ":"'
			};
			return false;
		}

		const hostParts = hostPort.split(':');
		if (hostParts.length !== 2) {
			pubkeyValidation = {
				isValid: false,
				message: 'Format should be: pubkey@host:port'
			};
			return false;
		}

		const [host, port] = hostParts;

		// Validate host (IPv4, IPv6, or onion/hostname)
		const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
		const ipv6Regex = /^\[?([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\]?$|^\[?::1\]?$|^\[?([0-9a-fA-F]{1,4}:){1,6}::[0-9a-fA-F]{0,4}\]?$|^\[?([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}\]?$|^\[?([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}\]?$|^\[?([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}\]?$|^\[?([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}\]?$/;
		const onionRegex = /^[a-z2-7]{16}\.onion$|^[a-z2-7]{56}\.onion$/;
		const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

		// Remove brackets from IPv6 if present
		const cleanHost = host.replace(/^\[|\]$/g, '');
		
		let hostValid = false;
		if (ipv4Regex.test(cleanHost)) {
			hostValid = true;
		} else if (ipv6Regex.test(host)) {  // Use original host for IPv6 (may have brackets)
			hostValid = true;
		} else if (onionRegex.test(cleanHost)) {
			hostValid = true;
		} else if (hostnameRegex.test(cleanHost)) {
			hostValid = true;
		}

		if (!hostValid) {
			pubkeyValidation = {
				isValid: false,
				message: 'Invalid host format. Use IPv4, IPv6, onion address, or hostname'
			};
			return false;
		}

		// Validate port: should be a number between 1 and 65535
		const portNum = parseInt(port, 10);
		if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
			pubkeyValidation = {
				isValid: false,
				message: 'Port must be a number between 1 and 65535'
			};
			return false;
		}

		// If we get here, validation passed
		pubkeyValidation = {
			isValid: true,
			message: ''
		};
		return true;
	}

	// Reactive validation when target_pubkey_uri changes
	$: if (orderData.target_pubkey_uri !== undefined) {
		validatePubkeyUri(orderData.target_pubkey_uri);
	}

	function clearSession() {
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem('liquiditystr-session');
		}
		sessionInfo.set({
			sessionId: null,
			npub: null,
			initialized: false
		});
		// Reset all state
		resetWorkflow();
		// Reinitialize
		initializeSession();
	}

	function toggleFAQ(index) {
		expandedFAQ[index] = !expandedFAQ[index];
		expandedFAQ = { ...expandedFAQ }; // Trigger reactivity
	}

	function toggleAdPopover(adId, field) {
		const key = `${adId}-${field}`;
		showAdPopovers[key] = !showAdPopovers[key];
		showAdPopovers = { ...showAdPopovers }; // Trigger reactivity
	}
</script>

<svelte:head>
	<title>liquiditystr: a gateway to the Nostr P2P Lightning liquidity marketplace</title>
</svelte:head>

<style>
	/* Custom slider styles */
	.slider::-webkit-slider-thumb {
		appearance: none;
		height: 20px;
		width: 20px;
		background: hsl(var(--primary));
		border-radius: 50%;
		cursor: pointer;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
	}

	.slider::-webkit-slider-thumb:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.slider::-moz-range-thumb {
		height: 20px;
		width: 20px;
		background: hsl(var(--primary));
		border-radius: 50%;
		cursor: pointer;
		border: none;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
	}

	.slider::-moz-range-thumb:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.slider::-webkit-slider-track {
		height: 8px;
		background: hsl(var(--muted));
		border-radius: 4px;
	}

	.slider::-moz-range-track {
		height: 8px;
		background: hsl(var(--muted));
		border-radius: 4px;
		border: none;
	}
</style>

<div class="w-full max-w-4xl mx-auto">
	<h1 class="text-center text-3xl font-bold mb-2">A gateway to the Nostr P2P Lightning liquidity marketplace</h1>
	<p class="text-center text-muted-foreground mb-8">
		Easily find and request Lightning liquidity from LSPs fully coordinated over Nostr
	</p>

	<!-- Session Status -->
	{#if sessionData.initialized}
		<div class="bg-green-500/10 border border-green-500/20 rounded-md p-3 mb-6 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<CheckCircle class="h-4 w-4 text-green-500 flex-shrink-0" />
				<div class="flex items-center gap-4 text-green-700 dark:text-green-300 text-sm">
					<span>Connected to relays</span>
					<div class="flex items-center gap-1 relative">
						<span class="text-xs">{sessionData.npub.slice(0, 10)}...</span>
						<button 
							on:click={() => copyToClipboard(sessionData.npub, 'npub')}
							class="p-0.5 hover:bg-green-500/20 rounded transition-colors relative"
							title="Copy npub to clipboard">
							<Copy class="h-3 w-3" />
							{#if copiedTooltips.npub}
								<div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-in fade-in duration-200">
									Copied npub!
								</div>
							{/if}
						</button>
					</div>
				</div>
			</div>
			<button 
				on:click={clearSession}
				class="text-xs px-2 py-1 border border-green-500/30 rounded hover:bg-green-500/10 text-green-700 dark:text-green-300">
				New Keys
			</button>
		</div>
	{:else}
		<div class="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 mb-6 flex items-center gap-2">
			<RefreshCw class="h-4 w-4 text-yellow-500 animate-spin" />
			<p class="text-yellow-700 dark:text-yellow-300 text-sm">
				Initializing session...
			</p>
		</div>
	{/if}

	{#if errorMessage}
		<div class="bg-destructive/10 border border-destructive/20 rounded-md p-4 mb-6 flex items-center gap-2">
			<AlertCircle class="h-4 w-4 text-destructive" />
			<p class="text-destructive text-sm">{errorMessage}</p>
		</div>
	{/if}

	<!-- Step Progress Indicator -->
	<div class="flex items-center justify-center mb-8">
		<div class="flex items-center space-x-4">
			{#each [1, 2, 3, 4] as stepNum}
				<div class="flex items-center">
					<div class="flex items-center justify-center w-8 h-8 rounded-full border-2 
						{currentStep >= stepNum ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground text-muted-foreground'}">
						{stepNum}
					</div>
					{#if stepNum < 4}
						<div class="w-12 h-0.5 {currentStep > stepNum ? 'bg-primary' : 'bg-muted-foreground/30'}"></div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Step 1: Browse and Select LSP Ads -->
	{#if currentStep === 1}
		<div class="bg-secondary/50 rounded-xl border p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-xl font-semibold">Select an LSP</h2>
				<button 
					on:click={loadAds}
					disabled={isLoading}
					class="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-md hover:bg-accent transition-colors disabled:opacity-50">
					<RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
					Refresh
				</button>
			</div>

			{#if isLoading}
				<div class="flex items-center justify-center py-12">
					<RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
					<span class="ml-2 text-muted-foreground">Loading LSP advertisements...</span>
				</div>
			{:else if adsList.length === 0}
				<div class="text-center py-12">
					<p class="text-muted-foreground">No LSP advertisements found.</p>
				</div>
			{:else}
				<div class="grid gap-4">
					{#each adsList as ad}
						<div class="border rounded-lg p-4 hover:bg-accent/50 transition-colors">
							<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-3">
										<h3 class="font-medium">{ad.lsp_alias || 'Unknown LSP'}</h3>
										<button 
											on:click={() => copyToClipboard(ad.lsp_pubkey, `lsp_pubkey_${ad.d}`)}
											class="p-0.5 hover:bg-gray-500/20 rounded transition-colors relative"
											title="Copy LSP pubkey to clipboard">
											<Copy class="h-3 w-3" />
											{#if copiedTooltips[`lsp_pubkey_${ad.d}`]}
												<div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-in fade-in duration-200">
													Copied LSP pubkey!
												</div>
											{/if}
										</button>
										{#if ad.value_prop}
											<span class="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs">
												{ad.value_prop}
											</span>
										{/if}
									</div>
									
									<!-- Responsive grid layout -->
									<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
										<!-- Channel Capacity -->
										<div class="text-center">
											<div class="font-medium text-sm">
												{formatCapacity(ad.min_channel_balance_sat)} - {formatCapacity(ad.max_channel_balance_sat)}
											</div>
											<div class="flex items-center justify-center gap-1">
												<span class="text-xs text-muted-foreground">Capacity</span>
												<div class="relative">
													<button
														type="button"
														on:click={() => toggleAdPopover(ad.d, 'capacity')}
														class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
														title="Channel capacity info"
													>
														<HelpCircle class="h-3 w-3 text-muted-foreground" />
													</button>
													{#if showAdPopovers[`${ad.d}-capacity`]}
														<!-- svelte-ignore a11y-click-events-have-key-events -->
														<!-- svelte-ignore a11y-no-static-element-interactions -->
														<div 
															class="fixed inset-0 z-40" 
															on:click={() => toggleAdPopover(ad.d, 'capacity')}
														></div>
														<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
															<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Channel Capacity Range</p>
															<p>The minimum and maximum channel size (in sats) that this LSP will open for you. The sum of the inbound and outbound sats must fit within this range.</p>
														</div>
													{/if}
												</div>
											</div>
										</div>

										<!-- Fixed Cost -->
										<div class="text-center">
											<div class="font-medium text-sm">
												{formatBigNum(ad.fixed_cost_sats)} sat
											</div>
											<div class="flex items-center justify-center gap-1">
												<span class="text-xs text-muted-foreground">Fixed Cost</span>
												<div class="relative">
													<button
														type="button"
														on:click={() => toggleAdPopover(ad.d, 'fixed')}
														class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
														title="Fixed cost info"
													>
														<HelpCircle class="h-3 w-3 text-muted-foreground" />
													</button>
													{#if showAdPopovers[`${ad.d}-fixed`]}
														<!-- svelte-ignore a11y-click-events-have-key-events -->
														<!-- svelte-ignore a11y-no-static-element-interactions -->
														<div 
															class="fixed inset-0 z-40" 
															on:click={() => toggleAdPopover(ad.d, 'fixed')}
														></div>
														<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
															<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Fixed Opening Cost</p>
															<p>A flat fee charged by the LSP for opening the channel, regardless of channel size.</p>
														</div>
													{/if}
												</div>
											</div>
										</div>

										<!-- Variable Cost -->
										<div class="text-center">
											<div class="font-medium text-sm">
												{formatBigNum(ad.variable_cost_ppm)} ppm
											</div>
											<div class="flex items-center justify-center gap-1">
												<span class="text-xs text-muted-foreground">Variable Cost</span>
												<div class="relative">
													<button
														type="button"
														on:click={() => toggleAdPopover(ad.d, 'variable')}
														class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
														title="Variable cost info"
													>
														<HelpCircle class="h-3 w-3 text-muted-foreground" />
													</button>
													{#if showAdPopovers[`${ad.d}-variable`]}
														<!-- svelte-ignore a11y-click-events-have-key-events -->
														<!-- svelte-ignore a11y-no-static-element-interactions -->
														<div 
															class="fixed inset-0 z-40" 
															on:click={() => toggleAdPopover(ad.d, 'variable')}
														></div>
														<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
															<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Variable Opening Cost</p>
															<p>A proportional fee (parts per million) based on the channel capacity. Larger channels cost more.</p>
														</div>
													{/if}
												</div>
											</div>
										</div>

										<!-- Max Base Fee -->
										{#if ad.max_promised_base_fee !== undefined}
											<div class="text-center">
												<div class="font-medium text-sm">
													{formatBigNum(ad.max_promised_base_fee)} sat
												</div>
												<div class="flex items-center justify-center gap-1">
													<span class="text-xs text-muted-foreground">Max Base Fee</span>
													<div class="relative">
														<button
															type="button"
															on:click={() => toggleAdPopover(ad.d, 'basefee')}
															class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
															title="Max base fee info"
														>
															<HelpCircle class="h-3 w-3 text-muted-foreground" />
														</button>
														{#if showAdPopovers[`${ad.d}-basefee`]}
															<!-- svelte-ignore a11y-click-events-have-key-events -->
															<!-- svelte-ignore a11y-no-static-element-interactions -->
															<div 
																class="fixed inset-0 z-40" 
																on:click={() => toggleAdPopover(ad.d, 'basefee')}
															></div>
															<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
																<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Maximum Promised Base Fee</p>
																<p>The maximum base fee the LSP promises to charge for routing payments through this channel.</p>
															</div>
														{/if}
													</div>
												</div>
											</div>
										{/if}

										<!-- Max Fee Rate -->
										{#if ad.max_promised_fee_rate !== undefined}
											<div class="text-center">
												<div class="font-medium text-sm">
													{formatBigNum(ad.max_promised_fee_rate)} ppm
												</div>
												<div class="flex items-center justify-center gap-1">
													<span class="text-xs text-muted-foreground">Max Fee Rate</span>
													<div class="relative">
														<button
															type="button"
															on:click={() => toggleAdPopover(ad.d, 'feerate')}
															class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
															title="Max fee rate info"
														>
															<HelpCircle class="h-3 w-3 text-muted-foreground" />
														</button>
														{#if showAdPopovers[`${ad.d}-feerate`]}
															<!-- svelte-ignore a11y-click-events-have-key-events -->
															<!-- svelte-ignore a11y-no-static-element-interactions -->
															<div 
																class="fixed inset-0 z-40" 
																on:click={() => toggleAdPopover(ad.d, 'feerate')}
															></div>
															<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
																<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Maximum Promised Fee Rate</p>
																<p>The maximum proportional fee rate (parts per million) the LSP promises to charge for routing payments through this channel.</p>
															</div>
														{/if}
													</div>
												</div>
											</div>
										{/if}
									</div>
								</div>
								
								<!-- Select Button - positioned at bottom for mobile, side for desktop -->
								<div class="flex justify-center lg:justify-end">
									<button 
										on:click={() => selectAd(ad)}
										class="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
										Select
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Step 2: Configure Channel Parameters -->
	{#if currentStep === 2 && selectedAdInfo}
		<div class="bg-secondary/50 rounded-xl border p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-xl font-semibold">Configure channel</h2>
				<button 
					on:click={resetWorkflow}
					class="px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
					Back to LSPs
				</button>
			</div>

			<div class="bg-background border rounded-lg p-4 mb-6">
				<h3 class="font-medium mb-3">Selected LSP: {selectedAdInfo.lsp_alias || 'Unknown'}</h3>
				
				<!-- Responsive grid layout matching the ad display -->
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
					<!-- Channel Capacity -->
					<div class="text-center">
						<div class="font-medium text-sm">
							{formatCapacity(selectedAdInfo.min_channel_balance_sat)} - {formatCapacity(selectedAdInfo.max_channel_balance_sat)}
						</div>
						<div class="flex items-center justify-center gap-1">
							<span class="text-xs text-muted-foreground">Capacity</span>
							<div class="relative">
								<button
									type="button"
									on:click={() => toggleAdPopover('selected', 'capacity')}
									class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
									title="Channel capacity info"
								>
									<HelpCircle class="h-3 w-3 text-muted-foreground" />
								</button>
								{#if showAdPopovers['selected-capacity']}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<div 
										class="fixed inset-0 z-40" 
										on:click={() => toggleAdPopover('selected', 'capacity')}
									></div>
									<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
										<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Channel Capacity Range</p>
                    <p>The minimum and maximum channel size (in sats) that this LSP will open for you. The sum of the inbound and outbound sats must fit within this range.</p>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Fixed Cost -->
					<div class="text-center">
						<div class="font-medium text-sm">
							{formatBigNum(selectedAdInfo.fixed_cost_sats)} sat
						</div>
						<div class="flex items-center justify-center gap-1">
							<span class="text-xs text-muted-foreground">Fixed Cost</span>
							<div class="relative">
								<button
									type="button"
									on:click={() => toggleAdPopover('selected', 'fixed')}
									class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
									title="Fixed cost info"
								>
									<HelpCircle class="h-3 w-3 text-muted-foreground" />
								</button>
								{#if showAdPopovers['selected-fixed']}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<div 
										class="fixed inset-0 z-40" 
										on:click={() => toggleAdPopover('selected', 'fixed')}
									></div>
									<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
										<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Fixed Opening Cost</p>
										<p>A flat fee charged by the LSP for opening the channel, regardless of channel size.</p>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Variable Cost -->
					<div class="text-center">
						<div class="font-medium text-sm">
							{formatBigNum(selectedAdInfo.variable_cost_ppm)} ppm
						</div>
						<div class="flex items-center justify-center gap-1">
							<span class="text-xs text-muted-foreground">Variable Cost</span>
							<div class="relative">
								<button
									type="button"
									on:click={() => toggleAdPopover('selected', 'variable')}
									class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
									title="Variable cost info"
								>
									<HelpCircle class="h-3 w-3 text-muted-foreground" />
								</button>
								{#if showAdPopovers['selected-variable']}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<div 
										class="fixed inset-0 z-40" 
										on:click={() => toggleAdPopover('selected', 'variable')}
									></div>
									<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
										<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Variable Opening Cost</p>
										<p>A proportional fee (parts per million) based on the channel capacity. Larger channels cost more.</p>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Max Base Fee -->
					{#if selectedAdInfo.max_promised_base_fee !== undefined}
						<div class="text-center">
							<div class="font-medium text-sm">
								{formatBigNum(selectedAdInfo.max_promised_base_fee)} sat
							</div>
							<div class="flex items-center justify-center gap-1">
								<span class="text-xs text-muted-foreground">Max Base Fee</span>
								<div class="relative">
									<button
										type="button"
										on:click={() => toggleAdPopover('selected', 'basefee')}
										class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
										title="Max base fee info"
									>
										<HelpCircle class="h-3 w-3 text-muted-foreground" />
									</button>
									{#if showAdPopovers['selected-basefee']}
										<!-- svelte-ignore a11y-click-events-have-key-events -->
										<!-- svelte-ignore a11y-no-static-element-interactions -->
										<div 
											class="fixed inset-0 z-40" 
											on:click={() => toggleAdPopover('selected', 'basefee')}
										></div>
										<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
											<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Maximum Promised Base Fee</p>
											<p>The maximum base fee the LSP promises to charge for routing payments through this channel.</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}

					<!-- Max Fee Rate -->
					{#if selectedAdInfo.max_promised_fee_rate !== undefined}
						<div class="text-center">
							<div class="font-medium text-sm">
								{formatBigNum(selectedAdInfo.max_promised_fee_rate)} ppm
							</div>
							<div class="flex items-center justify-center gap-1">
								<span class="text-xs text-muted-foreground">Max Fee Rate</span>
								<div class="relative">
									<button
										type="button"
										on:click={() => toggleAdPopover('selected', 'feerate')}
										class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
										title="Max fee rate info"
									>
										<HelpCircle class="h-3 w-3 text-muted-foreground" />
									</button>
									{#if showAdPopovers['selected-feerate']}
										<!-- svelte-ignore a11y-click-events-have-key-events -->
										<!-- svelte-ignore a11y-no-static-element-interactions -->
										<div 
											class="fixed inset-0 z-40" 
											on:click={() => toggleAdPopover('selected', 'feerate')}
										></div>
										<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
											<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Maximum Promised Fee Rate</p>
											<p>The maximum proportional fee rate (parts per million) the LSP promises to charge for routing payments through this channel.</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<form on:submit|preventDefault={submitOrder} class="space-y-6">
				<div class="grid md:grid-cols-2 gap-6">
					<div>
						<label for="lsp_balance" class="block text-sm font-medium mb-2">
							{formatBigNum(orderData.lsp_balance_sat)} sats inbound
						</label>
						<div class="space-y-2">
							<input 
								id="lsp_balance"
								type="range" 
								bind:value={orderData.lsp_balance_sat}
								min={selectedAdInfo.min_initial_lsp_balance_sat || 0}
								max={selectedAdInfo.max_initial_lsp_balance_sat || selectedAdInfo.max_channel_balance_sat}
								step="50000"
								class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider" />
							<div class="flex justify-between text-xs text-muted-foreground">
								<span>{formatBigNum(selectedAdInfo.min_initial_lsp_balance_sat || 0)}</span>
								<span>{formatBigNum(selectedAdInfo.max_initial_lsp_balance_sat || selectedAdInfo.max_channel_balance_sat)}</span>
							</div>
						</div>
					</div>

					<div>
						<label for="client_balance" class="block text-sm font-medium mb-2 flex items-center gap-1">
							{formatBigNum(orderData.client_balance_sat)} sats outbound
							<div class="relative">
								<button
									type="button"
									on:click={() => showOutboundPopover = !showOutboundPopover}
									class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
									title="What is outbound liquidity?"
								>
									<HelpCircle class="h-3 w-3 text-muted-foreground" />
								</button>
								{#if showOutboundPopover}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<div 
										class="fixed inset-0 z-40" 
										on:click={() => showOutboundPopover = false}
									></div>
									<div class="absolute left-0 top-6 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs text-gray-600 dark:text-gray-300">
										<p class="font-medium text-gray-900 dark:text-gray-100 mb-1">Outbound Liquidity</p>
										<p>This is the amount you can send through the channel after it opens so you can start spending immediately. This starting amount gets added to the order invoice, since LSPs don't normally give sats away for free, you know!</p>
									</div>
								{/if}
							</div>
						</label>
						<div class="space-y-2">
							<input 
								id="client_balance"
								type="range" 
								bind:value={orderData.client_balance_sat}
								min={selectedAdInfo.min_initial_client_balance_sat || 0}
								max={selectedAdInfo.max_initial_client_balance_sat || selectedAdInfo.max_channel_balance_sat}
								step="1000"
								class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider" />
							<div class="flex justify-between text-xs text-muted-foreground">
								<span>{formatBigNum(selectedAdInfo.min_initial_client_balance_sat || 0)}</span>
								<span>{formatBigNum(selectedAdInfo.max_initial_client_balance_sat || selectedAdInfo.max_channel_balance_sat)}</span>
							</div>
						</div>
					</div>
				</div>

				<div class="flex items-center space-x-3">
					<button 
						type="button"
						id="announce_channel"
						on:click={() => orderData.announce_channel = !orderData.announce_channel}
						class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 bg-gray-200 dark:bg-gray-700 }"
						role="switch"
						aria-checked={orderData.announce_channel}>
						<span 
							class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {orderData.announce_channel ? 'translate-x-6' : 'translate-x-1'}">
						</span>
					</button>
					<label for="announce_channel" class="text-sm font-medium">
						{orderData.announce_channel ? 'Make channel public' : 'Make channel private'}
					</label>
				</div>

				<div>
					<label for="target_pubkey_uri" class="block text-sm font-medium mb-2">
						Your Node URI <span class="text-destructive">*</span>
					</label>
					<input 
						id="target_pubkey_uri"
						type="text" 
						bind:value={orderData.target_pubkey_uri}
						placeholder="pubkey@host:port"
						required
						class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary
							{orderData.target_pubkey_uri && !pubkeyValidation.isValid ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : ''}
							{pubkeyValidation.isValid ? 'border-green-500 focus:border-green-500 focus:ring-green-500/20' : ''}" />
					
					{#if orderData.target_pubkey_uri && pubkeyValidation.message}
						<div class="mt-2 text-sm {pubkeyValidation.isValid ? 'text-green-600' : 'text-destructive'}">
							{pubkeyValidation.message}
						</div>
					{/if}
					
				</div>

				<div class="bg-background border rounded-lg p-4">
					<h4 class="font-medium mb-2">Channel Summary</h4>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span class="text-muted-foreground">Total Capacity:</span>
							<span class="font-medium">{formatBigNum(orderData.lsp_balance_sat + orderData.client_balance_sat)} sats</span>
						</div>
						<div>
							<span class="text-muted-foreground">Expected Cost:</span>
							<span class="font-medium">
								{formatBigNum(orderData.client_balance_sat + selectedAdInfo.fixed_cost_sats + Math.round(selectedAdInfo.variable_cost_ppm * (orderData.lsp_balance_sat) / 1000000))} sats
							</span>
						</div>
					</div>
				</div>

				<button 
					type="submit"
					disabled={isLoading || !orderData.target_pubkey_uri || !pubkeyValidation.isValid}
					class="w-full py-3 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
					{#if isLoading}
						<RefreshCw class="h-4 w-4 animate-spin" />
					{:else}
						<Send class="h-4 w-4" />
					{/if}
					Submit Order Request
				</button>
			</form>
		</div>
	{/if}

	<!-- Step 3: Order Receipt and Payment -->
	{#if currentStep === 3 && orderResult}
		<div class="bg-secondary/50 rounded-xl border p-6">
			<div class="flex items-center gap-3 mb-6">
				<CheckCircle class="h-6 w-6 text-green-500" />
				<h2 class="text-xl font-semibold">Order payment</h2>
			</div>

			<!-- Order Summary -->
			<div class="bg-background border rounded-lg p-4 mb-6">
				<h3 class="font-medium mb-3">Order Details</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
					<div>
						<span class="text-muted-foreground">Order ID</span>
						<code class="ml-2 px-2 py-0.5 rounded text-xs">
							<span class="sm:hidden">{getResponsiveText(orderResult.order_id || 'N/A', 'small')}</span>
							<span class="hidden sm:inline md:hidden">{getResponsiveText(orderResult.order_id || 'N/A', 'medium')}</span>
							<span class="hidden md:inline">{getResponsiveText(orderResult.order_id || 'N/A', 'large')}</span>
              <button 
                on:click={() => copyToClipboard(orderResult.order_id, 'order_id')}
                class="p-0.5 hover:bg-green-500/20 rounded transition-colors relative"
                title="Copy order ID to clipboard">
                <Copy class="h-3 w-3" />
                {#if copiedTooltips.order_id}
                  <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-in fade-in duration-200">
                    Copied order ID!
                  </div>
                {/if}
              </button>
						</code>
					</div>
					<div>
						<span class="text-muted-foreground">Status</span>
						<span class="ml-2 font-medium">{orderResult.order_state || 'N/A'}</span>
					</div>
					<div>
						<span class="text-muted-foreground">Inbound Liquidity</span>
						<span class="ml-2 font-medium">{formatBigNum(orderResult.lsp_balance_sat || 0)} sats</span>
					</div>
					<div>
						<span class="text-muted-foreground">Outbound Liquidity</span>
						<span class="ml-2 font-medium">{formatBigNum(orderResult.client_balance_sat || 0)} sats</span>
					</div>
					<div>
						<span class="text-muted-foreground">Public Channel:</span>
						<span class="ml-2 font-medium">{orderResult.announce_channel ? 'Yes' : 'No'}</span>
					</div>
				</div>
			</div>

			<!-- Payment Required -->
			{#if orderResult}
				{@const invoice = orderResult.payment?.bolt11?.invoice || orderResult.payment?.bolt11?.bolt11_invoice || orderResult.payment?.bolt11_invoice || orderResult.bolt11_invoice || orderResult.payment?.invoice}
				{@const amount = orderResult.payment?.bolt11?.order_total_sat || orderResult.payment?.bolt11?.amount_sat || orderResult.payment?.amount_sat || orderResult.payment?.amount}
				
				<div class="bg-background border rounded-lg p-6 mb-6">
					<div class="text-center mb-4">
						<p class="text-muted-foreground text-sm">
							{#if invoice}
								Scan the QR code or copy the invoice to pay with your Lightning wallet
							{:else}
								Processing payment request...
							{/if}
						</p>
					</div>

					{#if invoice}
						<div class="flex flex-col md:flex-row items-center gap-6">
							<!-- QR Code -->
							<div class="flex-shrink-0">
								{#if qrCodeDataUrl}
									<div class="bg-white p-2 rounded-lg">
										<img src={qrCodeDataUrl} alt="Lightning Invoice QR Code" class="w-48 h-48" />
									</div>
								{:else}
									<div class="bg-muted w-48 h-48 rounded-lg flex items-center justify-center">
										<QrCode class="h-12 w-12 text-muted-foreground" />
									</div>
								{/if}
							</div>

							<!-- Invoice Details -->
							<div class="flex-1 min-w-0">
								<div class="mb-4">
									<label class="block text-sm font-medium mb-2">Lightning Invoice</label>
									<div class="flex items-center gap-2">
										<code class="flex-1 bg-muted p-3 rounded text-xs break-all">
											{shortenInvoice(invoice)}
										</code>
										<button 
											on:click={() => copyToClipboard(invoice, 'invoice')}
											class="flex-shrink-0 p-2 border rounded hover:bg-accent relative"
											title="Copy invoice to clipboard">
											<Copy class="h-4 w-4" />
											{#if copiedTooltips.invoice}
												<div class="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-in fade-in duration-200">
													Copied!
												</div>
											{/if}
										</button>
									</div>
									<p class="text-xs text-muted-foreground mt-2">
										This is a HODL invoice - payment will be held until the channel opens
									</p>
								</div>

								{#if amount}
									<div class="text-center bg-muted/50 rounded p-3">
										<div class="text-sm text-muted-foreground">Amount</div>
										<div class="text-xl font-bold">{formatBigNum(amount)} sats</div>
									</div>
								{/if}
							</div>
						</div>

						<!-- monitoring text -->
						<div class="text-center mt-6">
							<p class="text-xs text-muted-foreground mt-2">
								{#if isListeningForChannels}
									<span class="flex items-center justify-center gap-2">
										<RefreshCw class="h-4 w-4 animate-spin" />
										Listening for payment confirmation from the LSP
									</span>
								{/if}
							</p>
						</div>
					{:else}
						<!-- Debug: Show what we actually received -->
						<div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-4">
							<h4 class="text-sm font-medium mb-2">Debug: Order Response Structure</h4>
							<pre class="text-xs whitespace-pre-wrap break-all">{JSON.stringify(orderResult, null, 2)}</pre>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Step 4: Channel Update Received -->
	{#if currentStep === 4}
		<div class="bg-secondary/50 rounded-xl border p-6">
			<div class="flex items-center gap-3 mb-6">
				<CheckCircle class="h-6 w-6 text-green-500" />
				<h2 class="text-xl font-semibold">
					{#if channelResult && channelResult.channel_state === 'OPEN'}
						Channel opened successfully!
					{:else}
						Payment received - channel processing!
					{/if}
				</h2>
			</div>

			{#if channelResult}
				<div class="bg-background border rounded-lg p-4 mb-6 text-left max-w-xl mx-auto">
					<h3 class="font-medium mb-2 text-center">Channel Details</h3>
					<div class="space-y-2 text-sm">
						<div>
							<span class="text-muted-foreground">Status</span>
							<span class="ml-2 font-medium {channelResult.channel_state === 'OPEN' ? 'text-green-600' : 'text-yellow-600'}">{channelResult.channel_state}</span>
						</div>
						{#if channelResult.txid_hex}
							<div>
								<span class="text-muted-foreground">Transaction ID</span>
								<code class="px-1 rounded text-xs ml-2">
									<span class="sm:hidden">{getResponsiveText(channelResult.txid_hex, 'small')}</span>
									<span class="hidden sm:inline md:hidden">{getResponsiveText(channelResult.txid_hex, 'medium')}</span>
									<span class="hidden md:inline">{getResponsiveText(channelResult.txid_hex, 'large')}</span>
								</code>
                <button 
                  on:click={() => copyToClipboard(channelResult.txid_hex, 'txid_hex')}
                  class="p-0.5 hover:bg-green-500/20 rounded transition-colors relative"
                  title="Copy txid to clipboard">
                  <Copy class="h-3 w-3" />
                  {#if copiedTooltips.txid_hex}
                    <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 animate-in fade-in duration-200">
                      Copied txid!
                    </div>
                  {/if}
                </button>
							</div>
						{/if}
						{#if channelResult.output_index !== undefined}
							<div>
								<span class="text-muted-foreground">Output Index</span>
								<span class="ml-2">{channelResult.output_index}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<p class="text-muted-foreground mb-6">
				{#if channelResult && channelResult.channel_state === 'OPEN'}
					Your Lightning channel is now active and ready to use!
				{:else}
					Your payment has been received! The LSP has submitted the opening transaction to the mempool.
				{/if}
			</p>
		</div>
	{/if}

	<!-- FAQ Section -->
	<div class="mt-16 mb-8">
		<div class="max-w-2xl mx-auto space-y-3">
			{#each [
				{
					question: "Nostr as the coordination layer for a P2P Lightning liquidity marketplace",
					answer: "🆓 Free to use (free, as in beer, and free as in freedom) for both customer and LSP, you're not locked in<br>🌐 Open to any customer and LSP<br>🔥 Transparent advertising: what you see is what you get, and is enforced on client-side (don't trust, verify)<br>💪 Uncensorable, no one can stop you from advertising or purchasing<br>⚡ Decentralized, no single API point of failure, and liquidity offers persist<br>🔒 Orders are privately made through NIP-17 DMs, so order flows are not broadcast and not centralized<br>🚀 Infinitely extensible in ways unimaginable right now, especially with the advent of AI agents participating in the open market<br>🔌 Existing LSPs on other platforms/protocols/APIs can easily plug into Nostr<br>"
				},
				{
					question: "How does it work?",
					answer: "LSPs advertise liquidity as addressable Kind 39735 events. Anyone interested in purchasing liquidity from an LSP can just pull and evaluate all those structured events, then NIP-17 DM an LSP of their choice to coordinate a liquidity purchase. Liquiditystr just performs the customer side of things in a streamlined UI. It connects to Nostr relays, pulls Kind 39735 events, displays the ads, and pipes NIP-17 DMs between your session and the LSP. Have a look at the <a class='text-white' target='_blank' href='https://github.com/smallworlnd/liquiditystr'>source code</a> to get a better idea!"
				},
				{
					question: "What information do I need to provide?",
					answer: "You only need to provide the LSP with the target Lightning node's public key URI (pubkey@host:port) that will receive the channel. You can customize the starting liquidity and channel size, and whether to make the channel publicly visible on the Lightning Network. Each liquiditystr session gets burner Nostr keys, and sessions last no more than two hours to ensure the entire order process completes. Nothing else is needed. No data is collected. No cookies. No accounts. No login."
				},
				{
					question: "How are the costs calculated?",
					answer: "LSPs can choose to apply a flat fee in sats to the order, and they can choose to apply a variable fee in parts per million (ppm) as a function of channel capacity. Adding an amount of outbound liquidity will be included in the cost of the purchase. What you see is what you get. Liquiditystr doesn't take a cut because it's just a gateway that connects to Nostr relays to fetch ads and transmit NIP-17 DMs."
				},
				{
					question: "How long does it take to open a channel?",
					answer: "Channel opening typically takes around 10 minutes by default, but can take up to several hours depending on the timing of the order and the volatility in the mempool. You'll see real-time updates on the channel status (pending/open) here but the LSP will will also provide the funding transaction ID, which can be viewed in an explorer of your choice."
				},
				{
					question: "How do I advertise liquidity?",
          answer: "You can run free and open-source software like <a class='text-white' target='_blank' href='https://github.com/smallworlnd/publsp'>publsp</a> to post your offer to Nostr, or you can write your own implementation the same event kind and structure to create the same order flow. Either way, your ad will automatically get picked up by liquiditystr."
				},
				{
					question: "What's the trust model?",
          answer: "The current iteration of the Nostr P2P liquidity marketplace is based off the <a class='text-white' target='_blank' href='https://github.com/lightning/blips/blob/master/blip-0051.md'>bLIP51</a> spec, so the same trust model applies; the client pays the LSP first (hodl invoice) then receives, so the risk is that you pay and don't receive. LSP reputation is on the line so bad behavior could generally be disincentivized."
				},
				{
					question: "Is there an API?",
          answer: "Have a look <a class='text-white' target='_blank' href='/api/docs'>here</a> or <a class='text-white' target='_blank' href='/api/redoc'>here</a>. The backend is implemented in <a class='text-white' target='_blank' href='https://github.com/smallworlnd/publsp'>publsp</a>."
				},
			] as faq, index}
				<div class="border border-border rounded-lg">
					<button
						on:click={() => toggleFAQ(index)}
						class="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-accent/50 transition-colors"
					>
						<span class="font-medium">{faq.question}</span>
						<ChevronDown class="h-4 w-4 transition-transform {expandedFAQ[index] ? 'rotate-180' : ''}" />
					</button>
					{#if expandedFAQ[index]}
						<div class="px-6 pb-4 text-muted-foreground text-sm leading-relaxed">
							{@html faq.answer}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Footer -->
	<footer class="mt-16 py-8 border-t border-border">
		<div class="flex flex-col items-center gap-4">
			<div class="flex items-center gap-4">
				<a 
					href="https://github.com/smallworlnd/publsp" 
					target="_blank" 
					rel="noopener noreferrer"
					class="flex items-center gap-2 px-4 py-2 bg-background border rounded-lg hover:bg-accent transition-colors">
					<Github class="h-4 w-4" />
					<span class="text-sm">publsp</span>
				</a>
				<a 
					href="https://github.com/smallworlnd/liquiditystr" 
					target="_blank" 
					rel="noopener noreferrer"
					class="flex items-center gap-2 px-4 py-2 bg-background border rounded-lg hover:bg-accent transition-colors">
					<Github class="h-4 w-4" />
					<span class="text-sm">liquiditystr</span>
				</a>
			</div>
		</div>
	</footer>
</div>
