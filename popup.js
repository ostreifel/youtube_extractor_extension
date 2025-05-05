function displayError(message) {
  document.getElementById('errorMessage').textContent = message;
}

document.getElementById('extractTranscript').addEventListener('click', () => {
  displayError('');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'extractTranscript' }, (response) => {
      if (response && response.transcript) {
        const blob = new Blob([response.transcript], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'transcript.txt';
        a.click();
        URL.revokeObjectURL(url);
        alert('Transcript saved!');
      } else {
        displayError('No transcript available. Ensure captions are enabled (CC button).');
      }
    });
  });
});

document.getElementById('captureScreenshot').addEventListener('click', () => {
  displayError('');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'captureScreenshot' }, (response) => {
      if (response && response.screenshot) {
        const a = document.createElement('a');
        a.href = response.screenshot;
        a.download = `screenshot_${Date.now()}.png`;
        a.click();
        alert('Screenshot saved!');
      } else {
        displayError('Could not capture screenshot. Ensure video is playing.');
      }
    });
  });
});

document.getElementById('captureAtTime').addEventListener('click', () => {
  displayError('');
  const timestamp = document.getElementById('timestamp').value.trim();
  if (!timestamp) {
    displayError('Please enter a timestamp.');
    return;
  }
  const seconds = parseTimestamp(timestamp);
  if (seconds === null) {
    displayError('Invalid timestamp format. Use MM:SS or HH:MM:SS.');
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'captureAtTime', time: seconds }, (response) => {
      if (response && response.screenshot) {
        const a = document.createElement('a');
        a.href = response.screenshot;
        a.download = `screenshot_${timestamp.replace(/:/g, '_')}.png`;
        a.click();
        alert('Screenshot saved!');
      } else {
        displayError('Could not capture screenshot. Ensure video is accessible.');
      }
    });
  });
});

document.getElementById('captureRange').addEventListener('click', () => {
  displayError('');
  const timestamp = document.getElementById('timestamp').value.trim();
  if (!timestamp) {
    displayError('Please enter a timestamp.');
    return;
  }
  const seconds = parseTimestamp(timestamp);
  if (seconds === null) {
    displayError('Invalid timestamp format. Use MM:SS or HH:MM:SS.');
    return;
  }
  const times = [seconds - 5, seconds, seconds + 5].filter(time => time >= 0);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    // Process each timestamp sequentially using Promises
    const captureSequentially = async () => {
      for (let time of times) {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'captureAtTime', time }, (response) => {
            if (response && response.screenshot) {
              const offset = time - seconds;
              const a = document.createElement('a');
              a.href = response.screenshot;
              a.download = `screenshot_${timestamp.replace(/:/g, '_')}_${offset}s.png`;
              a.click();
            }
            resolve();
          });
        });
      }
      alert('Screenshots saved for range!');
    };
    captureSequentially();
  });
});

function parseTimestamp(timestamp) {
  const parts = timestamp.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}