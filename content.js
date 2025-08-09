// YouTube Video Summarizer Content Script
class YouTubeSummarizer {
	constructor() {
		this.subtitles = [];
		this.subtitleTimings = [];
		this.summary = null;
		this.isProcessing = false;
		this.extractionAttempts = 0;
		this.maxExtractionAttempts = 5;
		this.currentTab = "captions"; // 'captions' or 'summary'
		this.videoElement = null;
		this.playbackObserver = null;
		this.currentActiveIndex = -1;
		this.lastActiveIndex = -1;
		this.userScrolled = false;
		this.scrollThreshold = 400; // pixels from active caption (increased magnetism)
		this.jumpButton = null;
		this.currentVideoId = null;
		this.jumpButtonDelay = 2000; // 2 seconds delay before showing jump button
		this.jumpButtonTimer = null;
		this.availableCaptionTracks = [];
		this.selectedCaptionTrack = null;
		this.themeObserver = null;
		this.autoScrollDelay = 1500; // 1.5 seconds delay before auto-scrolling back
		this.autoScrollTimer = null;
		this.autoSummaryGenerated = false; // Flag to prevent multiple auto-generations
		this.querySubmitting = false; // Flag to prevent duplicate query submissions
		this.queryEventListeners = []; // Store event listeners for cleanup
		this.subtitlesExtractionStartTime = null; // Track when subtitle extraction started
		this.initializationAttempts = 0; // Track initialization attempts
		this.maxInitializationAttempts = 3; // Maximum initialization attempts
		this.initializationComplete = false; // Flag to track if initialization is complete
		this.generationProgress = null; // { current, total } progress while chunk-uploading
		this.init();
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
		const CHUNK_SIZE = 30000; // match summary path to minimize requests
		const INTER_CHUNK_DELAY_MS = 800;
		const MAX_RETRIES_PER_CHUNK = 4;
		const chunks = [];
		for (let i = 0; i < subtitlesText.length; i += CHUNK_SIZE) {
			chunks.push(subtitlesText.slice(i, i + CHUNK_SIZE));
		}

		// Update the pending query section with progress
		this.updateQueryProgress(0, chunks.length);

		const perChunkAnswers = [];
		for (let i = 0; i < chunks.length; i++) {
			const tsRef = this.buildTimestampReferenceForIndices(chunks[i].indices || [], 25);
			const prompt = `You are answering a question about the YouTube video titled "${videoTitle}".

Question: ${query}

Here is CHUNK (${i + 1}/${chunks.length}) of the video's subtitles:

${chunks[i].text || chunks[i]}

Available timestamps from this chunk (use only these when referencing moments):
${tsRef}

Task: Provide a concise answer based ONLY on this chunk as a bullet list. For EVERY bullet point, you MUST:
- Start the bullet with exactly one timestamp in [MM:SS] or [HH:MM:SS] format chosen from the list above (the most relevant moment).
- If no timestamp in the list is relevant for that bullet, use [N/A] and briefly explain why.
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
- EVERY bullet point MUST start with one timestamp in [MM:SS] or [HH:MM:SS] format pulled from the available timestamps above. Choose the best matching moment.
- If no timestamp is applicable, use [N/A] and briefly explain why.
- Do not invent timestamps. Use only the timestamps listed above.`;

		let combineAttempt = 0;
		while (combineAttempt < 4) {
			try {
				const final = await chrome.runtime.sendMessage({ action: "query", customPrompt: combinePrompt, meta: { ...meta, phase: "q-combine" } });
				if (!final || !final.success) throw new Error(final?.error || "Failed to combine answers");
				return final.answer;
			} catch (e) {
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
			const pending = summaryContent.querySelector(".query-section:last-child .query-pending p");
			if (pending) {
				pending.textContent = `Getting answer... (${Math.min(current, total)}/${total})`;
			}
		} catch (e) {
			console.error("Error updating query progress:", e);
		}
	}

	init() {
		try {
			console.log("Initializing YouTube Summarizer extension...");
			this.initializationAttempts++;

			// Start immediately and also wait for YouTube to load
			this.setupImmediate();
			this.waitForYouTube();

			// Set a timeout to retry initialization if it fails
			setTimeout(() => {
				if (!this.initializationComplete && this.initializationAttempts < this.maxInitializationAttempts) {
					console.log(`Initialization incomplete, retrying (attempt ${this.initializationAttempts + 1}/${this.maxInitializationAttempts})...`);
					this.init();
				} else if (!this.initializationComplete) {
					console.error("Failed to initialize extension after maximum attempts");
				}
			}, 5000); // 5 second timeout
		} catch (error) {
			console.error("Error during initialization:", error);
			if (this.initializationAttempts < this.maxInitializationAttempts) {
				setTimeout(() => this.init(), 2000);
			}
		}
	}

	setupImmediate() {
		try {
			console.log("Setting up YouTube Summarizer extension...");

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
					console.log("Retrying UI creation after delay...");
					this.createSummaryUI();
				}

				// Mark initialization as complete if UI exists
				if (document.getElementById("youtube-summarizer-container")) {
					this.initializationComplete = true;
					console.log("Extension initialization completed successfully");
				}
			}, 2000);
		} catch (error) {
			console.error("Error in setupImmediate:", error);
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
				console.log("Video changed, refreshing extension...");

				// Reset all state
				this.resetState();

				// Reinitialize after a short delay to let YouTube load
				setTimeout(() => {
					this.setupImmediate();
				}, 1000);
			} else if (location.pathname === "/watch" && newVideoId && !this.currentVideoId) {
				// First time loading a video page
				this.currentVideoId = newVideoId;
				console.log("First time loading video page, initializing extension...");

				// Initialize the extension
				setTimeout(() => {
					this.setupImmediate();
				}, 500);
			}
		} catch (error) {
			console.error("Error handling video change:", error);
		}
	}

	resetState() {
		// Clear all data
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

		// Clean up query event listeners
		this.cleanupQueryEventListeners();

		// Stop playback tracking
		this.stopPlaybackTracking();

		// Clear jump button timer
		if (this.jumpButtonTimer) {
			clearTimeout(this.jumpButtonTimer);
			this.jumpButtonTimer = null;
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
			console.log("Attempting to recover extension...");

			// Reset state
			this.resetState();

			// Reinitialize
			this.initializationAttempts = 0;
			this.initializationComplete = false;

			// Wait a moment then reinitialize
			setTimeout(() => {
				this.setupImmediate();
			}, 1000);
		} catch (error) {
			console.error("Error during extension recovery:", error);
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
			console.error("Error adding recovery button:", error);
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
				console.log("YouTube page fully loaded, setting up video tracking...");

				// Setup video playback tracking after YouTube is fully loaded
				setTimeout(() => {
					this.setupVideoPlaybackTracking();
				}, 1000);
			}
		}, 500); // Check more frequently

		// Also set a timeout to prevent infinite checking
		setTimeout(() => {
			clearInterval(checkInterval);
			console.log("YouTube load timeout reached, proceeding anyway...");
			this.setupVideoPlaybackTracking();
		}, 10000); // 10 second timeout
	}

	setupSubtitlesExtraction() {
		try {
			console.log("Setting up subtitle extraction...");

			// Track when subtitle extraction started for this video
			this.subtitlesExtractionStartTime = Date.now();

			// Extract subtitles immediately and then with delays
			this.extractAllSubtitles();

			// Also extract with delays for better coverage
			setTimeout(() => {
				console.log("First retry of subtitle extraction...");
				this.extractAllSubtitles();
			}, 1000);

			setTimeout(() => {
				console.log("Second retry of subtitle extraction...");
				this.extractAllSubtitles();
			}, 3000);

			// Force refresh caption discovery after a longer delay
			setTimeout(() => {
				console.log("Force refreshing caption discovery...");
				this.forceRefreshCaptionDiscovery();
			}, 5000);

			// Additional retry if no subtitles found after 8 seconds
			setTimeout(() => {
				if (this.subtitles.length === 0) {
					console.log("No subtitles found after 8 seconds, retrying extraction...");
					this.extractAllSubtitles();
				} else {
					console.log(`Found ${this.subtitles.length} subtitles after 8 seconds`);
				}
			}, 8000);

			// Final check and retry after 12 seconds
			setTimeout(() => {
				if (this.subtitles.length < 5) {
					console.log("Still insufficient subtitles after 12 seconds, final retry...");
					this.extractAllSubtitles();
				} else {
					console.log(`Final subtitle count: ${this.subtitles.length}`);
				}
			}, 12000);

			// Monitor for changes with a more conservative approach
			const observer = new MutationObserver(() => {
				// Only re-extract if we don't have many subtitles yet and haven't tried too many times
				if (this.subtitles.length < 10 && this.extractionAttempts < this.maxExtractionAttempts) {
					setTimeout(() => {
						this.extractAllSubtitles();
					}, 1000);
				}
			});

			// Observe the video player for changes
			const videoPlayer = document.querySelector("#movie_player");
			if (videoPlayer) {
				observer.observe(videoPlayer, {
					childList: true,
					subtree: true,
				});
			}

			// Also observe for transcript panel changes
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (transcriptPanel) {
				observer.observe(transcriptPanel, {
					childList: true,
					subtree: true,
				});
			}
		} catch (error) {
			console.error("Error in setupSubtitlesExtraction:", error);
			// Retry after error
			setTimeout(() => {
				this.setupSubtitlesExtraction();
			}, 2000);
		}
	}

	// Validate that subtitles are ready for summary generation
	validateSubtitlesForSummary() {
		try {
			// Check if we have enough subtitles
			if (this.subtitles.length < 5) {
				console.log(`Not enough subtitles (${this.subtitles.length}), need at least 5`);
				return false;
			}

			// Check if all subtitles have content
			const hasValidContent = this.subtitles.every((subtitle) => subtitle && subtitle.trim().length > 0);

			if (!hasValidContent) {
				console.log("Some subtitles are empty or invalid");
				return false;
			}

			// Check if we have timing information
			if (!this.subtitleTimings || this.subtitleTimings.length === 0) {
				console.log("No timing information available");
				return false;
			}

			// Check if extraction was recent
			if (!this.subtitlesExtractionStartTime) {
				console.log("No extraction start time");
				return false;
			}

			const timeSinceExtraction = Date.now() - this.subtitlesExtractionStartTime;
			if (timeSinceExtraction > 30000) {
				console.log("Subtitles are too old");
				return false;
			}

			console.log(`Subtitles validated: ${this.subtitles.length} subtitles, ${this.subtitleTimings.length} timings`);
			return true;
		} catch (error) {
			console.error("Error validating subtitles:", error);
			return false;
		}
	}

	setupVideoPlaybackTracking() {
		try {
			this.videoElement = document.querySelector("video");
			if (this.videoElement) {
				// Track playback time updates
				this.videoElement.addEventListener("timeupdate", () => {
					this.updateActiveCaption();
				});

				// Track when video starts playing
				this.videoElement.addEventListener("play", () => {
					this.startPlaybackTracking();
				});

				// Track when video pauses
				this.videoElement.addEventListener("pause", () => {
					this.stopPlaybackTracking();
				});

				// Track when video is ready to play
				this.videoElement.addEventListener("loadeddata", () => {
					// Immediately update active caption when video is ready
					setTimeout(() => {
						this.updateActiveCaption();
					}, 100);
				});

				// Also update active caption immediately if video is already loaded
				if (this.videoElement.readyState >= 2) {
					setTimeout(() => {
						this.updateActiveCaption();
					}, 100);
				}
			}
		} catch (error) {
			console.error("Error setting up video playback tracking:", error);
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
			if (!this.videoElement || this.subtitleTimings.length === 0) return;

			const currentTime = this.videoElement.currentTime;
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

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
			if (newActiveIndex >= 0) {
				const activeTiming = this.subtitleTimings[newActiveIndex];
				console.log(
					`Active caption ${newActiveIndex}: ${this.formatTimestamp(activeTiming.start)}-${this.formatTimestamp(
						activeTiming.end
					)}, Current time: ${this.formatTimestamp(currentTime)}`
				);
			}

			// Only update if the active caption has changed
			if (newActiveIndex !== this.currentActiveIndex) {
				this.lastActiveIndex = this.currentActiveIndex;
				this.currentActiveIndex = newActiveIndex;
				this.updateCaptionHighlighting();
			}

			// Check if we should auto-scroll (only if user hasn't scrolled away significantly)
			if (newActiveIndex >= 0 && !this.userScrolled) {
				// Auto-scroll immediately if user hasn't scrolled away
				this.autoScrollToActiveCaption(newActiveIndex);
			} else if (newActiveIndex >= 0 && this.userScrolled) {
				// If user has scrolled away, use delayed auto-scroll
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

			// Always show jump button when there's an active caption
			if (newActiveIndex >= 0) {
				this.showJumpToActiveButton(newActiveIndex);
			}
		} catch (error) {
			console.error("Error updating active caption:", error);
		}
	}

	updateCaptionHighlighting() {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (!captionsContainer) return;

			const captionItems = captionsContainer.querySelectorAll(".subtitle-item");

			// Remove highlighting from all captions first
			captionItems.forEach((item) => {
				item.classList.remove("active-caption");
			});

			// Add highlighting to the current active caption
			if (this.currentActiveIndex >= 0 && this.currentActiveIndex < captionItems.length) {
				captionItems[this.currentActiveIndex].classList.add("active-caption");
			}
		} catch (error) {
			console.error("Error updating caption highlighting:", error);
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
			console.error("Error auto-scrolling to active caption:", error);
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
			console.error("Error showing jump button:", error);
		}
	}

	jumpToActiveCaption(activeIndex) {
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
			console.error("Error jumping to active caption:", error);
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
			console.error("Error updating jump button state:", error);
		}
	}

	setupScrollTracking() {
		try {
			const captionsContainer = document.getElementById("subtitles-content");
			if (captionsContainer) {
				captionsContainer.addEventListener("scroll", () => {
					this.handleScroll();
				});
			}
		} catch (error) {
			console.error("Error setting up scroll tracking:", error);
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
			console.error("Error handling scroll:", error);
		}
	}

	extractAllSubtitles() {
		try {
			this.extractionAttempts++;

			// Clear old subtitles if this is the first extraction attempt for a new video
			if (this.extractionAttempts === 1) {
				this.subtitles = [];
				this.subtitleTimings = [];
				console.log("Clearing old subtitles for new video");
			}

			// First, discover available caption tracks
			this.discoverCaptionTracks();

			// Method 1: Extract from transcript panel (manual and auto-generated)
			this.extractFromTranscript();

			// Method 2: Extract from subtitle track data (all available tracks)
			this.extractFromAllSubtitleTracks();

			// Method 3: Try to enable auto-generated captions if no subtitles found
			if (this.subtitles.length === 0 && this.extractionAttempts >= 2) {
				this.tryEnableAutoCaptions();
			}

			// Method 4: Try to open transcript panel to access all subtitles
			if (this.subtitles.length === 0 && this.extractionAttempts >= 3) {
				this.tryOpenTranscriptPanel();
			}
		} catch (error) {
			console.error("Error extracting subtitles:", error);
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
			const transcriptItems = document.querySelectorAll(".ytd-transcript-segment-renderer");
			console.log("Found transcript items:", transcriptItems.length);

			if (transcriptItems.length > 0) {
				// Check if there are multiple language options in the transcript panel
				const languageSelector = document.querySelector('[aria-label*="language"], [aria-label*="Language"]');

				// If we have transcript items, add as a track option
				const transcriptSubtitles = [];
				const timings = [];

				Array.from(transcriptItems).forEach((item) => {
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

							// Estimate end time (assuming 3 seconds per subtitle)
							const endTime = startTime + 3;

							timings.push({
								start: startTime,
								end: endTime,
							});
						}
					}
				});

				if (transcriptSubtitles.length > 0) {
					// Determine if this is auto-generated or manual
					const isAutoGenerated = this.detectIfAutoGenerated(transcriptSubtitles);
					const label = isAutoGenerated ? "English (auto-generated)" : "English";

					console.log(`Adding transcript track: ${label}, auto-generated: ${isAutoGenerated}`);

					// Check if we already have a track with this label
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
							isAutoGenerated: isAutoGenerated,
						};

						this.availableCaptionTracks.push(trackInfo);
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
				transcriptButton.click();

				// Wait for transcript panel to load and then discover
				setTimeout(() => {
					this.discoverFromTranscriptPanel();
					this.checkForMultipleLanguageOptions();
					this.selectBestCaptionTrack();
				}, 1500);
			}
		} catch (error) {
			console.error("Error opening transcript panel for discovery:", error);
		}
	}

	checkForMultipleLanguageOptions() {
		try {
			// Look for language selector buttons in the transcript panel
			const languageButtons = document.querySelectorAll('[aria-label*="language"], [aria-label*="Language"], [role="button"]');

			languageButtons.forEach((button) => {
				const buttonText = button.textContent.toLowerCase();
				if (buttonText.includes("english") || buttonText.includes("auto")) {
					// This might be a language option button
					console.log("Found language option button:", button.textContent);
				}
			});

			// Also check for dropdown menus in the transcript panel
			const languageDropdowns = document.querySelectorAll("select, [role='listbox']");
			languageDropdowns.forEach((dropdown) => {
				const options = dropdown.querySelectorAll("option");
				options.forEach((option) => {
					const optionText = option.textContent.toLowerCase();
					if (optionText.includes("english") || optionText.includes("auto")) {
						console.log("Found language option:", option.textContent);
					}
				});
			});

			// Check for YouTube's language selector in the transcript panel
			const transcriptPanel = document.querySelector("ytd-transcript-renderer");
			if (transcriptPanel) {
				// Look for language selector elements
				const languageSelectors = transcriptPanel.querySelectorAll('[aria-label*="language"], [aria-label*="Language"], button');
				languageSelectors.forEach((selector) => {
					const text = selector.textContent.toLowerCase();
					if (text.includes("english") || text.includes("auto")) {
						console.log("Found transcript language selector:", selector.textContent);
					}
				});
			}
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

	extractFromSelectedTrack() {
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
				this.subtitles = trackSubtitles;
				this.subtitleTimings = timings;
				this.updateSubtitlesDisplay();
				this.displaySubtitlesInView();
			}
		} catch (error) {
			console.error("Error extracting from selected track:", error);
		}
	}

	extractFromTranscript() {
		try {
			const transcriptItems = document.querySelectorAll(".ytd-transcript-segment-renderer");
			if (transcriptItems.length > 0) {
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
					this.subtitles = transcriptSubtitles;
					this.subtitleTimings = timings;
					this.updateSubtitlesDisplay();
					this.displaySubtitlesInView();
				}
			}
		} catch (error) {
			console.error("Error extracting from transcript:", error);
		}
	}

	extractFromAllSubtitleTracks() {
		try {
			// Try to access the video element and all its text tracks
			const videoElement = document.querySelector("video");
			if (videoElement && videoElement.textTracks) {
				// If we have a selected track, use that
				if (this.selectedCaptionTrack) {
					this.extractFromSelectedTrack();
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
							this.subtitles = trackSubtitles;
							this.subtitleTimings = timings;
							this.updateSubtitlesDisplay();
							this.displaySubtitlesInView();
							break;
						}
					}
				}
			}
		} catch (error) {
			console.error("Error extracting from subtitle tracks:", error);
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
			// Try to open the transcript panel to access all subtitles
			const transcriptButton = document.querySelector(
				'button[aria-label*="transcript"], button[aria-label*="Transcript"], button[aria-label*="Show transcript"]'
			);
			if (transcriptButton) {
				transcriptButton.click();

				// Wait for transcript panel to load and extract
				setTimeout(() => {
					this.extractFromTranscript();
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
				console.log("Not on a video page, skipping UI creation");
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
                <label for="caption-track-selector">Caption Track:</label>
                <select id="caption-track-selector" class="caption-track-selector">
                  <option value="">Loading captions...</option>
                </select>
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
                  <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    <path d="M13 8H7"/>
                    <path d="M17 12H7"/>
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
			console.error("Error creating summary UI:", error);
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
			console.error("Error setting up caption click listeners:", error);
		}
	}

	jumpToCaption(startTime) {
		this.jumpToTimestamp(startTime);
	}

	jumpToTimestamp(timestamp) {
		try {
			if (this.videoElement) {
				this.videoElement.currentTime = timestamp;
				console.log(`Jumped to timestamp ${this.formatTimestamp(timestamp)}`);
			}
		} catch (error) {
			console.error("Error jumping to timestamp:", error);
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
			console.error("Error setting up query event listeners:", error);
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
			console.error("Error cleaning up query event listeners:", error);
		}
	}

	async submitQuery() {
		try {
			// Prevent duplicate submissions
			if (this.querySubmitting) {
				console.log("Query already being submitted, ignoring duplicate request");
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
				<span class="query-spinner"></span>
				<span>Asking...</span>
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
				<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2 2z"/>
					<path d="M13 8H7"/>
					<path d="M17 12H7"/>
				</svg>
				<span>Ask</span>
			`;
			queryInput.disabled = false;
			queryInput.value = "";

			// Clear any autocomplete suggestions and prevent them from appearing
			queryInput.blur();
			queryInput.focus();
		} catch (error) {
			console.error("Error submitting query:", error);

			// Reset button state on error
			const submitBtn = document.getElementById("submit-query-btn");
			const queryInput = document.getElementById("summary-query-input");
			if (submitBtn) {
				submitBtn.disabled = false;
				submitBtn.innerHTML = `
					<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
						<path d="M13 8H7"/>
						<path d="M17 12H7"/>
					</svg>
					<span>Ask</span>
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
			console.error("Error building relevant subtitle context:", e);
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
							<h4>Question:</h4>
							<p>${question}</p>
						</div>
						<div class="query-pending">
							<div class="query-spinner"></div>
							<p>Getting answer...</p>
						</div>
					</div>
				`;

				// Add to the end of summary content
				summaryContent.insertAdjacentHTML("beforeend", queryHTML);
			} else {
				// Update existing pending section or create new one
				if (existingPendingSection) {
					// Replace the pending section with the answer
					const querySection = existingPendingSection.closest(".query-section");
					const questionElement = querySection.querySelector(".query-question");

					if (isError) {
						existingPendingSection.outerHTML = `
							<div class="query-error">
								<p>${answer}</p>
							</div>
						`;
					} else {
						// Format the answer with proper markdown structure
						const formattedAnswer = this.formatQueryAnswer(answer);
						existingPendingSection.outerHTML = `
							<div class="query-answer">
								<h4>Answer:</h4>
								<div class="summary-text">
									${formattedAnswer}
								</div>
							</div>
						`;
					}
				} else {
					// Create new section if no pending section exists
					const queryHTML = `
						<div class="query-divider"></div>
						<div class="query-section">
							<div class="query-question">
								<h4>Question:</h4>
								<p>${question}</p>
							</div>
							${
								isError
									? `<div class="query-error"><p>${answer}</p></div>`
									: `<div class="query-answer">
									<h4>Answer:</h4>
									<div class="summary-text">${this.formatQueryAnswer(answer)}</div>
								</div>`
							}
						</div>
					`;
					summaryContent.insertAdjacentHTML("beforeend", queryHTML);
				}
			}
		} catch (error) {
			console.error("Error adding query to view:", error);
		}
	}

	formatQueryAnswer(answer) {
		try {
			// Convert the answer to proper HTML structure with headers, numbered bullets, and bold text
			let formatted = answer
				// Convert ## headers to h2
				.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
				// Convert **bold text** to <strong>
				.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
				// Convert *italic text* to <em>
				.replace(/\*(.+?)\*/g, "<em>$1</em>")
				// Convert • bullet points to proper list items
				.replace(/^•\s+(.+)$/gm, "<li>$1</li>")
				// Convert numbered bullets (1., 2., 3.) to ordered list items
				.replace(/^(\d+)\.\s+(.+)$/gm, "<li>$2</li>")
				// Wrap consecutive list items in ul tags (for bullet points)
				.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
				// Clean up multiple ul tags
				.replace(/<\/ul>\s*<ul>/g, "")
				// Convert paragraphs (double line breaks)
				.replace(/\n\n/g, "</p><p>")
				// Wrap in paragraph tags
				.replace(/^(.+)$/gm, "<p>$1</p>")
				// Clean up empty paragraphs
				.replace(/<p><\/p>/g, "")
				// Clean up consecutive paragraph tags
				.replace(/<\/p><p>/g, "</p>\n<p>");

			// Convert timestamps to clickable elements
			formatted = this.convertTimestampsToClickable(formatted);

			// Remove [N/A] tags if the model used them for bullets with no applicable timestamp
			formatted = formatted.replace(/\[N\/A\]\s*/gi, "");

			// Sanitize to avoid XSS
			formatted = this.sanitizeHTML(formatted);

			// Setup click listeners for the new timestamp buttons
			setTimeout(() => {
				this.setupTimestampClickListeners();
			}, 100);

			return formatted;
		} catch (error) {
			console.error("Error formatting query answer:", error);
			return `<p>${answer}</p>`;
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

			console.log(`Extracted ${keyTimestamps.length} timestamps from ${totalSubtitles} subtitles`);
			return keyTimestamps;
		} catch (error) {
			console.error("Error extracting key timestamps:", error);
			return [];
		}
	}

	// Convert timestamps in text to clickable elements
	convertTimestampsToClickable(text) {
		try {
			// Match [MM:SS] or [HH:MM:SS]
			const timestampRegex = /\[(\d{1,2}:)?(\d{1,2}):(\d{2})\]/g;
			return text.replace(timestampRegex, (match) => {
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
				return `<span class="clickable-timestamp" data-time="${totalSeconds}">${formattedTime}</span>`;
			});
		} catch (error) {
			console.error("Error converting timestamps to clickable:", error);
			return text;
		}
	}

	// Minimal allowlist sanitizer to reduce XSS risk from model output
	sanitizeHTML(dirtyHtml) {
		try {
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
							// Allow only class and data-time on span.clickable-timestamp
							Array.from(child.attributes).forEach((attr) => {
								const name = attr.name.toLowerCase();
								const value = attr.value;
								const isClickableSpan = tag === "span" && name === "class" && value === "clickable-timestamp";
								const isDataTime = tag === "span" && name === "data-time" && /^\d+$/.test(value);
								if (!isClickableSpan && !isDataTime) {
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
			return dirtyHtml;
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
			console.error("Error setting up timestamp click listeners:", error);
		}
	}

	// Handle timestamp button clicks
	handleTimestampClick(event) {
		try {
			const timestamp = event.target;
			const timeInSeconds = parseInt(timestamp.getAttribute("data-time"));

			if (!isNaN(timeInSeconds)) {
				console.log(`Timestamp clicked: ${timeInSeconds} seconds`);
				this.jumpToTimestamp(timeInSeconds);
			}
		} catch (error) {
			console.error("Error handling timestamp click:", error);
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
			console.error("Error inserting container:", error);
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
			console.error("Error finding insertion point:", error);
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
			console.error("Error updating subtitle display:", error);
		}
	}

	displaySubtitlesInView() {
		try {
			const subtitlesContent = document.getElementById("subtitles-content");
			if (subtitlesContent && this.subtitles.length > 0) {
				// Show all subtitles with timestamps
				const subtitlesText = this.subtitles
					.map((subtitle, index) => {
						const timing = this.subtitleTimings[index] || { start: 0, end: 0 };
						const startTime = this.formatTimestamp(timing.start);
						const endTime = this.formatTimestamp(timing.end);
						return `<div class="subtitle-item" data-index="${index}" data-start-time="${timing.start}">
							<strong class="timestamp">${startTime} - ${endTime}</strong>
							<span class="subtitle-text">${subtitle}</span>
						</div>`;
					})
					.join("");

				// Preserve the subtitles-info div and add the subtitles list after it
				const subtitlesInfo = subtitlesContent.querySelector("#subtitles-info");
				const subtitlesInfoHTML = subtitlesInfo ? subtitlesInfo.outerHTML : "";

				subtitlesContent.innerHTML = `
          ${subtitlesInfoHTML}
          <div class="subtitles-list">
            ${subtitlesText}
          </div>
        `;

				// Update the subtitle count
				this.updateSubtitlesDisplay();

				// Immediately update active caption when subtitles are displayed
				setTimeout(() => {
					this.updateActiveCaption();
				}, 100);

				// Automatically generate summary if not already generated and subtitles are properly loaded
				if (!this.autoSummaryGenerated && this.validateSubtitlesForSummary()) {
					this.autoSummaryGenerated = true;
					console.log(`Subtitles validated (${this.subtitles.length} subtitles), automatically generating summary...`);

					// Add a longer delay to ensure everything is properly loaded
					setTimeout(() => {
						this.generateSummary();
					}, 2000);
				} else if (!this.autoSummaryGenerated) {
					console.log("Subtitles not ready for auto-summary generation, will retry...");
					// Retry subtitle extraction if not enough subtitles
					if (this.subtitles.length < 5) {
						setTimeout(() => {
							this.setupSubtitlesExtraction();
						}, 1000);
					}
				}
			}
		} catch (error) {
			console.error("Error displaying subtitles in view:", error);
		}
	}

	async generateSummary(force = false) {
		try {
			console.log("Starting summary generation...");

			// Check if extension is properly initialized
			if (!this.initializationComplete) {
				console.log("Extension not fully initialized, attempting to reinitialize...");
				this.setupImmediate();
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			if (this.isProcessing) {
				console.log("Already processing, skipping...");
				return;
			}

			if (this.subtitles.length === 0) {
				console.log("No subtitles available, showing error...");
				this.showError("No subtitles found. The extension will try to enable auto-generated captions, but this video may not have any captions available.");
				// Try to extract subtitles again
				setTimeout(() => {
					this.setupSubtitlesExtraction();
				}, 1000);
				return;
			}

			// Additional check to ensure subtitles are for the current video
			if (!this.subtitlesExtractionStartTime && !force) {
				console.log("No subtitle extraction start time, skipping summary generation");
				return;
			}

			if (this.subtitlesExtractionStartTime) {
				const timeSinceExtraction = Date.now() - this.subtitlesExtractionStartTime;
				if (timeSinceExtraction > 30000 && !force) {
					// 30 seconds
					console.log("Subtitles are too old, skipping summary generation");
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

			console.log(`Sending summary request with ${this.subtitles.length} subtitles and title: ${videoTitle}`);
			console.log("Key timestamps available:", keyTimestamps);

			// Chunk if too large
			const MAX_CHARS = 60000;
			if (subtitlesText.length > MAX_CHARS) {
				console.log("Subtitles are large, using chunked summarization...");
				try {
					this.summary = await this.summarizeInChunks(subtitlesText, videoTitle, keyTimestamps);
					this.displaySummary();
					this.switchTab("summary");
					return;
				} catch (e) {
					console.error("Chunked summarization failed:", e);
					this.showError(e.message || "Failed to generate summary");
					return;
				}
			}

			// Simple path with retries
			let lastError = null;
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					const response = await chrome.runtime.sendMessage({
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
					lastError = error.message || "Unknown error";
				}
				if (attempt < 3) await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
			}
			this.showError(lastError || "Failed to generate summary after multiple attempts");
		} catch (error) {
			console.error("Error generating summary:", error);
			console.error("Error details:", {
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

	// Split subtitles into chunks, summarize each, then combine
	async summarizeInChunks(subtitlesText, videoTitle, keyTimestamps) {
		const CHUNK_SIZE = 30000; // increase per-chunk payload to reduce number of round trips
		const INTER_CHUNK_DELAY_MS = 800; // shorter delay between chunk requests to speed up
		const MAX_RETRIES_PER_CHUNK = 4;
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
		const chunkSummaries = [];
		// Initialize progress; total is number of chunks
		this.generationProgress = { current: 0, total: chunks.length };
		this.updateGenerateButton(true);
		for (let i = 0; i < chunks.length; i++) {
			// Update progress before sending each chunk
			this.generationProgress = { current: i + 1, total: chunks.length };
			this.updateGenerateButton(true);
			const timestampReference = this.buildTimestampReferenceForIndices(chunks[i].indices, 20);
			const prompt = `You will receive a chunk (${i + 1}/${
				chunks.length
			}) of subtitles for the YouTube video titled "${videoTitle}". Summarize ONLY this chunk with clear sections (##) and keep it concise.

Chunk content:
${chunks[i].text}

Available timestamps from this chunk (use only these when referencing moments):
${timestampReference}

IMPORTANT: Only use timestamps listed above when referencing specific moments. Do not make up timestamps.`;
			let attempt = 0;
			let success = false;
			let lastError = null;
			while (attempt < MAX_RETRIES_PER_CHUNK && !success) {
				try {
					const res = await chrome.runtime.sendMessage({
						action: "summarize",
						customPrompt: prompt,
						meta: { ...meta, phase: "chunk", index: i + 1, total: chunks.length },
					});
					if (!res || !res.success) throw new Error(res?.error || "Failed to summarize chunk");
					chunkSummaries.push(res.summary);
					success = true;
				} catch (e) {
					lastError = e;
					const backoffMs = Math.min(10000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
					await new Promise((r) => setTimeout(r, backoffMs));
					attempt += 1;
				}
			}
			if (!success) throw new Error(lastError?.message || "Failed to summarize chunk after retries");
			// Small delay between chunks to avoid rate limits
			if (i < chunks.length - 1) {
				await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
			}
		}

		// Combine hierarchically in batches to keep prompt sizes small
		const batchSize = 5; // combine more parts per batch to reduce combine rounds
		let currentLevel = chunkSummaries.slice();
		const combineOneBatch = async (batch, title) => {
			const globalTsRef = this.buildTimestampReferenceFromKeyTimestamps(keyTimestamps);
			const combinePrompt = `You are given ${
				batch.length
			} partial summaries for the YouTube video titled "${title}". Merge them into one concise, non-redundant summary with the structure:

## Main Topic
## Key Points
## Important Insights
## Notable Details
## Overall Message

Avoid duplication. Use only the timestamps listed below when referencing specific moments.

Available timestamps from the video:
${globalTsRef}

Partial summaries:

${batch
	.map(
		(s, idx) => `Part ${idx + 1}:
${s}`
	)
	.join("\n\n")}`;
			let attempt = 0;
			while (attempt < 4) {
				try {
					const res = await chrome.runtime.sendMessage({ action: "summarize", customPrompt: combinePrompt, meta: { ...meta, phase: "combine" } });
					if (!res || !res.success) throw new Error(res?.error || "Failed to combine batch");
					return res.summary;
				} catch (e) {
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
				// Delay between batch combines
				await new Promise((r) => setTimeout(r, 700));
			}
			currentLevel = nextLevel;
		}

		// Clear progress after combine
		this.generationProgress = null;
		this.updateGenerateButton(true);
		return currentLevel[0];
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
					} else if (this.subtitles.length > 0) {
						summarizeBtn.innerHTML = `
								<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
									<path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
								</svg>
								<span>Generate Summary</span>
							`;
					} else {
						summarizeBtn.innerHTML = `
								<svg class="btn-icon" viewBox="0 0 16 16" fill="currentColor">
									<path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
								</svg>
								<span>Waiting for Subtitles...</span>
							`;
					}
					summarizeBtn.classList.remove("loading");
				}
			}
		} catch (error) {
			console.error("Error updating generate button:", error);
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
			console.error("Error getting video title:", error);
			return "YouTube Video";
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
			}
		} catch (error) {
			console.error("Error displaying summary:", error);
		}
	}

	formatSummaryContent(summary) {
		try {
			// Convert markdown-style headers to HTML
			let formatted = summary
				// Convert ## Main Headers to h1
				.replace(/^##\s+(.+)$/gm, "<h1>$1</h1>")
				// Convert ### Sub Headers to h2
				.replace(/^###\s+(.+)$/gm, "<h2>$1</h2>")
				// Convert #### Sub-sub Headers to h3
				.replace(/^####\s+(.+)$/gm, "<h3>$1</h3>")
				// Convert ##### Sub-sub-sub Headers to h4
				.replace(/^#####\s+(.+)$/gm, "<h4>$1</h4>")
				// Convert **bold text** to <strong>
				.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
				// Convert *italic text* to <em>
				.replace(/\*(.+?)\*/g, "<em>$1</em>")
				// Convert paragraphs (double line breaks)
				.replace(/\n\n/g, "</p><p>")
				// Wrap in paragraph tags
				.replace(/^(.+)$/gm, "<p>$1</p>")
				// Clean up empty paragraphs
				.replace(/<p><\/p>/g, "")
				// Clean up consecutive paragraph tags
				.replace(/<\/p><p>/g, "</p>\n<p>");

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
			console.error("Error formatting summary content:", error);
			return `<p>${summary}</p>`;
		}
	}

	showError(message) {
		try {
			const summaryContent = document.getElementById("summary-content");
			if (summaryContent) {
				summaryContent.innerHTML = `
        <div class="error-message">
          <p>❌ ${message}</p>
        </div>
      `;
			}
		} catch (error) {
			console.error("Error showing error message:", error);
		}
	}

	showLoading(show) {
		try {
			const loadingIndicator = document.getElementById("loading-indicator");
			if (loadingIndicator) {
				loadingIndicator.style.display = show ? "block" : "none";
			}
		} catch (error) {
			console.error("Error showing loading state:", error);
		}
	}

	setupThemeDetection() {
		try {
			// Initial theme detection
			this.detectAndApplyTheme();

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
			console.error("Error setting up theme detection:", error);
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
			}
		} catch (error) {
			console.error("Error detecting and applying theme:", error);
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
			console.error("Error detecting YouTube dark mode:", error);
			return false;
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
	console.error("Error initializing YouTube Summarizer:", error);
}
