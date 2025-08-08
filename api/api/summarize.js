// Vercel Serverless Function: /api/summarize
// Stores the API key in env and proxies to OpenRouter. No CORS restrictions by default.

export default async function handler(request, response) {
	try {
		if (request.method !== "POST") {
			return response.status(405).json({ error: "Method not allowed" });
		}

		const { prompt } = await getJson(request);
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

		const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"HTTP-Referer": "https://www.youtube.com",
				"X-Title": "YouTube Video Summarizer",
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
			return response.status(openrouterRes.status).json({ error: err?.error?.message || "Upstream error" });
		}

		const data = await openrouterRes.json();
		const summary = data?.choices?.[0]?.message?.content;
		if (!summary) {
			return response.status(502).json({ error: "Invalid response from model" });
		}

		return response.status(200).json({ summary });
	} catch (e) {
		return response.status(500).json({ error: e?.message || "Unexpected error" });
	}
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
