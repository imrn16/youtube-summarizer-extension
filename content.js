// YouTube Video Summarizer Content Script

// Prevent YouTube from auto-scrolling to transcript panel
// This runs immediately at document_start to override all scroll methods before YouTube's code runs
(function () {
	try {
		// Helper function to check if element is in transcript panel
		const isTranscriptElement = function (element) {
			if (!element || typeof element.closest !== "function") return false;
			return (
				element.closest("ytd-engagement-panel-section-list-renderer") !== null ||
				element.closest("ytd-transcript-renderer") !== null ||
				element.closest("ytd-engagement-panel-renderer") !== null
			);
		};

		// Override scrollIntoView
		if (!Element.prototype.scrollIntoView._youtubeSummarizerOverridden) {
			const originalScrollIntoView = Element.prototype.scrollIntoView;
			Element.prototype.scrollIntoView = function (...args) {
				if (isTranscriptElement(this)) {
					return;
				}
				return originalScrollIntoView.apply(this, args);
			};
			Element.prototype.scrollIntoView._youtubeSummarizerOverridden = true;
		}

		// Override scrollIntoViewIfNeeded (non-standard but sometimes used)
		if (Element.prototype.scrollIntoViewIfNeeded && !Element.prototype.scrollIntoViewIfNeeded._youtubeSummarizerOverridden) {
			const originalScrollIntoViewIfNeeded = Element.prototype.scrollIntoViewIfNeeded;
			Element.prototype.scrollIntoViewIfNeeded = function (...args) {
				if (isTranscriptElement(this)) {
					return;
				}
				return originalScrollIntoViewIfNeeded.apply(this, args);
			};
			Element.prototype.scrollIntoViewIfNeeded._youtubeSummarizerOverridden = true;
		}

		// Override scroll, scrollTo, scrollBy on Element
		const scrollMethods = ["scroll", "scrollTo", "scrollBy"];
		scrollMethods.forEach((method) => {
			if (Element.prototype[method] && !Element.prototype[method]._youtubeSummarizerOverridden) {
				const original = Element.prototype[method];
				Element.prototype[method] = function (...args) {
					if (isTranscriptElement(this)) {
						return;
					}
					return original.apply(this, args);
				};
				Element.prototype[method]._youtubeSummarizerOverridden = true;
			}
		});

		// Override window scroll methods - block ALL window scrolling when transcript panel opens
		// This is more aggressive but prevents any page-level auto-scrolling
		let blockWindowScroll = false;

		// Monitor for transcript panel opening
		const checkForTranscriptPanel = function () {
			const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
			blockWindowScroll = transcriptPanel !== null;
		};

		// Check immediately if DOM is ready
		if (document.body) {
			checkForTranscriptPanel();
		}

		// Monitor for transcript panel changes
		if (typeof MutationObserver !== "undefined") {
			const observer = new MutationObserver(function () {
				checkForTranscriptPanel();
			});

			if (document.body) {
				observer.observe(document.body, { childList: true, subtree: true });
			} else {
				document.addEventListener("DOMContentLoaded", function () {
					checkForTranscriptPanel();
					observer.observe(document.body, { childList: true, subtree: true });
				});
			}
		}

		// Override window scroll methods
		if (window.scroll && !window.scroll._youtubeSummarizerOverridden) {
			const originalWindowScroll = window.scroll;
			window.scroll = function (...args) {
				if (blockWindowScroll) {
					return;
				}
				return originalWindowScroll.apply(this, args);
			};
			window.scroll._youtubeSummarizerOverridden = true;
		}

		if (window.scrollTo && !window.scrollTo._youtubeSummarizerOverridden) {
			const originalWindowScrollTo = window.scrollTo;
			window.scrollTo = function (...args) {
				if (blockWindowScroll) {
					return;
				}
				return originalWindowScrollTo.apply(this, args);
			};
			window.scrollTo._youtubeSummarizerOverridden = true;
		}

		if (window.scrollBy && !window.scrollBy._youtubeSummarizerOverridden) {
			const originalWindowScrollBy = window.scrollBy;
			window.scrollBy = function (...args) {
				if (blockWindowScroll) {
					return;
				}
				return originalWindowScrollBy.apply(this, args);
			};
			window.scrollBy._youtubeSummarizerOverridden = true;
		}

		// Prevent focusing elements in transcript panel (focus can trigger scrollIntoView)
		if (!HTMLElement.prototype.focus._youtubeSummarizerOverridden) {
			const originalFocus = HTMLElement.prototype.focus;
			HTMLElement.prototype.focus = function (...args) {
				if (isTranscriptElement(this)) {
					// Block focus on transcript elements
					return;
				}
				return originalFocus.apply(this, args);
			};
			HTMLElement.prototype.focus._youtubeSummarizerOverridden = true;
		}

		// Monitor for focus changes and immediately blur transcript panel elements
		let focusBlurTimeout = null;
		const blurTranscriptElements = function () {
			const activeElement = document.activeElement;
			if (activeElement && isTranscriptElement(activeElement)) {
				activeElement.blur();
				// Also blur any focused elements within transcript panel
				const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
				if (transcriptPanel) {
					const focusedInPanel = transcriptPanel.querySelector(":focus");
					if (focusedInPanel) {
						focusedInPanel.blur();
					}
				}
			}
		};

		// Monitor focus events
		document.addEventListener(
			"focusin",
			function (e) {
				if (isTranscriptElement(e.target)) {
					// Immediately blur if focus goes to transcript element
					clearTimeout(focusBlurTimeout);
					focusBlurTimeout = setTimeout(blurTranscriptElements, 0);
				}
			},
			true
		); // Use capture phase to catch before YouTube's handlers

		// Also monitor for programmatic focus changes
		const checkAndBlurTranscriptFocus = function () {
			blurTranscriptElements();
		};

		// Check periodically for focus on transcript elements
		setInterval(checkAndBlurTranscriptFocus, 100);

		// Override requestAnimationFrame to check focus before each frame
		if (!window.requestAnimationFrame._youtubeSummarizerOverridden) {
			const originalRAF = window.requestAnimationFrame;
			window.requestAnimationFrame = function (callback) {
				return originalRAF(function (...args) {
					blurTranscriptElements();
					return callback.apply(this, args);
				});
			};
			window.requestAnimationFrame._youtubeSummarizerOverridden = true;
		}
	} catch (error) {
		// Silently fail if override fails (e.g., in environments where Element doesn't exist yet)
		console.error("[YouTube Summarizer] Error preventing transcript auto-scroll:", error);
	}
})();

// Constants
const CONSTANTS = {
	// Subtitle extraction
	MAX_EXTRACTION_ATTEMPTS: 5,
	MAX_INITIALIZATION_ATTEMPTS: 3,
	SUBTITLE_EXTRACTION_TIMEOUT_MS: 30000, // 30 seconds

	// Retry delays (exponential backoff)
	INITIAL_RETRY_DELAY_MS: 1000,
	MAX_RETRY_DELAY_MS: 12000,
	RETRY_BACKOFF_MULTIPLIER: 2,

	// Subtitle extraction retry schedule (ms)
	EXTRACTION_RETRY_DELAYS: [1000, 3000, 5000, 8000, 12000],

	// UI delays
	JUMP_BUTTON_DELAY_MS: 2000,
	AUTO_SCROLL_DELAY_MS: 1500,
	INITIALIZATION_TIMEOUT_MS: 5000,
	YOUTUBE_LOAD_TIMEOUT_MS: 10000,

	// Chunking
	CHUNK_SIZE: 25000, // Characters per chunk for API requests
	INTER_CHUNK_DELAY_MS: 300, // Reduced delay between chunk requests (was 800ms)
	MAX_RETRIES_PER_CHUNK: 4,
	MAX_CHARS_FOR_SINGLE_REQUEST: 50000,
	MAX_CONCURRENT_CHUNKS: 3, // Process up to 3 chunks in parallel for better performance

	// UI thresholds
	SCROLL_THRESHOLD_PX: 400, // Distance from active caption before marking as scrolled
	JUMP_BUTTON_DISABLE_DISTANCE_PX: 800, // Distance threshold for disabling jump button

	// Validation
	MIN_SUBTITLES_FOR_SUMMARY: 5,
	MIN_SUBTITLES_FOR_RETRY: 10,

	// API
	DEFAULT_PROXY_BASE_URL: "https://youtube-summary-ashy.vercel.app",

	// Debug
	DEBUG_MODE: false, // Set to true to enable debug logging
};

class YouTubeSummarizer {
	constructor() {
		this.subtitles = [];
		this.subtitleTimings = [];
		this.summary = null;
		this.isProcessing = false;
		this.extractionAttempts = 0;
		this.maxExtractionAttempts = CONSTANTS.MAX_EXTRACTION_ATTEMPTS;
		this.currentTab = "captions"; // 'captions' or 'summary'
		this.videoElement = null;
		this.playbackObserver = null;
		this.currentActiveIndex = -1;
		this.lastActiveIndex = -1;
		this.userScrolled = false;
		this.scrollThreshold = CONSTANTS.SCROLL_THRESHOLD_PX;
		this.jumpButton = null;
		this.currentVideoId = null;
		this.jumpButtonDelay = CONSTANTS.JUMP_BUTTON_DELAY_MS;
		this.jumpButtonTimer = null;
		this.availableCaptionTracks = [];
		this.selectedCaptionTrack = null;
		this.themeObserver = null;
		this.autoScrollDelay = CONSTANTS.AUTO_SCROLL_DELAY_MS;
		this.autoScrollTimer = null;
		this.autoSummaryGenerated = false; // Flag to prevent multiple auto-generations
		this.querySubmitting = false; // Flag to prevent duplicate query submissions
		this.queryEventListeners = []; // Store event listeners for cleanup
		this.subtitlesExtractionStartTime = null; // Track when subtitle extraction started
		this.initializationAttempts = 0; // Track initialization attempts
		this.maxInitializationAttempts = CONSTANTS.MAX_INITIALIZATION_ATTEMPTS;
		this.initializationComplete = false; // Flag to track if initialization is complete
		this.initializing = false; // Guard flag to prevent race conditions
		this.generationProgress = null; // { current, total } progress while chunk-uploading
		this.mutationObservers = []; // Store MutationObserver instances for cleanup
		this.videoEventListeners = new Map(); // Store video event listeners for cleanup
		this.scrollHandler = null; // Store scroll event handler for cleanup
		this.subtitleRetryTimer = null; // Timer for retrying when subtitles aren't ready
		this.containerRetryTimer = null; // Timer for retrying when container isn't ready
		this.videoElementCheckInterval = null; // Interval to check for video element
		this.videoElementRefreshInterval = null; // Interval to refresh video element reference
		this.searchQuery = ""; // Current search query
		this.searchMatches = []; // Array of match indices: [{subtitleIndex, matchIndex, text}]
		this.currentMatchIndex = -1; // Current match being viewed (-1 means none)
		this.summarySearchQuery = ""; // Current summary search query
		this.summarySearchMatches = []; // Array of match indices for summary: [{elementIndex, matchIndex, text}]
		this.currentSummaryMatchIndex = -1; // Current summary match being viewed (-1 means none)
		this.themeDetected = false; // Flag to track if theme has been detected
		this.transcriptPanelOpened = false; // Flag to track if transcript panel has been opened
		this.transcriptPanelOpenTime = null; // Timestamp when transcript panel was opened
		this.transcriptPanelDelayMs = 3000; // Delay in ms after transcript panel opens before showing extension
		this.init();
	}

	// HTML escaping function to prevent XSS
	escapeHTML(str) {
		if (typeof str !== "string") return "";
		const div = document.createElement("div");
		div.textContent = str;
		return div.innerHTML;
	}

	// Debug logging wrapper
	log(...args) {
		if (CONSTANTS.DEBUG_MODE) {
			console.log("[YouTube Summarizer]", ...args);
		}
	}

	// Error logging wrapper
	logError(message, error) {
		console.error(`[YouTube Summarizer] ${message}`, error);
	}

	// Check if chrome.runtime is available
	isExtensionAvailable() {
		try {
			return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id !== undefined;
		} catch (error) {
			return false;
		}
	}

	// Helper function to send messages to background script with error handling
	async sendMessageToBackground(message) {
		// First check if extension is available
		if (!this.isExtensionAvailable()) {
			const error = new Error("Extension was reloaded. Please refresh the page and try again.");
			error.isContextInvalidated = true;
			throw error;
		}

		try {
			const response = await chrome.runtime.sendMessage(message);

			// Check for chrome.runtime.lastError (common in Chrome extensions)
			if (chrome.runtime.lastError) {
				const errorMsg = chrome.runtime.lastError.message;
				if (
					errorMsg &&
					(errorMsg.includes("Extension context invalidated") ||
						errorMsg.includes("message port closed") ||
						errorMsg.includes("Receiving end does not exist"))
				) {
					const error = new Error("Extension was reloaded. Please refresh the page and try again.");
					error.isContextInvalidated = true;
					throw error;
				}
				throw new Error(errorMsg || "Background script error");
			}

			return response;
		} catch (error) {
			// Handle "Extension context invalidated" error
			if (
				error.message &&
				(error.message.includes("Extension context invalidated") ||
					error.message.includes("Extension was reloaded") ||
					error.message.includes("message port closed") ||
					error.message.includes("Receiving end does not exist"))
			) {
				this.logError("Extension context invalidated", error);
				const contextError = new Error("Extension was reloaded. Please refresh the page and try again.");
				contextError.isContextInvalidated = true;
				throw contextError;
			}
			// Re-throw other errors
			throw error;
		}
	}

	// Build a timestamp reference list for specific subtitle indices
	buildTimestampReferenceForIndices(indices, max = 25) {
		try {
			const items = [];
			for (let k = 0; k < indices.length && items.length < max; k++) {
				const idx = indices[k];
				const timing = this.subtitleTimings[idx];
				if (!timing) continue;
				const formatted = this.formatTimestamp(timing.start);
				const content = (this.subtitles[idx] || "").trim();
				if (content) items.push(`• [${formatted}] - "${content}"`);
			}
			return items.join("\n");
		} catch (e) {
			return "";
		}
	}

	// Build a global timestamp reference from key timestamps
	buildTimestampReferenceFromKeyTimestamps(keyTimestamps = []) {
		try {
			if (!Array.isArray(keyTimestamps)) return "";
			return keyTimestamps
				.slice(0, 30)
				.map((ts) => `• [${ts.formatted}] - "${(ts.content || "").trim()}"`)
				.join("\n");
		} catch (e) {
			return "";
		}
	}

	// Chunk subtitles with the user's question to maximize answer accuracy
	async queryInChunks(query, videoTitle, subtitlesText, keyTimestamps, meta) {
		const CHUNK_SIZE = CONSTANTS.CHUNK_SIZE;
		const INTER_CHUNK_DELAY_MS = CONSTANTS.INTER_CHUNK_DELAY_MS;
		const MAX_RETRIES_PER_CHUNK = CONSTANTS.MAX_RETRIES_PER_CHUNK;
		const chunks = [];
		for (let i = 0; i < subtitlesText.length; i += CHUNK_SIZE) {
			chunks.push(subtitlesText.slice(i, i + CHUNK_SIZE));
		}

		// Update the pending query section with progress
		this.updateQueryProgress(0, chunks.length);

		const perChunkAnswers = [];
		for (let i = 0; i < chunks.length; i++) {
			const tsRef = this.buildTimestampReferenceForIndices(chunks[i].indices || [], CONSTANTS.MAX_TIMESTAMPS_PER_CHUNK || 25);
			const prompt = `You are answering a question about the YouTube video titled "${videoTitle}".

Question: ${query}

Here is CHUNK (${i + 1}/${chunks.length}) of the video's subtitles:

${chunks[i].text || chunks[i]}

Available timestamps from this chunk (use only these when referencing moments):
${tsRef}

Task: Provide a concise answer based ONLY on this chunk as a bullet list. For EVERY bullet point, you MUST:
- Include exactly one timestamp in [MM:SS] or [HH:MM:SS] format at the END, chosen from the list above. TIMESTAMP SELECTION STRATEGY:
  1. FIRST, try to find an exact match where the timestamp content directly relates to your bullet point
  2. If no exact match exists, find the CLOSEST TIMESTAMP IN TIME to when that content was discussed in this chunk
  3. Use temporal proximity - if content was discussed around a certain time, use timestamps near that time even if the exact words don't match perfectly
  4. The goal is to help users jump to the right general time period, so approximate timestamps based on time proximity are acceptable
- ALWAYS include a timestamp - find the best match based on content OR time proximity. NEVER use [N/A] or write messages about missing timestamps.
- Do not invent timestamps. Use only the timestamps listed above.`;

			let attempt = 0;
			let success = false;
			let lastError = null;
			while (attempt < MAX_RETRIES_PER_CHUNK && !success) {
				try {
					const res = await chrome.runtime.sendMessage({
						action: "query",
						customPrompt: prompt,
						meta: { ...meta, phase: "q-chunk", index: i + 1, total: chunks.length },
					});
					if (!res || !res.success) throw new Error(res?.error || "Failed to get chunk answer");
					perChunkAnswers.push(res.answer);
					success = true;
				} catch (e) {
					// If extension context invalidated, throw immediately
					if (
						e.isContextInvalidated ||
						(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
					) {
						const error = new Error("Extension was reloaded. Please refresh the page and try again.");
						error.isContextInvalidated = true;
						throw error;
					}
					lastError = e;
					const backoffMs = Math.min(10000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
					await new Promise((r) => setTimeout(r, backoffMs));
					attempt += 1;
				}
			}
			if (!success) throw new Error(lastError?.message || "Failed to get chunk answer after retries");
			// Update progress after each chunk
			this.updateQueryProgress(i + 1, chunks.length);
			if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
		}

		// Combine all per-chunk answers into a single answer
		const globalTsRef = this.buildTimestampReferenceFromKeyTimestamps(keyTimestamps);
		const combinePrompt = `You are given ${perChunkAnswers.length} partial answers to the question "${query}" about the video "${videoTitle}".

Combine them into one high-quality answer AS A BULLET LIST (you may group bullets under short headers if needed). Remove contradictions and duplicates, prefer precise statements with timestamps, and clearly state if some information is not available from the provided content. Use only the timestamps listed below when referencing moments.

Available timestamps from the video:
${globalTsRef}

Partial answers:

${perChunkAnswers
	.map(
		(a, idx) => `Part ${idx + 1}:
${a}`
	)
	.join("\n\n")}

Final formatting rules for your output:
- Output bullets only (you may include short headers, but make the content bullets).
- EVERY bullet point MUST include one timestamp in [MM:SS] or [HH:MM:SS] format at the END, pulled from the available timestamps above. TIMESTAMP SELECTION STRATEGY:
  1. FIRST, try to find an exact match where the timestamp content directly relates to your bullet point
  2. If no exact match exists, find the CLOSEST TIMESTAMP IN TIME to when that content was discussed
  3. Use temporal proximity - if content was discussed around a certain time, use timestamps near that time (within 30-60 seconds) even if the exact words don't match perfectly
  4. The goal is to help users jump to the right general time period, so approximate timestamps based on time proximity are acceptable and preferred
- ALWAYS include a timestamp - choose based on content match OR time proximity. NEVER use [N/A] or write messages about missing timestamps.
- Do not invent timestamps. Use only the timestamps listed above.`;

		let combineAttempt = 0;
		while (combineAttempt < 4) {
			try {
				const final = await this.sendMessageToBackground({ action: "query", customPrompt: combinePrompt, meta: { ...meta, phase: "q-combine" } });
				if (!final || !final.success) throw new Error(final?.error || "Failed to combine answers");
				return final.answer;
			} catch (e) {
				// If extension context invalidated, throw immediately
				if (
					e.isContextInvalidated ||
					(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
				) {
					const error = new Error("Extension was reloaded. Please refresh the page and try again.");
					error.isContextInvalidated = true;
					throw error;
				}
				const backoffMs = Math.min(12000, 1000 * Math.pow(2, combineAttempt)) + Math.floor(Math.random() * 250);
				await new Promise((r) => setTimeout(r, backoffMs));
				combineAttempt += 1;
			}
		}
		throw new Error("Failed to combine answers after retries");
	}

	// Reflect per-question chunking progress in the pending UI row
	updateQueryProgress(current, total) {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) return;
			const pendingText = summaryContent.querySelector(".query-section:last-child .query-pending-text");
			const pendingCounter = summaryContent.querySelector(".query-section:last-child .query-pending-counter");
			if (pendingText && pendingCounter) {
				pendingCounter.textContent = ` (${Math.min(current, total)}/${total})`;
			}
		} catch (e) {
			this.logError("Error updating query progress", e);
		}
	}

	init() {
		// Prevent race conditions - only allow one initialization at a time
		if (this.initializing) {
			this.log("Initialization already in progress, skipping...");
			return;
		}

		try {
			this.initializing = true;
			this.log("Initializing YouTube Summarizer extension...");
			this.initializationAttempts++;

			// Prevent YouTube from auto-scrolling to transcript panel
			this.preventTranscriptAutoScroll();

			// Start immediately and also wait for YouTube to load
			this.setupImmediate();
			this.waitForYouTube();

			// Set a timeout to retry initialization if it fails
			setTimeout(() => {
				if (!this.initializationComplete && this.initializationAttempts < this.maxInitializationAttempts) {
					this.log(`Initialization incomplete, retrying (attempt ${this.initializationAttempts + 1}/${this.maxInitializationAttempts})...`);
					this.initializing = false; // Reset guard before retry
					this.init();
				} else if (!this.initializationComplete) {
					this.logError("Failed to initialize extension after maximum attempts");
					this.initializing = false;
				}
			}, CONSTANTS.INITIALIZATION_TIMEOUT_MS);
		} catch (error) {
			this.logError("Error during initialization", error);
			this.initializing = false; // Reset guard on error
			if (this.initializationAttempts < this.maxInitializationAttempts) {
				setTimeout(() => {
					this.initializing = false; // Reset guard before retry
					this.init();
				}, CONSTANTS.INITIAL_RETRY_DELAY_MS * 2);
			}
		}
	}

	setupImmediate() {
		try {
			this.log("Setting up YouTube Summarizer extension...");

			// Create UI immediately
			this.createSummaryUI();

			// Start extraction attempts immediately
			this.setupSubtitlesExtraction();

			// Setup video change detection
			this.setupVideoChangeDetection();

			// Setup video playback tracking
			this.setupVideoPlaybackTracking();

			// Setup theme detection
			this.setupThemeDetection();

			// Also retry after a delay in case YouTube hasn't loaded yet
			setTimeout(() => {
				if (!document.getElementById("youtube-summarizer-container")) {
					this.log("Retrying UI creation after delay...");
					this.createSummaryUI();
				}

				// Mark initialization as complete if UI exists
				if (document.getElementById("youtube-summarizer-container")) {
					this.initializationComplete = true;
					this.log("Extension initialization completed successfully");
				}
			}, 2000);
		} catch (error) {
			this.logError("Error in setupImmediate", error);
		}
	}

	setupVideoChangeDetection() {
		// Detect URL changes (video navigation)
		let lastUrl = location.href;
		let lastVideoId = this.extractVideoId(location.href);

		// Debounced handler to avoid excessive work
		const debouncedHandle = this.debounce(() => this.handleVideoChange(), 400);

		// Check for URL changes every 1000ms (fallback)
		setInterval(() => {
			const currentUrl = location.href;
			const currentVideoId = this.extractVideoId(currentUrl);

			if (currentUrl !== lastUrl || currentVideoId !== lastVideoId) {
				lastUrl = currentUrl;
				lastVideoId = currentVideoId;
				debouncedHandle();
			}
		}, 1000);

		// Listen for YouTube's navigation events
		document.addEventListener("yt-navigate-finish", () => {
			debouncedHandle();
		});

		// Listen for YouTube's page change events
		window.addEventListener("popstate", () => {
			debouncedHandle();
		});

		// Listen for YouTube's pushstate events (when navigation happens programmatically)
		window.addEventListener("pushstate", () => {
			debouncedHandle();
		});

		// Monitor for YouTube's custom navigation events
		document.addEventListener("yt-page-data-updated", () => {
			debouncedHandle();
		});
	}

	extractVideoId(url) {
		try {
			const urlParams = new URLSearchParams(url.split("?")[1] || "");
			return urlParams.get("v");
		} catch (error) {
			return null;
		}
	}

	handleVideoChange() {
		try {
			// Extract current video ID
			const newVideoId = this.extractVideoId(location.href);

			// Only refresh if it's actually a different video and we're on a video page
			if (newVideoId && newVideoId !== this.currentVideoId && location.pathname === "/watch") {
				this.currentVideoId = newVideoId;
				this.log("Video changed, refreshing extension...");

				// Reset all state (this clears UI and data)
				this.resetState();

				// Clear video element reference to force re-detection
				this.videoElement = null;

				// Reinitialize after a delay to let YouTube load
				// Use a longer delay to ensure YouTube has fully loaded the new video
				setTimeout(() => {
					// Double-check we're still on the same video
					const currentVideoId = this.extractVideoId(location.href);
					if (currentVideoId === this.currentVideoId) {
						this.setupImmediate();
					}
				}, 1500);
			} else if (location.pathname === "/watch" && newVideoId && !this.currentVideoId) {
				// First time loading a video page
				this.currentVideoId = newVideoId;
				this.log("First time loading video page, initializing extension...");

				// Initialize the extension
				setTimeout(() => {
					this.setupImmediate();
				}, 500);
			} else if (location.pathname !== "/watch" && this.currentVideoId) {
				// Navigated away from video page, reset state
				this.log("Navigated away from video page, resetting...");
				this.resetState();
				this.currentVideoId = null;
			}
		} catch (error) {
			this.logError("Error handling video change", error);
		}
	}

	resetState() {
		// Clear all data FIRST before UI changes
		this.subtitles = [];
		this.subtitleTimings = [];
		this.summary = null;
		this.isProcessing = false;
		this.extractionAttempts = 0;
		this.currentActiveIndex = -1;
		this.lastActiveIndex = -1;
		this.userScrolled = false;
		this.availableCaptionTracks = [];
		this.selectedCaptionTrack = null;
		this.autoSummaryGenerated = false; // Reset auto-summary flag
		this.querySubmitting = false; // Reset query submitting flag
		this.subtitlesExtractionStartTime = null; // Reset extraction start time
		this.initializationComplete = false; // Reset initialization flag
		this.initializationAttempts = 0; // Reset initialization attempts
		this.initializing = false; // Reset initialization guard
		this.generationProgress = null; // Reset generation progress
		this.searchQuery = ""; // Clear search query
		this.searchMatches = [];
		this.currentMatchIndex = -1;
		this.summarySearchQuery = ""; // Clear summary search query
		this.summarySearchMatches = []; // Clear summary search matches
		this.currentSummaryMatchIndex = -1; // Reset summary match index
		this.searchMatches = []; // Clear search matches
		this.currentMatchIndex = -1; // Reset match index

		// Clear search input UI
		const searchInput = document.getElementById("subtitle-search");
		if (searchInput) {
			searchInput.value = "";
		}
		this.updateSearchUI();

		// Clear summary search input UI
		const summarySearchInput = document.getElementById("summary-search");
		if (summarySearchInput) {
			summarySearchInput.value = "";
		}
		this.updateSummarySearchUI();

		// Clear subtitle display UI immediately to prevent showing old captions
		const subtitlesContent = document.getElementById("subtitles-content");
		if (subtitlesContent) {
			const subtitlesInfo = subtitlesContent.querySelector("#subtitles-info");
			const subtitlesInfoHTML = subtitlesInfo ? subtitlesInfo.outerHTML : "";
			subtitlesContent.innerHTML = subtitlesInfoHTML + '<p class="placeholder">Extracting subtitles...</p>';
		}

		// Clear summary display
		const summaryContent = document.getElementById("summary-content");
		if (summaryContent) {
			summaryContent.innerHTML = '<p class="placeholder">Click "Generate Summary" to get an AI summary of this video</p>';
		}

		// Clean up query event listeners
		this.cleanupQueryEventListeners();

		// Clean up mutation observers
		if (this.mutationObservers && this.mutationObservers.length > 0) {
			this.mutationObservers.forEach((obs) => obs.disconnect());
			this.mutationObservers = [];
		}

		// Clean up theme observer
		if (this.themeObserver) {
			this.themeObserver.disconnect();
			this.themeObserver = null;
		}

		// Reset theme detection flags
		this.themeDetected = false;
		this.videoInfoReady = false;
		this.pendingContainer = null;
		this.transcriptPanelOpened = false;
		this.transcriptPanelOpenTime = null;

		// Clean up video event listeners
		if (this.videoElement && this.videoEventListeners.size > 0) {
			this.videoEventListeners.forEach((handler, event) => {
				this.videoElement.removeEventListener(event, handler);
			});
			this.videoEventListeners.clear();
		}

		// Stop playback tracking
		this.stopPlaybackTracking();

		// Clear jump button timer
		if (this.jumpButtonTimer) {
			clearTimeout(this.jumpButtonTimer);
			this.jumpButtonTimer = null;
		}

		// Clear auto-scroll timer
		if (this.autoScrollTimer) {
			clearTimeout(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}

		// Clean up scroll handler
		const captionsContainer = document.getElementById("subtitles-content");
		if (captionsContainer && this.scrollHandler) {
			captionsContainer.removeEventListener("scroll", this.scrollHandler);
			this.scrollHandler = null;
		}

		// Clear retry timers
		if (this.subtitleRetryTimer) {
			clearTimeout(this.subtitleRetryTimer);
			this.subtitleRetryTimer = null;
		}
		if (this.containerRetryTimer) {
			clearTimeout(this.containerRetryTimer);
			this.containerRetryTimer = null;
		}
		if (this.videoElementCheckInterval) {
			clearInterval(this.videoElementCheckInterval);
			this.videoElementCheckInterval = null;
		}
		if (this.videoElementRefreshInterval) {
			clearInterval(this.videoElementRefreshInterval);
			this.videoElementRefreshInterval = null;
		}

		// Remove existing UI
		const existingContainer = document.getElementById("youtube-summarizer-container");
		if (existingContainer) {
			existingContainer.remove();
		}

		// Clear jump button
		if (this.jumpButton) {
			this.jumpButton.remove();
			this.jumpButton = null;
		}
	}

	// Recovery method to reinitialize the extension if it fails
	recoverExtension() {
		try {
			this.log("Attempting to recover extension...");

			// Reset state
			this.resetState();

			// Reinitialize
			this.initializationAttempts = 0;
			this.initializationComplete = false;
			this.initializing = false; // Reset guard

			// Wait a moment then reinitialize
			setTimeout(() => {
				this.setupImmediate();
			}, 1000);
		} catch (error) {
			this.logError("Error during extension recovery", error);
		}
	}

	// Add a recovery button when the extension fails to initialize
	addRecoveryButton() {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (summaryContent && !summaryContent.querySelector(".recovery-button")) {
				const recoveryHTML = `
					<div class="recovery-notice">
						<p>⚠️ Extension seems to be having issues. Click the button below to retry.</p>
						<button class="recovery-button" onclick="window.youtubeSummarizer.recoverExtension()">
							🔄 Retry Extension
						</button>
					</div>
				`;
				summaryContent.innerHTML = recoveryHTML;
			}
		} catch (error) {
			this.logError("Error adding recovery button", error);
		}
	}

	waitForYouTube() {
		const checkInterval = setInterval(() => {
			// Check for multiple YouTube elements to ensure the page is fully loaded
			const moviePlayer = document.querySelector("#movie_player");
			const secondary = document.querySelector("#secondary");
			const primary = document.querySelector("#primary");
			const videoElement = document.querySelector("video");

			if (moviePlayer && secondary && primary && videoElement) {
				clearInterval(checkInterval);
				this.log("YouTube page fully loaded, setting up video tracking...");

				// Setup video playback tracking after YouTube is fully loaded
				setTimeout(() => {
					this.setupVideoPlaybackTracking();
				}, 1000);
			}
		}, 500); // Check more frequently

		// Also set a timeout to prevent infinite checking
		setTimeout(() => {
			clearInterval(checkInterval);
			this.log("YouTube load timeout reached, proceeding anyway...");
			this.setupVideoPlaybackTracking();
		}, CONSTANTS.YOUTUBE_LOAD_TIMEOUT_MS);
	}

	setupSubtitlesExtraction() {
		try {
			this.log("Setting up subtitle extraction...");

			// Track when subtitle extraction started for this video
			this.subtitlesExtractionStartTime = Date.now();

			// Extract subtitles immediately
			this.extractAllSubtitles();

			// Schedule retries with exponential backoff
			CONSTANTS.EXTRACTION_RETRY_DELAYS.forEach((delay, index) => {
				setTimeout(() => {
					if (this.subtitles.length < CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY && this.extractionAttempts < this.maxExtractionAttempts) {
						this.log(`Retry ${index + 1} of subtitle extraction...`);
						this.extractAllSubtitles();
					} else if (this.subtitles.length >= CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY) {
						this.log(`Found ${this.subtitles.length} subtitles`);
					}
				}, delay);
			});

			// Force refresh caption discovery after a longer delay
			setTimeout(() => {
				if (this.subtitles.length < CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY) {
					this.log("Force refreshing caption discovery...");
					this.forceRefreshCaptionDiscovery();
				}
			}, CONSTANTS.EXTRACTION_RETRY_DELAYS[2]); // Use third delay (5000ms)

			// Monitor for changes with a more conservative approach
			// Debounce function to prevent rapid mutation observer triggers
			let mutationDebounceTimer = null;
			const debouncedExtract = () => {
				if (mutationDebounceTimer) {
					clearTimeout(mutationDebounceTimer);
				}
				mutationDebounceTimer = setTimeout(() => {
					// Check if YouTube UI dialogs are open - if so, don't interfere
					const settingsMenu = document.querySelector("ytd-menu-popup-renderer, ytd-menu-renderer[open], .ytp-popup");
					if (settingsMenu) {
						// YouTube UI is open, don't interfere
						return;
					}

					// Only re-extract if we don't have many subtitles yet and haven't tried too many times
					if (this.subtitles.length < CONSTANTS.MIN_SUBTITLES_FOR_RETRY && this.extractionAttempts < this.maxExtractionAttempts) {
						this.extractAllSubtitles();
					}
				}, 1000); // Debounce for 1 second
			};

			const observer = new MutationObserver((mutations) => {
				// Only react to mutations that are likely subtitle-related
				// Ignore mutations from YouTube's UI dialogs and menus
				const hasRelevantMutation = mutations.some((mutation) => {
					const target = mutation.target;
					// Skip if mutation is in YouTube's UI elements
					if (target.closest("ytd-menu-popup-renderer, ytd-menu-renderer, .ytp-popup, .ytp-settings-menu")) {
						return false;
					}
					// Only react to changes in subtitle-related elements
					return (
						target.closest("ytd-transcript-renderer, .ytp-caption-window-container, .ytp-caption-segment") !== null ||
						target.querySelector("ytd-transcript-renderer, .ytp-caption-window-container") !== null
					);
				});

				if (hasRelevantMutation) {
					debouncedExtract();
				}
			});

			// Observe the video player for changes, but be more selective
			const videoPlayer = document.querySelector("#movie_player");
			if (videoPlayer) {
				observer.observe(videoPlayer, {
					childList: true,
					subtree: false, // Don't observe entire subtree to avoid catching YouTube UI changes
				});
				this.mutationObservers.push(observer);
			}

			// Also observe for transcript panel changes specifically
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (transcriptPanel) {
				const transcriptObserver = new MutationObserver(() => {
					debouncedExtract();
				});
				transcriptObserver.observe(transcriptPanel, {
					childList: true,
					subtree: true,
				});
				this.mutationObservers.push(transcriptObserver);
			}
		} catch (error) {
			this.logError("Error in setupSubtitlesExtraction", error);
			// Retry after error
			setTimeout(() => {
				this.setupSubtitlesExtraction();
			}, CONSTANTS.INITIAL_RETRY_DELAY_MS * 2);
		}
	}

	// Validate that subtitles are ready for summary generation
	validateSubtitlesForSummary() {
		try {
			// Check if we have enough subtitles
			if (this.subtitles.length < CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY) {
				this.log(`Not enough subtitles (${this.subtitles.length}), need at least ${CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY}`);
				return false;
			}

			// Check if all subtitles have content
			const hasValidContent = this.subtitles.every((subtitle) => subtitle && subtitle.trim().length > 0);

			if (!hasValidContent) {
				this.log("Some subtitles are empty or invalid");
				return false;
			}

			// Check if we have timing information
			if (!this.subtitleTimings || this.subtitleTimings.length === 0) {
				this.log("No timing information available");
				return false;
			}

			// Check if extraction was recent
			if (!this.subtitlesExtractionStartTime) {
				this.log("No extraction start time");
				return false;
			}

			const timeSinceExtraction = Date.now() - this.subtitlesExtractionStartTime;
			if (timeSinceExtraction > CONSTANTS.SUBTITLE_EXTRACTION_TIMEOUT_MS) {
				this.log("Subtitles are too old");
				return false;
			}

			this.log(`Subtitles validated: ${this.subtitles.length} subtitles, ${this.subtitleTimings.length} timings`);
			return true;
		} catch (error) {
			this.logError("Error validating subtitles", error);
			return false;
		}
	}

	setupVideoPlaybackTracking() {
		try {
			// Clean up existing listeners first
			if (this.videoElement && this.videoEventListeners.size > 0) {
				this.videoEventListeners.forEach((handler, event) => {
					this.videoElement.removeEventListener(event, handler);
				});
				this.videoEventListeners.clear();
			}

			// Try to get video element
			this.videoElement = document.querySelector("video");

			// If video element not found, set up a periodic check
			if (!this.videoElement) {
				// Clear any existing interval
				if (this.videoElementCheckInterval) {
					clearInterval(this.videoElementCheckInterval);
				}

				// Check periodically for video element (max 10 attempts = 5 seconds)
				let attempts = 0;
				this.videoElementCheckInterval = setInterval(() => {
					attempts++;
					this.videoElement = document.querySelector("video");
					if (this.videoElement || attempts >= 10) {
						clearInterval(this.videoElementCheckInterval);
						this.videoElementCheckInterval = null;
						if (this.videoElement) {
							// Video element found, set up tracking
							this.setupVideoEventListeners();
						}
					}
				}, 500);
				return;
			}

			// Video element found, set up event listeners
			this.setupVideoEventListeners();
		} catch (error) {
			this.logError("Error setting up video playback tracking", error);
		}
	}

	setupVideoEventListeners() {
		try {
			if (!this.videoElement) return;

			// Create bound handlers for cleanup
			const timeUpdateHandler = () => {
				this.updateActiveCaption();
			};
			const playHandler = () => {
				this.startPlaybackTracking();
			};
			const pauseHandler = () => {
				this.stopPlaybackTracking();
			};
			const loadedDataHandler = () => {
				// Immediately update active caption when video is ready
				setTimeout(() => {
					this.updateActiveCaption();
				}, 100);
			};

			// Track playback time updates
			this.videoElement.addEventListener("timeupdate", timeUpdateHandler);
			this.videoEventListeners.set("timeupdate", timeUpdateHandler);

			// Track when video starts playing
			this.videoElement.addEventListener("play", playHandler);
			this.videoEventListeners.set("play", playHandler);

			// Track when video pauses
			this.videoElement.addEventListener("pause", pauseHandler);
			this.videoEventListeners.set("pause", pauseHandler);

			// Track when video is ready to play
			this.videoElement.addEventListener("loadeddata", loadedDataHandler);
			this.videoEventListeners.set("loadeddata", loadedDataHandler);

			// Also update active caption immediately if video is already loaded
			if (this.videoElement.readyState >= 2) {
				setTimeout(() => {
					this.updateActiveCaption();
				}, 100);
			}

			// Set up a periodic check to refresh video element reference
			// YouTube may replace the video element during navigation
			if (this.videoElementRefreshInterval) {
				clearInterval(this.videoElementRefreshInterval);
			}
			this.videoElementRefreshInterval = setInterval(() => {
				const currentVideoElement = document.querySelector("video");
				if (currentVideoElement && currentVideoElement !== this.videoElement) {
					// Video element was replaced, re-setup tracking
					this.log("Video element replaced, re-setting up tracking");
					this.setupVideoPlaybackTracking();
				} else if (!currentVideoElement && this.videoElement) {
					// Video element was removed
					this.videoElement = null;
				}
			}, 2000); // Check every 2 seconds
		} catch (error) {
			this.logError("Error setting up video event listeners", error);
		}
	}

	startPlaybackTracking() {
		if (this.playbackObserver) {
			clearInterval(this.playbackObserver);
		}
		// Update active caption every 100ms for smooth animation
		this.playbackObserver = setInterval(() => {
			this.updateActiveCaption();
		}, 100);
	}

	stopPlaybackTracking() {
		if (this.playbackObserver) {
			clearInterval(this.playbackObserver);
			this.playbackObserver = null;
		}
	}

	updateActiveCaption() {
		try {
			// Try to get video element if we don't have it yet
			if (!this.videoElement) {
				this.videoElement = document.querySelector("video");
				if (!this.videoElement) {
					// Video element not available yet, retry setup
					this.setupVideoPlaybackTracking();
					return;
				}
			}

			// Check if we have subtitle timings
			if (this.subtitleTimings.length === 0) {
				// Subtitles not loaded yet, wait a bit and retry
				if (!this.subtitleRetryTimer) {
					this.subtitleRetryTimer = setTimeout(() => {
						this.subtitleRetryTimer = null;
						this.updateActiveCaption();
					}, 500);
				}
				return;
			}

			const currentTime = this.videoElement.currentTime;
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) {
				// Container not ready yet, retry after a short delay
				if (!this.containerRetryTimer) {
					this.containerRetryTimer = setTimeout(() => {
						this.containerRetryTimer = null;
						this.updateActiveCaption();
					}, 200);
				}
				return;
			}

			// Find the active caption based on the most recent prior timestamp
			let newActiveIndex = -1;
			let mostRecentPriorIndex = -1;

			for (let i = 0; i < this.subtitleTimings.length; i++) {
				const timing = this.subtitleTimings[i];

				// If current time is within this caption's range, it's the active one
				if (currentTime >= timing.start && currentTime <= timing.end) {
					newActiveIndex = i;
					break;
				}

				// Keep track of the most recent prior timestamp
				if (currentTime >= timing.start) {
					mostRecentPriorIndex = i;
				}
			}

			// If no caption is currently active, use the most recent prior one
			if (newActiveIndex === -1 && mostRecentPriorIndex >= 0) {
				newActiveIndex = mostRecentPriorIndex;
			}

			// Debug logging for timing issues
			if (newActiveIndex >= 0 && CONSTANTS.DEBUG_MODE) {
				const activeTiming = this.subtitleTimings[newActiveIndex];
				this.log(
					`Active caption ${newActiveIndex}: ${this.formatTimestamp(activeTiming.start)}-${this.formatTimestamp(
						activeTiming.end
					)}, Current time: ${this.formatTimestamp(currentTime)}`
				);
			}

			// Update active index if it changed
			if (newActiveIndex !== this.currentActiveIndex) {
				this.lastActiveIndex = this.currentActiveIndex;
				this.currentActiveIndex = newActiveIndex;
			}

			// Always update highlighting when we have a valid active index
			// This ensures highlighting works even after DOM rebuild
			if (newActiveIndex >= 0) {
				this.updateCaptionHighlighting();
			}

			// Check if search bar has content - if so, suspend caption magnetism entirely
			const searchInput = document.getElementById("subtitle-search");
			const hasSearchContent = searchInput && searchInput.value.trim().length > 0;

			// Check if we should auto-scroll (only if user hasn't scrolled away significantly AND no search content)
			if (newActiveIndex >= 0 && !this.userScrolled && !hasSearchContent) {
				// Auto-scroll immediately if user hasn't scrolled away and no search is active
				this.autoScrollToActiveCaption(newActiveIndex);
			} else if (newActiveIndex >= 0 && this.userScrolled && !hasSearchContent) {
				// If user has scrolled away and no search is active, use delayed auto-scroll
				// Clear any existing timer
				if (this.autoScrollTimer) {
					clearTimeout(this.autoScrollTimer);
				}

				// Set a delay before auto-scrolling back
				this.autoScrollTimer = setTimeout(() => {
					this.autoScrollToActiveCaption(newActiveIndex);
					this.autoScrollTimer = null;
				}, this.autoScrollDelay);
			}
			// If hasSearchContent is true, do nothing - suspend caption magnetism entirely

			// Always show jump button when there's an active caption
			if (newActiveIndex >= 0) {
				this.showJumpToActiveButton(newActiveIndex);
			}
		} catch (error) {
			this.logError("Error updating active caption", error);
		}
	}

	updateCaptionHighlighting() {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");

			if (captionItems.length === 0) {
				// No caption items found, reset active index
				this.currentActiveIndex = -1;
				return;
			}

			// Remove highlighting from all captions first
			captionItems.forEach((item) => {
				item.classList.remove("active-caption");
			});

			// Add highlighting to the current active caption
			if (this.currentActiveIndex >= 0 && this.currentActiveIndex < captionItems.length) {
				captionItems[this.currentActiveIndex].classList.add("active-caption");
			} else if (this.currentActiveIndex >= captionItems.length) {
				// Active index is out of bounds, reset it
				this.currentActiveIndex = -1;
			}
		} catch (error) {
			this.logError("Error updating caption highlighting", error);
		}
	}

	autoScrollToActiveCaption(activeIndex) {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");
			if (activeIndex >= 0 && activeIndex < captionItems.length) {
				const activeItem = captionItems[activeIndex];

				// Get container and item dimensions
				const containerHeight = captionsContainer.clientHeight;
				const itemTop = activeItem.offsetTop;
				const itemHeight = activeItem.offsetHeight;

				// Calculate scroll position to center the item in the container
				const scrollTop = itemTop - containerHeight / 2 + itemHeight / 2;

				// Ensure scroll position is within bounds
				const maxScrollTop = captionsContainer.scrollHeight - containerHeight;
				const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));

				// Smooth scroll within the container only
				captionsContainer.scrollTo({
					top: finalScrollTop,
					behavior: "smooth",
				});
			}
		} catch (error) {
			this.logError("Error auto-scrolling to active caption", error);
		}
	}

	showJumpToActiveButton(activeIndex) {
		try {
			// Create jump button if it doesn't exist
			if (!this.jumpButton) {
				this.jumpButton = document.createElement("button");
				this.jumpButton.className = "jump-to-active-btn";
				this.jumpButton.innerHTML = `
					<span class="jump-icon">▶</span>
					<span class="jump-text">Jump to Active Caption</span>
				`;

				// Add click event
				this.jumpButton.addEventListener("click", () => {
					this.jumpToActiveCaption(activeIndex);
				});

				// Insert button into the subtitles preview container (outside the scrolling area)
				const subtitlesPreview = document.getElementById("subtitles-preview");
				if (subtitlesPreview) {
					// Insert after the subtitles-content div
					const subtitlesContent = subtitlesPreview.querySelector("#subtitles-content");
					if (subtitlesContent) {
						subtitlesContent.insertAdjacentElement("afterend", this.jumpButton);
					}
				}
			}

			// Update button state based on distance from active caption
			this.updateJumpButtonState(activeIndex);
		} catch (error) {
			this.logError("Error showing jump button", error);
		}
	}

	jumpToActiveCaption(activeIndex) {
		try {
			// Check if search bar has content - if so, clear it first
			const searchInput = document.getElementById("subtitle-search");
			if (searchInput && searchInput.value.trim().length > 0) {
				// Clear the search bar first
				searchInput.value = "";
				this.searchQuery = "";
				this.clearSearch();
				// Wait a moment for search to clear, then scroll to active caption (without changing playback)
				setTimeout(() => {
					this.scrollToActiveCaption(activeIndex);
				}, 100);
				return;
			}

			// Scroll to active caption without changing playback
			this.scrollToActiveCaption(activeIndex);
		} catch (error) {
			this.logError("Error jumping to active caption", error);
		}
	}

	scrollToActiveCaption(activeIndex) {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");
			if (activeIndex >= 0 && activeIndex < captionItems.length) {
				const activeItem = captionItems[activeIndex];

				// Get container and item dimensions
				const containerHeight = captionsContainer.clientHeight;
				const itemTop = activeItem.offsetTop;
				const itemHeight = activeItem.offsetHeight;

				// Calculate scroll position to center the item in the container
				const scrollTop = itemTop - containerHeight / 2 + itemHeight / 2;

				// Ensure scroll position is within bounds
				const maxScrollTop = captionsContainer.scrollHeight - containerHeight;
				const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));

				// Smooth scroll within the container only (NO playback change)
				captionsContainer.scrollTo({
					top: finalScrollTop,
					behavior: "smooth",
				});

				// Clear auto-scroll timer
				if (this.autoScrollTimer) {
					clearTimeout(this.autoScrollTimer);
					this.autoScrollTimer = null;
				}

				// Reset user scroll state
				this.userScrolled = false;

				// Update button state after jumping
				this.updateJumpButtonState(activeIndex);
			}
		} catch (error) {
			this.logError("Error scrolling to active caption", error);
		}
	}

	updateJumpButtonState(activeIndex) {
		try {
			if (!this.jumpButton || activeIndex < 0) return;

			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");
			if (activeIndex >= captionItems.length) return;

			const activeItem = captionItems[activeIndex];
			const containerRect = captionsContainer.getBoundingClientRect();
			const itemRect = activeItem.getBoundingClientRect();

			// Calculate distance from active caption
			const distanceFromActive = Math.abs(itemRect.top - containerRect.top);

			// Disable button if within 800px of active caption (increased magnetism)
			if (distanceFromActive <= 800) {
				this.jumpButton.disabled = true;
				this.jumpButton.classList.add("disabled");
			} else {
				this.jumpButton.disabled = false;
				this.jumpButton.classList.remove("disabled");
			}
		} catch (error) {
			this.logError("Error updating jump button state", error);
		}
	}

	setupScrollTracking() {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (captionsContainer) {
				// Remove existing listener if it exists to prevent duplicates
				if (this.scrollHandler) {
					captionsContainer.removeEventListener("scroll", this.scrollHandler);
				}
				// Create bound handler and store it for cleanup
				this.scrollHandler = () => {
					this.handleScroll();
				};
				captionsContainer.addEventListener("scroll", this.scrollHandler);
			}
		} catch (error) {
			this.logError("Error setting up scroll tracking", error);
		}
	}

	handleScroll() {
		try {
			if (this.currentActiveIndex < 0) return;

			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");
			if (this.currentActiveIndex >= captionItems.length) return;

			const activeItem = captionItems[this.currentActiveIndex];
			const containerRect = captionsContainer.getBoundingClientRect();
			const itemRect = activeItem.getBoundingClientRect();

			// Calculate distance from active caption
			const distanceFromActive = Math.abs(itemRect.top - containerRect.top);

			// Mark as scrolled if user is significantly away from active caption
			const wasScrolled = this.userScrolled;
			this.userScrolled = distanceFromActive > this.scrollThreshold;

			// Reset auto-scroll timer on each scroll event
			if (this.autoScrollTimer) {
				clearTimeout(this.autoScrollTimer);
				this.autoScrollTimer = null;
			}

			// Always show jump button and update its state
			if (this.userScrolled) {
				this.showJumpToActiveButton(this.currentActiveIndex);
			} else if (this.jumpButton) {
				this.updateJumpButtonState(this.currentActiveIndex);
			}
		} catch (error) {
			this.logError("Error handling scroll", error);
		}
	}

	extractAllSubtitles() {
		try {
			this.extractionAttempts++;

			// Clear old subtitles if this is the first extraction attempt for a new video
			if (this.extractionAttempts === 1) {
				this.subtitles = [];
				this.subtitleTimings = [];
				this.log("Clearing old subtitles for new video");
			}

			// Store initial subtitle count to detect if we got new subtitles
			const initialSubtitleCount = this.subtitles.length;

			// First, discover available caption tracks
			this.discoverCaptionTracks();

			// If we have a selected caption track (especially from transcript panel), use it first
			// This ensures we prioritize English auto-generated captions
			if (this.selectedCaptionTrack && this.selectedCaptionTrack.source === "transcript-panel") {
				this.log("Extracting from selected transcript panel track:", this.selectedCaptionTrack.label);
				this.extractFromSelectedTrack(false); // Pass false to skip display
			}

			// Method 1: Extract from transcript panel (manual and auto-generated)
			// Only if we don't have a selected track from transcript panel
			if (!this.selectedCaptionTrack || this.selectedCaptionTrack.source !== "transcript-panel") {
				this.extractFromTranscript(false); // Pass false to skip display
			}

			// Method 2: Extract from subtitle track data (all available tracks)
			// Only if we haven't extracted from transcript panel track
			if (!this.selectedCaptionTrack || this.selectedCaptionTrack.source !== "transcript-panel") {
				this.extractFromAllSubtitleTracks(false); // Pass false to skip display
			}

			// Method 3: Try to open transcript panel earlier if no subtitles found and no tracks discovered
			// This ensures we can discover auto-generated captions from transcript panel
			if (this.subtitles.length === 0 && this.availableCaptionTracks.length === 0 && this.extractionAttempts >= 1) {
				this.tryOpenTranscriptPanel();
			}

			// Method 4: Try to enable auto-generated captions if no subtitles found
			if (this.subtitles.length === 0 && this.extractionAttempts >= 2) {
				this.tryEnableAutoCaptions();
			}

			// Verify we're still on the same video before displaying
			const currentVideoId = this.extractVideoId(location.href);
			if (currentVideoId && currentVideoId !== this.currentVideoId) {
				this.log("Video changed during extraction, not displaying subtitles");
				return;
			}

			// Remove duplicates before checking if we should display
			// This ensures we check the final count after deduplication
			this.removeDuplicateSubtitles();

			// Sort subtitles by timestamp (earliest to latest)
			this.sortSubtitlesByTime();

			// Display subtitles if:
			// 1. We have subtitles (even if count didn't increase due to deduplication), OR
			// 2. We have more subtitles than we started with
			if (this.subtitles.length > 0) {
				// Always display if we have any subtitles after deduplication
				this.updateSubtitlesDisplay();
				this.displaySubtitlesInView();
			} else if (initialSubtitleCount > 0) {
				// If we had subtitles before but now have none after deduplication, log it
				this.log("Warning: All subtitles were removed as duplicates");
			}
		} catch (error) {
			this.logError("Error extracting subtitles", error);
		}
	}

	// Sort subtitles by timestamp (earliest to latest)
	sortSubtitlesByTime() {
		try {
			if (this.subtitles.length === 0 || this.subtitleTimings.length === 0) {
				return;
			}

			// Create array of indices to sort
			const indices = Array.from({ length: this.subtitles.length }, (_, i) => i);

			// Sort indices based on start time
			indices.sort((a, b) => {
				const timeA = this.subtitleTimings[a]?.start || 0;
				const timeB = this.subtitleTimings[b]?.start || 0;
				return timeA - timeB;
			});

			// Reorder both arrays using sorted indices
			const sortedSubtitles = indices.map((i) => this.subtitles[i]);
			const sortedTimings = indices.map((i) => this.subtitleTimings[i]);

			this.subtitles = sortedSubtitles;
			this.subtitleTimings = sortedTimings;

			this.log(`Sorted ${this.subtitles.length} subtitles by timestamp`);
		} catch (error) {
			this.logError("Error sorting subtitles by time", error);
		}
	}

	// Remove duplicate subtitles based on content and timing
	// Only removes exact duplicates (same text AND same timestamp within 0.1 seconds)
	removeDuplicateSubtitles() {
		try {
			const seen = new Map();
			const uniqueSubtitles = [];
			const uniqueTimings = [];
			const originalCount = this.subtitles.length;

			for (let i = 0; i < this.subtitles.length; i++) {
				const subtitle = this.subtitles[i];
				const timing = this.subtitleTimings[i];
				const subtitleText = subtitle.trim().toLowerCase();

				// Check if we've seen this exact text at a very similar time (within 0.1 seconds)
				// This allows the same text at different times to be kept (which is valid)
				let isDuplicate = false;
				for (const [key, seenTiming] of seen.entries()) {
					if (key === subtitleText && Math.abs(seenTiming - timing.start) < 0.1) {
						isDuplicate = true;
						break;
					}
				}

				if (!isDuplicate) {
					seen.set(subtitleText, timing.start);
					uniqueSubtitles.push(subtitle);
					uniqueTimings.push(timing);
				}
			}

			const removedCount = originalCount - uniqueSubtitles.length;
			if (removedCount > 0) {
				this.log(`Removed ${removedCount} duplicate subtitles (exact matches only)`);
			}

			this.subtitles = uniqueSubtitles;
			this.subtitleTimings = uniqueTimings;
		} catch (error) {
			this.logError("Error removing duplicate subtitles", error);
		}
	}

	discoverCaptionTracks() {
		try {
			this.availableCaptionTracks = [];

			// Method 1: Check video text tracks
			this.discoverFromVideoTracks();

			// Method 2: Check transcript panel for available options
			this.discoverFromTranscriptPanel();

			// Method 3: Try to open transcript panel to discover more options
			if (this.availableCaptionTracks.length === 0) {
				this.tryOpenTranscriptPanelForDiscovery();
			}

			// Remove duplicates based on label and source
			this.removeDuplicateTracks();

			// Select the best caption track by default
			this.selectBestCaptionTrack();
		} catch (error) {
			console.error("Error discovering caption tracks:", error);
		}
	}

	removeDuplicateTracks() {
		try {
			const uniqueTracks = [];
			const seenKeys = new Set();

			console.log("Before removing duplicates, tracks:", this.availableCaptionTracks.length);

			this.availableCaptionTracks.forEach((track) => {
				// Create a unique key that includes the auto-generated status
				const key = `${track.label}-${track.source}-${track.isAutoGenerated}`;

				if (!seenKeys.has(key)) {
					seenKeys.add(key);
					uniqueTracks.push(track);
					console.log(`Keeping track: ${track.label} (${track.source}, auto-generated: ${track.isAutoGenerated})`);
				} else {
					console.log(`Removing duplicate track: ${track.label} (${track.source}, auto-generated: ${track.isAutoGenerated})`);
				}
			});

			this.availableCaptionTracks = uniqueTracks;
			console.log("After removing duplicates, tracks:", this.availableCaptionTracks.length);
		} catch (error) {
			console.error("Error removing duplicate tracks:", error);
		}
	}

	discoverFromVideoTracks() {
		try {
			const videoElement = document.querySelector("video");
			if (!videoElement || !videoElement.textTracks) return;

			console.log("Discovering video tracks, total tracks:", videoElement.textTracks.length);

			for (let i = 0; i < videoElement.textTracks.length; i++) {
				const track = videoElement.textTracks[i];

				console.log(`Track ${i}:`, {
					label: track.label,
					language: track.language,
					kind: track.kind,
					mode: track.mode,
					cuesLength: track.cues ? track.cues.length : 0,
				});

				// Try to enable the track to access its cues
				if (track.mode === "disabled") {
					track.mode = "showing";
				}

				if (track.cues && track.cues.length > 0) {
					// Determine if this is auto-generated based on track properties
					const isAutoGenerated = this.isTrackAutoGenerated(track);
					const label = track.language === "en" ? (isAutoGenerated ? "English (auto-generated)" : "English") : track.label || `Track ${i + 1}`;

					console.log(`Adding track: ${label}, auto-generated: ${isAutoGenerated}`);

					const trackInfo = {
						index: i,
						label: label,
						language: track.language || "unknown",
						kind: track.kind,
						mode: track.mode,
						cues: Array.from(track.cues),
						source: "video-track",
						isAutoGenerated: isAutoGenerated,
					};

					this.availableCaptionTracks.push(trackInfo);
				}
			}
		} catch (error) {
			console.error("Error discovering from video tracks:", error);
		}
	}

	isTrackAutoGenerated(track) {
		try {
			// Check track label for auto-generated indicators - be more specific
			if (track.label) {
				const label = track.label.toLowerCase();
				// Only detect as auto-generated if the label explicitly mentions it
				if (label.includes("auto-generated") || label.includes("auto generated")) {
					console.log("Track detected as auto-generated by label:", track.label);
					return true;
				}
				// Don't detect as auto-generated just because it contains "auto" (could be "automatic" or other words)
			}

			// Check track language code for auto-generated indicators
			if (track.language) {
				const lang = track.language.toLowerCase();
				// Be more specific about language indicators
				if (lang.includes("auto-generated") || lang.includes("auto generated")) {
					console.log("Track detected as auto-generated by language:", track.language);
					return true;
				}
			}

			// Check cues for auto-generated indicators - be more conservative
			if (track.cues && track.cues.length > 0) {
				const autoGeneratedIndicators = [
					"[inaudible]",
					"[music]",
					"[applause]",
					"[laughter]",
					"♪",
					"♫",
					"[speaking in foreign language]",
					"[foreign language]",
				];

				// Count how many cues contain auto-generated indicators
				let autoGeneratedCueCount = 0;
				const totalCues = track.cues.length;

				Array.from(track.cues).forEach((cue) => {
					const hasIndicator = autoGeneratedIndicators.some((indicator) => cue.text.toLowerCase().includes(indicator.toLowerCase()));
					if (hasIndicator) {
						autoGeneratedCueCount++;
					}
				});

				// Only consider auto-generated if a significant portion has indicators
				const autoGeneratedPercentage = (autoGeneratedCueCount / totalCues) * 100;
				if (autoGeneratedPercentage > 10) {
					// More than 10% of cues have auto-generated indicators
					console.log(`Track detected as auto-generated by content analysis: ${autoGeneratedPercentage.toFixed(1)}% of cues have indicators`);
					return true;
				}
			}

			return false;
		} catch (error) {
			console.error("Error checking if track is auto-generated:", error);
			return false;
		}
	}

	discoverFromTranscriptPanel() {
		try {
			// Look for transcript panel with language options
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (!transcriptPanel) return;

			const transcriptItems = document.querySelectorAll(".ytd-transcript-segment-renderer");
			this.log("Found transcript items:", transcriptItems.length);

			if (transcriptItems.length > 0) {
				// Check the current language selection in the transcript panel
				// Look for language indicator text that might show "English (auto-generated)"
				const languageIndicator = transcriptPanel.querySelector('[aria-label*="language"], [aria-label*="Language"], .ytd-transcript-header-renderer');
				let currentLanguageLabel = "English";
				let isAutoGenerated = false;

				if (languageIndicator) {
					const indicatorText = languageIndicator.textContent.toLowerCase();
					if (indicatorText.includes("auto-generated") || indicatorText.includes("auto generated")) {
						isAutoGenerated = true;
						currentLanguageLabel = "English (auto-generated)";
					}
				}

				// If we have transcript items, add as a track option
				const transcriptSubtitles = [];
				const timings = [];

				Array.from(transcriptItems).forEach((item, index) => {
					const textElement = item.querySelector(".segment-text");
					const timestampElement = item.querySelector(".segment-timestamp");

					if (textElement) {
						const text = textElement.textContent.trim();
						if (text.length > 0) {
							transcriptSubtitles.push(text);

							// Extract timestamp
							let startTime = 0;
							if (timestampElement) {
								const timestampText = timestampElement.textContent.trim();
								startTime = this.parseTimestamp(timestampText);
							}

							// Calculate end time based on next item's start time, or estimate
							let endTime = startTime + 3; // Default estimate
							if (index < transcriptItems.length - 1) {
								const nextItem = transcriptItems[index + 1];
								const nextTimestampElement = nextItem.querySelector(".segment-timestamp");
								if (nextTimestampElement) {
									const nextTimestampText = nextTimestampElement.textContent.trim();
									const nextStartTime = this.parseTimestamp(nextTimestampText);
									endTime = nextStartTime;
								}
							}

							timings.push({
								start: startTime,
								end: endTime,
							});
						}
					}
				});

				if (transcriptSubtitles.length > 0) {
					// Determine if this is auto-generated - use both detection methods
					const detectedAutoGenerated = this.detectIfAutoGenerated(transcriptSubtitles);
					// Prefer the explicit label from the panel if available
					const finalIsAutoGenerated = isAutoGenerated || detectedAutoGenerated;
					const label = finalIsAutoGenerated ? "English (auto-generated)" : currentLanguageLabel;

					this.log(`Adding transcript track: ${label}, auto-generated: ${finalIsAutoGenerated}, items: ${transcriptSubtitles.length}`);

					// Check if we already have a track with this label and source
					const existingTrackIndex = this.availableCaptionTracks.findIndex((track) => track.label === label && track.source === "transcript-panel");

					if (existingTrackIndex === -1) {
						// Only add if we don't already have this track
						const trackInfo = {
							index: this.availableCaptionTracks.length,
							label: label,
							language: "en",
							kind: "subtitles",
							mode: "showing",
							cues: transcriptSubtitles.map((text, index) => ({
								text: text,
								startTime: timings[index]?.start || 0,
								endTime: timings[index]?.end || 0,
							})),
							source: "transcript-panel",
							timings: timings,
							isAutoGenerated: finalIsAutoGenerated,
						};

						this.availableCaptionTracks.push(trackInfo);
					} else {
						// Update existing track with latest data
						this.availableCaptionTracks[existingTrackIndex].cues = transcriptSubtitles.map((text, index) => ({
							text: text,
							startTime: timings[index]?.start || 0,
							endTime: timings[index]?.end || 0,
						}));
						this.availableCaptionTracks[existingTrackIndex].timings = timings;
						this.availableCaptionTracks[existingTrackIndex].isAutoGenerated = finalIsAutoGenerated;
					}
				}
			}
		} catch (error) {
			console.error("Error discovering from transcript panel:", error);
		}
	}

	detectIfAutoGenerated(subtitles) {
		try {
			// Look for common auto-generated caption indicators
			const autoGeneratedIndicators = ["[inaudible]", "[music]", "[applause]", "[laughter]", "♪", "♫", "[speaking in foreign language]", "[foreign language]"];

			// Check if any subtitle contains auto-generated indicators
			const hasAutoGeneratedContent = subtitles.some((subtitle) =>
				autoGeneratedIndicators.some((indicator) => subtitle.toLowerCase().includes(indicator.toLowerCase()))
			);

			// Check for transcript panel language indicators - be more specific
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (transcriptPanel) {
				// Look for specific auto-generated indicators in the transcript panel
				const transcriptText = transcriptPanel.textContent.toLowerCase();

				// Check for explicit auto-generated labels
				if (transcriptText.includes("auto-generated") || transcriptText.includes("auto generated")) {
					// Look for the specific context - it should be near language selection
					const languageSelectors = transcriptPanel.querySelectorAll('[aria-label*="language"], [aria-label*="Language"], button');
					for (const selector of languageSelectors) {
						const selectorText = selector.textContent.toLowerCase();
						if (selectorText.includes("auto-generated") || selectorText.includes("auto generated")) {
							console.log("Found explicit auto-generated indicator in transcript panel");
							return true;
						}
					}
				}
			}

			// Only return true if we found actual auto-generated content indicators
			return hasAutoGeneratedContent;
		} catch (error) {
			console.error("Error detecting auto-generated captions:", error);
			return false;
		}
	}

	tryOpenTranscriptPanelForDiscovery() {
		try {
			// Try to open the transcript panel to discover more caption options
			const transcriptButton = document.querySelector(
				'button[aria-label*="transcript"], button[aria-label*="Transcript"], button[aria-label*="Show transcript"]'
			);
			if (transcriptButton) {
				// Store current scroll position before opening panel
				const scrollY = window.scrollY || window.pageYOffset;
				const scrollX = window.scrollX || window.pageXOffset;

				transcriptButton.click();

				// Mark transcript panel as opened and record the time
				this.transcriptPanelOpened = true;
				this.transcriptPanelOpenTime = Date.now();
				this.log("Transcript panel opened for discovery, will wait before showing extension");

				// Immediately restore scroll position and blur focused elements
				setTimeout(() => {
					window.scrollTo(scrollX, scrollY);
					const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
					if (transcriptPanel) {
						const focusedElements = transcriptPanel.querySelectorAll(":focus, [tabindex]:focus");
						focusedElements.forEach((el) => el.blur());
					}
				}, 0);

				// Wait for transcript panel to load and then discover
				setTimeout(() => {
					this.discoverFromTranscriptPanel();
					this.checkForMultipleLanguageOptions();
					this.selectBestCaptionTrack();
					// Ensure no focus remains on transcript elements
					const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
					if (transcriptPanel) {
						const focusedElements = transcriptPanel.querySelectorAll(":focus, [tabindex]:focus");
						focusedElements.forEach((el) => el.blur());
					}
				}, 1500);

				// Check if we can show container after transcript panel delay
				setTimeout(() => {
					this.checkAndShowContainer();
				}, this.transcriptPanelDelayMs);
			}
		} catch (error) {
			console.error("Error opening transcript panel for discovery:", error);
		}
	}

	checkForMultipleLanguageOptions() {
		try {
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (!transcriptPanel) return;

			// Priority: English auto-generated > English manual > other languages
			// Look for language selector buttons in the transcript panel
			const languageButtons = transcriptPanel.querySelectorAll('button[role="button"], button[aria-label*="language"], button[aria-label*="Language"]');

			let englishAutoGeneratedButton = null;
			let englishManualButton = null;

			languageButtons.forEach((button) => {
				const buttonText = button.textContent.toLowerCase();
				// Check for English auto-generated first
				if (
					(buttonText.includes("english") || buttonText.includes("en")) &&
					(buttonText.includes("auto-generated") || buttonText.includes("auto generated"))
				) {
					englishAutoGeneratedButton = button;
					this.log("Found English auto-generated button:", button.textContent);
				}
				// Check for English manual (but not auto-generated)
				else if ((buttonText.includes("english") || buttonText.includes("en")) && !buttonText.includes("auto")) {
					if (!englishManualButton) {
						englishManualButton = button;
						this.log("Found English manual button:", button.textContent);
					}
				}
			});

			// Click English auto-generated if available, otherwise English manual
			if (englishAutoGeneratedButton) {
				this.log("Clicking English auto-generated option");
				englishAutoGeneratedButton.click();
				// Wait for panel to update
				setTimeout(() => {
					this.discoverFromTranscriptPanel();
					this.selectBestCaptionTrack();
				}, 500);
			} else if (englishManualButton) {
				this.log("Clicking English manual option");
				englishManualButton.click();
				setTimeout(() => {
					this.discoverFromTranscriptPanel();
					this.selectBestCaptionTrack();
				}, 500);
			}

			// Also check for dropdown menus in the transcript panel
			const languageDropdowns = transcriptPanel.querySelectorAll("select, [role='listbox']");
			languageDropdowns.forEach((dropdown) => {
				const options = dropdown.querySelectorAll("option");
				options.forEach((option) => {
					const optionText = option.textContent.toLowerCase();
					if (
						(optionText.includes("english") || optionText.includes("en")) &&
						(optionText.includes("auto-generated") || optionText.includes("auto generated"))
					) {
						this.log("Found English auto-generated option in dropdown:", option.textContent);
						option.selected = true;
						dropdown.dispatchEvent(new Event("change", { bubbles: true }));
						setTimeout(() => {
							this.discoverFromTranscriptPanel();
							this.selectBestCaptionTrack();
						}, 500);
					}
				});
			});
		} catch (error) {
			console.error("Error checking for multiple language options:", error);
		}
	}

	// Add a method to force refresh caption discovery
	forceRefreshCaptionDiscovery() {
		try {
			console.log("Force refreshing caption discovery...");
			this.availableCaptionTracks = [];
			this.discoverCaptionTracks();
		} catch (error) {
			console.error("Error force refreshing caption discovery:", error);
		}
	}

	selectBestCaptionTrack() {
		try {
			if (this.availableCaptionTracks.length === 0) return;

			// Priority order: English manual > English auto-generated > first available
			let bestTrack = null;

			// Look for English manual captions first (preferred)
			bestTrack = this.availableCaptionTracks.find((track) => track.language.startsWith("en") && track.isAutoGenerated === false);

			// If no manual captions, look for English auto-generated captions
			if (!bestTrack) {
				bestTrack = this.availableCaptionTracks.find((track) => track.language.startsWith("en") && track.isAutoGenerated === true);
			}

			// If no English captions, use the first available
			if (!bestTrack) {
				bestTrack = this.availableCaptionTracks[0];
			}

			this.selectedCaptionTrack = bestTrack;
			this.updateCaptionTrackSelector();

			// Log available tracks for debugging
			console.log(
				"Available caption tracks:",
				this.availableCaptionTracks.map((track) => ({
					label: track.label,
					language: track.language,
					isAutoGenerated: track.isAutoGenerated,
					source: track.source,
				}))
			);
		} catch (error) {
			console.error("Error selecting best caption track:", error);
		}
	}

	updateCaptionTrackSelector() {
		try {
			const selector = document.getElementById("caption-track-selector");
			if (!selector) return;

			// Clear existing options
			selector.innerHTML = "";

			// Add options for each available track
			if (this.availableCaptionTracks.length > 0) {
				this.availableCaptionTracks.forEach((track, index) => {
					const option = document.createElement("option");
					option.value = index;
					option.textContent = `${track.label} (${track.language})`;
					selector.appendChild(option);
				});

				// Set the selected track
				if (this.selectedCaptionTrack) {
					const selectedIndex = this.availableCaptionTracks.indexOf(this.selectedCaptionTrack);
					if (selectedIndex >= 0) {
						selector.value = selectedIndex;
					} else {
						// If selected track not found, select the first one
						selector.value = 0;
						this.selectedCaptionTrack = this.availableCaptionTracks[0];
					}
				} else {
					// If no track selected, select the first one
					selector.value = 0;
					this.selectedCaptionTrack = this.availableCaptionTracks[0];
				}
			} else {
				// No tracks available
				const option = document.createElement("option");
				option.value = "";
				option.textContent = "No captions available";
				selector.appendChild(option);
			}
		} catch (error) {
			console.error("Error updating caption track selector:", error);
		}
	}

	onCaptionTrackChange(trackIndex) {
		try {
			if (trackIndex >= 0 && trackIndex < this.availableCaptionTracks.length) {
				this.selectedCaptionTrack = this.availableCaptionTracks[trackIndex];

				// Extract subtitles from the selected track
				this.extractFromSelectedTrack();
			}
		} catch (error) {
			console.error("Error changing caption track:", error);
		}
	}

	extractFromSelectedTrack(shouldDisplay = true) {
		try {
			if (!this.selectedCaptionTrack) return;

			const trackSubtitles = [];
			const timings = [];

			if (this.selectedCaptionTrack.source === "transcript-panel") {
				// Handle transcript panel tracks
				this.selectedCaptionTrack.cues.forEach((cue) => {
					const text = cue.text.trim();
					if (text.length > 0) {
						trackSubtitles.push(text);
						timings.push({
							start: cue.startTime,
							end: cue.endTime,
						});
					}
				});
			} else {
				// Handle video track cues
				this.selectedCaptionTrack.cues.forEach((cue) => {
					const text = cue.text.trim();
					if (text.length > 0) {
						trackSubtitles.push(text);
						timings.push({
							start: cue.startTime,
							end: cue.endTime,
						});
					}
				});
			}

			if (trackSubtitles.length > 0) {
				// Always replace if:
				// 1. We have no subtitles yet, OR
				// 2. The new set has more subtitles, OR
				// 3. This is from transcript panel (preferred source) and we have subtitles from a different source
				const isPreferredSource = this.selectedCaptionTrack && this.selectedCaptionTrack.source === "transcript-panel";
				const shouldReplace =
					this.subtitles.length === 0 || trackSubtitles.length > this.subtitles.length || (isPreferredSource && this.subtitles.length > 0);

				if (shouldReplace) {
					this.log(
						`Replacing subtitles: ${this.subtitles.length} -> ${trackSubtitles.length} (source: ${
							this.selectedCaptionTrack?.source || "unknown"
						})`
					);
					this.subtitles = trackSubtitles;
					this.subtitleTimings = timings;
					// Sort subtitles by timestamp
					this.sortSubtitlesByTime();
					if (shouldDisplay) {
						this.updateSubtitlesDisplay();
						this.displaySubtitlesInView();
					}
				}
			}
		} catch (error) {
			this.logError("Error extracting from selected track", error);
		}
	}

	extractFromTranscript(shouldDisplay = true) {
		try {
			// First check if we have a selected track from transcript panel - use that preferentially
			if (this.selectedCaptionTrack && this.selectedCaptionTrack.source === "transcript-panel") {
				this.log("Using selected transcript panel track for extraction:", this.selectedCaptionTrack.label);
				this.extractFromSelectedTrack(shouldDisplay);
				return;
			}

			const transcriptItems = document.querySelectorAll(".ytd-transcript-segment-renderer");
			if (transcriptItems.length > 0) {
				// Check if we should prefer English auto-generated captions
				// Look for language selector in transcript panel to see if we can switch to English auto-generated
				const transcriptPanel = document.querySelector("ytd-transcript-renderer");
				if (transcriptPanel) {
					// Try to find and click English auto-generated option if available
					const languageButtons = transcriptPanel.querySelectorAll('[aria-label*="language"], [aria-label*="Language"], button[role="button"]');
					for (const button of languageButtons) {
						const buttonText = button.textContent.toLowerCase();
						// Look for English auto-generated option
						if (
							(buttonText.includes("english") || buttonText.includes("en")) &&
							(buttonText.includes("auto-generated") || buttonText.includes("auto generated"))
						) {
							this.log("Found English auto-generated option in transcript panel, clicking...");
							button.click();
							// Wait for the panel to update, then extract
							setTimeout(() => {
								this.extractFromTranscript(shouldDisplay);
							}, 1000);
							return;
						}
					}
				}

				const transcriptSubtitles = [];
				const timings = [];

				Array.from(transcriptItems).forEach((item, index) => {
					const textElement = item.querySelector(".segment-text");
					const timestampElement = item.querySelector(".segment-timestamp");

					if (textElement) {
						const text = textElement.textContent.trim();
						if (text.length > 0) {
							transcriptSubtitles.push(text);

							// Extract timestamp
							let startTime = 0;
							if (timestampElement) {
								const timestampText = timestampElement.textContent.trim();
								startTime = this.parseTimestamp(timestampText);
							}

							// Calculate end time based on next item's start time, or estimate
							let endTime = startTime + 3; // Default estimate
							if (index < transcriptItems.length - 1) {
								const nextItem = transcriptItems[index + 1];
								const nextTimestampElement = nextItem.querySelector(".segment-timestamp");
								if (nextTimestampElement) {
									const nextTimestampText = nextTimestampElement.textContent.trim();
									const nextStartTime = this.parseTimestamp(nextTimestampText);
									endTime = nextStartTime;
								}
							}

							timings.push({
								start: startTime,
								end: endTime,
							});
						}
					}
				});

				if (transcriptSubtitles.length > 0) {
					// Detect if these are auto-generated and update available tracks
					const isAutoGenerated = this.detectIfAutoGenerated(transcriptSubtitles);

					// Always replace if:
					// 1. We have no subtitles yet, OR
					// 2. The new set has more subtitles, OR
					// 3. This is English auto-generated and current is not, OR
					// 4. This is from transcript panel (preferred source) and new set is substantial
					const currentIsAutoGenerated = this.subtitles.length > 0 ? this.detectIfAutoGenerated(this.subtitles) : false;
					const shouldReplace =
						this.subtitles.length === 0 ||
						transcriptSubtitles.length > this.subtitles.length ||
						(isAutoGenerated && !currentIsAutoGenerated) ||
						transcriptSubtitles.length >= this.subtitles.length * 0.8; // Allow replacement if new set is at least 80% of current size

					if (shouldReplace) {
						this.log(
							`Replacing subtitles from transcript: ${this.subtitles.length} -> ${transcriptSubtitles.length} (auto-generated: ${isAutoGenerated})`
						);
						this.subtitles = transcriptSubtitles;
						this.subtitleTimings = timings;
						// Sort subtitles by timestamp
						this.sortSubtitlesByTime();
						if (shouldDisplay) {
							this.updateSubtitlesDisplay();
							this.displaySubtitlesInView();
						}
					}
				}
			}
		} catch (error) {
			this.logError("Error extracting from transcript", error);
		}
	}

	extractFromAllSubtitleTracks(shouldDisplay = true) {
		try {
			// Try to access the video element and all its text tracks
			const videoElement = document.querySelector("video");
			if (videoElement && videoElement.textTracks) {
				// If we have a selected track, use that
				if (this.selectedCaptionTrack) {
					this.extractFromSelectedTrack(shouldDisplay);
					return;
				}

				// Otherwise, try to find any available track
				for (let i = 0; i < videoElement.textTracks.length; i++) {
					const track = videoElement.textTracks[i];
					// Try to enable the track to access its cues
					if (track.mode === "disabled") {
						track.mode = "showing";
					}

					if (track.cues && track.cues.length > 0) {
						const cues = Array.from(track.cues);
						const trackSubtitles = [];
						const timings = [];

						cues.forEach((cue) => {
							const text = cue.text.trim();
							if (text.length > 0) {
								trackSubtitles.push(text);
								timings.push({
									start: cue.startTime,
									end: cue.endTime,
								});
							}
						});

						if (trackSubtitles.length > 0) {
							// Always replace if we have no subtitles, or if new set is larger
							// Allow replacement if new set is at least 80% of current size (to handle partial extractions)
							const shouldReplace =
								this.subtitles.length === 0 ||
								trackSubtitles.length > this.subtitles.length ||
								(trackSubtitles.length >= this.subtitles.length * 0.8 && this.subtitles.length > 0);
							if (shouldReplace) {
								this.log(`Replacing subtitles from track: ${this.subtitles.length} -> ${trackSubtitles.length}`);
								this.subtitles = trackSubtitles;
								this.subtitleTimings = timings;
								// Sort subtitles by timestamp
								this.sortSubtitlesByTime();
								// Display is handled by extractAllSubtitles, not here
							}
							break;
						}
					}
				}
			}
		} catch (error) {
			this.logError("Error extracting from subtitle tracks", error);
		}
	}

	parseTimestamp(timestampText) {
		try {
			// Support MM:SS and HH:MM:SS
			const parts = timestampText
				.trim()
				.split(":")
				.map((p) => parseInt(p, 10));
			if (parts.some((n) => Number.isNaN(n))) return 0;
			if (parts.length === 2) {
				const [m, s] = parts;
				return m * 60 + s;
			}
			if (parts.length === 3) {
				const [h, m, s] = parts;
				return h * 3600 + m * 60 + s;
			}
			return 0;
		} catch (error) {
			console.error("Error parsing timestamp:", error);
			return 0;
		}
	}

	formatTimestamp(seconds) {
		try {
			const totalSeconds = Math.max(0, Math.floor(seconds));
			const hours = Math.floor(totalSeconds / 3600);
			const minutes = Math.floor((totalSeconds % 3600) / 60);
			const secs = totalSeconds % 60;
			if (hours > 0) {
				return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
			}
			return `${minutes}:${secs.toString().padStart(2, "0")}`;
		} catch (error) {
			console.error("Error formatting timestamp:", error);
			return "0:00";
		}
	}

	tryEnableAutoCaptions() {
		try {
			// Check if YouTube UI dialogs are open - if so, don't interfere
			const settingsMenu = document.querySelector("ytd-menu-popup-renderer, ytd-menu-renderer[open], .ytp-popup");
			if (settingsMenu) {
				// YouTube UI is open, don't interfere
				return;
			}

			// Try to click the CC button to enable auto-generated captions
			const ccButton = document.querySelector(".ytp-subtitles-button");
			if (ccButton && !ccButton.classList.contains("ytp-subtitles-enabled")) {
				ccButton.click();

				// Wait a bit and try to extract again
				setTimeout(() => {
					this.extractAllSubtitles();
				}, 2000);
			}
		} catch (error) {
			console.error("Error enabling auto captions:", error);
		}
	}

	tryOpenTranscriptPanel() {
		try {
			// Check if YouTube UI dialogs are open - if so, don't interfere
			const settingsMenu = document.querySelector("ytd-menu-popup-renderer, ytd-menu-renderer[open], .ytp-popup");
			if (settingsMenu) {
				// YouTube UI is open, don't interfere
				return;
			}

			// Try to open the transcript panel to access all subtitles
			const transcriptButton = document.querySelector(
				'button[aria-label*="transcript"], button[aria-label*="Transcript"], button[aria-label*="Show transcript"]'
			);
			if (transcriptButton) {
				// Store current scroll position before opening panel
				const scrollY = window.scrollY || window.pageYOffset;
				const scrollX = window.scrollX || window.pageXOffset;

				transcriptButton.click();

				// Mark transcript panel as opened and record the time
				this.transcriptPanelOpened = true;
				this.transcriptPanelOpenTime = Date.now();
				this.log("Transcript panel opened, will wait before showing extension");

				// Immediately restore scroll position after a short delay
				setTimeout(() => {
					window.scrollTo(scrollX, scrollY);
					// Also blur any focused elements in transcript panel
					const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
					if (transcriptPanel) {
						const focusedElements = transcriptPanel.querySelectorAll(":focus, [tabindex]:focus");
						focusedElements.forEach((el) => el.blur());
					}
				}, 0);

				// Check if we can show container after transcript panel delay
				setTimeout(() => {
					this.checkAndShowContainer();
				}, this.transcriptPanelDelayMs);

				// Wait for transcript panel to load, then discover tracks and extract
				setTimeout(() => {
					// Ensure no focus remains on transcript elements
					const transcriptPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
					if (transcriptPanel) {
						const focusedElements = transcriptPanel.querySelectorAll(":focus, [tabindex]:focus");
						focusedElements.forEach((el) => el.blur());
					}

					// First discover tracks from the transcript panel
					this.discoverFromTranscriptPanel();
					// Check for multiple language options and select English auto-generated
					this.checkForMultipleLanguageOptions();
					// Select the best track (prioritizes English auto-generated)
					this.selectBestCaptionTrack();

					// If we have a selected track from transcript panel, extract from it
					if (this.selectedCaptionTrack && this.selectedCaptionTrack.source === "transcript-panel") {
						this.log("Extracting from transcript panel track after opening:", this.selectedCaptionTrack.label);
						this.extractFromSelectedTrack(false);
					} else {
						// Fallback to direct extraction
						this.extractFromTranscript(false);
					}

					// Trigger a re-extraction to pick up the new subtitles
					setTimeout(() => {
						this.extractAllSubtitles();
						// Final check to ensure no focus on transcript elements
						const finalPanel = document.querySelector("ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer");
						if (finalPanel) {
							const finalFocused = finalPanel.querySelectorAll(":focus, [tabindex]:focus");
							finalFocused.forEach((el) => el.blur());
						}
					}, 500);
				}, 2500);
			}
		} catch (error) {
			console.error("Error opening transcript panel:", error);
		}
	}

	createSummaryUI() {
		try {
			// Only create UI if we're on a video page
			if (location.pathname !== "/watch" || !this.extractVideoId(location.href)) {
				this.log("Not on a video page, skipping UI creation");
				return;
			}

			// Remove existing container if it exists
			const existingContainer = document.getElementById("youtube-summarizer-container");
			if (existingContainer) {
				existingContainer.remove();
			}

			// Create the summary container
			const summaryContainer = document.createElement("div");
			summaryContainer.id = "youtube-summarizer-container";
			// Initially hide the container until video info is loaded
			summaryContainer.style.display = "none";
			summaryContainer.innerHTML = `
      <div class="summarizer-header">
        <!-- Modern Toggle Tabs -->
        <div class="toggle-tabs-container">
          <div class="toggle-tabs">
            <button class="toggle-tab active" data-tab="captions">
              <svg class="toggle-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z"/>
              </svg>
            </button>
            <button class="toggle-tab" data-tab="summary">
              <svg class="toggle-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
              </svg>
            </button>
          </div>
        </div>
        <button id="summarize-btn" class="summarize-btn">
          <svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
          </svg>
          <span>Summarize Video</span>
        </button>
      </div>
      <div class="summarizer-content">
        <div class="tab-content">
          <div id="captions-tab" class="tab-pane active">
            <div id="subtitles-preview" class="subtitles-preview">
              <div class="caption-controls">
                <div class="search-controls">
                  <div class="search-bar-wrapper">
                    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="11" cy="11" r="8"/>
                      <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <input type="text" id="subtitle-search" class="subtitle-search" placeholder="Search captions" />
                    <button id="search-clear" class="search-clear-btn" title="Clear search" style="display: none;">
                      <svg class="clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                    <div class="search-navigation" id="search-navigation" style="display: none;">
                      <button id="search-prev" class="search-nav-btn" title="Previous match (↑)">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <path d="M18 15l-6-6-6 6"/>
                        </svg>
                      </button>
                      <span id="search-match-count" class="search-match-count">0/0</span>
                      <button id="search-next" class="search-nav-btn" title="Next match (↓)">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <button id="copy-captions-btn" class="copy-btn" title="Copy all captions">
                  <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
              <div id="subtitles-content" class="subtitles-content">
        <div id="subtitles-info" class="subtitles-info">
          <p>📝 Subtitles extracted: <span id="subtitle-count">0</span></p>
        </div>
                <p class="placeholder">Extracting subtitles...</p>
              </div>
            </div>
          </div>
          <div id="summary-tab" class="tab-pane">
            <div class="summary-search-controls">
              <div class="search-controls">
                <div class="search-bar-wrapper">
                  <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                  </svg>
                  <input type="text" id="summary-search" class="subtitle-search" placeholder="Search summary..." />
                  <button id="summary-search-clear" class="search-clear-btn" title="Clear search" style="display: none;">
                    <svg class="clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                  <div class="search-navigation" id="summary-search-navigation" style="display: none;">
                    <button id="summary-search-prev" class="search-nav-btn" title="Previous match (↑)">
                      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M18 15l-6-6-6 6"/>
                      </svg>
                    </button>
                    <span id="summary-search-match-count" class="search-match-count">0/0</span>
                    <button id="summary-search-next" class="search-nav-btn" title="Next match (↓)">
                      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <button id="copy-summary-btn" class="copy-btn" title="Copy summary">
                <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
        <div id="summary-content" class="summary-content">
          <p class="placeholder">Click "Generate Summary" to get an AI summary of this video</p>
        </div>
        <div id="loading-indicator" class="loading-indicator" style="display: none;">
          <div class="spinner"></div>
          <p>Generating summary...</p>
            </div>
            <div class="summary-query-section">
              <div class="query-input-container">
                <input type="text" id="summary-query-input" class="summary-query-input" placeholder="Ask a Question" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                <button id="submit-query-btn" class="submit-query-btn">
                  <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 11L12 9M12 9L10 11M12 9V15M21.0039 12C21.0039 16.9706 16.9745 21 12.0039 21C9.9675 21 3.00463 21 3.00463 21C3.00463 21 4.56382 17.2561 3.93982 16.0008C3.34076 14.7956 3.00391 13.4372 3.00391 12C3.00391 7.02944 7.03334 3 12.0039 3C16.9745 3 21.0039 7.02944 21.0039 12Z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

			// Insert the summary container in the correct position
			this.insertContainerInCorrectPosition(summaryContainer);

			// Wait for video title and info to load before showing the extension
			this.waitForVideoInfoAndShow(summaryContainer);

			// Add event listeners
			this.setupEventListeners();

			// Setup scroll tracking
			this.setupScrollTracking();

			// Update button state based on whether summary exists
			this.updateGenerateButton(false);

			// Show a message that summary will be generated automatically
			const summaryContent = document.getElementById("summary-content");
			if (summaryContent) {
				summaryContent.innerHTML = `
					<div class="auto-summary-notice">
						<p>📝 Summary will be generated automatically once subtitles are loaded...</p>
					</div>
				`;
			}

			// Add recovery button if extension fails to initialize
			setTimeout(() => {
				if (!this.initializationComplete) {
					this.addRecoveryButton();
				}
			}, 10000); // 10 seconds timeout
		} catch (error) {
			this.logError("Error creating summary UI", error);
		}
	}

	setupEventListeners() {
		// Add event listener for the summarize button
		const summarizeBtn = document.getElementById("summarize-btn");
		if (summarizeBtn) {
			summarizeBtn.addEventListener("click", () => {
				this.generateSummary(true);
			});
		}

		// Add event listeners for toggle tab buttons
		const toggleTabs = document.querySelectorAll(".toggle-tab");
		toggleTabs.forEach((button) => {
			button.addEventListener("click", () => {
				this.switchTab(button.dataset.tab);
			});
		});

		// Add event listener for caption track selector
		const captionSelector = document.getElementById("caption-track-selector");
		if (captionSelector) {
			captionSelector.addEventListener("change", (event) => {
				const trackIndex = parseInt(event.target.value);
				this.onCaptionTrackChange(trackIndex);
			});
		}

		// Add event listeners for caption items (delegated)
		this.setupCaptionClickListeners();

		// Add event listener for query submit button
		this.setupQueryEventListeners();

		// Setup search functionality
		this.setupSearchFunctionality();
		// Setup summary search functionality
		this.setupSummarySearchFunctionality();
		// Setup copy buttons
		this.setupCopyButtons();
	}

	switchTab(tabName) {
		// Update active toggle tab button
		const toggleTabs = document.querySelectorAll(".toggle-tab");
		toggleTabs.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.tab === tabName);
		});

		// Update active tab content
		const tabPanes = document.querySelectorAll(".tab-pane");
		tabPanes.forEach((pane) => {
			pane.classList.toggle("active", pane.id === `${tabName}-tab`);
		});

		this.currentTab = tabName;

		// Update sticky header top position when switching to summary tab
		if (tabName === "summary") {
			setTimeout(() => {
				this.updateStickyHeaderTop();
			}, 100); // Small delay to ensure DOM is updated
		}
	}

	setupCaptionClickListeners() {
		try {
			// Use event delegation to handle caption clicks
			const captionsContainer = document.getElementById("subtitles-content");
			if (captionsContainer) {
				captionsContainer.addEventListener("click", (event) => {
					const captionItem = event.target.closest(".subtitle-item");
					if (captionItem && !captionItem.classList.contains("active-caption")) {
						const startTime = parseFloat(captionItem.dataset.startTime);
						if (!isNaN(startTime)) {
							this.jumpToCaption(startTime);
						}
					}
				});
			}
		} catch (error) {
			this.logError("Error setting up caption click listeners", error);
		}
	}

	jumpToCaption(startTime) {
		this.jumpToTimestamp(startTime);
	}

	jumpToTimestamp(timestamp) {
		try {
			if (this.videoElement) {
				this.videoElement.currentTime = timestamp;
				this.log(`Jumped to timestamp ${this.formatTimestamp(timestamp)}`);
			}
		} catch (error) {
			this.logError("Error jumping to timestamp", error);
		}
	}

	setupQueryEventListeners() {
		try {
			// Clean up existing event listeners first
			this.cleanupQueryEventListeners();

			// Get the specific elements
			const submitBtn = document.getElementById("submit-query-btn");
			const queryInput = document.getElementById("summary-query-input");

			if (!submitBtn || !queryInput) return;

			// Create event listener functions
			const submitClickHandler = (event) => {
				if (event.target.id === "submit-query-btn" && !this.querySubmitting) {
					this.submitQuery();
				}
			};

			const enterKeyHandler = (event) => {
				if (event.target.id === "summary-query-input" && event.key === "Enter" && !this.querySubmitting) {
					this.submitQuery();
				}
			};

			// Add event listeners to specific elements
			submitBtn.addEventListener("click", submitClickHandler);
			queryInput.addEventListener("keypress", enterKeyHandler);

			// Store references for cleanup
			this.queryEventListeners = [
				{ element: submitBtn, event: "click", handler: submitClickHandler },
				{ element: queryInput, event: "keypress", handler: enterKeyHandler },
			];
		} catch (error) {
			this.logError("Error setting up query event listeners", error);
		}
	}

	cleanupQueryEventListeners() {
		try {
			// Remove existing event listeners
			this.queryEventListeners.forEach(({ element, event, handler }) => {
				if (element && element.removeEventListener) {
					element.removeEventListener(event, handler);
				}
			});
			this.queryEventListeners = [];
		} catch (error) {
			this.logError("Error cleaning up query event listeners", error);
		}
	}

	setupSearchFunctionality() {
		try {
			const searchInput = document.getElementById("subtitle-search");
			const searchClearBtn = document.getElementById("search-clear");
			const searchPrevBtn = document.getElementById("search-prev");
			const searchNextBtn = document.getElementById("search-next");

			if (!searchInput || !searchClearBtn || !searchPrevBtn || !searchNextBtn) return;

			// Show/hide clear button based on input
			const updateClearButton = () => {
				if (searchInput.value.length > 0) {
					searchClearBtn.style.display = "flex";
				} else {
					searchClearBtn.style.display = "none";
				}
			};

			// Search input handler
			searchInput.addEventListener("input", (e) => {
				const previousQuery = this.searchQuery;
				this.searchQuery = e.target.value.trim();

				updateClearButton();

				// Disable auto-scroll to active caption during search
				if (this.searchQuery.length > 0) {
					this.userScrolled = true;
					this.performSearch();
				} else {
					// Search was cleared - jump back to active caption
					this.userScrolled = false;
					this.clearSearch();
					this.jumpToActiveCaptionAfterClear();
				}
			});

			// Clear button click handler
			searchClearBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				searchInput.value = "";
				this.searchQuery = "";
				this.userScrolled = false;
				updateClearButton();
				this.clearSearch();
				this.jumpToActiveCaptionAfterClear();
			});

			// Keyboard shortcuts for search navigation
			searchInput.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (e.shiftKey) {
						this.navigateToMatch(-1); // Shift+Enter = previous
					} else {
						this.navigateToMatch(1); // Enter = next
					}
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					this.navigateToMatch(-1);
				} else if (e.key === "ArrowDown") {
					e.preventDefault();
					this.navigateToMatch(1);
				} else if (e.key === "Escape") {
					e.preventDefault();
					searchInput.value = "";
					this.searchQuery = "";
					this.userScrolled = false;
					updateClearButton();
					this.clearSearch();
					this.jumpToActiveCaptionAfterClear();
				}
			});

			// Navigation buttons
			searchPrevBtn.addEventListener("click", () => {
				this.navigateToMatch(-1);
			});

			searchNextBtn.addEventListener("click", () => {
				this.navigateToMatch(1);
			});
		} catch (error) {
			this.logError("Error setting up search functionality", error);
		}
	}

	performSearch() {
		try {
			this.searchMatches = [];
			this.currentMatchIndex = -1;

			if (!this.searchQuery || this.searchQuery.length === 0) {
				this.updateSearchUI();
				// Redisplay subtitles without highlights
				if (this.subtitles.length > 0) {
					this.displaySubtitlesInView();
				}
				return;
			}

			const query = this.searchQuery.toLowerCase();

			// Find all matches in subtitles
			this.subtitles.forEach((subtitle, subtitleIndex) => {
				const subtitleLower = subtitle.toLowerCase();
				let searchIndex = 0;

				// Find all occurrences of the query in this subtitle
				while ((searchIndex = subtitleLower.indexOf(query, searchIndex)) !== -1) {
					this.searchMatches.push({
						subtitleIndex: subtitleIndex,
						matchIndex: searchIndex,
						text: subtitle.substring(searchIndex, searchIndex + query.length),
					});
					searchIndex += query.length;
				}
			});

			this.log(`Found ${this.searchMatches.length} matches for "${this.searchQuery}"`);

			// Update UI and highlight matches
			this.updateSearchUI();

			// Redisplay subtitles with highlights
			if (this.subtitles.length > 0) {
				this.displaySubtitlesInView();
			}

			// Navigate to first match if any found
			if (this.searchMatches.length > 0) {
				this.currentMatchIndex = 0;
				this.navigateToMatch(0);
			}
		} catch (error) {
			this.logError("Error performing search", error);
		}
	}

	highlightSearchMatches(subtitle, subtitleIndex) {
		try {
			if (!this.searchQuery || this.searchQuery.length === 0) {
				return this.escapeHTML(subtitle);
			}

			const query = this.searchQuery.toLowerCase();
			const subtitleLower = subtitle.toLowerCase();
			let result = "";
			let lastIndex = 0;
			let searchIndex = 0;

			// Find all matches and wrap them in highlight spans
			while ((searchIndex = subtitleLower.indexOf(query, searchIndex)) !== -1) {
				// Add text before match
				result += this.escapeHTML(subtitle.substring(lastIndex, searchIndex));

				// Add highlighted match
				const matchText = subtitle.substring(searchIndex, searchIndex + query.length);
				result += `<mark class="search-match" data-subtitle-index="${subtitleIndex}" data-match-index="${searchIndex}">${this.escapeHTML(
					matchText
				)}</mark>`;

				lastIndex = searchIndex + query.length;
				searchIndex = lastIndex;
			}

			// Add remaining text
			result += this.escapeHTML(subtitle.substring(lastIndex));

			return result;
		} catch (error) {
			this.logError("Error highlighting search matches", error);
			return this.escapeHTML(subtitle);
		}
	}

	navigateToMatch(direction) {
		try {
			if (this.searchMatches.length === 0) return;

			// Calculate new match index
			if (direction === 0) {
				// Jump to specific index (used for initial navigation)
				this.currentMatchIndex = 0;
			} else {
				// Navigate relative to current position
				this.currentMatchIndex += direction;

				// Wrap around
				if (this.currentMatchIndex < 0) {
					this.currentMatchIndex = this.searchMatches.length - 1;
				} else if (this.currentMatchIndex >= this.searchMatches.length) {
					this.currentMatchIndex = 0;
				}
			}

			const match = this.searchMatches[this.currentMatchIndex];
			if (!match) return;

			// Update UI
			this.updateSearchUI();

			// Temporarily disable auto-scroll to active caption during search navigation
			// This prevents the active caption magnetism from interfering with search scrolling
			const wasUserScrolled = this.userScrolled;
			this.userScrolled = true; // Prevent auto-scroll to active caption

			// Scroll to the subtitle item containing this match
			const subtitleItem = document.querySelector(`.subtitle-item[data-index="${match.subtitleIndex}"]`);
			if (subtitleItem) {
				// Remove previous active match highlight
				document.querySelectorAll(".subtitle-item.search-match-active").forEach((el) => {
					el.classList.remove("search-match-active");
				});

				// Add active match highlight
				subtitleItem.classList.add("search-match-active");

				// Scroll to the item
				const subtitlesContent = document.getElementById("subtitles-content");
				if (subtitlesContent) {
					const containerRect = subtitlesContent.getBoundingClientRect();
					const itemRect = subtitleItem.getBoundingClientRect();

					// Calculate scroll position to center the item
					const scrollTop = subtitlesContent.scrollTop + itemRect.top - containerRect.top - containerRect.height / 2 + itemRect.height / 2;

					subtitlesContent.scrollTo({
						top: Math.max(0, scrollTop),
						behavior: "smooth",
					});
				}

				// Note: We intentionally do NOT jump to the timestamp here
				// Video playback should only change when the user explicitly clicks on a caption
				// Search navigation should only scroll and highlight, not change playback
			}

			// Restore userScrolled state after a short delay to allow search scrolling to complete
			setTimeout(() => {
				// Only restore if search is still active, otherwise keep userScrolled as it was
				if (this.searchQuery && this.searchMatches.length > 0) {
					this.userScrolled = true; // Keep disabled during active search
				} else {
					this.userScrolled = wasUserScrolled; // Restore original state
				}
			}, 500);
		} catch (error) {
			this.logError("Error navigating to match", error);
		}
	}

	updateSearchUI() {
		try {
			const searchNavigation = document.getElementById("search-navigation");
			const searchMatchCount = document.getElementById("search-match-count");
			const searchPrevBtn = document.getElementById("search-prev");
			const searchNextBtn = document.getElementById("search-next");

			if (!searchNavigation || !searchMatchCount || !searchPrevBtn || !searchNextBtn) return;

			// Show navigation if there are matches - use setProperty with important to prevent hiding
			if (this.searchMatches.length > 0) {
				searchNavigation.style.setProperty("display", "flex", "important");
				searchNavigation.style.setProperty("visibility", "visible", "important");
				searchNavigation.style.setProperty("opacity", "1", "important");
				const current = this.currentMatchIndex >= 0 ? this.currentMatchIndex + 1 : 0;
				searchMatchCount.textContent = `${current}/${this.searchMatches.length}`;
				searchPrevBtn.disabled = this.searchMatches.length <= 1;
				searchNextBtn.disabled = this.searchMatches.length <= 1;
			} else {
				searchNavigation.style.display = "none";
				searchMatchCount.textContent = "0/0";
				searchPrevBtn.disabled = true;
				searchNextBtn.disabled = true;
			}
		} catch (error) {
			this.logError("Error updating search UI", error);
		}
	}

	clearSearch() {
		try {
			const searchInput = document.getElementById("subtitle-search");
			const searchClearBtn = document.getElementById("search-clear");
			if (searchInput) {
				searchInput.value = "";
			}
			if (searchClearBtn) {
				searchClearBtn.style.display = "none";
			}
			this.searchQuery = "";
			this.searchMatches = [];
			this.currentMatchIndex = -1;
			this.userScrolled = false; // Re-enable auto-scroll to active caption
			this.updateSearchUI();

			// Redisplay subtitles without highlights
			if (this.subtitles.length > 0) {
				this.displaySubtitlesInView();
			}
		} catch (error) {
			this.logError("Error clearing search", error);
		}
	}

	jumpToActiveCaptionAfterClear() {
		try {
			// Wait a moment for the DOM to update, then scroll to active caption (without changing playback)
			setTimeout(() => {
				if (this.currentActiveIndex >= 0) {
					// Only scroll to the active caption in the subtitle list, do NOT change playback
					const subtitleItem = document.querySelector(`.subtitle-item[data-index="${this.currentActiveIndex}"]`);
					if (subtitleItem) {
						const subtitlesContent = document.getElementById("subtitles-content");
						if (subtitlesContent) {
							const containerRect = subtitlesContent.getBoundingClientRect();
							const itemRect = subtitleItem.getBoundingClientRect();

							// Calculate scroll position to center the item
							const scrollTop =
								subtitlesContent.scrollTop + itemRect.top - containerRect.top - containerRect.height / 2 + itemRect.height / 2;

							subtitlesContent.scrollTo({
								top: Math.max(0, scrollTop),
								behavior: "smooth",
							});
						}
					}
				}
			}, 100);
		} catch (error) {
			this.logError("Error jumping to active caption after clear", error);
		}
	}

	setupSummarySearchFunctionality() {
		try {
			const searchInput = document.getElementById("summary-search");
			const searchClearBtn = document.getElementById("summary-search-clear");
			const searchPrevBtn = document.getElementById("summary-search-prev");
			const searchNextBtn = document.getElementById("summary-search-next");

			if (!searchInput || !searchClearBtn || !searchPrevBtn || !searchNextBtn) return;

			// Show/hide clear button based on input
			const updateClearButton = () => {
				if (searchInput.value.length > 0) {
					searchClearBtn.style.display = "flex";
				} else {
					searchClearBtn.style.display = "none";
				}
			};

			// Search input handler
			searchInput.addEventListener("input", (e) => {
				this.summarySearchQuery = e.target.value.trim();

				updateClearButton();

				if (this.summarySearchQuery.length > 0) {
					this.performSummarySearch();
				} else {
					// Search was cleared - just remove highlights, don't change scroll position
					this.clearSummarySearch();
				}
			});

			// Clear button click handler
			searchClearBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				searchInput.value = "";
				this.summarySearchQuery = "";
				updateClearButton();
				this.clearSummarySearch();
			});

			// Keyboard shortcuts for search navigation
			searchInput.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (e.shiftKey) {
						this.navigateToSummaryMatch(-1); // Shift+Enter = previous
					} else {
						this.navigateToSummaryMatch(1); // Enter = next
					}
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					this.navigateToSummaryMatch(-1);
				} else if (e.key === "ArrowDown") {
					e.preventDefault();
					this.navigateToSummaryMatch(1);
				} else if (e.key === "Escape") {
					e.preventDefault();
					searchInput.value = "";
					this.summarySearchQuery = "";
					updateClearButton();
					this.clearSummarySearch();
				}
			});

			// Navigation buttons
			searchPrevBtn.addEventListener("click", () => {
				this.navigateToSummaryMatch(-1);
			});

			searchNextBtn.addEventListener("click", () => {
				this.navigateToSummaryMatch(1);
			});
		} catch (error) {
			this.logError("Error setting up summary search functionality", error);
		}
	}

	performSummarySearch() {
		try {
			this.summarySearchMatches = [];
			this.currentSummaryMatchIndex = -1;

			if (!this.summarySearchQuery || this.summarySearchQuery.length === 0) {
				this.updateSummarySearchUI();
				this.highlightSummaryMatches();
				return;
			}

			const query = this.summarySearchQuery.toLowerCase();
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) return;

			// Helper function to extract plain text from an element, ignoring all HTML formatting
			const getPlainText = (element) => {
				if (!element) return "";
				// Clone to avoid modifying original
				const clone = element.cloneNode(true);
				// Remove all mark elements (existing search highlights) to get clean text
				clone.querySelectorAll("mark").forEach((mark) => {
					const textNode = document.createTextNode(mark.textContent);
					if (mark.parentNode) {
						mark.parentNode.replaceChild(textNode, mark);
					}
				});
				// Return plain text content (this strips all HTML tags)
				return clone.textContent || clone.innerText || "";
			};

			// Get all block-level elements (excluding headers/titles) that contain text
			const allElements = summaryContent.querySelectorAll("li, p, blockquote, code, pre");
			const processedElements = new Set();

			allElements.forEach((element, elementIndex) => {
				// Skip if already processed (to avoid duplicates from nested elements)
				if (processedElements.has(element)) return;

				// Skip header elements (h1-h6) - titles are not searchable
				if (element.tagName && /^H[1-6]$/.test(element.tagName)) return;

				// Get plain text content, ignoring all formatting
				const plainText = getPlainText(element);
				if (!plainText || plainText.trim().length === 0) return;

				const textLower = plainText.toLowerCase();
				let searchIndex = 0;

				// Find all occurrences of the query in this element's plain text
				while ((searchIndex = textLower.indexOf(query, searchIndex)) !== -1) {
					// Find the text node that contains this match
					const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

					let textNode;
					let currentIndex = 0;
					let foundNode = null;
					let targetIndex = searchIndex;

					// Find which text node contains the match
					while ((textNode = walker.nextNode())) {
						const nodeText = textNode.textContent || "";
						const nodeLength = nodeText.length;

						if (targetIndex < currentIndex + nodeLength) {
							foundNode = textNode;
							break;
						}
						currentIndex += nodeLength;
					}

					// If we couldn't find the exact node, use the first text node in the element
					if (!foundNode) {
						const walker2 = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
						foundNode = walker2.nextNode();
					}

					if (foundNode) {
						// Check if the match is within a header element - exclude from count
						let parentElement = foundNode.parentElement;
						let isInHeader = false;
						while (parentElement && parentElement !== summaryContent) {
							if (parentElement.tagName && /^H[1-6]$/.test(parentElement.tagName)) {
								isInHeader = true;
								break;
							}
							parentElement = parentElement.parentElement;
						}

						// Only add to matches if not in a header
						if (!isInHeader) {
							this.summarySearchMatches.push({
								elementIndex: elementIndex,
								node: foundNode,
								matchIndex: searchIndex,
								text: plainText.substring(searchIndex, searchIndex + query.length),
							});
						}
					}

					searchIndex += query.length;
				}

				// Mark this element as processed
				processedElements.add(element);
			});

			this.log(`Found ${this.summarySearchMatches.length} matches in summary for "${this.summarySearchQuery}"`);

			// Update UI and highlight matches
			this.updateSummarySearchUI();
			this.highlightSummaryMatches();

			// Navigate to first match if any found
			if (this.summarySearchMatches.length > 0) {
				this.currentSummaryMatchIndex = 0;
				this.navigateToSummaryMatch(0);
			}
		} catch (error) {
			this.logError("Error performing summary search", error);
		}
	}

	highlightSummaryMatches() {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) return;

			// Remove existing highlights
			summaryContent.querySelectorAll("mark.summary-search-match").forEach((mark) => {
				const parent = mark.parentNode;
				parent.replaceChild(document.createTextNode(mark.textContent), mark);
				parent.normalize();
			});

			if (!this.summarySearchQuery || this.summarySearchQuery.length === 0) {
				return;
			}

			const query = this.summarySearchQuery.toLowerCase();

			// Helper function to extract plain text from an element, ignoring all HTML formatting
			const getPlainText = (element) => {
				if (!element) return "";
				const clone = element.cloneNode(true);
				clone.querySelectorAll("mark").forEach((mark) => {
					const textNode = document.createTextNode(mark.textContent);
					if (mark.parentNode) {
						mark.parentNode.replaceChild(textNode, mark);
					}
				});
				return clone.textContent || clone.innerText || "";
			};

			// Process each element that might contain matches (excluding headers/titles)
			const allElements = summaryContent.querySelectorAll("li, p, blockquote, code, pre");

			// Process elements in reverse to avoid index issues
			Array.from(allElements)
				.reverse()
				.forEach((element) => {
					// Skip header elements (h1-h6) - titles are not searchable
					if (element.tagName && /^H[1-6]$/.test(element.tagName)) return;

					const plainText = getPlainText(element);
					if (!plainText || !plainText.toLowerCase().includes(query)) return;

					// Find all matches in the plain text
					const textLower = plainText.toLowerCase();
					let searchIndex = 0;
					const matches = [];
					while ((searchIndex = textLower.indexOf(query, searchIndex)) !== -1) {
						matches.push({ start: searchIndex, end: searchIndex + query.length });
						searchIndex += query.length;
					}

					// Build a map of text nodes with their offsets
					const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
					let node;
					let currentOffset = 0;
					const textNodes = [];

					while ((node = walker.nextNode())) {
						const nodeText = node.textContent || "";
						const nodeLength = nodeText.length;
						textNodes.push({
							node,
							start: currentOffset,
							end: currentOffset + nodeLength,
							text: nodeText,
						});
						currentOffset += nodeLength;
					}

					// Process matches in reverse order
					matches.reverse().forEach((match) => {
						// Find all text nodes that intersect with this match
						const intersectingNodes = textNodes.filter((tn) => tn.start < match.end && tn.end > match.start);

						if (intersectingNodes.length === 0) return;

						// If match is entirely within one text node
						if (intersectingNodes.length === 1) {
							const tn = intersectingNodes[0];
							const relativeStart = match.start - tn.start;
							const relativeEnd = match.end - tn.start;
							const parent = tn.node.parentNode;
							if (!parent) return;

							const nodeText = tn.text;
							const fragments = [];

							// For headers, ensure no extra whitespace is introduced
							if (element.tagName && /^H[1-6]$/.test(element.tagName)) {
								// Add text before match
								if (relativeStart > 0) {
									const beforeText = nodeText.substring(0, relativeStart);
									fragments.push(document.createTextNode(beforeText));
								}

								// Create mark element with exact match text
								const mark = document.createElement("mark");
								mark.className = "summary-search-match";
								const matchText = nodeText.substring(relativeStart, relativeEnd);
								mark.textContent = matchText;
								fragments.push(mark);

								// Add text after match
								if (relativeEnd < nodeText.length) {
									const afterText = nodeText.substring(relativeEnd);
									fragments.push(document.createTextNode(afterText));
								}

								// Replace the text node
								if (fragments.length > 0) {
									const fragment = document.createDocumentFragment();
									fragments.forEach((f) => fragment.appendChild(f));
									parent.replaceChild(fragment, tn.node);
									// Normalize to remove any extra whitespace nodes
									parent.normalize();
								}
							} else {
								// Add text before match
								if (relativeStart > 0) {
									fragments.push(document.createTextNode(nodeText.substring(0, relativeStart)));
								}

								// Create mark element and preserve formatting by cloning the relevant portion
								const mark = document.createElement("mark");
								mark.className = "summary-search-match";

								// Get the portion of the element that contains this match
								const range = document.createRange();
								range.setStart(tn.node, relativeStart);
								range.setEnd(tn.node, relativeEnd);
								// Clone the contents including formatting for non-headers
								const contents = range.cloneContents();
								mark.appendChild(contents);

								fragments.push(mark);

								// Add text after match
								if (relativeEnd < nodeText.length) {
									fragments.push(document.createTextNode(nodeText.substring(relativeEnd)));
								}

								// Replace the text node
								if (fragments.length > 0) {
									const fragment = document.createDocumentFragment();
									fragments.forEach((f) => fragment.appendChild(f));
									parent.replaceChild(fragment, tn.node);
								}
							}
						} else {
							// Match spans multiple text nodes - need to wrap the entire range
							const firstNode = intersectingNodes[0];
							const lastNode = intersectingNodes[intersectingNodes.length - 1];

							// Create a range that spans the entire match
							const range = document.createRange();
							const firstRelativeStart = match.start - firstNode.start;
							const lastRelativeEnd = match.end - lastNode.start;

							range.setStart(firstNode.node, firstRelativeStart);
							range.setEnd(lastNode.node, lastRelativeEnd);

							// Create mark element and wrap the entire range
							const mark = document.createElement("mark");
							mark.className = "summary-search-match";

							// For headers, manually extract text to avoid whitespace issues
							if (element.tagName && /^H[1-6]$/.test(element.tagName)) {
								// Manually extract text from intersecting nodes to avoid whitespace
								let matchText = "";
								intersectingNodes.forEach((tn, idx) => {
									if (idx === 0) {
										// First node: from relativeStart to end
										matchText += tn.text.substring(firstRelativeStart);
									} else if (idx === intersectingNodes.length - 1) {
										// Last node: from start to lastRelativeEnd
										matchText += tn.text.substring(0, lastRelativeEnd);
									} else {
										// Middle nodes: entire text
										matchText += tn.text;
									}
								});

								mark.textContent = matchText;
								// Replace the range with the mark
								range.deleteContents();
								range.insertNode(mark);
								// Normalize to remove any extra whitespace nodes
								element.normalize();
							} else {
								// Clone the contents including all formatting for non-headers
								const contents = range.cloneContents();
								mark.appendChild(contents);
								// Replace the range with the mark
								range.deleteContents();
								range.insertNode(mark);
							}
						}
					});
				});
		} catch (error) {
			this.logError("Error highlighting summary matches", error);
		}
	}

	navigateToSummaryMatch(direction) {
		try {
			if (this.summarySearchMatches.length === 0) return;

			// Calculate new match index
			if (direction === 0) {
				// Jump to specific index (used for initial navigation)
				this.currentSummaryMatchIndex = 0;
			} else {
				// Navigate relative to current position
				this.currentSummaryMatchIndex += direction;

				// Wrap around
				if (this.currentSummaryMatchIndex < 0) {
					this.currentSummaryMatchIndex = this.summarySearchMatches.length - 1;
				} else if (this.currentSummaryMatchIndex >= this.summarySearchMatches.length) {
					this.currentSummaryMatchIndex = 0;
				}
			}

			const match = this.summarySearchMatches[this.currentSummaryMatchIndex];
			if (!match || !match.node) return;

			// Update UI
			this.updateSummarySearchUI();

			// Remove previous active match highlight
			document.querySelectorAll("mark.summary-search-match-active").forEach((el) => {
				el.classList.remove("summary-search-match-active");
			});

			// Find the mark element for this match
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) return;

			// Get all mark elements
			const marks = summaryContent.querySelectorAll("mark.summary-search-match");
			if (marks.length > this.currentSummaryMatchIndex) {
				const activeMark = marks[this.currentSummaryMatchIndex];
				activeMark.classList.add("summary-search-match-active");

				// Scroll to the mark element
				const containerRect = summaryContent.getBoundingClientRect();
				const markRect = activeMark.getBoundingClientRect();

				// Calculate scroll position to center the mark
				const scrollTop = summaryContent.scrollTop + markRect.top - containerRect.top - containerRect.height / 2 + markRect.height / 2;

				summaryContent.scrollTo({
					top: Math.max(0, scrollTop),
					behavior: "smooth",
				});
			}
		} catch (error) {
			this.logError("Error navigating to summary match", error);
		}
	}

	updateSummarySearchUI() {
		try {
			const searchNavigation = document.getElementById("summary-search-navigation");
			const searchMatchCount = document.getElementById("summary-search-match-count");
			const searchPrevBtn = document.getElementById("summary-search-prev");
			const searchNextBtn = document.getElementById("summary-search-next");

			if (!searchNavigation || !searchMatchCount || !searchPrevBtn || !searchNextBtn) return;

			// Show navigation if there are matches - always use !important to prevent hiding
			if (this.summarySearchMatches.length > 0) {
				searchNavigation.style.setProperty("display", "flex", "important");
				searchNavigation.style.setProperty("visibility", "visible", "important");
				searchNavigation.style.setProperty("opacity", "1", "important");
				const current = this.currentSummaryMatchIndex >= 0 ? this.currentSummaryMatchIndex + 1 : 0;
				searchMatchCount.textContent = `${current}/${this.summarySearchMatches.length}`;
				searchPrevBtn.disabled = this.summarySearchMatches.length <= 1;
				searchNextBtn.disabled = this.summarySearchMatches.length <= 1;
			} else {
				searchNavigation.style.display = "none";
				searchMatchCount.textContent = "0/0";
				searchPrevBtn.disabled = true;
				searchNextBtn.disabled = true;
			}
		} catch (error) {
			this.logError("Error updating summary search UI", error);
		}
	}

	clearSummarySearch() {
		try {
			const searchInput = document.getElementById("summary-search");
			const searchClearBtn = document.getElementById("summary-search-clear");
			if (searchInput) {
				searchInput.value = "";
			}
			if (searchClearBtn) {
				searchClearBtn.style.display = "none";
			}
			this.summarySearchQuery = "";
			this.summarySearchMatches = [];
			this.currentSummaryMatchIndex = -1;
			this.updateSummarySearchUI();

			// Remove highlights but keep scroll position
			this.highlightSummaryMatches();
		} catch (error) {
			this.logError("Error clearing summary search", error);
		}
	}

	setupCopyButtons() {
		try {
			// Copy captions button
			const copyCaptionsBtn = document.getElementById("copy-captions-btn");
			if (copyCaptionsBtn) {
				copyCaptionsBtn.addEventListener("click", () => {
					this.copyCaptions();
				});
			}

			// Copy summary button
			const copySummaryBtn = document.getElementById("copy-summary-btn");
			if (copySummaryBtn) {
				copySummaryBtn.addEventListener("click", () => {
					this.copySummary();
				});
			}
		} catch (error) {
			this.logError("Error setting up copy buttons", error);
		}
	}

	async copyCaptions() {
		try {
			if (!this.subtitles || this.subtitles.length === 0) {
				this.log("No captions to copy");
				return;
			}

			// Get all caption text with timestamps
			const captionsText = this.subtitles
				.map((subtitle, index) => {
					const timing = this.subtitleTimings[index];
					if (timing) {
						const timeStr = this.formatTimestamp(timing.start);
						return `[${timeStr}] ${subtitle}`;
					}
					return subtitle;
				})
				.join("\n");

			// Copy to clipboard
			await navigator.clipboard.writeText(captionsText);

			// Show visual feedback
			const copyBtn = document.getElementById("copy-captions-btn");
			if (copyBtn) {
				const originalHTML = copyBtn.innerHTML;
				copyBtn.innerHTML = `
					<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M20 6L9 17l-5-5"/>
					</svg>
				`;
				copyBtn.style.color = "var(--accent-primary)";
				setTimeout(() => {
					copyBtn.innerHTML = originalHTML;
					copyBtn.style.color = "";
				}, 2000);
			}
		} catch (error) {
			this.logError("Error copying captions", error);
			// Fallback for older browsers
			try {
				const textArea = document.createElement("textarea");
				textArea.value = this.subtitles
					.map((subtitle, index) => {
						const timing = this.subtitleTimings[index];
						if (timing) {
							const timeStr = this.formatTimestamp(timing.start);
							return `[${timeStr}] ${subtitle}`;
						}
						return subtitle;
					})
					.join("\n");
				textArea.style.position = "fixed";
				textArea.style.opacity = "0";
				document.body.appendChild(textArea);
				textArea.select();
				document.execCommand("copy");
				document.body.removeChild(textArea);
			} catch (fallbackError) {
				this.logError("Fallback copy failed", fallbackError);
			}
		}
	}

	async copySummary() {
		try {
			if (!this.summary) {
				this.log("No summary to copy");
				return;
			}

			// Get summary text content (strip HTML tags)
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) {
				this.log("Summary content element not found");
				return;
			}

			// Get text content from the summary, preserving structure
			const summaryText = summaryContent.innerText || summaryContent.textContent || "";

			if (!summaryText.trim()) {
				this.log("Summary text is empty");
				return;
			}

			// Copy to clipboard
			await navigator.clipboard.writeText(summaryText);

			// Show visual feedback
			const copyBtn = document.getElementById("copy-summary-btn");
			if (copyBtn) {
				const originalHTML = copyBtn.innerHTML;
				copyBtn.innerHTML = `
					<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M20 6L9 17l-5-5"/>
					</svg>
				`;
				copyBtn.style.color = "var(--accent-primary)";
				setTimeout(() => {
					copyBtn.innerHTML = originalHTML;
					copyBtn.style.color = "";
				}, 2000);
			}
		} catch (error) {
			this.logError("Error copying summary", error);
			// Fallback for older browsers
			try {
				const summaryContent = document.getElementById("summary-content");
				if (summaryContent) {
					const textArea = document.createElement("textarea");
					textArea.value = summaryContent.innerText || summaryContent.textContent || "";
					textArea.style.position = "fixed";
					textArea.style.opacity = "0";
					document.body.appendChild(textArea);
					textArea.select();
					document.execCommand("copy");
					document.body.removeChild(textArea);
				}
			} catch (fallbackError) {
				this.logError("Fallback copy failed", fallbackError);
			}
		}
	}

	async submitQuery() {
		try {
			// Prevent duplicate submissions
			if (this.querySubmitting) {
				this.log("Query already being submitted, ignoring duplicate request");
				return;
			}

			const queryInput = document.getElementById("summary-query-input");
			const submitBtn = document.getElementById("submit-query-btn");
			const summaryContent = document.getElementById("summary-content");

			if (!queryInput || !submitBtn || !summaryContent) return;

			const query = queryInput.value.trim();
			if (!query) return;

			// Set submitting flag
			this.querySubmitting = true;

			// Show loading state with spinner
			submitBtn.disabled = true;
			submitBtn.innerHTML = `
				<span class="submit-btn-spinner"></span>
			`;
			queryInput.disabled = true;

			// Add question immediately to the view
			this.addQueryToView(query, null, true);

			// Build meta and run chunked question flow over the full captions
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const videoTitle = this.getVideoTitle();
			const keyTimestamps = this.extractKeyTimestamps();
			const subtitlesText = this.subtitles.join(" ");
			const meta = { runId, videoTitle, pageUrl: location.href };

			const finalAnswer = await this.queryInChunks(query, videoTitle, subtitlesText, keyTimestamps, meta);

			// Update the view with the combined answer
			this.addQueryToView(query, finalAnswer, false);

			// Reset button state
			submitBtn.disabled = false;
			submitBtn.innerHTML = `
				<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14 11L12 9M12 9L10 11M12 9V15M21.0039 12C21.0039 16.9706 16.9745 21 12.0039 21C9.9675 21 3.00463 21 3.00463 21C3.00463 21 4.56382 17.2561 3.93982 16.0008C3.34076 14.7956 3.00391 13.4372 3.00391 12C3.00391 7.02944 7.03334 3 12.0039 3C16.9745 3 21.0039 7.02944 21.0039 12Z"/>
				</svg>
			`;
			queryInput.disabled = false;
			queryInput.value = "";

			// Clear any autocomplete suggestions and prevent them from appearing
			queryInput.blur();
			queryInput.focus();
		} catch (error) {
			this.logError("Error submitting query", error);

			// Check for extension context invalidated error
			if (
				error.isContextInvalidated ||
				(error.message && (error.message.includes("Extension context invalidated") || error.message.includes("Extension was reloaded")))
			) {
				this.showError("Extension was reloaded. Please refresh the page and try again.", true);
			} else {
				const summaryContent = document.getElementById("summary-content");
				if (summaryContent) {
					const querySection = summaryContent.querySelector(".query-section:last-child");
					if (querySection) {
						const answerDiv = querySection.querySelector(".query-answer");
						if (answerDiv) {
							answerDiv.innerHTML = `
								<div class="query-error">
									<p>❌ ${this.escapeHTML(error.message || "Failed to process query")}</p>
								</div>
							`;
						}
					}
				}
			}

			// Reset button state on error
			const submitBtn = document.getElementById("submit-query-btn");
			const queryInput = document.getElementById("summary-query-input");
			if (submitBtn) {
				submitBtn.disabled = false;
				submitBtn.innerHTML = `
					<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14 11L12 9M12 9L10 11M12 9V15M21.0039 12C21.0039 16.9706 16.9745 21 12.0039 21C9.9675 21 3.00463 21 3.00463 21C3.00463 21 4.56382 17.2561 3.93982 16.0008C3.34076 14.7956 3.00391 13.4372 3.00391 12C3.00391 7.02944 7.03334 3 12.0039 3C16.9745 3 21.0039 7.02944 21.0039 12Z"/>
					</svg>
				`;
			}
			if (queryInput) {
				queryInput.disabled = false;
				// Clear any autocomplete suggestions and prevent them from appearing
				queryInput.blur();
				queryInput.focus();
			}
		} finally {
			// Always reset the submitting flag
			this.querySubmitting = false;
		}
	}

	// Build a compact, relevant excerpt of subtitles based on the user's query
	buildRelevantSubtitleContext(query, maxChars = 1800) {
		try {
			if (!query || !this.subtitles || this.subtitles.length === 0) return "";
			const q = query.toLowerCase();
			const tokens = Array.from(new Set(q.split(/[^a-z0-9]+/i).filter((t) => t.length >= 4)));
			if (tokens.length === 0) return "";
			const scored = [];
			for (let i = 0; i < this.subtitles.length; i++) {
				const text = (this.subtitles[i] || "").toLowerCase();
				let score = 0;
				for (const t of tokens) {
					if (text.includes(t)) score++;
				}
				if (score > 0) scored.push({ i, score });
			}
			// Sort by score descending, take top slices
			scored.sort((a, b) => b.score - a.score);
			const take = Math.min(25, scored.length);
			let result = "";
			for (let k = 0; k < take && result.length < maxChars; k++) {
				const idx = scored[k].i;
				const start = Math.max(0, idx - 1);
				const end = Math.min(this.subtitles.length - 1, idx + 1);
				for (let j = start; j <= end; j++) {
					const timing = this.subtitleTimings[j];
					const ts = timing ? `[${this.formatTimestamp(timing.start)}]` : "";
					const line = `${ts} ${this.subtitles[j]}`.trim();
					if (result.length + line.length + 1 > maxChars) break;
					result += (result ? "\n" : "") + line;
				}
			}
			return result;
		} catch (e) {
			this.logError("Error building relevant subtitle context", e);
			return "";
		}
	}

	addQueryToView(question, answer, isPending = false, isError = false) {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) return;

			// Check if there's already a pending query section for this question
			const existingPendingSection = summaryContent.querySelector(".query-section:last-child .query-pending");

			if (isPending) {
				// Create new pending section
				const queryHTML = `
					<div class="query-divider"></div>
					<div class="query-section">
						<div class="query-question">
							<div class="query-question-text">${this.escapeHTML(question)}</div>
						</div>
						<div class="query-pending">
							<div class="query-pending-content">
							<div class="query-spinner"></div>
								<p class="query-pending-text">Getting answer<span class="query-pending-counter"></span>...</p>
							</div>
						</div>
					</div>
				`;

				// Add to the end of summary content
				summaryContent.insertAdjacentHTML("beforeend", queryHTML);

				// Scroll to show the question container
				setTimeout(() => {
					const querySection = summaryContent.querySelector(".query-section:last-child");
					if (querySection) {
						const questionElement = querySection.querySelector(".query-question");
						if (questionElement) {
							const containerRect = summaryContent.getBoundingClientRect();
							const questionRect = questionElement.getBoundingClientRect();
							const scrollTop =
								summaryContent.scrollTop +
								questionRect.top -
								containerRect.top -
								containerRect.height / 2 +
								questionRect.height / 2;
							const maxScrollTop = summaryContent.scrollHeight - summaryContent.clientHeight;
							const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
							summaryContent.scrollTo({
								top: finalScrollTop,
								behavior: "smooth",
							});
						}
					}
				}, 100);
			} else {
				// Update existing pending section or create new one
				if (existingPendingSection) {
					// Store reference to query section and question before replacing
					const querySection = existingPendingSection.closest(".query-section");
					const questionElement = querySection ? querySection.querySelector(".query-question") : null;

					if (isError) {
						existingPendingSection.outerHTML = `
							<div class="query-error">
								<p>${this.escapeHTML(answer)}</p>
							</div>
						`;
					} else {
						// Format the answer with proper markdown structure
						const formattedAnswer = this.formatQueryAnswer(answer);
						existingPendingSection.outerHTML = `
							<div class="query-answer">
								<div class="summary-text">
									${formattedAnswer}
								</div>
							</div>
						`;
					}

					// Scroll so the question is at the top of the view
					if (querySection) {
						setTimeout(() => {
							// Re-query to ensure element still exists after DOM update
							const updatedQuerySection = summaryContent.querySelector(".query-section:last-child");
							const updatedQuestionElement = updatedQuerySection ? updatedQuerySection.querySelector(".query-question") : null;
							if (updatedQuestionElement) {
								const containerRect = summaryContent.getBoundingClientRect();
								const questionRect = updatedQuestionElement.getBoundingClientRect();
								// Calculate scroll position to put question at the top
								const scrollTop = summaryContent.scrollTop + questionRect.top - containerRect.top;
								const maxScrollTop = summaryContent.scrollHeight - summaryContent.clientHeight;
								const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
								summaryContent.scrollTo({
									top: finalScrollTop,
									behavior: "smooth",
								});
							}
						}, 100);
					}
				} else {
					// Create new section if no pending section exists
					const queryHTML = `
						<div class="query-divider"></div>
						<div class="query-section">
							<div class="query-question">
								<div class="query-question-text">${this.escapeHTML(question)}</div>
							</div>
							${
								isError
									? `<div class="query-error"><p>${this.escapeHTML(answer)}</p></div>`
									: `<div class="query-answer">
									<div class="summary-text">${this.formatQueryAnswer(answer)}</div>
								</div>`
							}
						</div>
					`;
					summaryContent.insertAdjacentHTML("beforeend", queryHTML);

					// Scroll so the question is at the top of the view
					setTimeout(() => {
						const querySection = summaryContent.querySelector(".query-section:last-child");
						if (querySection && querySection.querySelector(".query-question")) {
							const questionElement = querySection.querySelector(".query-question");
							const containerRect = summaryContent.getBoundingClientRect();
							const questionRect = questionElement.getBoundingClientRect();
							// Calculate scroll position to put question at the top
							const scrollTop = summaryContent.scrollTop + questionRect.top - containerRect.top;
							const maxScrollTop = summaryContent.scrollHeight - summaryContent.clientHeight;
							const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
							summaryContent.scrollTo({
								top: finalScrollTop,
								behavior: "smooth",
							});
						}
					}, 100);
				}
			}
		} catch (error) {
			this.logError("Error adding query to view", error);
		}
	}

	formatQueryAnswer(answer) {
		try {
			// Clean up malformed input first
			// Remove standalone asterisks
			answer = answer.replace(/^\*\s*$/gm, "");

			// Fix headers wrapped in asterisks: * **Header** * -> ## Header
			answer = answer.replace(/^\*\s*\*\*(.+?)\*\*\s*\*$/gm, "## $1");

			// Fix headers with asterisks: * **Header** -> ## Header
			answer = answer.replace(/^\*\s*\*\*(.+?)\*\*\s*$/gm, "## $1");

			// Use the same formatting logic as formatSummaryContent for consistency
			// Split into lines for processing
			const lines = answer.split("\n");
			let formatted = "";
			let inList = false;

			for (let i = 0; i < lines.length; i++) {
				let line = lines[i].trim();

				// Skip empty lines
				if (!line) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					continue;
				}

				// Convert headers (supporting ##, ###, ####, #####)
				if (line.match(/^##\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^##\s+(.+)$/, "<h1>$1</h1>") + "\n";
				} else if (line.match(/^###\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^###\s+(.+)$/, "<h2>$1</h2>") + "\n";
				} else if (line.match(/^####\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^####\s+(.+)$/, "<h3>$1</h3>") + "\n";
				} else if (line.match(/^#####\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^#####\s+(.+)$/, "<h4>$1</h4>") + "\n";
				} else if (line.match(/^[•\-\*]\s+(.+)$/) || line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
					// Bullet point - convert to <li>
					if (!inList) {
						formatted += "<ul>\n";
						inList = true;
					}
					// Remove bullet character and any leading whitespace
					let bulletContent = line.replace(/^[•\-\*]\s*/, "").trim();

					// Handle timestamps at the start: "0:00 content" -> "content [0:00]"
					// Match patterns like "0:00", "0:36", "1:06", "2:04", "3:18", "6:01", "1:23:45", etc.
					// Only process if timestamp is not already in brackets
					if (!bulletContent.match(/\[.*\]/)) {
						const timestampMatch = bulletContent.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
						if (timestampMatch) {
							const timestamp = timestampMatch[1];
							const content = timestampMatch[2];
							// Format timestamp as [MM:SS] or [HH:MM:SS]
							bulletContent = `${content} [${timestamp}]`;
						}
					}

					formatted += `<li>${bulletContent}</li>\n`;
				} else {
					// Regular paragraph
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += `<p>${line}</p>\n`;
				}
			}

			// Close any open list
			if (inList) {
				formatted += "</ul>\n";
			}

			// Convert **bold text** to <strong>
			formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
			// Convert *italic text* to <em> (but not bullet points)
			formatted = formatted.replace(/(?<!^[•\-\*]\s)\*(.+?)\*/g, "<em>$1</em>");

			// If no headers were found, treat the first line as a main header
			if (!formatted.includes("<h1>") && !formatted.includes("<h2>") && !formatted.includes("<h3>") && !formatted.includes("<h4>")) {
				const lines = answer.split("\n");
				if (lines.length > 0) {
					const firstLine = lines[0].trim();
					const remainingContent = lines.slice(1).join("\n").trim();

					formatted = `<h1>${firstLine}</h1>`;
					if (remainingContent) {
						formatted += `<p>${remainingContent}</p>`;
					}
				}
			}

			// Convert timestamps to clickable elements
			formatted = this.convertTimestampsToClickable(formatted);

			// Remove [N/A] tags and any messages about missing timestamps
			formatted = formatted.replace(/\[N\/A\]\s*/gi, "");
			formatted = formatted.replace(/\(\s*Not mentioned in the available timestamps\.?\s*\)/gi, "");
			formatted = formatted.replace(/\(\s*no direct timestamp.*?\)/gi, "");
			formatted = formatted.replace(/\(\s*no timestamp.*?\)/gi, "");
			formatted = formatted.replace(/\(\s*timestamp.*?not available.*?\)/gi, "");
			formatted = formatted.replace(/\(\s*timestamp.*?not found.*?\)/gi, "");
			formatted = formatted.replace(/no direct timestamp.*?available/gi, "");
			formatted = formatted.replace(/no timestamp.*?available/gi, "");
			formatted = formatted.replace(/timestamp.*?not available/gi, "");
			formatted = formatted.replace(/timestamp.*?not found/gi, "");
			// Remove standalone phrases about missing timestamps
			formatted = formatted.replace(/,\s*no direct timestamp.*?\./gi, ".");
			formatted = formatted.replace(/,\s*no timestamp.*?\./gi, ".");
			formatted = formatted.replace(/\.\s*No direct timestamp.*?\./gi, ".");
			formatted = formatted.replace(/\.\s*No timestamp.*?\./gi, ".");

			// Sanitize to avoid XSS
			formatted = this.sanitizeHTML(formatted);

			// Setup click listeners for the new timestamp buttons and summary bullets
			setTimeout(() => {
				this.setupTimestampClickListeners();
				this.setupSummaryBulletClickListeners();
			}, 100);

			return formatted;
		} catch (error) {
			this.logError("Error formatting query answer", error);
			return `<p>${this.escapeHTML(answer)}</p>`;
		}
	}

	// Extract key timestamps from subtitles for AI reference
	extractKeyTimestamps() {
		try {
			const keyTimestamps = [];
			const totalSubtitles = this.subtitles.length;

			// Use all available subtitles with their timestamps
			// Limit to a reasonable number to avoid overwhelming the AI
			const maxTimestamps = 20; // Limit to 20 timestamps to keep prompt manageable
			const step = Math.max(1, Math.floor(totalSubtitles / maxTimestamps));

			for (let i = 0; i < totalSubtitles; i += step) {
				if (this.subtitleTimings[i]) {
					const timing = this.subtitleTimings[i];
					const formattedTime = this.formatTimestamp(timing.start);
					keyTimestamps.push({
						time: timing.start,
						formatted: formattedTime,
						content: this.subtitles[i] || "",
					});
				}

				// Stop if we've reached the limit
				if (keyTimestamps.length >= maxTimestamps) {
					break;
				}
			}

			// Always include the first and last timestamps if they're not already included
			if (totalSubtitles > 0) {
				// Add first timestamp if not already included
				if (this.subtitleTimings[0] && !keyTimestamps.some((ts) => ts.time === this.subtitleTimings[0].start)) {
					keyTimestamps.unshift({
						time: this.subtitleTimings[0].start,
						formatted: this.formatTimestamp(this.subtitleTimings[0].start),
						content: this.subtitles[0] || "",
					});
				}

				// Add last timestamp if not already included
				const lastIndex = totalSubtitles - 1;
				if (this.subtitleTimings[lastIndex] && !keyTimestamps.some((ts) => ts.time === this.subtitleTimings[lastIndex].start)) {
					keyTimestamps.push({
						time: this.subtitleTimings[lastIndex].start,
						formatted: this.formatTimestamp(this.subtitleTimings[lastIndex].start),
						content: this.subtitles[lastIndex] || "",
					});
				}
			}

			this.log(`Extracted ${keyTimestamps.length} timestamps from ${totalSubtitles} subtitles`);
			return keyTimestamps;
		} catch (error) {
			this.logError("Error extracting key timestamps", error);
			return [];
		}
	}

	// Convert timestamps in text to clickable elements
	convertTimestampsToClickable(text) {
		try {
			// First, handle multiple timestamps in format [21:54, 24:34]
			// Match patterns like [MM:SS, MM:SS] or [HH:MM:SS, HH:MM:SS] - must have at least one comma
			const multipleTimestampRegex = /\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:,\s*(?:\d{1,2}:)?\d{1,2}:\d{2})+)\]/g;
			text = text.replace(multipleTimestampRegex, (match, timestampsStr) => {
				const timestamps = timestampsStr.split(",").map((ts) => ts.trim());
				const timestampSeconds = [];
				const formattedTimestamps = [];

				for (const timestamp of timestamps) {
					const parts = timestamp.split(":").map((p) => parseInt(p, 10));
					let totalSeconds = 0;
					if (parts.length === 2) {
						const [m, s] = parts;
						totalSeconds = m * 60 + s;
					} else if (parts.length === 3) {
						const [h, m, s] = parts;
						totalSeconds = h * 3600 + m * 60 + s;
					}

					if (this.videoElement && Number.isFinite(this.videoElement.duration) && totalSeconds > this.videoElement.duration) {
						continue;
					}

					timestampSeconds.push(totalSeconds);
					formattedTimestamps.push(this.formatTimestamp(totalSeconds));
				}

				if (timestampSeconds.length === 0) {
					return match;
				}

				// Sort timestamps chronologically
				const sortedPairs = timestampSeconds
					.map((seconds, index) => ({
						seconds,
						formatted: formattedTimestamps[index],
					}))
					.sort((a, b) => a.seconds - b.seconds);

				// Store all timestamps as a data attribute on a wrapper
				const timestampsData = sortedPairs.map((p) => p.seconds).join(",");

				// Create separate clickable elements for each timestamp, wrapped in a container
				const timestampElements = sortedPairs
					.map((p) => `<span class="clickable-timestamp" data-time="${p.seconds}">${this.escapeHTML(p.formatted)}</span>`)
					.join(", ");

				return `<span class="multiple-timestamps-wrapper" data-timestamps="${timestampsData}">${timestampElements}</span>`;
			});

			// Then handle single timestamps [MM:SS] or [HH:MM:SS]
			// Only match if not already inside a clickable-timestamp span (which would have been created above)
			const timestampRegex = /\[(\d{1,2}:)?(\d{1,2}):(\d{2})\]/g;
			return text.replace(timestampRegex, (match) => {
				// Skip if this is already inside a clickable-timestamp span (from multiple timestamps)
				// We can check this by seeing if the match is part of already processed content
				// Since we process multiple timestamps first, any remaining single timestamps are safe to process

				const clean = match.replace(/[\[\]]/g, "");
				const parts = clean.split(":").map((p) => parseInt(p, 10));
				let totalSeconds = 0;
				if (parts.length === 2) {
					const [m, s] = parts;
					totalSeconds = m * 60 + s;
				} else if (parts.length === 3) {
					const [h, m, s] = parts;
					totalSeconds = h * 3600 + m * 60 + s;
				}
				if (this.videoElement && Number.isFinite(this.videoElement.duration) && totalSeconds > this.videoElement.duration) {
					return match;
				}
				const formattedTime = this.formatTimestamp(totalSeconds);
				return `<span class="clickable-timestamp" data-time="${totalSeconds}">${this.escapeHTML(formattedTime)}</span>`;
			});
		} catch (error) {
			this.logError("Error converting timestamps to clickable", error);
			return this.escapeHTML(text);
		}
	}

	// Minimal allowlist sanitizer to reduce XSS risk from model output
	sanitizeHTML(dirtyHtml) {
		try {
			if (typeof dirtyHtml !== "string") {
				return "";
			}
			const allowedTags = new Set(["p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "blockquote", "code", "pre", "span"]);
			const template = document.createElement("template");
			template.innerHTML = dirtyHtml;
			const walk = (node) => {
				Array.from(node.childNodes).forEach((child) => {
					if (child.nodeType === Node.ELEMENT_NODE) {
						const tag = child.tagName.toLowerCase();
						if (!allowedTags.has(tag)) {
							child.replaceWith(...Array.from(child.childNodes));
						} else {
							// Allow class, data-time, and data-timestamps on span elements
							Array.from(child.attributes).forEach((attr) => {
								const name = attr.name.toLowerCase();
								const value = attr.value;
								const isClickableSpan =
									tag === "span" &&
									name === "class" &&
									(value === "clickable-timestamp" || value === "multiple-timestamps-wrapper");
								const isDataTime = tag === "span" && name === "data-time" && /^\d+$/.test(value);
								const isDataTimestamps = tag === "span" && name === "data-timestamps" && /^[\d,]+$/.test(value);
								if (!isClickableSpan && !isDataTime && !isDataTimestamps) {
									child.removeAttribute(name);
								}
							});
						}
					}
					if (child.childNodes && child.childNodes.length) walk(child);
				});
			};
			walk(template.content);
			return template.innerHTML;
		} catch (e) {
			// On error, escape the HTML instead of returning unsanitized content
			this.logError("Error sanitizing HTML, falling back to escaping", e);
			return this.escapeHTML(dirtyHtml);
		}
	}

	// Setup click listeners for timestamp buttons
	setupTimestampClickListeners() {
		try {
			const timestampButtons = document.querySelectorAll(".clickable-timestamp");
			timestampButtons.forEach((button) => {
				// Remove existing listeners to prevent duplicates
				button.removeEventListener("click", this.handleTimestampClick);
				// Add new listener
				button.addEventListener("click", this.handleTimestampClick.bind(this));
			});
		} catch (error) {
			this.logError("Error setting up timestamp click listeners", error);
		}
	}

	// Handle timestamp button clicks
	handleTimestampClick(event) {
		try {
			const timestamp = event.target.closest(".clickable-timestamp");
			if (!timestamp) return;

			// Stop propagation to prevent bullet click handler from running
			event.stopPropagation();

			const timeInSeconds = parseInt(timestamp.getAttribute("data-time"));

			if (!isNaN(timeInSeconds)) {
				// If this timestamp is inside a summary bullet, add active class
				const bullet = timestamp.closest(".summary-text li");
				if (bullet) {
					// Remove active class from all bullets
					document.querySelectorAll(".summary-text li").forEach((li) => {
						li.classList.remove("summary-bullet-active");
					});
					bullet.classList.add("summary-bullet-active");
				}

				this.log(`Timestamp clicked: ${timeInSeconds} seconds`);
				this.jumpToTimestamp(timeInSeconds);
			}
		} catch (error) {
			this.logError("Error handling timestamp click", error);
		}
	}

	insertContainerInCorrectPosition(container) {
		try {
			// Strategy 1: Insert at the beginning of the secondary-inner container (above suggested videos)
			const secondaryInner = document.querySelector("#secondary-inner");
			if (secondaryInner) {
				secondaryInner.insertBefore(container, secondaryInner.firstChild);
				return;
			}

			// Strategy 2: Insert before the ytd-watch-next-secondary-results-renderer (suggested videos component)
			const watchNextResults = document.querySelector("ytd-watch-next-secondary-results-renderer");
			if (watchNextResults) {
				watchNextResults.parentNode.insertBefore(container, watchNextResults);
				return;
			}

			// Strategy 3: Insert before the secondary column (suggested videos)
			const secondaryColumn = document.querySelector("#secondary");
			if (secondaryColumn) {
				secondaryColumn.parentNode.insertBefore(container, secondaryColumn);
				return;
			}

			// Strategy 4: Insert before the related videos section
			const relatedVideos = document.querySelector("#related");
			if (relatedVideos) {
				relatedVideos.parentNode.insertBefore(container, relatedVideos);
				return;
			}

			// Strategy 5: Insert in the main content area if all else fails
			const mainContent = document.querySelector("#primary");
			if (mainContent) {
				mainContent.appendChild(container);
				return;
			}

			// Fallback: append to body
			document.body.appendChild(container);
		} catch (error) {
			this.logError("Error inserting container", error);
			// Fallback: append to body
			document.body.appendChild(container);
		}
	}

	findInsertionPoint() {
		try {
			// Try to find the secondary column (suggested videos)
			const secondaryColumn = document.querySelector("#secondary");
			if (secondaryColumn) {
				return secondaryColumn;
			}

			// Fallback: look for the related videos section
			const relatedVideos = document.querySelector("#related");
			if (relatedVideos) {
				return relatedVideos;
			}

			// Another fallback: look for the sidebar
			const sidebar = document.querySelector("#secondary-inner");
			if (sidebar) {
				return sidebar;
			}

			return null;
		} catch (error) {
			this.logError("Error finding insertion point", error);
			return null;
		}
	}

	updateSubtitlesDisplay() {
		try {
			const subtitleCount = document.getElementById("subtitle-count");
			if (subtitleCount) {
				subtitleCount.textContent = this.subtitles.length;
			}
		} catch (error) {
			this.logError("Error updating subtitle display", error);
		}
	}

	displaySubtitlesInView() {
		try {
			const subtitlesContent = document.getElementById("subtitles-content");
			if (subtitlesContent && this.subtitles.length > 0) {
				// Remove any existing subtitles list to prevent duplicates
				const existingList = subtitlesContent.querySelector(".subtitles-list");
				if (existingList) {
					existingList.remove();
				}

				// Show all subtitles with timestamps, highlighting search matches if any
				const subtitlesText = this.subtitles
					.map((subtitle, index) => {
						const timing = this.subtitleTimings[index] || { start: 0, end: 0 };
						const startTime = this.formatTimestamp(timing.start);
						// Highlight search matches in subtitle text
						const highlightedText = this.highlightSearchMatches(subtitle, index);
						return `<div class="subtitle-item" data-index="${index}" data-start-time="${timing.start}">
							<span class="clickable-timestamp caption-timestamp" data-time="${timing.start}">${this.escapeHTML(startTime)}</span>
							<span class="subtitle-text">${highlightedText}</span>
						</div>`;
					})
					.join("");

				// Preserve the subtitles-info div and add the subtitles list after it
				const subtitlesInfo = subtitlesContent.querySelector("#subtitles-info");
				const subtitlesInfoHTML = subtitlesInfo ? subtitlesInfo.outerHTML : "";

				// Create the subtitles list element
				const subtitlesList = document.createElement("div");
				subtitlesList.className = "subtitles-list";
				subtitlesList.innerHTML = subtitlesText;

				// Clear and rebuild content to ensure no duplicates
				subtitlesContent.innerHTML = subtitlesInfoHTML;
				subtitlesContent.appendChild(subtitlesList);

				// Update the subtitle count
				this.updateSubtitlesDisplay();

				// Ensure scroll tracking is set up (in case it was lost during rebuild)
				// Note: Event delegation means listeners on the container should still work,
				// but we ensure it's set up just in case
				this.setupScrollTracking();

				// Ensure video playback tracking is set up (it might not be ready yet)
				// This ensures we have the video element reference
				if (!this.videoElement) {
					this.setupVideoPlaybackTracking();
				}

				// Reset active index to force recalculation after DOM rebuild
				// This ensures highlighting is reapplied even if video position hasn't changed
				this.currentActiveIndex = -1;

				// Set up click listeners for caption timestamps (they use clickable-timestamp class)
				setTimeout(() => {
					this.setupTimestampClickListeners();
				}, 100);

				// Immediately update active caption when subtitles are displayed
				// Use a slightly longer delay to ensure DOM and video element are fully ready
				setTimeout(() => {
					// Refresh video element reference in case it wasn't available before
					if (!this.videoElement) {
						this.videoElement = document.querySelector("video");
					}
					this.updateActiveCaption();
				}, 250);

				// Automatically generate summary if not already generated and subtitles are properly loaded
				if (!this.autoSummaryGenerated && this.validateSubtitlesForSummary()) {
					this.autoSummaryGenerated = true;
					this.log(`Subtitles validated (${this.subtitles.length} subtitles), automatically generating summary...`);

					// Add a longer delay to ensure everything is properly loaded
					setTimeout(() => {
						this.generateSummary();
					}, CONSTANTS.INITIAL_RETRY_DELAY_MS * 2);
				} else if (!this.autoSummaryGenerated) {
					this.log("Subtitles not ready for auto-summary generation, will retry...");
					// Retry subtitle extraction if not enough subtitles
					if (this.subtitles.length < CONSTANTS.MIN_SUBTITLES_FOR_SUMMARY) {
						setTimeout(() => {
							this.setupSubtitlesExtraction();
						}, CONSTANTS.INITIAL_RETRY_DELAY_MS);
					}
				}
			}
		} catch (error) {
			this.logError("Error displaying subtitles in view", error);
		}
	}

	async generateSummary(force = false) {
		try {
			this.log("Starting summary generation...");

			// Check if extension is properly initialized
			if (!this.initializationComplete) {
				this.log("Extension not fully initialized, attempting to reinitialize...");
				this.setupImmediate();
				await new Promise((resolve) => setTimeout(resolve, CONSTANTS.INITIAL_RETRY_DELAY_MS));
			}

			if (this.isProcessing) {
				this.log("Already processing, skipping...");
				return;
			}

			if (this.subtitles.length === 0) {
				this.log("No subtitles available, showing error...");
				this.showError("No subtitles found. The extension will try to enable auto-generated captions, but this video may not have any captions available.");
				// Try to extract subtitles again
				setTimeout(() => {
					this.setupSubtitlesExtraction();
				}, CONSTANTS.INITIAL_RETRY_DELAY_MS);
				return;
			}

			// Additional check to ensure subtitles are for the current video
			if (!this.subtitlesExtractionStartTime && !force) {
				this.log("No subtitle extraction start time, skipping summary generation");
				return;
			}

			if (this.subtitlesExtractionStartTime) {
				const timeSinceExtraction = Date.now() - this.subtitlesExtractionStartTime;
				if (timeSinceExtraction > CONSTANTS.SUBTITLE_EXTRACTION_TIMEOUT_MS && !force) {
					this.log("Subtitles are too old, skipping summary generation");
					return;
				}
			}

			// Reset any previous progress indicator
			this.generationProgress = null;
			this.isProcessing = true;
			this.updateGenerateButton(true);

			const subtitlesText = this.subtitles.join(" ");
			const videoTitle = this.getVideoTitle();
			const keyTimestamps = this.extractKeyTimestamps();
			// Add meta for diagnostics and correlation
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const meta = {
				runId,
				videoTitle,
				totalSubtitles: this.subtitles.length,
				totalTimings: this.subtitleTimings.length,
				pageUrl: location.href,
			};

			this.log(`Sending summary request with ${this.subtitles.length} subtitles and title: ${videoTitle}`);
			this.log("Key timestamps available:", keyTimestamps);

			// Chunk if too large
			if (subtitlesText.length > CONSTANTS.MAX_CHARS_FOR_SINGLE_REQUEST) {
				this.log("Subtitles are large, using chunked summarization...");
				try {
					this.summary = await this.summarizeInChunks(subtitlesText, videoTitle, keyTimestamps);
					this.displaySummary();
					this.switchTab("summary");
					return;
				} catch (e) {
					this.logError("Chunked summarization failed", e);
					// Check for extension context invalidated error
					if (
						e.isContextInvalidated ||
						(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
					) {
						this.showError("Extension was reloaded. Please refresh the page and try again.", true);
					} else {
						this.showError(e.message || "Failed to generate summary");
					}
					return;
				}
			}

			// Simple path with retries
			let lastError = null;
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					const response = await this.sendMessageToBackground({
						action: "summarize",
						subtitles: subtitlesText,
						videoTitle,
						keyTimestamps,
						meta,
					});
					if (response && response.success) {
						this.summary = response.summary;
						this.displaySummary();
						this.switchTab("summary");
						return;
					}
					lastError = response ? response.error : "No response from background script";
				} catch (error) {
					// If it's an extension context invalidated error, show message and return early
					if (
						error.isContextInvalidated ||
						(error.message && (error.message.includes("Extension context invalidated") || error.message.includes("Extension was reloaded")))
					) {
						this.showError(error.message || "Extension was reloaded. Please refresh the page and try again.", true);
						return;
					}
					lastError = error.message || "Unknown error";
				}
				if (attempt < 3) await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
			}
			this.showError(lastError || "Failed to generate summary after multiple attempts");
		} catch (error) {
			this.logError("Error generating summary", error);
			this.log("Error details:", {
				message: error.message,
				stack: error.stack,
				subtitlesLength: this.subtitles.length,
				initializationComplete: this.initializationComplete,
				isProcessing: this.isProcessing,
			});
			this.showError("Failed to generate summary. Please try again later.");
		} finally {
			this.isProcessing = false;
			// Ensure progress is cleared after completion or failure
			this.generationProgress = null;
			this.updateGenerateButton(false);
		}
	}

	// Calculate video duration from subtitle timings
	getVideoDuration() {
		try {
			// Try to get duration from video element first
			if (this.videoElement && Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0) {
				return this.videoElement.duration;
			}
			// Fallback to last subtitle timing
			if (this.subtitleTimings && this.subtitleTimings.length > 0) {
				const lastTiming = this.subtitleTimings[this.subtitleTimings.length - 1];
				if (lastTiming && lastTiming.end) {
					return lastTiming.end;
				}
				if (lastTiming && lastTiming.start) {
					// Estimate: assume last subtitle is ~5 seconds long
					return lastTiming.start + 5;
				}
			}
			return null;
		} catch (error) {
			this.logError("Error calculating video duration", error);
			return null;
		}
	}

	// Calculate chunk duration based on subtitle indices
	getChunkDuration(indices) {
		try {
			if (!indices || indices.length === 0 || !this.subtitleTimings || this.subtitleTimings.length === 0) {
				return null;
			}
			const firstIndex = indices[0];
			const lastIndex = indices[indices.length - 1];
			const firstTiming = this.subtitleTimings[firstIndex];
			const lastTiming = this.subtitleTimings[lastIndex];
			if (!firstTiming || !lastTiming) return null;
			// Use end time if available, otherwise estimate
			const startTime = firstTiming.start || 0;
			const endTime = lastTiming.end || lastTiming.start || startTime;
			return Math.max(0, endTime - startTime);
		} catch (error) {
			this.logError("Error calculating chunk duration", error);
			return null;
		}
	}

	// Calculate token budget for a chunk based on proportional duration
	calculateTokenBudget(chunkDuration, totalDuration, totalChunks, estimatedMaxTokens = 4000) {
		try {
			if (!chunkDuration || !totalDuration || totalDuration <= 0) {
				// Fallback: equal distribution
				return Math.floor(estimatedMaxTokens / totalChunks);
			}
			// Calculate proportion of video this chunk represents
			const proportion = chunkDuration / totalDuration;
			// Allocate tokens proportionally, with a minimum to ensure coverage
			const proportionalTokens = Math.floor(estimatedMaxTokens * proportion);
			const minTokens = Math.floor(estimatedMaxTokens / totalChunks);
			return Math.max(minTokens, proportionalTokens);
		} catch (error) {
			this.logError("Error calculating token budget", error);
			return Math.floor(estimatedMaxTokens / totalChunks);
		}
	}

	// Split subtitles into chunks, summarize each, then combine
	async summarizeInChunks(subtitlesText, videoTitle, keyTimestamps) {
		const CHUNK_SIZE = CONSTANTS.CHUNK_SIZE;
		const INTER_CHUNK_DELAY_MS = CONSTANTS.INTER_CHUNK_DELAY_MS;
		const MAX_RETRIES_PER_CHUNK = CONSTANTS.MAX_RETRIES_PER_CHUNK;
		// Build chunks aligned to subtitle boundaries to preserve timestamps
		const chunks = [];
		let buffer = "";
		let currentIndices = [];
		for (let i = 0; i < this.subtitles.length; i++) {
			const add = (this.subtitles[i] || "") + " ";
			if (buffer.length + add.length > CHUNK_SIZE && currentIndices.length > 0) {
				chunks.push({ text: buffer.trim(), indices: currentIndices.slice() });
				buffer = "";
				currentIndices = [];
			}
			buffer += add;
			currentIndices.push(i);
		}
		if (currentIndices.length > 0) {
			chunks.push({ text: buffer.trim(), indices: currentIndices.slice() });
		}

		// Calculate video duration and token budgets
		const totalDuration = this.getVideoDuration();
		const totalChunks = chunks.length;
		const estimatedMaxTokens = 4000; // Conservative estimate for response tokens
		const chunkSummaries = [];
		// Initialize progress; total is number of chunks
		this.generationProgress = { current: 0, total: chunks.length };
		this.updateGenerateButton(true);

		// Process chunks in parallel with concurrency limit for better performance
		const MAX_CONCURRENT = CONSTANTS.MAX_CONCURRENT_CHUNKS || 3;
		const processChunk = async (chunkIndex) => {
			const chunk = chunks[chunkIndex];
			const timestampReference = this.buildTimestampReferenceForIndices(chunk.indices, 20);
			const isFirstChunk = chunkIndex === 0;
			const isLastChunk = chunkIndex === chunks.length - 1;
			const chunkPosition = isFirstChunk ? "beginning" : isLastChunk ? "end" : "middle";

			// Calculate token budget for this chunk
			const chunkDuration = this.getChunkDuration(chunk.indices);
			const tokenBudget = this.calculateTokenBudget(chunkDuration, totalDuration, totalChunks, estimatedMaxTokens);
			const chunkProportion = totalDuration && chunkDuration ? ((chunkDuration / totalDuration) * 100).toFixed(1) : (100 / totalChunks).toFixed(1);

			const prompt = `You will receive chunk ${chunkIndex + 1} of ${
				chunks.length
			} from the YouTube video titled "${videoTitle}". This chunk represents the ${chunkPosition} portion of the video${
				totalDuration && chunkDuration ? ` (approximately ${chunkProportion}% of the video)` : ""
			}.

TOKEN BUDGET ALLOCATION:
- This chunk represents ${chunkProportion}% of the total video
- You have approximately ${tokenBudget} tokens allocated for your response
- Use your token budget PROPORTIONALLY - do not exceed this allocation
- Keep your summary CONCISE and focused on the KEY information from this chunk
- Ensure EVEN coverage within this chunk - don't spend all tokens on the start

IMPORTANT: This is ONE PART of a longer video that will be combined with other chunks. Your summary will be merged with summaries from other parts of the video. Therefore:
- Keep your summary CONCISE and focused on the KEY information from this chunk
- Do NOT over-detail early content - save detail for important points throughout
- Ensure you cover the content in this chunk EVENLY - don't spend all your detail on the start of this chunk
- If this is the final chunk (${isLastChunk ? "YES" : "NO"}), make sure to include ALL important content from the end of the video
- If this is the first chunk (${isFirstChunk ? "YES" : "NO"}), be concise so later chunks have room for detail
- RESPECT YOUR TOKEN BUDGET: This chunk is ${chunkProportion}% of the video - use approximately ${chunkProportion}% of your available detail/tokens

Chunk content:
${chunk.text}

Available timestamps from this chunk (use only these when referencing moments):
${timestampReference}

CRITICAL FORMATTING REQUIREMENT:
- START YOUR RESPONSE DIRECTLY WITH THE FIRST SECTION HEADER (##)
- DO NOT include any introductory text, explanations, or meta-commentary before the summary
- DO NOT write phrases like "Here's a summary" or "Okay, here's..." or any similar introductory text
- Begin immediately with the markdown structure

Create a summary with:
- Logical section headers (##) that describe the content in this chunk - add relevant emojis to headers (e.g., 📝, 💡, 🎯, ⚠️, ✅, 🔑)
- Bullet points summarizing the key information in each section
- EVERY bullet point MUST include a timestamp in [MM:SS] or [HH:MM:SS] format
- Match each bullet point to the most relevant timestamp from the list above
- Include as many bullets per section as needed based on content density, but keep them concise
- Use **bold text** EXTENSIVELY - bold at least 2-4 key words or phrases in EVERY bullet point for better readability
- Bold important terms, concepts, numbers, statistics, names, features, and key information

CRITICAL: 
- Every bullet point must have a timestamp. Use only timestamps listed above. Do not make up timestamps.
- Aim for 30-50% of each bullet point to be bolded for optimal readability.
- Keep summaries concise and evenly detailed - this chunk will be combined with others, so don't over-detail early content.
- Ensure you cover ALL important content from this chunk, especially if this is the final chunk.`;

			let attempt = 0;
			let success = false;
			let lastError = null;
			while (attempt < MAX_RETRIES_PER_CHUNK && !success) {
				try {
					const res = await this.sendMessageToBackground({
						action: "summarize",
						customPrompt: prompt,
						meta: { ...meta, phase: "chunk", index: chunkIndex + 1, total: chunks.length },
					});
					if (!res || !res.success) throw new Error(res?.error || "Failed to summarize chunk");

					// Store result at correct index to maintain order
					chunkSummaries[chunkIndex] = res.summary;

					// Update progress
					const completed = chunkSummaries.filter((s) => s !== undefined).length;
					this.generationProgress = { current: completed, total: chunks.length };
					this.updateGenerateButton(true);

					success = true;
				} catch (e) {
					// If extension context invalidated, throw immediately
					if (
						e.isContextInvalidated ||
						(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
					) {
						const error = new Error("Extension was reloaded. Please refresh the page and try again.");
						error.isContextInvalidated = true;
						throw error;
					}
					lastError = e;
					const backoffMs = Math.min(10000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
					await new Promise((r) => setTimeout(r, backoffMs));
					attempt += 1;
				}
			}
			if (!success) throw new Error(lastError?.message || "Failed to summarize chunk after retries");
		};

		// Process chunks with concurrency limit for better performance
		for (let i = 0; i < chunks.length; i += MAX_CONCURRENT) {
			const batch = chunks.slice(i, Math.min(i + MAX_CONCURRENT, chunks.length));
			const batchPromises = batch.map((_, batchIndex) => processChunk(i + batchIndex));
			await Promise.all(batchPromises);
			// Small delay between batches to avoid rate limits
			if (i + MAX_CONCURRENT < chunks.length) {
				await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
			}
		}

		// Ensure all summaries are in order (remove any undefined entries and maintain order)
		const orderedSummaries = [];
		for (let i = 0; i < chunks.length; i++) {
			if (chunkSummaries[i] !== undefined) {
				orderedSummaries.push(chunkSummaries[i]);
			}
		}

		if (orderedSummaries.length !== chunks.length) {
			throw new Error(`Failed to summarize all chunks. Expected ${chunks.length}, got ${orderedSummaries.length}`);
		}

		// Combine hierarchically in batches to keep prompt sizes small
		const batchSize = 5; // combine more parts per batch to reduce combine rounds
		let currentLevel = orderedSummaries.slice();
		const combineOneBatch = async (batch, title) => {
			const globalTsRef = this.buildTimestampReferenceFromKeyTimestamps(keyTimestamps);
			const batchProportion = totalChunks > 0 ? ((batch.length / totalChunks) * 100).toFixed(1) : "unknown";
			const combinePrompt = `You are given ${
				batch.length
			} partial summaries (representing ${batchProportion}% of the video) for the YouTube video titled "${title}". These summaries represent different parts of the video from start to finish. Merge them into one cohesive summary that covers the ENTIRE video evenly.

TOKEN BUDGET AWARENESS:
- These ${batch.length} summaries represent ${batchProportion}% of the total video
- Allocate your response tokens proportionally across all parts
- Do NOT over-allocate tokens to early summaries - ensure later summaries get adequate representation
- Maintain EVEN detail distribution across all parts

CRITICAL: This video has been split into multiple parts. You MUST ensure that:
- ALL parts of the video are represented in the final summary - from beginning to end
- Content from later parts of the video is NOT omitted or cut short
- The summary maintains EVEN coverage across the entire video timeline
- If you notice that later parts of the video have less detail, prioritize including content from those parts
- The summary should flow chronologically from start to finish, covering the entire video

Analyze all partial summaries to identify natural thematic or chronological sections. Create section headers that accurately describe each part of the video, then organize the content accordingly.

Structure:
- Start with an "## Overview" section (1-2 sentences)
- Create logical sections based on the video's content structure (e.g., "Introduction", "Main Concepts", "Examples", "Conclusion", or topic-specific headers)
- Order sections chronologically as they appear in the video - ensure you cover from start to finish
- Include as many bullet points per section as needed to adequately summarize the content
- End with a "## Key Takeaways" section

CRITICAL REQUIREMENTS:
- EVERY bullet point MUST include a timestamp in [MM:SS] or [HH:MM:SS] format
- Match each bullet point to the most relevant timestamp from the list below
- If a bullet covers content from multiple timestamps, use the timestamp that best represents the main point
- Avoid duplication - merge similar content from different partial summaries
- Maintain chronological order when possible
- ENSURE COMPLETE COVERAGE: Make sure content from ALL parts of the video (especially later parts) is included in the final summary
- Do NOT cut off early - the summary must cover the entire video from start to finish
- Use only the timestamps listed below when referencing specific moments - do not make up timestamps
- Use **bold text** EXTENSIVELY - bold at least 2-4 key words or phrases in EVERY bullet point for better readability
- Bold important terms, concepts, numbers, statistics, names, features, actions, and key takeaways
- Add relevant emojis to section headers to make them more visually engaging (e.g., 📝 Introduction, 💡 Key Concepts, 🎯 Main Points, ⚠️ Important Notes, ✅ Conclusion, 🔑 Key Takeaways)
- The number of sections and bullets should be determined by the actual content, not a fixed template
- Aim for 30-50% of each bullet point to be bolded for optimal readability
- Prioritize including content from later parts of the video if space is limited - ensure the entire video is covered

Available timestamps from the video:
${globalTsRef}

Partial summaries:

${batch
	.map(
		(s, idx) => `Part ${idx + 1}:
${s}`
	)
	.join("\n\n")}

CRITICAL FORMATTING REQUIREMENT:
- START YOUR RESPONSE DIRECTLY WITH "## Overview"
- DO NOT include any introductory text, explanations, or meta-commentary before the summary
- DO NOT write phrases like "Here's a merged summary" or "Okay, here's..." or any similar introductory text
- Begin immediately with the markdown structure: ## Overview`;
			let attempt = 0;
			while (attempt < 4) {
				try {
					const res = await this.sendMessageToBackground({ action: "summarize", customPrompt: combinePrompt, meta: { ...meta, phase: "combine" } });
					if (!res || !res.success) throw new Error(res?.error || "Failed to combine batch");
					// Strip any introductory text that might have slipped through
					return this.stripIntroductoryText(res.summary);
				} catch (e) {
					// If extension context invalidated, re-throw with clearer message
					if (
						e.isContextInvalidated ||
						(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
					) {
						const error = new Error("Extension was reloaded. Please refresh the page and try again.");
						error.isContextInvalidated = true;
						throw error;
					}
					const backoffMs = Math.min(12000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
					await new Promise((r) => setTimeout(r, backoffMs));
					attempt += 1;
				}
			}
			throw new Error("Failed to combine batch after retries");
		};

		while (currentLevel.length > 1) {
			const nextLevel = [];
			for (let i = 0; i < currentLevel.length; i += batchSize) {
				const batch = currentLevel.slice(i, i + batchSize);
				const combined = await combineOneBatch(batch, videoTitle);
				nextLevel.push(combined);
				// Reduced delay between batch combines (was 700ms)
				if (i + batchSize < currentLevel.length) {
					await new Promise((r) => setTimeout(r, 300));
				}
			}
			currentLevel = nextLevel;
		}

		// Final compression pass to ensure even coverage
		// Only run compression for videos longer than 10 minutes to avoid unnecessary delay for short videos
		const finalSummary = currentLevel[0];
		const shouldCompress = totalDuration && totalDuration > 600; // 10 minutes = 600 seconds
		const compressedSummary = shouldCompress ? await this.compressSummaryForEvenCoverage(finalSummary, videoTitle, keyTimestamps, totalDuration) : finalSummary;

		// Strip any introductory text that might precede "## Overview"
		const cleanedSummary = this.stripIntroductoryText(compressedSummary);

		// Clear progress after combine
		this.generationProgress = null;
		this.updateGenerateButton(true);
		return cleanedSummary;
	}

	// Strip introductory text that might precede "## Overview"
	stripIntroductoryText(summary) {
		try {
			if (!summary || typeof summary !== "string") return summary;

			// Find the first occurrence of "## Overview" or any "##" header
			const overviewIndex = summary.indexOf("## Overview");
			const firstHeaderIndex = summary.search(/^##\s+/m);

			// Use the earlier of the two if both exist, otherwise use whichever exists
			let startIndex = -1;
			if (overviewIndex !== -1 && firstHeaderIndex !== -1) {
				startIndex = Math.min(overviewIndex, firstHeaderIndex);
			} else if (overviewIndex !== -1) {
				startIndex = overviewIndex;
			} else if (firstHeaderIndex !== -1) {
				startIndex = firstHeaderIndex;
			}

			// If we found a header, strip everything before it
			if (startIndex > 0) {
				const cleaned = summary.substring(startIndex).trim();
				// Also remove any trailing newlines at the start
				return cleaned.replace(/^\n+/, "");
			}

			return summary;
		} catch (error) {
			this.logError("Error stripping introductory text", error);
			return summary;
		}
	}

	// Compression pass to redistribute detail evenly across the entire video
	async compressSummaryForEvenCoverage(summary, videoTitle, keyTimestamps, totalDuration) {
		try {
			const globalTsRef = this.buildTimestampReferenceFromKeyTimestamps(keyTimestamps);
			const durationMinutes = totalDuration ? Math.floor(totalDuration / 60) : null;
			const durationSeconds = totalDuration ? Math.floor(totalDuration % 60) : null;
			const durationStr = durationMinutes !== null ? `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}` : "unknown";

			const compressionPrompt = `You are given a summary for the YouTube video titled "${videoTitle}". This summary was created by combining multiple parts of the video.

CRITICAL TASK: Redistribute detail to ensure EVEN coverage across the ENTIRE video timeline.

ANALYZE THE SUMMARY:
1. Check if the summary covers the entire video from start to finish
2. Identify if early sections have excessive detail while later sections are sparse or missing
3. Verify that timestamps span the full video duration${totalDuration ? ` (total duration: ${durationStr})` : ""}

REDISTRIBUTION RULES:
- If early sections are too detailed, COMPRESS them while preserving key information
- If later sections are sparse or missing, EXPAND them with more detail
- Ensure the summary maintains chronological flow from beginning to end
- Every section should have proportional detail based on its importance, not its position
- The summary MUST cover the entire video timeline - do not cut off early

STRUCTURE REQUIREMENTS:
- Start with an "## Overview" section (1-2 sentences)
- Create logical sections that cover the ENTIRE video chronologically
- End with a "## Key Takeaways" section
- EVERY bullet point MUST include a timestamp in [MM:SS] or [HH:MM:SS] format
- Use **bold text** EXTENSIVELY - bold at least 2-4 key words/phrases per bullet
- Add relevant emojis to section headers

AVAILABLE TIMESTAMPS FROM THE VIDEO:
${globalTsRef}

CURRENT SUMMARY (may need redistribution):
${summary}

CRITICAL FORMATTING REQUIREMENT:
- START YOUR RESPONSE DIRECTLY WITH "## Overview" 
- DO NOT include any introductory text, explanations, or meta-commentary before the summary
- DO NOT write phrases like "Here's a revised summary" or "Okay, here's..." or any similar introductory text
- Begin immediately with the markdown structure: ## Overview

Please provide a redistributed summary that ensures complete, even coverage of the entire video from start to finish.`;

			let attempt = 0;
			while (attempt < 3) {
				try {
					const res = await this.sendMessageToBackground({
						action: "summarize",
						customPrompt: compressionPrompt,
						meta: { phase: "compression", videoTitle },
					});
					if (!res || !res.success) throw new Error(res?.error || "Failed to compress summary");
					this.log("Summary compression pass completed successfully");
					// Strip any introductory text that might have slipped through
					return this.stripIntroductoryText(res.summary);
				} catch (e) {
					// If extension context invalidated, re-throw with clearer message
					if (
						e.isContextInvalidated ||
						(e.message && (e.message.includes("Extension context invalidated") || e.message.includes("Extension was reloaded")))
					) {
						const error = new Error("Extension was reloaded. Please refresh the page and try again.");
						error.isContextInvalidated = true;
						throw error;
					}
					this.logError(`Compression pass attempt ${attempt + 1} failed`, e);
					if (attempt === 2) {
						// If compression fails, return original summary
						this.log("Compression pass failed, returning original summary");
						return summary;
					}
					const backoffMs = Math.min(8000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
					await new Promise((r) => setTimeout(r, backoffMs));
					attempt += 1;
				}
			}
			return summary;
		} catch (error) {
			this.logError("Error in compression pass", error);
			// Return original summary if compression fails
			return summary;
		}
	}

	// Simple debounce helper
	debounce(fn, wait = 300) {
		let t;
		return (...args) => {
			clearTimeout(t);
			t = setTimeout(() => fn.apply(this, args), wait);
		};
	}

	updateGenerateButton(isLoading) {
		try {
			const summarizeBtn = document.getElementById("summarize-btn");
			if (summarizeBtn) {
				if (isLoading) {
					summarizeBtn.disabled = true;
					// If we have chunk progress, show it as Generating... (x/y)
					let progressSuffix = "";
					if (this.generationProgress && this.generationProgress.total > 0) {
						const { current, total } = this.generationProgress;
						progressSuffix = ` (${Math.min(current, total)}/${total})`;
					}
					summarizeBtn.innerHTML = `
						<span class="btn-spinner"></span>
						<span>Generating...${progressSuffix}</span>
					`;
					summarizeBtn.classList.add("loading");
				} else {
					summarizeBtn.disabled = false;
					// Check if summary has been generated
					if (this.summary) {
						summarizeBtn.innerHTML = `
								<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
								</svg>
								<span>Generate Again</span>
							`;
						summarizeBtn.classList.add("generate-again");
						summarizeBtn.classList.remove("waiting-subtitles");
					} else if (this.subtitles.length > 0) {
						summarizeBtn.innerHTML = `
								<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
									<path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
								</svg>
								<span>Generate Summary</span>
							`;
						summarizeBtn.classList.remove("generate-again", "waiting-subtitles");
					} else {
						summarizeBtn.innerHTML = `
								<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
									<path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
								</svg>
								<span>Waiting for Subtitles...</span>
							`;
						summarizeBtn.classList.add("waiting-subtitles");
						summarizeBtn.classList.remove("generate-again");
					}
					summarizeBtn.classList.remove("loading");
				}
			}
		} catch (error) {
			this.logError("Error updating generate button", error);
		}
	}

	getVideoTitle() {
		try {
			const selectors = ["#title h1.title", "#title h1", "ytd-watch-metadata h1", "h1.ytd-video-primary-info-renderer"];
			for (const sel of selectors) {
				const el = document.querySelector(sel);
				if (el && el.textContent) return el.textContent.trim();
			}
			return "YouTube Video";
		} catch (error) {
			this.logError("Error getting video title", error);
			return "YouTube Video";
		}
	}

	waitForVideoInfoAndShow(container) {
		try {
			// Store container reference for checkAndShowContainer
			this.pendingContainer = container;

			const checkVideoInfo = () => {
				// Check for video title
				const titleSelectors = ["#title h1.title", "#title h1", "ytd-watch-metadata h1", "h1.ytd-video-primary-info-renderer"];
				let titleFound = false;
				for (const selector of titleSelectors) {
					const titleElement = document.querySelector(selector);
					if (titleElement && titleElement.textContent.trim()) {
						titleFound = true;
						break;
					}
				}

				// Check for video info/metadata section
				const infoSelectors = ["ytd-watch-metadata", "#meta-contents", "ytd-video-primary-info-renderer"];
				let infoFound = false;
				for (const selector of infoSelectors) {
					const infoElement = document.querySelector(selector);
					if (infoElement && infoElement.children.length > 0) {
						infoFound = true;
						break;
					}
				}

				if (titleFound && infoFound) {
					// Video info is loaded, mark as ready and check if we can show
					this.videoInfoReady = true;
					this.checkAndShowContainer();
					return true;
				}
				return false;
			};

			// Initialize videoInfoReady flag
			this.videoInfoReady = false;

			// Check immediately
			if (checkVideoInfo()) {
				return;
			}

			// Check periodically with a timeout
			let attempts = 0;
			const maxAttempts = 20; // 10 seconds max wait (20 * 500ms)
			const checkInterval = setInterval(() => {
				attempts++;
				if (checkVideoInfo() || attempts >= maxAttempts) {
					clearInterval(checkInterval);
					if (attempts >= maxAttempts) {
						// Timeout: mark as ready anyway to prevent infinite waiting
						this.videoInfoReady = true;
						this.checkAndShowContainer();
						this.log("Timeout waiting for video info, proceeding anyway");
					}
				}
			}, 500);
		} catch (error) {
			this.logError("Error waiting for video info", error);
			// On error, show the extension anyway
			if (container) {
				container.style.display = "flex";
			}
		}
	}

	displaySummary() {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (summaryContent && this.summary) {
				// Format the summary with proper HTML structure
				const formattedSummary = this.formatSummaryContent(this.summary);
				summaryContent.innerHTML = `
        <div class="summary-text">
          ${formattedSummary}
        </div>
      `;

				// Calculate search bar height and update sticky header top position
				this.updateStickyHeaderTop();

				// Setup click handlers for summary bullet points
				this.setupSummaryBulletClickListeners();

				// Re-apply search highlights if there's an active search
				if (this.summarySearchQuery && this.summarySearchQuery.length > 0) {
					this.performSummarySearch();
				}
			}
		} catch (error) {
			this.logError("Error displaying summary", error);
		}
	}

	updateStickyHeaderTop() {
		try {
			// Ensure headers have sticky positioning
			const summaryContent = document.getElementById("summary-content");
			if (!summaryContent) {
				this.log("Summary content not found");
				return;
			}

			const headers = summaryContent.querySelectorAll(".summary-text h2, .summary-text h3, .summary-text h4");
			if (headers && headers.length > 0) {
				this.log(`Found ${headers.length} headers to ensure sticky positioning`);
				headers.forEach((header) => {
					// Ensure sticky positioning is set
					header.style.position = "sticky";
					header.style.top = "0";
					// Set z-index based on header level
					const zIndex = header.tagName === "H2" ? "30" : header.tagName === "H3" ? "29" : "28";
					header.style.zIndex = zIndex;
					this.log(`Set ${header.tagName} to sticky with z-index ${zIndex}`);
				});
			} else {
				this.log("No headers found");
			}
		} catch (error) {
			this.logError("Error updating sticky header top", error);
		}
	}

	setupSummaryBulletClickListeners() {
		try {
			const summaryBullets = document.querySelectorAll(".summary-text li");
			summaryBullets.forEach((bullet) => {
				// Remove existing listeners to prevent duplicates
				bullet.removeEventListener("click", this.handleSummaryBulletClick);
				// Add new listener
				bullet.addEventListener("click", this.handleSummaryBulletClick.bind(this));
			});
		} catch (error) {
			this.logError("Error setting up summary bullet click listeners", error);
		}
	}

	handleSummaryBulletClick(event) {
		try {
			const bullet = event.currentTarget;

			// Check if click was directly on a timestamp element - if so, let the timestamp handler deal with it
			// The timestamp click handler will stop propagation, so we can just return here
			if (event.target.closest(".clickable-timestamp")) {
				// Timestamp click handler will handle this - just return
				return;
			}

			// Check if this bullet has multiple timestamps BEFORE removing active classes
			const multipleTimestampsWrapper = bullet.querySelector(".multiple-timestamps-wrapper");
			const timestampsData = multipleTimestampsWrapper ? multipleTimestampsWrapper.getAttribute("data-timestamps") : null;
			const wasActive = bullet.classList.contains("summary-bullet-active");

			// Remove active class from all bullets
			document.querySelectorAll(".summary-text li").forEach((li) => {
				li.classList.remove("summary-bullet-active");
			});

			// If bullet has multiple timestamps and click was on bullet (not timestamp), cycle through them
			if (timestampsData) {
				const timestamps = timestampsData
					.split(",")
					.map((ts) => parseInt(ts.trim(), 10))
					.filter((ts) => !isNaN(ts));
				if (timestamps.length > 1) {
					// Get current index from data attribute
					// If this bullet was active, increment to next timestamp; if not, start at 0 (earliest)
					let currentIndex = wasActive ? parseInt(bullet.getAttribute("data-timestamp-index") || "0", 10) : -1;

					// Cycle to next timestamp (if was active, increment; if not, start at 0)
					currentIndex = (currentIndex + 1) % timestamps.length;
					bullet.setAttribute("data-timestamp-index", currentIndex.toString());

					const selectedTimestamp = timestamps[currentIndex];

					this.log(`Summary bullet clicked (cycling ${currentIndex + 1}/${timestamps.length}): ${selectedTimestamp} seconds`);
					this.jumpToTimestamp(selectedTimestamp);

					// Add active class to this bullet
					bullet.classList.add("summary-bullet-active");
					return;
				}
			}

			// Single timestamp or no multiple timestamps wrapper - find single timestamp
			const timestampElement = bullet.querySelector(".clickable-timestamp");
			if (timestampElement) {
				// Single timestamp
				const timeInSeconds = parseInt(timestampElement.getAttribute("data-time"));
				if (!isNaN(timeInSeconds)) {
					this.log(`Summary bullet timestamp clicked: ${timeInSeconds} seconds`);
					this.jumpToTimestamp(timeInSeconds);
					// Add active class to this bullet
					bullet.classList.add("summary-bullet-active");
				}
			} else {
				// Try to find timestamp text in format [MM:SS] or [HH:MM:SS]
				const bulletText = bullet.textContent || bullet.innerText || "";
				const timestampMatch = bulletText.match(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
				if (timestampMatch) {
					const hours = timestampMatch[3] ? parseInt(timestampMatch[1]) : 0;
					const minutes = timestampMatch[3] ? parseInt(timestampMatch[2]) : parseInt(timestampMatch[1]);
					const seconds = timestampMatch[3] ? parseInt(timestampMatch[3]) : parseInt(timestampMatch[2]);
					const totalSeconds = hours * 3600 + minutes * 60 + seconds;
					this.log(`Summary bullet timestamp found: ${totalSeconds} seconds`);
					this.jumpToTimestamp(totalSeconds);
					// Add active class to this bullet
					bullet.classList.add("summary-bullet-active");
				}
			}
		} catch (error) {
			this.logError("Error handling summary bullet click", error);
		}
	}

	formatSummaryContent(summary) {
		try {
			// Split into lines for processing
			const lines = summary.split("\n");
			let formatted = "";
			let inList = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();

				// Skip empty lines
				if (!line) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					continue;
				}

				// Convert headers
				if (line.match(/^##\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^##\s+(.+)$/, "<h1>$1</h1>") + "\n";
				} else if (line.match(/^###\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^###\s+(.+)$/, "<h2>$1</h2>") + "\n";
				} else if (line.match(/^####\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^####\s+(.+)$/, "<h3>$1</h3>") + "\n";
				} else if (line.match(/^#####\s+(.+)$/)) {
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += line.replace(/^#####\s+(.+)$/, "<h4>$1</h4>") + "\n";
				} else if (line.match(/^[•\-\*]\s+(.+)$/) || line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
					// Bullet point - convert to <li>
					if (!inList) {
						formatted += "<ul>\n";
						inList = true;
					}
					// Remove bullet character and any leading whitespace
					const bulletContent = line.replace(/^[•\-\*]\s*/, "").trim();
					formatted += `<li>${bulletContent}</li>\n`;
				} else {
					// Regular paragraph
					if (inList) {
						formatted += "</ul>\n";
						inList = false;
					}
					formatted += `<p>${line}</p>\n`;
				}
			}

			// Close any open list
			if (inList) {
				formatted += "</ul>\n";
			}

			// Convert **bold text** to <strong>
			formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
			// Convert *italic text* to <em> (but not bullet points)
			formatted = formatted.replace(/(?<!^[•\-\*]\s)\*(.+?)\*/g, "<em>$1</em>");

			// If no headers were found, treat the first line as a main header
			if (!formatted.includes("<h1>") && !formatted.includes("<h2>") && !formatted.includes("<h3>") && !formatted.includes("<h4>")) {
				const lines = summary.split("\n");
				if (lines.length > 0) {
					const firstLine = lines[0].trim();
					const remainingContent = lines.slice(1).join("\n").trim();

					formatted = `<h1>${firstLine}</h1>`;
					if (remainingContent) {
						formatted += `<p>${remainingContent}</p>`;
					}
				}
			}

			// Convert timestamps to clickable elements
			formatted = this.convertTimestampsToClickable(formatted);

			// Sanitize to avoid XSS
			formatted = this.sanitizeHTML(formatted);

			// Hide explicit markers about missing timestamps or unavailable mapping
			formatted = formatted.replace(/\[N\/A\]\s*/gi, "");
			formatted = formatted.replace(/\(\s*Not mentioned in the available timestamps\.?\s*\)/gi, "");

			// Setup click listeners for the new timestamp buttons
			setTimeout(() => {
				this.setupTimestampClickListeners();
			}, 100);

			return formatted;
		} catch (error) {
			this.logError("Error formatting summary content", error);
			return `<p>${this.escapeHTML(summary)}</p>`;
		}
	}

	showError(message, isContextInvalidated = false) {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (summaryContent) {
				let errorHTML = `
        <div class="error-message">
          <p>❌ ${this.escapeHTML(message)}</p>
        `;

				// Add refresh button for context invalidated errors
				if (isContextInvalidated) {
					errorHTML += `
          <div style="margin-top: 16px; text-align: center;">
            <button class="recovery-button" onclick="window.location.reload()" style="margin-top: 12px;">
              🔄 Refresh Page
            </button>
        </div>
      `;
				}

				errorHTML += `</div>`;
				summaryContent.innerHTML = errorHTML;
			}
		} catch (error) {
			this.logError("Error showing error message", error);
		}
	}

	showLoading(show) {
		try {
			const loadingIndicator = document.getElementById("loading-indicator");
			if (loadingIndicator) {
				loadingIndicator.style.display = show ? "block" : "none";
			}
		} catch (error) {
			this.logError("Error showing loading state", error);
		}
	}

	setupThemeDetection() {
		try {
			// Initial theme detection - try multiple times if container doesn't exist yet
			const attemptThemeDetection = () => {
				const container = document.getElementById("youtube-summarizer-container");
				if (container) {
					this.detectAndApplyTheme();
				} else {
					// Container not created yet, try again after a short delay
					setTimeout(attemptThemeDetection, 100);
				}
			};
			attemptThemeDetection();

			// Watch for theme changes
			this.themeObserver = new MutationObserver(() => {
				this.detectAndApplyTheme();
			});

			// Observe the html element for theme changes
			this.themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["data-darkreader-mode", "class"],
			});

			// Also watch for YouTube's theme changes
			this.themeObserver.observe(document.body, {
				attributes: true,
				attributeFilter: ["class"],
			});
		} catch (error) {
			this.logError("Error setting up theme detection", error);
		}
	}

	detectAndApplyTheme() {
		try {
			const isDarkMode = this.isYouTubeDarkMode();

			// Apply theme to our container
			const container = document.getElementById("youtube-summarizer-container");
			if (container) {
				if (isDarkMode) {
					container.setAttribute("data-theme", "dark");
				} else {
					container.setAttribute("data-theme", "light");
				}
				// Mark theme as detected
				this.themeDetected = true;
				// Check if we can show the container now (if video info is also ready)
				this.checkAndShowContainer();
			}
		} catch (error) {
			this.logError("Error detecting and applying theme", error);
			// Even on error, mark theme as detected (default to light) to prevent infinite waiting
			this.themeDetected = true;
			this.checkAndShowContainer();
		}
	}

	isYouTubeDarkMode() {
		try {
			// Check for YouTube's dark mode indicators
			const html = document.documentElement;

			// Check for data-darkreader-mode attribute
			if (html.getAttribute("data-darkreader-mode") === "dark") {
				return true;
			}

			// Check for YouTube's dark mode classes
			const body = document.body;
			if (body.classList.contains("dark") || body.classList.contains("yt-dark") || body.classList.contains("yt-dark-theme")) {
				return true;
			}

			// Check for YouTube's dark mode in the app layout
			const appLayout = document.querySelector("ytd-app");
			if (appLayout && appLayout.hasAttribute("is-dark")) {
				return true;
			}

			// Check for dark mode in the masthead
			const masthead = document.querySelector("ytd-masthead");
			if (masthead && masthead.hasAttribute("dark")) {
				return true;
			}

			// Check for dark mode in the page manager
			const pageManager = document.querySelector("ytd-page-manager");
			if (pageManager && pageManager.hasAttribute("dark")) {
				return true;
			}

			return false;
		} catch (error) {
			this.logError("Error detecting YouTube dark mode", error);
			return false;
		}
	}

	checkAndShowContainer() {
		try {
			// Check if all conditions are met:
			// 1. Video info is ready
			// 2. Theme is detected
			// 3. Container exists
			// 4. If transcript panel was opened, enough time has passed since it opened
			if (!this.videoInfoReady || !this.themeDetected || !this.pendingContainer) {
				return;
			}

			// If transcript panel was opened, check if enough time has passed
			if (this.transcriptPanelOpened && this.transcriptPanelOpenTime) {
				const timeSinceOpen = Date.now() - this.transcriptPanelOpenTime;
				if (timeSinceOpen < this.transcriptPanelDelayMs) {
					// Not enough time has passed, wait a bit more
					const remainingDelay = this.transcriptPanelDelayMs - timeSinceOpen;
					setTimeout(() => {
						this.checkAndShowContainer();
					}, remainingDelay + 50); // Add small buffer
					return;
				}
			}

			// All conditions met, show the container
			const container = this.pendingContainer;
			// Double-check container still exists
			if (container && container.parentNode) {
				container.style.display = "flex";
				const delayInfo = this.transcriptPanelOpened ? ` (after ${this.transcriptPanelDelayMs}ms transcript panel delay)` : "";
				this.log(`Video info and theme ready${delayInfo}, showing extension`);
				// Clear the pending reference
				this.pendingContainer = null;
			}
		} catch (error) {
			this.logError("Error checking and showing container", error);
		}
	}

	preventTranscriptAutoScroll() {
		try {
			// Override scrollIntoView to prevent auto-scrolling to transcript panel
			const originalScrollIntoView = Element.prototype.scrollIntoView;

			// Only override if not already overridden
			if (!Element.prototype.scrollIntoView._youtubeSummarizerOverridden) {
				Element.prototype.scrollIntoView = function (...args) {
					// Block auto scroll triggered by transcript panel
					if (this.closest("ytd-engagement-panel-section-list-renderer")) {
						return;
					}
					// Also block scrolling for transcript-related elements
					if (this.closest("ytd-transcript-renderer")) {
						return;
					}
					// Allow normal scrolling for other elements
					return originalScrollIntoView.apply(this, args);
				};

				// Mark as overridden to prevent multiple overrides
				Element.prototype.scrollIntoView._youtubeSummarizerOverridden = true;

				this.log("Transcript auto-scroll prevention enabled");
			}
		} catch (error) {
			this.logError("Error preventing transcript auto-scroll", error);
		}
	}
}

// Initialize the summarizer when the page loads with error handling
try {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			window.youtubeSummarizer = new YouTubeSummarizer();
		});
	} else {
		window.youtubeSummarizer = new YouTubeSummarizer();
	}
} catch (error) {
	console.error("[YouTube Summarizer] Error initializing:", error);
}
