document.getElementById('extractTranscript').addEventListener('click', () => {
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
        alert(`Error: No transcript available. ${response.error}`);
      }
    });
  });
});

document.getElementById('captureScreenshot').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'captureScreenshot' }, (response) => {
      if (response && response.screenshot) {
        const a = document.createElement('a');
        a.href = response.screenshot;
        a.download = `screenshot_${Date.now()}.png`;
        a.click();
        alert('Screenshot saved!');
      } else {
        alert(`Error: Could not capture screenshot. Message ${response.error}`);
      }
    });
  });
});
