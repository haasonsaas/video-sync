// Video Sync - Offscreen Document
// Handles PeerJS connections (persists unlike service worker)

let peer = null;
let connections = new Map();
let sessionCode = null;
let isHost = false;

// Generate a random 6-character session code
function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function sessionCodeToPeerId(code) {
  return `videosync-${code.toUpperCase()}`;
}

// Send message to background script
function sendToBackground(action, data = {}) {
  chrome.runtime.sendMessage({ target: 'background', action, ...data });
}

// Initialize PeerJS
function initPeer(peerId = null) {
  return new Promise((resolve, reject) => {
    console.log('[VideoSync Offscreen] Initializing peer...', peerId);

    peer = new Peer(peerId, {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout - could not reach signaling server'));
    }, 15000);

    peer.on('open', (id) => {
      clearTimeout(timeout);
      console.log('[VideoSync Offscreen] Peer open with ID:', id);
      sendToBackground('peer-ready', { peerId: id });
      resolve(id);
    });

    peer.on('connection', (conn) => {
      console.log('[VideoSync Offscreen] Incoming connection:', conn.peer);
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[VideoSync Offscreen] Peer error:', err.type, err);

      if (err.type === 'unavailable-id') {
        reject(new Error('Session code already in use'));
      } else if (err.type === 'peer-unavailable') {
        reject(new Error('Session not found - check the code'));
      } else if (err.type === 'network') {
        reject(new Error('Network error - check your connection'));
      } else if (err.type === 'server-error') {
        reject(new Error('Server error - try again'));
      } else {
        reject(new Error(err.message || 'Connection failed'));
      }
    });

    peer.on('disconnected', () => {
      console.log('[VideoSync Offscreen] Peer disconnected, attempting reconnect...');
      sendToBackground('connection-status', { status: 'reconnecting' });

      // Try to reconnect
      setTimeout(() => {
        if (peer && !peer.destroyed) {
          peer.reconnect();
        }
      }, 1000);
    });

    peer.on('close', () => {
      console.log('[VideoSync Offscreen] Peer closed');
      sendToBackground('connection-status', { status: 'closed' });
    });
  });
}

function setupConnection(conn) {
  console.log('[VideoSync Offscreen] Setting up connection:', conn.peer);

  conn.on('open', () => {
    console.log('[VideoSync Offscreen] Connection open:', conn.peer);
    connections.set(conn.peer, conn);
    sendToBackground('peer-joined', { peerId: conn.peer, count: connections.size + 1 });
  });

  conn.on('data', (data) => {
    console.log('[VideoSync Offscreen] Received data:', data);
    sendToBackground('peer-data', { data, from: conn.peer });

    // Relay to other peers if host
    if (isHost && connections.size > 1) {
      connections.forEach((c, id) => {
        if (id !== conn.peer && c.open) {
          c.send(data);
        }
      });
    }
  });

  conn.on('close', () => {
    console.log('[VideoSync Offscreen] Connection closed:', conn.peer);
    connections.delete(conn.peer);
    sendToBackground('peer-left', { peerId: conn.peer, count: connections.size + 1 });
  });

  conn.on('error', (err) => {
    console.error('[VideoSync Offscreen] Connection error:', err);
    connections.delete(conn.peer);
  });
}

async function createSession() {
  console.log('[VideoSync Offscreen] Creating session...');

  if (peer) {
    peer.destroy();
    connections.clear();
  }

  sessionCode = generateSessionCode();
  isHost = true;

  try {
    await initPeer(sessionCodeToPeerId(sessionCode));
    return { success: true, code: sessionCode, isHost: true };
  } catch (err) {
    if (err.message === 'Session code already in use') {
      // Try again with new code
      return createSession();
    }
    return { success: false, error: err.message };
  }
}

async function joinSession(code) {
  console.log('[VideoSync Offscreen] Joining session:', code);

  if (peer) {
    peer.destroy();
    connections.clear();
  }

  sessionCode = code.toUpperCase();
  isHost = false;

  try {
    await initPeer();

    const hostPeerId = sessionCodeToPeerId(sessionCode);
    console.log('[VideoSync Offscreen] Connecting to host:', hostPeerId);

    const conn = peer.connect(hostPeerId, { reliable: true });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error('Could not connect to session - host may be offline'));
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        console.log('[VideoSync Offscreen] Connected to host');
        setupConnection(conn);
        conn.send({ type: 'sync-request' });
        resolve({ success: true, code: sessionCode, isHost: false });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[VideoSync Offscreen] Failed to connect:', err);
        reject(new Error('Failed to connect to session'));
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function leaveSession() {
  console.log('[VideoSync Offscreen] Leaving session');

  if (peer) {
    peer.destroy();
    peer = null;
  }
  connections.clear();
  sessionCode = null;
  isHost = false;

  return { success: true };
}

function getStatus() {
  return {
    connected: peer !== null && !peer.disconnected && !peer.destroyed,
    sessionCode,
    isHost,
    peerCount: connections.size + (peer && !peer.destroyed ? 1 : 0)
  };
}

function broadcast(data) {
  connections.forEach((conn) => {
    if (conn.open) {
      conn.send(data);
    }
  });
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  console.log('[VideoSync Offscreen] Message:', message.action);

  switch (message.action) {
    case 'create-session':
      createSession().then(sendResponse);
      return true;

    case 'join-session':
      joinSession(message.code).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;

    case 'leave-session':
      sendResponse(leaveSession());
      break;

    case 'get-status':
      sendResponse(getStatus());
      break;

    case 'broadcast':
      broadcast(message.data);
      sendResponse({ success: true });
      break;

    case 'ping':
      sendResponse({ pong: true });
      break;
  }
});

console.log('[VideoSync Offscreen] Loaded and ready');
sendToBackground('offscreen-ready');
