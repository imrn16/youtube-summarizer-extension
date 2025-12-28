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
				const DEFAULT_PROXY_URL = "https://youtube-summary-ashy.vercel.app";
				chrome.storage?.sync?.get({ proxyBaseUrl: DEFAULT_PROXY_URL }, (items) => {
					const url = items.proxyBaseUrl || DEFAULT_PROXY_URL;
					// Basic URL validation
					try {
						new URL(url);
						resolve(url);
					} catch {
						// Invalid URL, use default
						resolve(DEFAULT_PROXY_URL);
					}
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

IMPORTANT TIMESTAMP SELECTION RULES:
- Only use the timestamps listed above when referencing specific moments in the video. Do not make up timestamps that don't correspond to real content.
- Each timestamp corresponds to actual subtitle content from the video.
- When selecting a timestamp for a bullet point:
  1. FIRST, try to find an exact match where the timestamp content directly relates to your bullet point
  2. If no exact match exists, find the CLOSEST TIMESTAMP IN TIME that relates to the general time period when that content was discussed
  3. Use temporal proximity - if content was discussed around 5:30, use timestamps near that time (e.g., 5:25, 5:28, 5:32, 5:35) even if the exact words don't match
  4. The goal is to help users jump to the right general time period in the video, so approximate timestamps are better than no timestamp`;
		}

		return `Please provide a concise, well-structured summary of this YouTube video based on its subtitles. This summary must cover the ENTIRE video from start to finish with even coverage.

Video Title: ${videoTitle}

Subtitles:
${subtitles}${timestampReference}

CRITICAL: This video may be long. You MUST ensure that:
- The summary covers the ENTIRE video from beginning to end
- Content is distributed EVENLY across the video timeline
- Later parts of the video are NOT omitted or cut short
- The summary maintains consistent detail throughout, not just at the beginning
- If the video is long, ensure you include content from all parts, especially the middle and end sections

Please create a summary organized into logical sections that follow the order and flow of the video content. Analyze the subtitles to identify natural thematic or chronological sections, then create section headers that accurately describe each part of the video.

CRITICAL FORMATTING REQUIREMENT:
- START YOUR RESPONSE DIRECTLY WITH "## Overview"
- DO NOT include any introductory text, explanations, or meta-commentary before the summary
- DO NOT write phrases like "Here's a summary" or "Okay, here's..." or any similar introductory text
- Begin immediately with the markdown structure: ## Overview

Structure your summary as follows:

## Overview
Brief 1-2 sentence overview of what the video covers

## [Section Name 1]
• Bullet point summarizing content from this section [MM:SS]
• Another bullet point if there's more content to cover [MM:SS]
• Add as many bullets as needed based on the amount of content in this section [MM:SS]

## [Section Name 2]
• Content from this section [MM:SS]
• More content as needed [MM:SS]

[Continue with additional sections as needed based on the video's content structure]

## Key Takeaways
Main conclusions or important points from the video

CRITICAL REQUIREMENTS:
- EVERY bullet point MUST include a timestamp in [MM:SS] or [HH:MM:SS] format
- TIMESTAMP SELECTION STRATEGY: When choosing a timestamp for a bullet point:
  1. FIRST, try to find an exact match where the timestamp content directly relates to your bullet point
  2. If no exact match exists, find the CLOSEST TIMESTAMP IN TIME to when that content was discussed. Use temporal proximity - if content was discussed around 5:30, use timestamps near that time (5:25, 5:28, 5:32, 5:35, etc.) even if the exact words don't match perfectly
  3. The goal is to help users jump to the right general time period, so approximate timestamps based on time proximity are acceptable and preferred
- Use the timestamps from the "Available timestamps" section above - match each bullet point to the most relevant timestamp based on content OR time proximity
- If a bullet covers content from multiple timestamps or time periods, use the timestamp that best represents the main point or the earliest relevant timestamp from that time period
- Create section headers that logically group the video's content (e.g., "Introduction", "Main Concepts", "Examples", "Conclusion", or topic-specific headers)
- Order sections chronologically as they appear in the video
- Include as many bullet points per section as needed to adequately summarize the content - don't limit yourself to a fixed number
- Use **bold text** EXTENSIVELY - bold at least 2-4 key words or phrases in EVERY bullet point to improve readability and visual scanning
- Bold important terms, concepts, numbers, statistics, names, features, actions, and key takeaways
- Add relevant emojis to section headers to make them more visually engaging (e.g., 📝 Introduction, 💡 Key Concepts, 🎯 Main Points, ⚠️ Important Notes, ✅ Conclusion, 🔑 Key Takeaways)
- Use emojis that match the content theme - be creative but relevant
- Make the summary highly scannable by bolding the most important information in each bullet
- Only use timestamps that are listed in the "Available timestamps" section above - do not make up timestamps
- Use clear, simple language and focus on the most important information
- The number of sections and bullets should be determined by the actual content structure, not a fixed template
- Format important information prominently: use **bold** for statistics, key facts, main takeaways, and significant points
- Aim for 30-50% of each bullet point to be bolded for optimal readability`;
	}

	createQueryPrompt(query, videoTitle, summary, relevantSubtitles, keyTimestamps = []) {
		// Create a reference section with actual timestamps from the video
		let timestampReference = "";
		if (keyTimestamps && keyTimestamps.length > 0) {
			timestampReference = `

Available timestamps from the video (use these when referencing specific moments):
${keyTimestamps.map((ts) => `• [${ts.formatted}] - "${ts.content.trim()}"`).join("\n")}

IMPORTANT TIMESTAMP SELECTION RULES:
- Only use the timestamps listed above when referencing specific moments in the video. Do not make up timestamps that don't correspond to real content.
- Each timestamp corresponds to actual subtitle content from the video.
- When selecting a timestamp for a bullet point:
  1. FIRST, try to find an exact match where the timestamp content directly relates to your bullet point
  2. If no exact match exists, find the CLOSEST TIMESTAMP IN TIME that relates to the general time period when that content was discussed
  3. Use temporal proximity - if content was discussed around 5:30, use timestamps near that time (e.g., 5:25, 5:28, 5:32, 5:35) even if the exact words don't match
  4. The goal is to help users jump to the right general time period in the video, so approximate timestamps are better than no timestamp`;
		}

		return `Please answer the following question about this YouTube video based on the provided context.

Video Title: ${videoTitle}

Question: ${query}

Video Summary:
${summary}

	Relevant Subtitles (compact context):
	${relevantSubtitles || ""}${timestampReference}

Please provide a beautiful, well-structured answer organized into logical sections that follow the EXACT same format as the video summary. You MUST use proper markdown formatting with ## for headers and • for bullets.

EXACT FORMAT REQUIREMENTS:
- Section headers MUST start with ## followed by a space, then an emoji, then the section name
- Bullet points MUST start with • followed by a space
- Timestamps MUST be in square brackets [MM:SS] or [HH:MM:SS] at the END of each bullet point
- Bold text MUST use **text** format (double asterisks)

Structure your answer EXACTLY as follows:

## 📝 Overview
Brief 1-2 sentence overview of the answer

## 💡 [Section Name 1]
• **Bullet point** answering the question with **key information** [MM:SS]
• Another **bullet point** if there's **more content** to cover [MM:SS]
• Add as many **bullets** as needed based on the **amount of content** in this section [MM:SS]

## 🎯 [Section Name 2]
• **Content** from this section [MM:SS]
• More **content** as needed [MM:SS]

[Continue with additional sections as needed based on the answer's content structure, using relevant emojis like ⚠️, ✅, 🔑, 📊, 🎓]

## ✅ Key Takeaways
Main conclusions or important points from the answer

CRITICAL FORMATTING RULES - FOLLOW EXACTLY:
1. Headers: ALWAYS use ## followed by space, emoji, space, then header name. Example: ## 📝 Overview
2. Bullets: ALWAYS use • (bullet character) followed by space, then content, then timestamp in brackets at the end. Example: • **Content here** [MM:SS]
3. NEVER use single asterisks (*) for headers or bullets
4. NEVER wrap headers in asterisks like * **Header** *
5. NEVER put timestamps at the start of bullets - always at the end in brackets
6. EVERY bullet point MUST include a timestamp in [MM:SS] or [HH:MM:SS] format at the END. This is ABSOLUTELY MANDATORY - you MUST find and include a timestamp from the "Available timestamps" section for EVERY bullet point. There is NO exception - if you cannot find a perfect match, use the closest timestamp in TIME that corresponds to when that content was discussed. NEVER write messages like "no timestamp available" or "no direct timestamp" - ALWAYS include a timestamp.
7. TIMESTAMP SELECTION STRATEGY: When choosing a timestamp for a bullet point:
   - FIRST priority: Find an exact match where the timestamp content directly relates to your bullet point
   - SECOND priority: If no exact match, find the CLOSEST TIMESTAMP IN TIME to when that content was discussed. Use temporal proximity - if you're discussing content from around 5:30, use timestamps near that time (5:25, 5:28, 5:32, 5:35, etc.) even if the exact words don't match perfectly
   - The goal is to help users jump to the right general time period, so approximate timestamps based on time proximity are acceptable and preferred over omitting timestamps
8. If a bullet covers content from multiple timestamps or time periods, use the timestamp that best represents the main point or the earliest relevant timestamp from that time period
9. When answering questions, EVERY bullet point MUST have a timestamp - aim for 100% timestamp coverage. Timestamps make answers much more useful by allowing users to jump directly to relevant video moments.
10. NEVER include explanatory text about missing timestamps. NEVER write phrases like "no timestamp available", "no direct timestamp", "timestamp not found", "[N/A]", or any variation. Simply include the best matching timestamp from the available list.
11. Create section headers that logically group your answer (e.g., "📝 Overview", "💡 Main Answer", "🎯 Supporting Details", "✅ Conclusion", or topic-specific headers), including a relevant emoji at the start of each header
12. Order sections logically to best answer the question
13. Include as many bullet points per section as needed to adequately answer the question - don't limit yourself to a fixed number
14. Use **bold text** extensively to highlight key terms, important concepts, main points, features, names, numbers, and any critical information. Aim for 2-4 bolded words/phrases per bullet point, making 30-50% of the bullet bolded.
15. Make the answer visually engaging by using **bold** for emphasis on important words and phrases throughout.
16. Only use timestamps that are listed in the "Available timestamps" section above - do not make up timestamps
17. Use clear, simple language and focus on the most important information
18. The number of sections and bullets should be determined by the actual content needed to answer the question, not a fixed template
19. Format important information prominently: use **bold** for statistics, key facts, main takeaways, and significant points
20. If the question cannot be answered from the available information, clearly state "This information is not available in the video content."

REMEMBER: Use ## for headers, • for bullets, [MM:SS] for timestamps at the END of bullets, and **text** for bold. Do NOT use single asterisks or wrap headers in asterisks.`;
	}
}

// Initialize the background handler
new BackgroundHandler();
