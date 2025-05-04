chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractTranscript') {
    try {
      const transcriptPanel = document.querySelector('ytd-transcript-renderer');
      if (!transcriptPanel) {
        sendResponse({ transcript: null });
        return;
      }
      const transcriptElements = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
      if (transcriptElements.length === 0) {
        sendResponse({ transcript: null });
        return;
      }
      // Format transcript with timestamps
      const transcript = Array.from(transcriptElements)
        .map((el, index) => {
          const timestampEl = el.closest('ytd-transcript-segment-renderer').querySelector('.segment-timestamp');
          const timeText = timestampEl ? timestampEl.textContent.trim() : `00:00:${index.toString().padStart(2, '0')}`;
          return `[${timeText}] ${el.textContent.trim()}`;
        })
        .join('\n');
      sendResponse({ transcript });
    } catch (e) {
      sendResponse({ transcript: null });
    }
  } else if (request.action === 'captureScreenshot') {
    try {
      const video = document.querySelector('video');
      if (!video || video.paused || video.currentTime === 0) {
        sendResponse({ screenshot: null });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      sendResponse({ screenshot: dataUrl });
    } catch (e) {
      sendResponse({ screenshot: null });
    }
  } else if (request.action === 'captureAtTime') {
    try {
      const video = document.querySelector('video');
      if (!video) {
        sendResponse({ screenshot: null });
        return;
      }
      video.currentTime = request.time;
      video.addEventListener('seeked', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        sendResponse({ screenshot: dataUrl });
      }, { once: true });
      return true; // Indicates async response
    } catch (e) {
      sendResponse({ screenshot: null });
    }
  }
});
