let estimatedScreenshotSize = 0;

async function estimateScreenshotSize(tabId) {
  const response = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'captureScreenshot' }, resolve);
  });
  if (response && response.screenshot) {
    const imgData = response.screenshot;
    const img = new Image();
    img.src = imgData;
    await new Promise((resolve) => { img.onload = resolve; });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const imgHeight = 50;
    const imgWidth = (img.width * imgHeight) / img.height;
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

    const compressedData = canvas.toDataURL('image/jpeg', 0.7);
    const base64Data = compressedData.split(',')[1];
    const sizeInBytes = (base64Data.length * 3) / 4;
    estimatedScreenshotSize = sizeInBytes / (1024 * 1024);
  }
}

function displayEstimatedSize(numScreenshots) {
  if (estimatedScreenshotSize === 0) return;
  const pdfOverhead = 0.2;
  const totalSize = (estimatedScreenshotSize * numScreenshots) + pdfOverhead;
  document.getElementById('estimatedSize').textContent = `Estimated PDF Size: ${totalSize.toFixed(2)} MB`;
}

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

document.getElementById('downloadAll').addEventListener('click', () => {
  displayError('');
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0].id;

    // Extract transcript
    const transcriptResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'extractTranscript' }, resolve);
    });
    if (!transcriptResponse || !transcriptResponse.transcript) {
      displayError('No transcript available. Ensure captions are enabled (CC button).');
      return;
    }
    const transcriptBlob = new Blob([transcriptResponse.transcript], { type: 'text/plain' });
    const transcriptUrl = URL.createObjectURL(transcriptBlob);
    const transcriptLink = document.createElement('a');
    transcriptLink.href = transcriptUrl;
    transcriptLink.download = 'transcript.txt';
    transcriptLink.click();
    URL.revokeObjectURL(transcriptUrl);

    // Parse transcript to get timestamps
    const transcriptLines = transcriptResponse.transcript.split('\n');
    const timestamps = [];
    const timestampRegex = /^\[(\d+:\d+(?::\d+)?)\]/;
    for (const line of transcriptLines) {
      const match = line.match(timestampRegex);
      if (match) {
        const timestamp = match[1];
        const seconds = parseTimestamp(timestamp);
        if (seconds !== null && !timestamps.includes(seconds)) {
          timestamps.push(seconds);
        }
      }
    }

    if (timestamps.length === 0) {
      displayError('No timestamps found in transcript.');
      return;
    }

    // Calculate sampling rate to stay under 25 MB (no offsets for Download All)
    const targetSizeMB = 25;
    const pdfOverheadMB = 0.2;
    const screenshotSizeMB = 0.429; // Updated based on 33 MB for 77 screenshots
    const maxScreenshots = Math.floor((targetSizeMB - pdfOverheadMB) / screenshotSizeMB);
    const n = Math.max(1, Math.ceil(timestamps.length / maxScreenshots));
    const sampledTimestamps = timestamps.filter((_, index) => index % n === 0);

    const numScreenshots = sampledTimestamps.length;
    displayEstimatedSize(numScreenshots);

    // Capture screenshots
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 50;

    for (let seconds of sampledTimestamps) {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'captureAtTime', time: seconds }, resolve);
      });
      if (response && response.screenshot) {
        const timestampStr = formatTimestamp(seconds);
        const imgData = response.screenshot;
        
        const img = new Image();
        img.src = imgData;
        await new Promise((resolve) => { img.onload = resolve; });
        
        const imgWidth = (img.width * imgHeight) / img.height;
        if (yOffset + imgHeight > pageHeight - 20) {
          doc.addPage();
          yOffset = 10;
        }
        doc.text(`Screenshot at ${timestampStr} (0s)`, 10, yOffset);
        yOffset += 10;
        doc.addImage(imgData, 'JPEG', 10, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.7);
        yOffset += imgHeight + 10;
      }
    }
    doc.save('screenshots.pdf');
    alert('Screenshots saved as PDF!');
  });
});

document.getElementById('captureAtTimes').addEventListener('click', () => {
  displayError('');
  const timestampInput = document.getElementById('timestamps').value.trim();
  if (!timestampInput) {
    displayError('Please enter at least one timestamp.');
    return;
  }
  const includeOffsets = document.getElementById('includeOffsets').checked;
  const timestamps = timestampInput.split(/[\s,]+/).filter(t => t).map(parseTimestamp);
  if (timestamps.some(t => t === null)) {
    displayError('Invalid timestamp format. Use MM:SS or HH:MM:SS, separated by commas or spaces.');
    return;
  }
  const numScreenshots = timestamps.length * (includeOffsets ? 3 : 1);
  displayEstimatedSize(numScreenshots);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 50;

    const captureAllTimestamps = async () => {
      for (let seconds of timestamps) {
        const times = includeOffsets ? [seconds - 5, seconds, seconds + 5].filter(t => t >= 0) : [seconds];
        for (let time of times) {
          const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'captureAtTime', time }, resolve);
          });
          if (response && response.screenshot) {
            const offset = time - seconds;
            const timestampStr = formatTimestamp(seconds);
            const imgData = response.screenshot;
            
            const img = new Image();
            img.src = imgData;
            await new Promise((resolve) => { img.onload = resolve; });
            
            const imgWidth = (img.width * imgHeight) / img.height;
            if (yOffset + imgHeight > pageHeight - 20) {
              doc.addPage();
              yOffset = 10;
            }
            doc.text(`Screenshot at ${timestampStr} (${offset}s)`, 10, yOffset);
            yOffset += 10;
            doc.addImage(imgData, 'JPEG', 10, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.7);
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

document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    estimateScreenshotSize(tabs[0].id);
  });
});
