let estimatedScreenshotSize = 0;
let runningTotalSize = 0;
let screenshotCount = 0;

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

    const compressedData = canvas.toDataURL('image/jpeg', 0.5);
    const base64Data = compressedData.split(',')[1];
    const sizeInBytes = (base64Data.length * 3) / 4;
    estimatedScreenshotSize = sizeInBytes / (1024 * 1024);
    console.log(`Initial estimated size per screenshot: ${estimatedScreenshotSize.toFixed(2)} MB`);
  }
}

async function estimateSingleScreenshotSize(imgData) {
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

  const compressedData = canvas.toDataURL('image/jpeg', 0.5);
  const base64Data = compressedData.split(',')[1];
  const sizeInBytes = (base64Data.length * 3) / 4;
  return sizeInBytes / (1024 * 1024);
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
    chrome.tabs.sendMessage(tabs[0].id, { action: 'extractTranscriptWithTitle' }, (response) => {
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

    // Extract transcript and video title
    const transcriptResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'extractTranscriptWithTitle' }, resolve);
    });
    if (!transcriptResponse || !transcriptResponse.transcript) {
      displayError('No transcript available. Ensure captions are enabled (CC button).');
      return;
    }
    const videoTitle = transcriptResponse.videoTitle || 'Unknown Video Title';

    // Extract preamble and transcript content
    const transcriptText = transcriptResponse.transcript;
    const preambleEndIndex = transcriptText.indexOf('Transcript Content:');
    const preamble = preambleEndIndex !== -1 ? transcriptText.substring(0, preambleEndIndex + 'Transcript Content:'.length) : '';
    const transcriptLines = transcriptText.split('\n');
    const entries = [];
    const timestampRegex = /^\[(\d+:\d+(?::\d+)?)\](.*)/;
    for (const line of transcriptLines) {
      const match = line.match(timestampRegex);
      if (match) {
        const timestamp = match[1];
        const seconds = parseTimestamp(timestamp);
        const text = match[2].trim();
        if (seconds !== null) {
          entries.push({ seconds, timestamp, text });
        }
      }
    }

    if (entries.length === 0) {
      displayError('No timestamps found in transcript.');
      return;
    }

    // Initial sampling rate (every 2nd line)
    let n = 2;
    let sampledTimestamps = entries.filter((_, index) => index % n === 0).map(entry => entry.seconds);
    console.log(`Initial sampling: every ${n}th line, ${sampledTimestamps.length} timestamps`);
    displayEstimatedSize(sampledTimestamps.length);

    // Generate PDF with intermingled transcript and screenshots
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 50;
    runningTotalSize = 0;
    screenshotCount = 0;
    let sampledIndex = 0;

    // Add video title as header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(videoTitle, 10, yOffset);
    yOffset += 15;

    // Add preamble with text wrapping
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const preambleLines = preamble.split('\n');
    for (const line of preambleLines) {
      if (line.trim()) {
        const wrappedLines = doc.splitTextToSize(line, 190); // 190 is the width in points (A4 page width - margins)
        for (const wrappedLine of wrappedLines) {
          if (yOffset + 10 > pageHeight - 20) {
            doc.addPage();
            yOffset = 10;
          }
          doc.text(wrappedLine, 10, yOffset);
          yOffset += 5;
        }
      }
    }
    yOffset += 10; // Extra spacing after preamble

    // Intermingle transcript and screenshots with dynamic sampling
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isSampled = sampledIndex < sampledTimestamps.length && sampledTimestamps[sampledIndex] === entry.seconds;

      // Add transcript line
      if (yOffset + 10 > pageHeight - 20) {
        doc.addPage();
        yOffset = 10;
      }
      doc.text(`[${entry.timestamp}] ${entry.text}`, 10, yOffset);
      yOffset += 5;

      // Add screenshot if this timestamp is sampled
      if (isSampled) {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: 'captureAtTime', time: entry.seconds }, resolve);
        });
        if (response && response.screenshot) {
          screenshotCount++;
          const screenshotSize = await estimateSingleScreenshotSize(response.screenshot);
          runningTotalSize += screenshotSize;
          console.log(`Screenshot ${screenshotCount} at ${entry.timestamp}: Size ${screenshotSize.toFixed(2)} MB, Running Total: ${runningTotalSize.toFixed(2)} MB`);

          // Check size every 5th screenshot
          if (screenshotCount % 5 === 0) {
            const avgSizePerScreenshot = runningTotalSize / screenshotCount;
            const remainingEntries = entries.length - i - 1;
            const remainingTimestamps = Math.floor(remainingEntries / n);
            const extrapolatedSize = (avgSizePerScreenshot * (screenshotCount + remainingTimestamps)) + 0.2;
            console.log(`Extrapolated size after ${screenshotCount} screenshots: ${extrapolatedSize.toFixed(2)} MB`);

            if (extrapolatedSize > 32) {
              n += 1; // Increase sampling interval
              const remainingEntriesList = entries.slice(i + 1);
              sampledTimestamps = remainingEntriesList.filter((_, index) => index % n === 0).map(e => e.seconds);
              sampledIndex = 0;
              console.log(`Size exceeds 32 MB, new sampling rate: every ${n}th line, remaining sampled timestamps: ${sampledTimestamps.length}`);
            } else {
              const timestampStr = formatTimestamp(entry.seconds);
              const label = `Screenshot at ${timestampStr}`;
              const imgData = response.screenshot;

              const img = new Image();
              img.src = imgData;
              await new Promise((resolve) => { img.onload = resolve; });

              const imgWidth = (img.width * imgHeight) / img.height;
              if (yOffset + imgHeight + 15 > pageHeight - 20) {
                doc.addPage();
                yOffset = 10;
              }
              doc.setFont('helvetica', 'italic');
              doc.setFontSize(12);
              doc.text(label, 10, yOffset);
              yOffset += 10;
              doc.addImage(imgData, 'JPEG', 10, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.5);
              yOffset += imgHeight + 10;
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(10);
              sampledIndex++;
            }
          }
        }
      }
    }
    console.log(`Final screenshot count: ${screenshotCount}, Final size estimate: ${runningTotalSize.toFixed(2)} MB`);
    doc.save('transcript_with_screenshots.pdf');
    alert('Transcript and screenshots saved as PDF!');
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

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0].id;

    const titleResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'extractTranscriptWithTitle' }, resolve);
    });
    const videoTitle = titleResponse && titleResponse.videoTitle ? titleResponse.videoTitle : 'Unknown Video Title';

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 50;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(videoTitle, 10, yOffset);
    yOffset += 15;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(12);

    for (let seconds of timestamps) {
      const times = includeOffsets ? [seconds - 5, seconds, seconds + 5].filter(t => t >= 0) : [seconds];
      for (let time of times) {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'captureAtTime', time }, resolve);
        });
        if (response && response.screenshot) {
          const offset = time - seconds;
          const timestampStr = formatTimestamp(seconds);
          const label = includeOffsets ? `Screenshot at ${timestampStr} (${offset}s)` : `Screenshot at ${timestampStr}`;
          const imgData = response.screenshot;
          
          const img = new Image();
          img.src = imgData;
          await new Promise((resolve) => { img.onload = resolve; });
          
          const imgWidth = (img.width * imgHeight) / img.height;
          if (yOffset + imgHeight > pageHeight - 20) {
            doc.addPage();
            yOffset = 10;
          }
          doc.text(label, 10, yOffset);
          yOffset += 10;
          doc.addImage(imgData, 'JPEG', 10, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.5);
          yOffset += imgHeight + 10;
        }
      }
    }
    doc.save('screenshots.pdf');
    alert('Screenshots saved as PDF!');
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
