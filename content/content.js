// Video Sync - Content Script
// Detects videos and syncs playback with peers

(function() {
  'use strict';

  let activeVideo = null;
  let ignoreEvents = false;
  let isBuffering = false;
  let myNickname = null;
  const SYNC_THRESHOLD = 0.5;
  const DEBOUNCE_MS = 100;

  // Get or generate nickname
  function getMyNickname() {
    if (!myNickname) {
      chrome.storage.local.get(['nickname'], (result) => {
        myNickname = result.nickname || `User${Math.floor(Math.random() * 1000)}`;
      });
    }
    return myNickname || 'You';
  }

  // Find all videos including in shadow DOM
  function findAllVideos(root = document) {
    let videos = [...root.querySelectorAll('video')];

    // Search shadow DOMs
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        videos = videos.concat(findAllVideos(el.shadowRoot));
      }
    });

    // Also check iframes (same-origin only)
    try {
      root.querySelectorAll('iframe').forEach(iframe => {
        try {
          if (iframe.contentDocument) {
            videos = videos.concat(findAllVideos(iframe.contentDocument));
          }
        } catch (e) { /* cross-origin, skip */ }
      });
    } catch (e) { /* skip */ }

    return videos;
  }

  // Find the primary video element on the page
  function findPrimaryVideo() {
    const videos = findAllVideos();
    if (videos.length === 0) return null;

    let largest = videos[0];
    let maxArea = 0;

    videos.forEach(video => {
      const area = video.clientWidth * video.clientHeight;
      if (area > maxArea) {
        maxArea = area;
        largest = video;
      }
    });

    return largest;
  }

  // Set up event listeners on a video element
  function attachVideoListeners(video) {
    if (activeVideo === video) return;

    if (activeVideo) {
      detachVideoListeners(activeVideo);
    }

    activeVideo = video;
    console.log('[VideoSync] Attached to video:', video.src || video.currentSrc);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('waiting', onBuffering);
    video.addEventListener('playing', onPlaying);
  }

  function detachVideoListeners(video) {
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('ratechange', onRateChange);
    video.removeEventListener('waiting', onBuffering);
    video.removeEventListener('playing', onPlaying);
  }

  // Debounce helper
  const debounceTimers = {};
  function debounce(key, fn, data, delay = DEBOUNCE_MS) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(() => fn(data), delay);
  }

  // Video event handlers
  function onPlay(e) {
    if (ignoreEvents) return;
    debounce('play', sendEvent, {
      type: 'play',
      time: e.target.currentTime,
      nickname: getMyNickname()
    });
  }

  function onPause(e) {
    if (ignoreEvents) return;
    debounce('pause', sendEvent, {
      type: 'pause',
      time: e.target.currentTime,
      nickname: getMyNickname()
    });
  }

  function onSeeked(e) {
    if (ignoreEvents) return;
    debounce('seek', sendEvent, {
      type: 'seek',
      time: e.target.currentTime,
      nickname: getMyNickname()
    });
  }

  function onRateChange(e) {
    if (ignoreEvents) return;
    debounce('rate', sendEvent, {
      type: 'speed',
      speed: e.target.playbackRate,
      nickname: getMyNickname()
    });
  }

  function onBuffering(e) {
    if (ignoreEvents || isBuffering) return;
    isBuffering = true;
    debounce('buffer', sendEvent, {
      type: 'buffering',
      time: e.target.currentTime,
      nickname: getMyNickname()
    }, 500);
  }

  function onPlaying(e) {
    isBuffering = false;
  }

  // Send event to background script
  function sendEvent(data) {
    chrome.runtime.sendMessage({
      action: 'video-event',
      data: data
    });

    const actionLabels = {
      'play': 'played',
      'pause': 'paused',
      'seek': `seeked to ${formatTime(data.time)}`,
      'speed': `set speed to ${data.speed}x`,
      'buffering': 'is buffering...'
    };
    showToast(`You ${actionLabels[data.type]}`, 'self');
  }

  // Apply sync action to video (from remote peer)
  function applySync(data, fromPeerId) {
    if (!activeVideo) {
      activeVideo = findPrimaryVideo();
      if (!activeVideo) {
        console.log('[VideoSync] No video found to sync');
        return;
      }
    }

    ignoreEvents = true;
    const timeDiff = Math.abs(activeVideo.currentTime - (data.time || 0));
    const sender = data.nickname || 'Someone';

    switch (data.type) {
      case 'play':
        if (timeDiff > SYNC_THRESHOLD) {
          activeVideo.currentTime = data.time;
        }
        activeVideo.play();
        showToast(`${sender} played`, 'peer');
        break;

      case 'pause':
        if (timeDiff > SYNC_THRESHOLD) {
          activeVideo.currentTime = data.time;
        }
        activeVideo.pause();
        showToast(`${sender} paused`, 'peer');
        break;

      case 'seek':
        activeVideo.currentTime = data.time;
        showToast(`${sender} seeked to ${formatTime(data.time)}`, 'peer');
        break;

      case 'speed':
        activeVideo.playbackRate = data.speed;
        showToast(`${sender} set speed to ${data.speed}x`, 'peer');
        break;

      case 'buffering':
        // Pause for everyone when someone is buffering
        activeVideo.pause();
        showToast(`${sender} is buffering - paused for sync`, 'warning');
        break;

      case 'sync-request':
        chrome.runtime.sendMessage({
          action: 'sync-response',
          data: {
            type: 'sync-response',
            time: activeVideo.currentTime,
            playing: !activeVideo.paused,
            speed: activeVideo.playbackRate,
            url: window.location.href
          }
        });
        break;

      case 'sync-response':
        activeVideo.currentTime = data.time;
        activeVideo.playbackRate = data.speed || 1;
        if (data.playing) {
          activeVideo.play();
        } else {
          activeVideo.pause();
        }
        showToast('Synced with session', 'success');
        break;

      case 'chat':
        showChatMessage(data.nickname, data.message);
        break;
    }

    setTimeout(() => {
      ignoreEvents = false;
    }, 200);
  }

  // Format time for display
  function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Create UI container
  let uiContainer = null;
  function getUIContainer() {
    if (!uiContainer) {
      uiContainer = document.createElement('div');
      uiContainer.id = 'videosync-ui';
      uiContainer.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      document.body.appendChild(uiContainer);
    }
    return uiContainer;
  }

  // Toast notifications
  let toastStack = [];
  function showToast(message, type = 'info') {
    const container = getUIContainer();

    const toast = document.createElement('div');
    const colors = {
      self: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      peer: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
      warning: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      success: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      info: 'rgba(0, 0, 0, 0.85)'
    };

    toast.style.cssText = `
      background: ${colors[type] || colors.info};
      color: white;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transform: translateX(100%);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const icon = type === 'self' ? '📤' : type === 'peer' ? '📥' : type === 'warning' ? '⏳' : '🔄';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);
    toastStack.push(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });

    // Remove after delay
    setTimeout(() => {
      toast.style.transform = 'translateX(100%)';
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        toastStack = toastStack.filter(t => t !== toast);
      }, 300);
    }, 2500);

    // Limit stack size
    if (toastStack.length > 4) {
      const oldest = toastStack.shift();
      oldest.remove();
    }
  }

  // Chat message display
  let chatContainer = null;
  function showChatMessage(nickname, message) {
    if (!chatContainer) {
      chatContainer = document.createElement('div');
      chatContainer.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 20px;
        max-width: 300px;
        z-index: 999998;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      document.body.appendChild(chatContainer);
    }

    const msg = document.createElement('div');
    msg.style.cssText = `
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      animation: slideIn 0.3s ease;
    `;
    msg.innerHTML = `<strong style="color: #667eea;">${nickname}:</strong> ${message}`;

    chatContainer.appendChild(msg);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      msg.style.opacity = '0';
      msg.style.transition = 'opacity 0.3s';
      setTimeout(() => msg.remove(), 300);
    }, 10000);

    // Limit messages
    while (chatContainer.children.length > 5) {
      chatContainer.firstChild.remove();
    }
  }

  // Keyboard shortcuts
  function handleKeyboard(e) {
    // Only when video is focused or in fullscreen
    if (!activeVideo) return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    // Alt + S = Sync everyone to your position
    if (e.altKey && e.key === 's') {
      e.preventDefault();
      sendEvent({
        type: 'seek',
        time: activeVideo.currentTime,
        nickname: getMyNickname()
      });
      showToast('Synced everyone to your position', 'self');
    }

    // Alt + C = Open chat (handled by popup)
    if (e.altKey && e.key === 'c') {
      chrome.runtime.sendMessage({ action: 'open-chat' });
    }
  }

  document.addEventListener('keydown', handleKeyboard);

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'sync-event':
        applySync(message.data, message.from);
        break;

      case 'notification':
        showToast(message.message, 'info');
        break;

      case 'get-video-state':
        if (activeVideo) {
          sendResponse({
            time: activeVideo.currentTime,
            playing: !activeVideo.paused,
            speed: activeVideo.playbackRate,
            url: window.location.href
          });
        } else {
          sendResponse(null);
        }
        return true;

      case 'set-nickname':
        myNickname = message.nickname;
        chrome.storage.local.set({ nickname: message.nickname });
        break;
    }
  });

  // Watch for video elements being added to the page
  const observer = new MutationObserver((mutations) => {
    const video = findPrimaryVideo();
    if (video && video !== activeVideo) {
      attachVideoListeners(video);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial video detection
  const initialVideo = findPrimaryVideo();
  if (initialVideo) {
    attachVideoListeners(initialVideo);
  }

  // Load nickname
  chrome.storage.local.get(['nickname'], (result) => {
    myNickname = result.nickname;
  });

  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(-20px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  console.log('[VideoSync] Content script loaded');
})();
