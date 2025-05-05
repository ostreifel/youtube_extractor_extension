const MAX_PDF_SIZE_MB = 32; // Maximum PDF size in MB 
const TRANSCRIPT_ERROR_MESSAGE = 'No transcript available. Expand the description and click "Show Transcript".';
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

const reusableCanvas = document.createElement('canvas');
const reusableCtx = reusableCanvas.getContext('2d');

// Calibration factor based on actual vs. logged size (0.35 MB actual / 0.0015 MB logged ≈ 233)
const CALIBRATION_FACTOR = 233;

async function estimateSingleScreenshotSize(imgData) {
  if (!imgData || !imgData.startsWith('data:image/')) {
    console.error('Invalid image data for size estimation');
    return 0;
  }
  const img = new Image();
  img.src = imgData;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Failed to load image for size estimation'));
  });

  const imgHeight = 50;
  const imgWidth = (img.width * imgHeight) / img.height;
  reusableCanvas.width = imgWidth;
  reusableCanvas.height = imgHeight;
  reusableCtx.clearRect(0, 0, reusableCanvas.width, reusableCanvas.height); // Clear canvas to prevent corruption
  reusableCtx.drawImage(img, 0, 0, imgWidth, imgHeight);

  const compressedData = reusableCanvas.toDataURL('image/jpeg', 0.5);
  const base64Data = compressedData.split(',')[1] || '';
  const sizeInBytes = (base64Data.length * 3) / 4;
  const sizeInMB = sizeInBytes / (1024 * 1024);
  const calibratedSizeInMB = sizeInMB * CALIBRATION_FACTOR;
  console.log(`Base64 size: ${sizeInMB.toFixed(2)} MB, Calibrated size: ${calibratedSizeInMB.toFixed(2)} MB`);
  return calibratedSizeInMB;
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
        displayError(TRANSCRIPT_ERROR_MESSAGE);
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

    const videoInfoResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getVideoInfo' }, resolve);
    });

    // Extract transcript and video title
    const transcriptResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'extractTranscriptWithTitle' }, resolve);
    });
    if (!transcriptResponse || !transcriptResponse.transcript) {
      displayError(TRANSCRIPT_ERROR_MESSAGE);
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
    const seenSeconds = new Set();
    for (const line of transcriptLines) {
      const match = line.match(timestampRegex);
      if (match) {
        const timestamp = match[1];
        const seconds = parseTimestamp(timestamp);
        const text = match[2].trim();
        if (seconds !== null && !seenSeconds.has(seconds)) {
          entries.push({ seconds, timestamp, text });
          seenSeconds.add(seconds);
        }
      }
    }

    if (entries.length === 0) {
      displayError('No timestamps found in transcript.');
      return;
    }

    // Generate PDF with intermingled transcript and screenshots
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let yOffset = 10;
    const pageHeight = doc.internal.pageSize.height;
    const imgHeight = 50;
    runningTotalSize = 100 / (1024 * 1024); // 100 KB in MB
    screenshotCount = 0;

    // Add video title as header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(videoTitle, 10, yOffset);
    yOffset += 15;

    // Add metadata below the title
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text(`Author name: ${videoInfoResponse.authorName || 'Unknown'}`, 10, yOffset);
    yOffset += 5; 
    doc.text(`Upload date: ${videoInfoResponse.uploadDate || 'Unknown'}`, 10, yOffset);
    yOffset += 5; 
    doc.text(`Views: ${videoInfoResponse.viewCount || 'Unknown'}`, 10, yOffset);
    yOffset += 5;
    doc.text(`Likes: ${videoInfoResponse.likeCount || 'Unknown'}`, 10, yOffset);
    yOffset += 5;
    doc.text(`Dislikes: ${videoInfoResponse.dislikeCount || 'Unknown'}`, 10, yOffset);
    yOffset += 5;
    // Add duration with hours if necessary
    const durationSeconds = parseInt(videoInfoResponse.duration, 10);
    let durationFormatted;
    if (isNaN(durationSeconds)) {
      durationFormatted = 'Unknown';
    } else if (durationSeconds >= 3600) {
      // Format as HH:MM:SS if duration is 1 hour or more
      const hours = Math.floor(durationSeconds / 3600);
      const minutes = Math.floor((durationSeconds % 3600) / 60);
      const seconds = durationSeconds % 60;
      durationFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      // Format as MM:SS if duration is less than 1 hour
      const minutes = Math.floor(durationSeconds / 60);
      const seconds = durationSeconds % 60;
      durationFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    doc.text(`Duration: ${durationFormatted}`, 10, yOffset);
    yOffset += 5;
    const transcriptLineCount = entries.length;
    doc.text(`Transcript Lines: ${transcriptLineCount}`, 10, yOffset);
    yOffset += 5;
    const screenshotCountYPosition = yOffset;
    yOffset += 5;
    yOffset += 10; // Extra spacing after metadata

    // Add description
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Description:', 10, yOffset);
    yOffset += 5;
    doc.setFont('helvetica', 'normal');
    const descriptionLines = doc.splitTextToSize(videoInfoResponse.description || 'No description available', 190);
    for (const line of descriptionLines) {
      if (yOffset + 10 > pageHeight - 20) {
        doc.addPage();
        yOffset = 10;
      }
      doc.text(line, 10, yOffset);
      yOffset += 5;
    }
    yOffset += 10; // Extra spacing after description

    // Add preamble with text wrapping
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const preambleLines = preamble.split('\n');
    for (const line of preambleLines) {
      if (line.trim()) {
        const wrappedLines = doc.splitTextToSize(line, 190);
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

    let nextTranscriptLineIndexForScreenshot = 0;
    let screenshotInterval = 1;

    // Intermingle transcript and screenshots with dynamic sampling
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isSampled = nextTranscriptLineIndexForScreenshot === i;

      // Add transcript line
      if (yOffset + 10 > pageHeight - 20) {
        doc.addPage();
        yOffset = 10;
      }
      doc.text(`[${entry.timestamp}] ${entry.text}`, 10, yOffset);
      yOffset += 5;

      // Add screenshot if this timestamp is sampled
      if (isSampled) {
        const timeAtNextTranscriptLine = i + 1 < entries.length ? entries[i + 1].seconds : videoInfoResponse.duration;
        const timeAtMiddleOfTranscriptLine = Math.ceil((entry.seconds + timeAtNextTranscriptLine) / 2);
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: 'captureAtTime', time: timeAtMiddleOfTranscriptLine }, resolve);
        });
        if (response && response.screenshot) {
          const screenshotSize = await estimateSingleScreenshotSize(response.screenshot);

          if (screenshotSize + runningTotalSize > MAX_PDF_SIZE_MB) {
            console.warn(`Skipping screenshot at ${entry.timestamp} due to size limit.`);
            continue;
          }
          screenshotCount++;

          runningTotalSize += screenshotSize;
          
          const remainingSize = MAX_PDF_SIZE_MB - runningTotalSize;
          const remainingTranscriptLines = entries.length - i - 1;
          const remainingScreenshots = Math.floor(remainingSize / screenshotSize);

          screenshotInterval = Math.max(1, Math.floor(remainingTranscriptLines / remainingScreenshots));
          nextTranscriptLineIndexForScreenshot += screenshotInterval;
          console.log(`Screenshot ${screenshotCount} at ${entry.timestamp}: Size ${screenshotSize.toFixed(2)} MB, Running Total: ${runningTotalSize.toFixed(2)} MB`);

          const timestampStr = formatTimestamp(timeAtMiddleOfTranscriptLine);
          const label = `Screenshot at ${timestampStr}`;
          const imgData = response.screenshot;

          const img = new Image();
          img.src = imgData;
          await new Promise((resolve) => { img.onload = resolve; });

          const imgWidth = (img.width * imgHeight) / img.height;
          if (yOffset + imgHeight + 10 > pageHeight - 20) {
            doc.addPage();
            yOffset = 10;
          }
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(12);
          doc.text(label, 10, yOffset);
          yOffset += 5;
          doc.addImage(imgData, 'JPEG', 10, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.5);
          yOffset += imgHeight + 5;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
        } else {
          console.error(`Failed to capture screenshot at ${entry.timestamp}`);
        }
      }
    }

    // Update the screenshot count in the metadata section
    doc.setPage(1);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text(`Screenshots: ${screenshotCount}`, 10, screenshotCountYPosition);

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Page ${p} of ${pageCount}`, 190, 287, { align: 'right' });
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

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Page ${p} of ${pageCount}`, 190, 287, { align: 'right' }); // Bottom-right corner
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
