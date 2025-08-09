// Background script for YouTube Video Summarizer
class BackgroundHandler {
	constructor() {
		// Simple client-side rate limiter for outbound API requests
		this.lastRequestTimeMs = 0;
		this.minRequestIntervalMs = 900; // lower spacing for faster throughput; retries/backoff still protect limits
		this.maxRetries = 4; // max retries on 429/5xx
		this.baseBackoffMs = 1000; // starting backoff
		this.setupMessageListener();
	}

	setupMessageListener() {
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			if (request.action === "summarize") {
				this.handleSummarizeRequest(request, sendResponse);
				return true; // Keep the message channel open for async response
			} else if (request.action === "query") {
				this.handleQueryRequest(request, sendResponse);
				return true; // Keep the message channel open for async response
			}
		});
	}

	async handleSummarizeRequest(request, sendResponse) {
		try {
			console.log("Background script received summarize request");
			console.log("Request details:", {
				subtitlesLength: request.subtitles ? request.subtitles.length : 0,
				videoTitle: request.videoTitle,
				hasSubtitles: !!request.subtitles,
				meta: request.meta || null,
			});

			// Only require subtitles when not using a custom prompt (chunked flow)
			if (!request.customPrompt && (!request.subtitles || request.subtitles.trim().length === 0)) {
				throw new Error("No subtitles provided for summarization");
			}

			// Support custom prompts for chunked combine flow
			let summary;
			if (request.customPrompt) {
				summary = await this.callProxySummarize(request.customPrompt, request.meta);
			} else {
				summary = await this.callOpenRouterAPI(request.subtitles, request.videoTitle, request.keyTimestamps, request.meta);
			}

			console.log("Summary generated successfully in background script");
			sendResponse({
				success: true,
				summary: summary,
			});
		} catch (error) {
			console.error("Error in background script:", error);
			console.error("Error details:", {
				message: error.message,
				stack: error.stack,
				requestSubtitlesLength: request.subtitles ? request.subtitles.length : 0,
			});
			sendResponse({
				success: false,
				error: error.message || "Failed to generate summary",
			});
		}
	}

	async callOpenRouterAPI(subtitles, videoTitle, keyTimestamps = [], meta = undefined) {
		try {
			console.log("Calling proxy (summarize)...");
			const prompt = this.createSummaryPrompt(subtitles, videoTitle, keyTimestamps);
			return await this.callProxySummarize(prompt, meta);
		} catch (error) {
			console.error("Error in callOpenRouterAPI:", error);
			throw error;
		}
	}

	async handleQueryRequest(request, sendResponse) {
		try {
			let answer;
			if (request.customPrompt) {
				answer = await this.callProxyQuery(request.customPrompt, request.meta);
			} else {
				answer = await this.callOpenRouterQueryAPI(
					request.query,
					request.videoTitle,
					request.summary,
					request.relevantSubtitles,
					request.keyTimestamps,
					request.meta
				);
			}

			sendResponse({
				success: true,
				answer: answer,
			});
		} catch (error) {
			console.error("Error in background script:", error);
			sendResponse({
				success: false,
				error: error.message || "Failed to get answer",
			});
		}
	}

	async callOpenRouterQueryAPI(query, videoTitle, summary, relevantSubtitles, keyTimestamps = [], meta = undefined) {
		const prompt = this.createQueryPrompt(query, videoTitle, summary, relevantSubtitles, keyTimestamps);
		return await this.callProxyQuery(prompt, meta);
	}

	async callProxySummarize(prompt, meta = undefined) {
		const baseUrl = await this.getProxyBaseUrl();
		const res = await this.fetchWithBackoff(`${baseUrl}/api/summarize`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Correlation-Id": meta?.runId || "" },
			body: JSON.stringify({ prompt, meta }),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error || `Proxy summarize failed (${res.status})`);
		}
		return data.summary;
	}

	async callProxyQuery(prompt, meta = undefined) {
		const baseUrl = await this.getProxyBaseUrl();
		const res = await this.fetchWithBackoff(`${baseUrl}/api/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Correlation-Id": meta?.runId || "" },
			body: JSON.stringify({ prompt, meta }),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error || `Proxy query failed (${res.status})`);
		}
		return data.answer;
	}

	async fetchWithBackoff(url, options = {}) {
		// Enforce minimum interval between requests
		const now = Date.now();
		const waitMs = Math.max(0, this.lastRequestTimeMs + this.minRequestIntervalMs - now);
		if (waitMs > 0) {
			await new Promise((r) => setTimeout(r, waitMs));
		}

		let attempt = 0;
		let lastError;
		while (attempt <= this.maxRetries) {
			try {
				this.lastRequestTimeMs = Date.now();
				const res = await fetch(url, options);
				if (res.ok) return res;

				const status = res.status;
				if (status === 429 || (status >= 500 && status <= 599)) {
					// Respect Retry-After if present
					const retryAfterHeader = res.headers?.get?.("retry-after");
					let delayMs = 0;
					if (retryAfterHeader) {
						const ra = parseInt(retryAfterHeader, 10);
						if (!Number.isNaN(ra)) delayMs = ra * 1000;
					}
					if (delayMs === 0) {
						delayMs = Math.min(30000, this.baseBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
					}
					await new Promise((r) => setTimeout(r, delayMs));
					attempt += 1;
					continue;
				}

				// Non-retryable status
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.error || `Request failed (${status})`);
			} catch (err) {
				lastError = err;
				// Network errors: retry with backoff
				const delayMs = Math.min(30000, this.baseBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
				await new Promise((r) => setTimeout(r, delayMs));
				attempt += 1;
			}
		}
		throw new Error(lastError?.message || "Request failed after retries");
	}

	getProxyBaseUrl() {
		return new Promise((resolve) => {
			try {
				chrome.storage?.sync?.get({ proxyBaseUrl: "https://youtube-summary-ashy.vercel.app" }, (items) => {
					resolve(items.proxyBaseUrl || "https://youtube-summary-ashy.vercel.app");
				});
			} catch (e) {
				resolve("https://youtube-summary-ashy.vercel.app");
			}
		});
	}

	createSummaryPrompt(subtitles, videoTitle, keyTimestamps = []) {
		// Create a reference section with actual timestamps from the video
		let timestampReference = "";
		if (keyTimestamps && keyTimestamps.length > 0) {
			timestampReference = `

Available timestamps from the video (use these when referencing specific moments):
${keyTimestamps.map((ts) => `• [${ts.formatted}] - "${ts.content.trim()}"`).join("\n")}

IMPORTANT: Only use the timestamps listed above when referencing specific moments in the video. Do not make up timestamps that don't correspond to real content. Each timestamp corresponds to actual subtitle content from the video.`;
		}

		return `Please provide a concise, well-structured summary of this YouTube video based on its subtitles.

Video Title: ${videoTitle}

Subtitles:
${subtitles}${timestampReference}

Please create a summary with the following structure:

## Main Topic
Brief overview of what the video covers

## Key Points
Point 1 (use timestamps from the list above when referencing specific content)
Point 2 (use timestamps from the list above when referencing specific content)
Point 3 (use timestamps from the list above when referencing specific content)

## Important Insights
Insight 1 (use timestamps from the list above when referencing specific content)
Insight 2 (use timestamps from the list above when referencing specific content)

## Notable Details
Detail 1 (use timestamps from the list above when referencing specific content)
Detail 2 (use timestamps from the list above when referencing specific content)

## Overall Message
Main takeaway or conclusion

IMPORTANT: Only use timestamps that are listed in the "Available timestamps" section above. Do not make up timestamps that don't correspond to real content. If you reference a specific point, use one of the provided timestamps.

Keep each section concise with 2-4 points maximum. Use **bold text** to highlight key terms, features, or important concepts. Include timestamps in the format [MM:SS] or [HH:MM:SS] when referencing specific moments, events, or important points from the video. Use clear, simple language and focus on the most important information only.`;
	}

	createQueryPrompt(query, videoTitle, summary, relevantSubtitles, keyTimestamps = []) {
		// Create a reference section with actual timestamps from the video
		let timestampReference = "";
		if (keyTimestamps && keyTimestamps.length > 0) {
			timestampReference = `

Available timestamps from the video (use these when referencing specific moments):
${keyTimestamps.map((ts) => `• [${ts.formatted}] - "${ts.content.trim()}"`).join("\n")}

IMPORTANT: Only use the timestamps listed above when referencing specific moments in the video. Do not make up timestamps that don't correspond to real content. Each timestamp corresponds to actual subtitle content from the video.`;
		}

		return `Please answer the following question about this YouTube video based on the provided context.

Video Title: ${videoTitle}

Question: ${query}

Video Summary:
${summary}

	Relevant Subtitles (compact context):
	${relevantSubtitles || ""}${timestampReference}

Please provide a beautiful, well-structured answer with logical sections. Organize your response as follows:

## Direct Answer
Provide the main answer to the question

## Key Details
• Include important supporting information (use timestamps from the list above when referencing specific content)
• Add relevant context and background (use timestamps from the list above when referencing specific content)

## Supporting Evidence
• Reference specific points from the video (use timestamps from the list above when referencing specific content)
• Include relevant examples or explanations (use timestamps from the list above when referencing specific content)
• Use **bold text** to highlight key terms, features, or important concepts

## Additional Context
• Any related information that enhances understanding (use timestamps from the list above when referencing specific content)
• Important caveats or clarifications (use timestamps from the list above when referencing specific content)

Use bullet points (•) for general information and numbered bullets (1., 2., 3.) when presenting steps, sequences, or ordered lists. Use **bold text** to highlight important terms, features, or concepts. Include timestamps in the format [MM:SS] or [HH:MM:SS] when referencing specific moments, events, or important points from the video. Keep each section concise with 2-4 points maximum.

If the question cannot be answered from the available information, clearly state "This information is not available in the video content."`;
	}
}

// Initialize the background handler
new BackgroundHandler();
