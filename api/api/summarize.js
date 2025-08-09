// Vercel Serverless Function: /api/summarize
// Stores the API key in env and proxies to OpenRouter. No CORS restrictions by default.

export default async function handler(request, response) {
	// Prepare diagnostics variables so they're always defined
	const startMs = Date.now();
	let correlationId = (request.headers["x-correlation-id"] || "").toString();
	let bodyMeta;
	try {
		if (request.method !== "POST") {
			return response.status(405).json({ error: "Method not allowed" });
		}

		const { prompt, meta } = await getJson(request);
		bodyMeta = meta;
		if (!prompt || typeof prompt !== "string") {
			return response.status(400).json({ error: "Missing or invalid prompt" });
		}

		// Basic size limits to protect your key and costs
		if (prompt.length > 60000) {
			return response.status(413).json({ error: "Prompt too large" });
		}

		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			return response.status(500).json({ error: "Server misconfigured: missing OPENROUTER_API_KEY" });
		}

		const model = process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free";

		// Apply server-side retry with backoff for upstream rate limits
		// Prefer header correlation id; fallback to body meta
		if (!correlationId && meta?.runId) correlationId = String(meta.runId);
		const openrouterRes = await fetchWithRetries("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"HTTP-Referer": "https://www.youtube.com",
				"X-Title": "YouTube Video Summarizer",
				"X-Correlation-Id": correlationId,
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "system",
						content: "You are a helpful assistant that creates concise, well-structured summaries. Use clear section headers (##). Prefer short, high-signal text. Use **bold** sparingly for emphasis.",
					},
					{ role: "user", content: prompt },
				],
				max_tokens: 2000,
				temperature: 0.7,
			}),
		});

		if (!openrouterRes.ok) {
			const err = await safeJson(openrouterRes);
			const retryAfter = openrouterRes.headers?.get?.("retry-after");
			return response.status(openrouterRes.status).json({
				error: err?.error?.message || "Upstream error",
				upstreamStatus: openrouterRes.status,
				retryAfter: retryAfter || null,
				correlationId,
				durationMs: Date.now() - startMs,
			});
		}

		const data = await safeJson(openrouterRes);
		const summary = data?.choices?.[0]?.message?.content;
		if (!summary) {
			return response.status(502).json({ error: "Invalid response from model", correlationId, durationMs: Date.now() - startMs });
		}

		return response.status(200).json({ summary, correlationId, durationMs: Date.now() - startMs });
	} catch (e) {
		// Use header or parsed body meta if available
		const fallbackCorrelation = correlationId || (typeof bodyMeta?.runId === "string" ? bodyMeta.runId : undefined);
		return response.status(500).json({ error: e?.message || "Unexpected error", correlationId: fallbackCorrelation, durationMs: Date.now() - startMs });
	}
}

async function fetchWithRetries(url, options, { maxRetries = 4, baseBackoffMs = 500 } = {}) {
	let attempt = 0;
	let lastError;
	while (attempt <= maxRetries) {
		try {
			const res = await fetch(url, options);
			if (res.ok) return res;
			const status = res.status;
			if (status === 429 || (status >= 500 && status <= 599)) {
				// Respect Retry-After
				const retryAfterHeader = res.headers?.get?.("retry-after");
				let delayMs = 0;
				if (retryAfterHeader) {
					const ra = parseInt(retryAfterHeader, 10);
					if (!Number.isNaN(ra)) delayMs = ra * 1000;
				}
				if (delayMs === 0) delayMs = Math.min(15000, baseBackoffMs * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
				await new Promise((r) => setTimeout(r, delayMs));
				attempt += 1;
				continue;
			}
			// Non-retryable
			return res;
		} catch (e) {
			lastError = e;
			const delayMs = Math.min(15000, baseBackoffMs * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
			await new Promise((r) => setTimeout(r, delayMs));
			attempt += 1;
		}
	}
	throw lastError || new Error("Request failed after retries");
}

async function getJson(req) {
	if (typeof req.json === "function") return req.json();
	// Fallback for some runtimes
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8");
	return JSON.parse(text || "{}");
}

async function safeJson(res) {
	try {
		return await res.json();
	} catch {
		return null;
	}
}
