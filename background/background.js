// Video Sync - Background Service Worker
// Manages offscreen document and message routing

let offscreenReady = false;
let sessionCode = null;
let isHost = false;
let peerCount = 0;

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Check if offscreen document exists
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return contexts.length > 0;
}

// Create offscreen document
async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    console.log('[VideoSync] Offscreen document already exists');
    return;
  }

  console.log('[VideoSync] Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['WEB_RTC'],
    justification: 'WebRTC peer connections for video sync'
  });
  console.log('[VideoSync] Offscreen document created');
}

// Send message to offscreen document
async function sendToOffscreen(action, data = {}) {
  await setupOffscreenDocument();
  return chrome.runtime.sendMessage({ target: 'offscreen', action, ...data });
}

// Update badge
function updateBadge(text, color = '#4CAF50') {
  chrome.action.setBadgeText({ text: text || '' });
  chrome.action.setBadgeBackgroundColor({ color });
}

// Enable/disable popup based on session state
function setPopupEnabled(enabled) {
  chrome.action.setPopup({
    popup: enabled ? 'popup/popup.html' : ''
  });
}

// Notify content scripts
function notifyContentScripts(action, data = {}) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action, ...data }).catch(() => {});
    });
  });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle messages from offscreen document
  if (message.target === 'background') {
    handleOffscreenMessage(message);
    return;
  }

  // Handle messages from popup/content scripts
  console.log('[VideoSync] Message:', message.action);

  switch (message.action) {
    case 'create-session':
      handleCreateSession(sendResponse);
      return true;

    case 'join-session':
      handleJoinSession(message.code, sendResponse);
      return true;

    case 'leave-session':
      handleLeaveSession(sendResponse);
      return true;

    case 'get-status':
      handleGetStatus(sendResponse);
      return true;

    case 'video-event':
    case 'sync-response':
      sendToOffscreen('broadcast', { data: message.data }).catch(console.error);
      break;

    case 'send-chat':
      sendToOffscreen('broadcast', {
        data: {
          type: 'chat',
          message: message.message,
          nickname: message.nickname,
          timestamp: Date.now()
        }
      }).catch(console.error);
      // Also show locally
      notifyContentScripts('sync-event', {
        data: {
          type: 'chat',
          message: message.message,
          nickname: message.nickname
        }
      });
      sendResponse({ success: true });
      break;

    case 'get-video-url':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse({ url: tabs[0]?.url || '' });
      });
      return true;
  }
});

async function handleCreateSession(sendResponse) {
  try {
    const result = await sendToOffscreen('create-session');
    if (result.success) {
      sessionCode = result.code;
      isHost = true;
      peerCount = 1;
      updateBadge('0');
      setPopupEnabled(true);
      notifyContentScripts('session-status', { connected: true });

      chrome.storage.local.set({
        lastSession: { code: sessionCode, isHost: true, timestamp: Date.now() }
      });
    }
    sendResponse(result);
  } catch (err) {
    console.error('[VideoSync] Create session error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleJoinSession(code, sendResponse) {
  try {
    const result = await sendToOffscreen('join-session', { code });
    if (result.success) {
      sessionCode = result.code;
      isHost = false;
      peerCount = 2;
      updateBadge('1');
      setPopupEnabled(true);
      notifyContentScripts('session-status', { connected: true });

      chrome.storage.local.set({
        lastSession: { code: sessionCode, isHost: false, timestamp: Date.now() }
      });
    }
    sendResponse(result);
  } catch (err) {
    console.error('[VideoSync] Join session error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleLeaveSession(sendResponse) {
  try {
    const result = await sendToOffscreen('leave-session');
    sessionCode = null;
    isHost = false;
    peerCount = 0;
    updateBadge('');
    setPopupEnabled(false);
    notifyContentScripts('session-status', { connected: false });
    chrome.storage.local.remove('lastSession');
    sendResponse(result);
  } catch (err) {
    setPopupEnabled(false);
    notifyContentScripts('session-status', { connected: false });
    sendResponse({ success: true }); // Still consider it left
  }
}

async function handleGetStatus(sendResponse) {
  try {
    if (await hasOffscreenDocument()) {
      const status = await sendToOffscreen('get-status');
      sessionCode = status.sessionCode;
      isHost = status.isHost;
      peerCount = status.peerCount;
      sendResponse(status);
    } else {
      sendResponse({
        connected: false,
        sessionCode: null,
        isHost: false,
        peerCount: 0
      });
    }
  } catch (err) {
    sendResponse({
      connected: false,
      sessionCode: null,
      isHost: false,
      peerCount: 0
    });
  }
}

function handleOffscreenMessage(message) {
  console.log('[VideoSync] From offscreen:', message.action);

  switch (message.action) {
    case 'offscreen-ready':
      offscreenReady = true;
      break;

    case 'peer-ready':
      console.log('[VideoSync] Peer ready:', message.peerId);
      break;

    case 'peer-joined':
      peerCount = message.count;
      updateBadge((peerCount - 1).toString());
      notifyContentScripts('notification', { message: 'Someone joined the session' });
      chrome.runtime.sendMessage({ action: 'peer-count', count: peerCount }).catch(() => {});
      break;

    case 'peer-left':
      peerCount = message.count;
      updateBadge(peerCount > 1 ? (peerCount - 1).toString() : '0');
      notifyContentScripts('notification', { message: 'Someone left the session' });
      chrome.runtime.sendMessage({ action: 'peer-count', count: peerCount }).catch(() => {});
      break;

    case 'peer-data':
      // Forward to active tab's content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'sync-event',
            data: message.data,
            from: message.from
          }).catch(() => {});
        }
      });
      break;

    case 'connection-status':
      if (message.status === 'reconnecting') {
        updateBadge('!', '#ff9800');
      } else if (message.status === 'closed') {
        updateBadge('', '#ff4444');
        sessionCode = null;
        setPopupEnabled(false);
        notifyContentScripts('session-status', { connected: false });
      }
      break;
  }
}

// Keep service worker alive by responding to alarms
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && sessionCode) {
    // Ping offscreen to keep it alive
    sendToOffscreen('ping').catch(() => {});
  }
});

// Initialize popup state based on session status
async function initializePopupState() {
  try {
    if (await hasOffscreenDocument()) {
      const status = await sendToOffscreen('get-status');
      if (status.connected && status.sessionCode) {
        sessionCode = status.sessionCode;
        isHost = status.isHost;
        peerCount = status.peerCount;
        setPopupEnabled(true);
        return;
      }
    }
  } catch (err) {
    console.log('[VideoSync] No active session on startup');
  }
  setPopupEnabled(false);
}

initializePopupState();
console.log('[VideoSync] Background service worker started');
