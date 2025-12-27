// Video Sync - Popup Script

const disconnectedView = document.getElementById('disconnected-view');
const connectedView = document.getElementById('connected-view');
const settingsView = document.getElementById('settings-view');

const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const copyBtn = document.getElementById('copy-btn');
const shareBtn = document.getElementById('share-btn');
const settingsBtn = document.getElementById('settings-btn');
const backBtn = document.getElementById('back-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const sendChatBtn = document.getElementById('send-chat-btn');

const codeInput = document.getElementById('code-input');
const chatInput = document.getElementById('chat-input');
const nicknameInput = document.getElementById('nickname-input');
const sessionCodeDisplay = document.getElementById('session-code');
const peerCountDisplay = document.getElementById('peer-count');
const peerLabelDisplay = document.getElementById('peer-label');
const statusText = document.getElementById('status-text');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');

let currentView = 'disconnected';
let nickname = '';

// Load saved nickname
chrome.storage.local.get(['nickname'], (result) => {
  nickname = result.nickname || `User${Math.floor(Math.random() * 1000)}`;
  nicknameInput.value = nickname;
});

// View management
function showView(view) {
  disconnectedView.style.display = 'none';
  connectedView.style.display = 'none';
  settingsView.style.display = 'none';

  if (view === 'disconnected') {
    disconnectedView.style.display = 'block';
  } else if (view === 'connected') {
    connectedView.style.display = 'block';
  } else if (view === 'settings') {
    settingsView.style.display = 'block';
  }

  currentView = view;
}

// Update UI based on connection state
function updateUI(status) {
  if (status.connected && status.sessionCode) {
    showView('connected');
    sessionCodeDisplay.textContent = status.sessionCode;
    updatePeerCount(status.peerCount);
    statusText.textContent = status.isHost ? 'Hosting' : 'Connected';
  } else {
    showView('disconnected');
  }
}

function updatePeerCount(count) {
  peerCountDisplay.textContent = count;
  peerLabelDisplay.textContent = count === 1 ? 'person' : 'people';
}

// Show messages
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  errorMessage.classList.add('fade-in');
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 3000);
}

function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.style.display = 'block';
  successMessage.classList.add('fade-in');
  setTimeout(() => {
    successMessage.style.display = 'none';
  }, 2000);
}

// Create session
createBtn.addEventListener('click', async () => {
  createBtn.disabled = true;
  createBtn.textContent = 'Connecting...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'create-session' });
    if (response && response.success) {
      updateUI({ connected: true, sessionCode: response.code, peerCount: 1, isHost: true });
      try {
        await navigator.clipboard.writeText(response.code);
        showSuccess('Session created! Code copied.');
      } catch {
        showSuccess('Session created!');
      }
    } else {
      showError(response?.error || 'Failed to create session');
    }
  } catch (err) {
    console.error('Create session error:', err);
    showError('Connection failed. Try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create Session';
  }
});

// Join session
joinBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    showError('Please enter a 6-character code');
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = 'Connecting...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'join-session', code });
    if (response && response.success) {
      updateUI({ connected: true, sessionCode: response.code, peerCount: 2, isHost: false });
      showSuccess('Connected!');
    } else {
      showError(response?.error || 'Session not found');
    }
  } catch (err) {
    console.error('Join session error:', err);
    showError('Connection failed. Check the code.');
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
  }
});

// Leave session
leaveBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ action: 'leave-session' });
    updateUI({ connected: false });
    codeInput.value = '';
  } catch (err) {
    showError(err.message);
  }
});

// Copy code
copyBtn.addEventListener('click', async () => {
  const code = sessionCodeDisplay.textContent;
  try {
    await navigator.clipboard.writeText(code);
    showSuccess('Code copied!');

    // Visual feedback
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    setTimeout(() => {
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
    }, 1500);
  } catch (err) {
    showError('Failed to copy');
  }
});

// Share with URL
shareBtn.addEventListener('click', async () => {
  const code = sessionCodeDisplay.textContent;
  try {
    // Get current tab URL
    const response = await chrome.runtime.sendMessage({ action: 'get-video-url' });
    const shareText = `Join my video sync session!\nCode: ${code}${response.url ? `\nWatching: ${response.url}` : ''}`;

    await navigator.clipboard.writeText(shareText);
    showSuccess('Share info copied!');
  } catch (err) {
    // Fallback to just code
    await navigator.clipboard.writeText(`Join my video sync session! Code: ${code}`);
    showSuccess('Share info copied!');
  }
});

// Settings
settingsBtn.addEventListener('click', () => {
  showView('settings');
});

backBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'get-status' }, (status) => {
    if (status && status.connected) {
      showView('connected');
    } else {
      showView('disconnected');
    }
  });
});

saveSettingsBtn.addEventListener('click', async () => {
  const newNickname = nicknameInput.value.trim();
  if (newNickname) {
    nickname = newNickname;
    await chrome.storage.local.set({ nickname: nickname });

    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'set-nickname', nickname: nickname });
      }
    });

    showSuccess('Settings saved!');

    // Go back after short delay
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'get-status' }, (status) => {
        if (status && status.connected) {
          showView('connected');
        } else {
          showView('disconnected');
        }
      });
    }, 500);
  }
});

// Chat
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChat();
  }
});

async function sendChat() {
  const message = chatInput.value.trim();
  if (!message) return;

  try {
    await chrome.runtime.sendMessage({
      action: 'send-chat',
      message: message,
      nickname: nickname
    });
    chatInput.value = '';
  } catch (err) {
    showError('Failed to send message');
  }
}

// Format code input
codeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Enter key to join
codeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinBtn.click();
  }
});

// Listen for updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'peer-count') {
    updatePeerCount(message.count);
  }
});

// Get initial status
chrome.runtime.sendMessage({ action: 'get-status' }, (status) => {
  if (status) {
    updateUI(status);
  }
});
