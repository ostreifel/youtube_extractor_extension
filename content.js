
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractTranscript') {
      try {
        // Find transcript elements (YouTube's transcript panel)
        const transcriptElements = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
        if (transcriptElements.length === 0) {
          sendResponse({ transcript: null, error: 'Transcript element not opened!' });
          return;
        }
        const transcript = Array.from(transcriptElements)
          .map(el => el.textContent.trim())
          .join(' ');
        sendResponse({ transcript });
      } catch (e) {
        sendResponse({ transcript: null, error: e.message });
      }
    } else if (request.action === 'captureScreenshot') {
      try {
        const video = document.querySelector('video');
        if (!video) {
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
        sendResponse({ screenshot: null, error: e.message });
      }
    }
  });
