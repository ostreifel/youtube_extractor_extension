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

async function generateCombinedPDF(tabId, transcriptLines, timestamps, sampledTimestamps, screenshotTimes) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let yOffset = 10;
  const pageHeight = doc.internal.pageSize.height;
  const imgHeight = 50;
  const lineHeight = 5;
  const margin = 10;
  const maxWidth = 190;

  doc.setFontSize(10);

  // Add header (first few lines of transcript)
  const headerLines = transcriptLines.slice(0, transcriptLines.findIndex(line => line.startsWith('Transcript Content:')) + 2);
  for (const line of headerLines) {
    const wrappedLines = doc.splitTextToSize(line, maxWidth);
    for (const wrappedLine of wrappedLines) {
      if (yOffset + lineHeight > pageHeight - 10) {
        doc.addPage();
        yOffset = 10;
      }
      doc.text(wrappedLine, margin, yOffset);
      yOffset += lineHeight;
    }
  }

  // Process transcript lines and insert screenshots
  let screenshotIndex = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const line = transcriptLines[i + headerLines.length - 1]; // Adjust for header lines

    // Add the transcript line
    const wrappedLines = doc.splitTextToSize(line, maxWidth);
    for (const wrappedLine of wrappedLines) {
      if (yOffset + lineHeight > pageHeight - 10) {
        doc.addPage();
        yOffset = 10;
      }
      doc.text(wrappedLine, margin, yOffset);
      yOffset += lineHeight;
    }

    // Insert any screenshots that fall between this timestamp and the next
    while (screenshotIndex < screenshotTimes.length && (i === timestamps.length - 1 || screenshotTimes[screenshotIndex] <= (i + 1 < timestamps.length ? timestamps[i + 1] : screenshotTimes[screenshotIndex]))) {
      const screenshotTime = screenshotTimes[screenshotIndex];
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'captureAtTime', time: screenshotTime }, resolve);
      });
      if (response && response.screenshot) {
        const timestampStr = formatTimestamp(screenshotTime);
        const imgData = response.screenshot;

        const img = new Image();
        img.src = imgData;
        await new Promise((resolve) => { img.onload = resolve; });

        const imgWidth = (img.width * imgHeight) / img.height;
        if (yOffset + imgHeight + 10 > pageHeight - 10) {
          doc.addPage();
          yOffset = 10;
        }
        doc.text(`Screenshot at ${timestampStr} (0s)`, margin, yOffset);
        yOffset += 10;
        doc.addImage(imgData, 'JPEG', margin, yOffset, imgWidth, imgHeight, null, 'SLOW', 0.7);
        yOffset += imgHeight + 10;
      }
      screenshotIndex++;
    }
  }

  return doc.output('blob');
}

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

    // Parse transcript to get timestamps and lines
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

    // Initial sampling rate to target under 25 MB
    const targetSizeMB = 25;
    const maxSizeMB = 32;
    const pdfOverheadMB = 0.2;
    const screenshotSizeMB = 0.426; // Based on previous videos
    let maxScreenshots = Math.floor((targetSizeMB - pdfOverheadMB) / screenshotSizeMB);
    let n = Math.max(1, Math.ceil(timestamps.length / maxScreenshots));
    let sampledTimestamps = timestamps.filter((_, index) => index % n === 0);

    // Get video duration for last segment
    const videoInfoResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getVideoInfo' }, resolve);
    });
    const videoDuration = videoInfoResponse && videoInfoResponse.duration ? videoInfoResponse.duration : timestamps[timestamps.length - 1] + 10;

    // Determine the end timestamp for each sampled segment
    const timestampEnds = sampledTimestamps.map((start, index) => {
      if (index < sampledTimestamps.length - 1) {
        return sampledTimestamps[index + 1];
      }
      return videoDuration; // Use actual video duration for the last segment
    });

    // Calculate screenshot times (midpoints)
    const screenshotTimes = sampledTimestamps.map((start, index) => {
      const end = timestampEnds[index];
      return Math.min(start + (end - start) / 2, end);
    });

    let pdfSizeMB = 0;
    let pdfBlob = null;

    // Generate PDF and adjust sampling if necessary
    do {
      pdfBlob = await generateCombinedPDF(tabId, transcriptLines, timestamps, sampledTimestamps, screenshotTimes);
      pdfSizeMB = pdfBlob.size / (1024 * 1024); // Convert bytes to MB
      if (pdfSizeMB > maxSizeMB) {
        n += 1; // Increase sampling interval to reduce number of screenshots
        maxScreenshots = Math.floor(timestamps.length / n);
        sampledTimestamps = timestamps.filter((_, index) => index % n === 0);
        timestampEnds.length = 0;
        screenshotTimes.length = 0;
        sampledTimestamps.forEach((start, index) => {
          const end = index < sampledTimestamps.length - 1 ? sampledTimestamps[index + 1] : videoDuration;
          timestampEnds.push(end);
          screenshotTimes.push(Math.min(start + (end - start) / 2, end));
        });
      }
    } while (pdfSizeMB > maxSizeMB);

    displayEstimatedSize(screenshotTimes.length);

    // Save the PDF
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript_with_screenshots.pdf';
    a.click();
    URL.revokeObjectURL(url);
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
  const secs = Math.floor(seconds % 60);
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
