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

document.getElementById('captureAtTimes').addEventListener('click', () => {
  displayError('');
  const timestampInput = document.getElementById('timestamps').value.trim();
  if (!timestampInput) {
    displayError('Please enter at least one timestamp.');
    return;
  }
  // Parse timestamps (e.g., "0:10, 6:09, 17:26" or "0:10 6:09 17:26")
  const timestamps = timestampInput.split(/[\s,]+/).filter(t => t).map(parseTimestamp);
  if (timestamps.some(t => t === null)) {
    displayError('Invalid timestamp format. Use MM:SS or HH:MM:SS, separated by commas or spaces.');
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 100; // Adjust based on desired height in PDF

    const captureAllTimestamps = async () => {
      for (let seconds of timestamps) {
        const times = [seconds - 5, seconds, seconds + 5].filter(t => t >= 0);
        for (let time of times) {
          const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'captureAtTime', time }, resolve);
          });
          if (response && response.screenshot) {
            const offset = time - seconds;
            const timestampStr = formatTimestamp(seconds);
            const imgData = response.screenshot;
            
            // Add screenshot to PDF
            const img = new Image();
            img.src = imgData;
            await new Promise((resolve) => { img.onload = resolve; });
            
            const imgWidth = (img.width * imgHeight) / img.height; // Maintain aspect ratio
            if (yOffset + imgHeight > pageHeight - 20) {
              doc.addPage();
              yOffset = 10;
            }
            doc.text(`Screenshot at ${timestampStr} (${offset}s)`, 10, yOffset);
            yOffset += 10;
            doc.addImage(imgData, 'PNG', 10, yOffset, imgWidth, imgHeight);
            yOffset += imgHeight + 10;
          }
        }
      }
      doc.save('screenshots.pdf');
      alert('Screenshots saved as PDF!');
    };
    captureAllTimestamps();
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

function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
