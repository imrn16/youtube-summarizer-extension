// Unified configuration for OpenRouter API
// This file centralizes the model selection for all API endpoints

export const OPENROUTER_CONFIG = {
	// Default model to use if OPENROUTER_MODEL env var is not set
	DEFAULT_MODEL: "google/gemini-3-flash-preview",

	//google/gemini-2.0-flash-exp:free
	// Get the model to use, preferring environment variable over default
	getModel() {
		return process.env.OPENROUTER_MODEL || this.DEFAULT_MODEL;
	},
};
