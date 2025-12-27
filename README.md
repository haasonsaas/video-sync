# Video Sync

A Chrome extension that lets you watch videos in sync with friends using peer-to-peer connections. No server required - connects directly between browsers using WebRTC.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **P2P Sync** - Direct browser-to-browser connections via WebRTC (no server needed)
- **Universal Support** - Works with any HTML5 video (YouTube, Netflix, Vimeo, etc.)
- **Real-time Sync** - Play, pause, seek, and speed changes sync instantly
- **Buffering Detection** - Automatically pauses everyone when someone buffers
- **Chat** - Send messages that appear as overlays on the video
- **Nicknames** - See who triggered each action
- **Auto-reconnect** - Handles connection drops gracefully
- **Keyboard Shortcuts** - Quick controls while watching

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| YouTube | ✅ Tested | Full support |
| Netflix | ✅ Tested | Full support |
| Amazon Prime Video | ✅ Tested | Full support |
| Disney+ | ✅ Expected | Standard HTML5 video |
| Hulu | ✅ Expected | Standard HTML5 video |
| HBO Max / Max | ✅ Expected | Standard HTML5 video |
| Twitch | ✅ Expected | Live streams sync too |
| Vimeo | ✅ Expected | Standard HTML5 video |
| Any HTML5 video | ✅ Works | Generic support |

> **Note**: Some sites may have DRM or custom players that could affect sync. If you encounter issues, please open an issue!

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Browser                             │
├──────────────────┬──────────────────┬───────────────────────┤
│   Popup UI       │  Content Script  │   Offscreen Document  │
│  - Join/Create   │  - Video control │   - PeerJS/WebRTC     │
│  - Chat          │  - Sync logic    │   - P2P connections   │
└──────────────────┴──────────────────┴───────────────────────┘
                              │
                    PeerJS Signaling (handshake only)
                              │
                              ▼
                    ┌─────────────────┐
                    │  Friend's       │
                    │  Browser        │
                    └─────────────────┘
```

1. One person creates a session → gets a 6-character code
2. Friends enter the code → direct P2P connection established
3. Anyone plays/pauses/seeks → syncs to everyone instantly

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/video-sync-extension.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in top right)

4. Click **Load unpacked**

5. Select the cloned folder

### Usage

1. Click the Video Sync extension icon
2. Click **Create Session** to start a new room
3. Share the 6-character code with friends
4. Friends click the icon → enter code → **Join**
5. Navigate to any video page and enjoy synced playback!

## Controls

| Action | What Happens |
|--------|--------------|
| Play/Pause | Syncs to all participants |
| Seek | Everyone jumps to the same timestamp |
| Speed change | Playback rate syncs (0.5x, 1x, 2x, etc.) |
| Buffering | Everyone pauses until ready |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + S` | Force sync everyone to your current position |

## Architecture

This extension uses **Manifest V3** with an offscreen document pattern to maintain persistent WebRTC connections:

```
video-sync/
├── manifest.json           # Extension configuration
├── background/
│   └── background.js       # Service worker - message routing
├── offscreen/
│   ├── offscreen.html      # Offscreen document
│   └── offscreen.js        # PeerJS connection management
├── content/
│   └── content.js          # Video detection & sync logic
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Popup styling
│   └── popup.js            # Popup logic
├── lib/
│   └── peerjs.min.js       # PeerJS library
└── icons/
    └── icon-*.png          # Extension icons
```

### Why Offscreen Document?

Manifest V3 service workers terminate after ~30 seconds of inactivity, which breaks WebRTC connections. The offscreen document runs in a persistent context, allowing WebRTC connections to stay alive.

## Technical Details

- **Signaling**: Uses PeerJS cloud (free) for initial handshake only
- **Data Transfer**: Direct P2P via WebRTC DataChannel
- **NAT Traversal**: Google STUN servers for ICE candidates
- **Sync Precision**: ~100-200ms tolerance (imperceptible for video)
- **Topology**: Star topology (host relays to all peers)

## Privacy

- No data is stored on any server
- Video content stays between you and the streaming service
- Only sync commands (play/pause/seek) are sent between peers
- Session codes are randomly generated and ephemeral

## Troubleshooting

### "Session not found"
- Make sure the host hasn't left the session
- Check that you entered the code correctly (case insensitive)

### Video not syncing
- Ensure you're on a page with an HTML5 `<video>` element
- Some sites use custom players - try refreshing

### Connection drops
- The extension auto-reconnects up to 5 times
- If persistent issues, both users should rejoin

### Badge shows "!"
- Connection was lost, attempting to reconnect
- If stuck, leave and rejoin the session

## Development

```bash
# Clone the repo
git clone https://github.com/yourusername/video-sync-extension.git
cd video-sync-extension

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select this folder

# View logs
# - Background: chrome://extensions → Video Sync → "service worker"
# - Offscreen: chrome://extensions → Video Sync → "offscreen.html"
# - Content: Regular DevTools on any page
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this however you'd like.

## Credits

- [PeerJS](https://peerjs.com/) - WebRTC abstraction library
- Icons generated programmatically

---

Made with ❤️ for synchronized movie nights
