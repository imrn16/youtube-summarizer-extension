# YouTube Video Summarizer

A Chrome extension that extracts English subtitles from YouTube videos and uses AI to generate comprehensive summaries. The summary is displayed inline on the YouTube page, above the suggested videos list.

## Features

- 🎬 **Automatic subtitle extraction** from YouTube videos
- 🤖 **AI-powered summarization** via a tiny Vercel proxy (your key stays server-side)
- 📱 **Inline display** - summaries appear directly on the YouTube page
- 🔒 **Key stays private** - stored as an env var on your Vercel function
- 📝 **Multiple subtitle extraction methods** for better coverage
- 🔄 **Auto-generated captions support** - works even without manual subtitles

## Installation

1. **Download or clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer mode** by toggling the switch in the top right
4. **Click "Load unpacked"** and select the folder containing this extension
5. **Pin the extension** to your toolbar for easy access

## Usage

1. **Navigate to any YouTube video** (with or without manual subtitles)
2. **Wait for the page to load** - the extension will automatically detect available subtitles
3. **Click "Generate Summary"** in the summary panel that appears above the suggested videos
4. **Wait for the AI to process** and generate a comprehensive summary
5. **Read the summary** displayed inline on the page

## How it Works

### Subtitle Extraction

The extension uses multiple methods to extract subtitles:

- **Transcript panel** - Extracts from YouTube's transcript feature (manual and auto-generated)
- **Caption overlay** - Captures live captions during video playback
- **Subtitle tracks** - Accesses the video's embedded subtitle data
- **Auto-generated captions** - Automatically enables and extracts auto-generated English captions when manual subtitles aren't available

### AI Summarization (through Vercel proxy)

- A minimal serverless function on Vercel proxies requests to OpenRouter
- Your API key is stored as `OPENROUTER_API_KEY` in Vercel env vars
- The extension never ships or stores your key client-side

### Display

- Summary appears in a clean, styled panel above the suggested videos
- Matches YouTube's design language for seamless integration
- Responsive design that works on different screen sizes

## Technical Details

- **Manifest V3** compliant Chrome extension
- **Content script** injection for YouTube video pages
- **Background service worker** for proxy communication
- **Vercel serverless functions** hold the API key securely
- **MutationObserver** for dynamic subtitle detection
- **Automatic caption enabling** for videos without manual subtitles

## Troubleshooting

### No subtitles found

- The extension will automatically try to enable auto-generated captions
- Some videos may not have any captions available
- Try refreshing the page and waiting for it to fully load
- Check if the video has auto-generated captions available

### Summary not generating

- Check your internet connection
- Verify the extension has the necessary permissions
- Try refreshing the page and clicking "Generate Summary" again
- Contact the extension developer if issues persist

## Privacy & Security

- **No secrets shipped** in the extension. The key lives in Vercel env vars
- **Only subtitles, title, and prompt** are proxied to the AI provider
- **Optional per-user key**: alternatively let users paste their own key in options

## Development

To modify or extend this extension:

1. **Clone the repository**
2. **Deploy the Vercel functions**
      - Create a Vercel project, add `api/summarize.js` and `api/query.js`
      - Set env var `OPENROUTER_API_KEY` (and optional `OPENROUTER_MODEL`)
3. **Set proxy URL**: In Chrome, set `proxyBaseUrl` (via options page or `chrome.storage.sync`) to your Vercel URL
4. **Reload the extension** in Chrome's extension manager
5. **Test on YouTube videos** to verify functionality

### File Structure

```
youtube-summarizer-extension/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── popup.css             # Popup styling
├── content.js            # YouTube page integration
├── background.js         # Proxy communication (no key in client)
├── api/                  # Vercel serverless functions (deploy on Vercel)
│   ├── summarize.js      # Summarization proxy (uses OPENROUTER_API_KEY)
│   └── query.js          # Query proxy (uses OPENROUTER_API_KEY)
├── styles.css            # Inline summary styling
└── README.md            # This file
```

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or contributions, please open an issue on the project repository.
