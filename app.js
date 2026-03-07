const video = document.getElementById("video");
const scannerBox = document.getElementById("scannerBox");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const wordInput = document.getElementById("wordInput");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");
const statusText = document.getElementById("statusText");
const reviewSection = document.getElementById("reviewSection");
const scanWordBankBtn = document.getElementById("scanWordBankBtn");
const wordBankList = document.getElementById("wordBankList");
const shapeButtons = document.querySelectorAll(".shape-btn");

let ocrLetters = [];
let baseImage = null;
let verified = false;
let foundHighlights = [];
let wordBankMode = false;
let currentShape = "square";
let wordBankSet = new Set();

initCamera();
captureBtn.addEventListener("click", captureFrame);
clearBtn.addEventListener("click", clearBoard);
searchBtn.addEventListener("click", handleSearch);
scanWordBankBtn.addEventListener("click", () => {
  if (!wordBankMode) {
    wordBankMode = true;
    scanWordBankBtn.textContent = "Done Scanning Words";
    statusText.textContent = "Capture Word Bank...";
    setShape("vertical");
  } else {
    wordBankMode = false;
    scanWordBankBtn.textContent = "Scan Word Bank";
    statusText.textContent = "Returned to puzzle.";
    redrawAllHighlights();
  }
});

shapeButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    setShape(btn.dataset.shape);
  });
});

function setShape(shape) {
  currentShape = shape;
  scannerBox.classList.remove("square", "vertical", "horizontal");
  scannerBox.classList.add(shape);
  shapeButtons.forEach(b => b.classList.toggle("active", b.dataset.shape === shape));

  // Reset inline styles so CSS classes take over again
  scannerBox.style.transform = "";
  scannerBox.style.left = "";
  scannerBox.style.top = "";
  scannerBox.style.width = "";
  scannerBox.style.height = "";
}

function clearBoard() {
  ocrLetters = [];
  baseImage = null;
  verified = false;
  foundHighlights = [];
  wordBankSet.clear();
  wordBankMode = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  reviewSection.innerHTML = "";
  reviewSection.classList.add("hidden");
  wordBankList.innerHTML = "";

  wordInput.value = "";
  wordInput.disabled = true;
  searchBtn.disabled = true;

  scanWordBankBtn.textContent = "Scan Word Bank";
  statusText.textContent = "Board cleared. Awaiting image...";
  setShape("square");
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: "continuous" }]
      }
    });

    // Attempt to force continuous autofocus if supported by the track
    const track = stream.getVideoTracks()[0];
    if (track && track.getCapabilities && track.getCapabilities().focusMode) {
      const caps = track.getCapabilities();
      if (caps.focusMode.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    }

    video.srcObject = stream;
  } catch (err) {
    console.error("Camera access failed", err);
    statusText.textContent = "Camera access failed. Check permissions.";
  }
}

async function captureFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const offscreen = document.createElement("canvas");
  offscreen.width = vw;
  offscreen.height = vh;
  const offCtx = offscreen.getContext("2d");
  offCtx.drawImage(video, 0, 0, vw, vh);

  const rect = scannerBox.getBoundingClientRect();
  const videoRect = video.getBoundingClientRect();

  const scaleX = vw / videoRect.width;
  const scaleY = vh / videoRect.height;

  const sx = (rect.left - videoRect.left) * scaleX;
  const sy = (rect.top - videoRect.top) * scaleY;
  const cropWidth = Math.floor(rect.width * scaleX);
  const cropHeight = Math.floor(rect.height * scaleY);
  const cropX = Math.floor(sx);
  const cropY = Math.floor(sy);

  // If the box is extremely small or negative, abort
  if (cropWidth <= 0 || cropHeight <= 0) return null;

  const cropped = offCtx.getImageData(cropX, cropY, cropWidth, cropHeight);
  preprocess(cropped);
  return { cropped, cropWidth, cropHeight };
}

async function captureFrame() {
  const result = getProcessedCrop();
  if (!result) return;
  const { cropped, cropWidth, cropHeight } = result;

  // Strict mode by shape
  if (currentShape === "square") {
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    ctx.putImageData(cropped, 0, 0);
    baseImage = new Image();
    baseImage.src = canvas.toDataURL();
    await runOCR(baseImage);
  } else if (currentShape === "vertical" || currentShape === "horizontal") {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cropWidth;
    tempCanvas.height = cropHeight;
    tempCanvas.getContext("2d").putImageData(cropped, 0, 0);
    const tempImg = new Image();
    tempImg.src = tempCanvas.toDataURL();
    await runWordBankOCR(tempImg);
  }
}

// Live Preview Overlay Logic
const previewOverlay = document.createElement("canvas");
previewOverlay.className = "preview-overlay";
scannerBox.appendChild(previewOverlay);

function updateLivePreview() {
  if (video.readyState >= 2 && !verified) {
    const rect = scannerBox.getBoundingClientRect();
    const result = getProcessedCrop();

    if (result) {
      previewOverlay.width = result.cropWidth;
      previewOverlay.height = result.cropHeight;
      const pCtx = previewOverlay.getContext("2d");
      pCtx.putImageData(result.cropped, 0, 0);
    }
  } else if (verified) {
    // Clear preview if paused/verified
    const pCtx = previewOverlay.getContext("2d");
    pCtx.clearRect(0, 0, previewOverlay.width, previewOverlay.height);
  }
  requestAnimationFrame(updateLivePreview);
}
requestAnimationFrame(updateLivePreview);

function preprocess(imageData) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // 1. Convert to grayscale
  const grays = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    grays[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // 1.5 Sharpen Image (Convolution 3x3 Kernel)
  // [  0, -1,  0 ]
  // [ -1,  5, -1 ]
  // [  0, -1,  0 ]
  const sharpened = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let idx = y * width + x;
      let top = (y - 1) * width + x;
      let bottom = (y + 1) * width + x;
      let left = y * width + (x - 1);
      let right = y * width + (x + 1);

      let sum = (grays[idx] * 5) - grays[top] - grays[bottom] - grays[left] - grays[right];
      sharpened[idx] = Math.min(Math.max(sum, 0), 255);
    }
  }

  // 2. Adaptive Thresholding (Bradley-Roth algorithm)
  // This drastically reduces shadows and uneven lighting by comparing each pixel 
  // to the average of its surrounding S x S window.
  const S = Math.floor(width / 16);
  let s2 = Math.floor(S / 2);
  const T = 0.15; // 15% threshold

  const integral = new Uint32Array(width * height);

  // Compute integral image using sharpened pixels
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      let idx = y * width + x;
      sum += sharpened[idx];
      integral[idx] = (y === 0) ? sum : integral[(y - 1) * width + x] + sum;
    }
  }

  // Apply threshold
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let x1 = Math.max(x - s2, 0);
      let x2 = Math.min(x + s2, width - 1);
      let y1 = Math.max(y - s2, 0);
      let y2 = Math.min(y + s2, height - 1);

      let count = (x2 - x1) * (y2 - y1);
      let sum = integral[y2 * width + x2]
        - integral[y1 * width + x2]
        - integral[y2 * width + x1]
        + integral[y1 * width + x1];

      let idx = y * width + x;
      // If pixel is X% darker than the local average, make it black, else white.
      let color = (sharpened[idx] * count) < (sum * (1.0 - T)) ? 0 : 255;

      data[idx * 4] = color;
      data[idx * 4 + 1] = color;
      data[idx * 4 + 2] = color;
      data[idx * 4 + 3] = 255; // Alpha
    }
  }

  // 3. Morphological Dilation (Thickening black pixels)
  // Tesseract struggles with very thin fonts. We expand black pixels into neighbors.
  const tempData = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let idx = (y * width + x) * 4;

      // If a neighboring pixel is black (0), make this pixel black
      if (
        tempData[((y - 1) * width + x) * 4] === 0 || // top
        tempData[((y + 1) * width + x) * 4] === 0 || // bottom
        tempData[(y * width + (x - 1)) * 4] === 0 || // left
        tempData[(y * width + (x + 1)) * 4] === 0    // right
      ) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      }
    }
  }
}

async function runOCR(img) {
  statusText.textContent = "Running OCR...";
  verified = false;
  wordInput.disabled = true;
  searchBtn.disabled = true;

  const result = await Tesseract.recognize(img, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    tessedit_pageseg_mode: "6", // PSM 6: Assume a single uniform block of text
    preserve_interword_spaces: "0", // Ignore spaces heavily
    logger: m => {
      if (m.status === "recognizing text") {
        statusText.textContent = `OCR ${Math.round(m.progress * 100)}%`;
      }
    }
  });

  const letters = [];
  const CONF_THRESHOLD = 80;

  // Calculate average sizes to filter out specks of dust / noise
  let totalW = 0, totalH = 0, count = 0;
  if (result.data.symbols) {
    result.data.symbols.forEach(s => {
      if (!/^[A-Z]$/.test(s.text.trim())) return;
      totalW += (s.bbox.x1 - s.bbox.x0);
      totalH += (s.bbox.y1 - s.bbox.y0);
      count++;
    });
  }
  const avgW = count > 0 ? totalW / count : 20;
  const avgH = count > 0 ? totalH / count : 20;

  if (result.data.symbols && result.data.symbols.length > 0) {
    result.data.symbols.forEach(s => {
      const char = s.text.trim();
      if (!/^[A-Z]$/.test(char)) return; // Strictly only uppercase A-Z, no spaces or punctuations

      const { x0, y0, x1, y1 } = s.bbox;
      const width = x1 - x0;
      const height = y1 - y0;

      // Filter out tiny noise artifacts
      if (width < avgW * 0.3 || height < avgH * 0.3) return;

      const confidence = typeof s.confidence === "number" ? s.confidence : 100;

      // Symbols are single characters.
      // If the box is extremely wide (spans a huge gap), shrink it to the center.
      if (width > height * 1.5) {
        const center = (x0 + x1) / 2;
        const newX0 = center - (height / 2);
        const newX1 = center + (height / 2);
        letters.push({ char, bbox: { x0: newX0, y0, x1: newX1, y1 }, confidence });
      } else {
        letters.push({ char, bbox: s.bbox, confidence });
      }
    });
  }

  // Backup method if symbols are poorly segmented but words exist
  if (letters.length === 0 && result.data.words) {
    result.data.words.forEach(w => {
      const clean = w.text.replace(/[^A-Z]/g, "");
      if (!clean) return;

      const { x0, y0, x1, y1 } = w.bbox;
      const totalWidth = x1 - x0;
      const charWidth = totalWidth / clean.length;

      for (let i = 0; i < clean.length; i++) {
        const cx0 = Math.floor(x0 + i * charWidth);
        const cx1 = Math.floor(x0 + (i + 1) * charWidth);
        const width = cx1 - cx0;
        const height = y1 - y0;
        const confidence = typeof w.confidence === "number" ? w.confidence : 100;

        if (width > height * 1.25) {
          const pieces = Math.max(1, Math.round(width / height));
          const pieceWidth = width / pieces;

          for (let p = 0; p < pieces; p++) {
            const px0 = Math.floor(cx0 + p * pieceWidth);
            const px1 = Math.floor(cx0 + (p + 1) * pieceWidth);
            letters.push({
              char: clean[i],
              bbox: { x0: px0, y0, x1: px1, y1 },
              confidence
            });
          }
        } else {
          letters.push({
            char: clean[i],
            bbox: { x0: cx0, y0, x1: cx1, y1 },
            confidence
          });
        }
      }
    });
  }

  ocrLetters = letters;

  const lowConfidence = ocrLetters.filter(l => (l.confidence ?? 100) < CONF_THRESHOLD);

  if (lowConfidence.length === 0) {
    reviewSection.classList.add("hidden");
    verified = true;
    wordInput.disabled = false;
    searchBtn.disabled = false;
    statusText.textContent = `OCR complete. Found ${ocrLetters.length} letters automatically.`;
  } else {
    buildReviewUI();
  }
}

function buildReviewUI() {
  reviewSection.innerHTML = "";
  reviewSection.classList.remove("hidden");

  const instructions = document.createElement("p");
  instructions.className = "review-instructions";
  instructions.textContent = "Instructions: Click any incorrect letter thumbnail to change its letter or delete it. Click Confirm when all letters in a group are correct.";
  reviewSection.appendChild(instructions);

  const CONF_THRESHOLD = 80;
  const groups = {};
  ocrLetters.forEach((l, idx) => {
    if ((l.confidence ?? 100) >= CONF_THRESHOLD) return;
    if (!groups[l.char]) groups[l.char] = [];
    groups[l.char].push({ ...l, index: idx });
  });

  Object.keys(groups).forEach(letter => {
    const div = document.createElement("div");
    div.className = "letter-group";
    div.innerHTML = `<strong>${letter}</strong>`;

    const crops = document.createElement("div");
    crops.className = "crops";

    groups[letter].forEach(item => {
      const { x0, y0, x1, y1 } = item.bbox;
      const temp = document.createElement("canvas");
      const tctx = temp.getContext("2d");

      const padding = 2;
      const imgW = canvas.width;
      const imgH = canvas.height;

      let cropX = Math.max(0, x0 - padding);
      let cropY = Math.max(0, y0 - padding);
      let cropW = (x1 - x0) + padding * 2;
      let cropH = (y1 - y0) + padding * 2;

      if (cropX + cropW > imgW) cropW = imgW - cropX;
      if (cropY + cropH > imgH) cropH = imgH - cropY;

      // Use native crop size without scaling
      temp.width = cropW;
      temp.height = cropH;
      temp.style.maxWidth = "50px";
      temp.style.maxHeight = "50px";

      tctx.clearRect(0, 0, cropW, cropH);
      tctx.drawImage(
        canvas,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        cropW,
        cropH
      );

      temp.className = "crop";
      temp.onclick = () => {
        const newChar = prompt("Correct letter (leave empty to delete):", item.char);
        if (newChar === null) return;

        const trimmed = newChar.trim().toUpperCase();

        if (trimmed === "") {
          ocrLetters.splice(item.index, 1);
          buildReviewUI();
          return;
        }

        if (/^[A-Z]$/.test(trimmed)) {
          ocrLetters[item.index].char = trimmed;
          buildReviewUI();
        }
      };

      crops.appendChild(temp);
    });

    const confirm = document.createElement("button");
    confirm.textContent = "Confirm";
    confirm.className = "confirm-btn";
    confirm.onclick = () => {
      div.remove();
      if (!reviewSection.querySelector(".letter-group")) {
        verified = true;
        wordInput.disabled = false;
        searchBtn.disabled = false;
        statusText.textContent = "Verification complete. Enter word.";
      }
    };

    const editBtn = document.createElement("button");
    editBtn.textContent = "Mark Incorrect";
    editBtn.className = "confirm-btn";
    editBtn.onclick = () => {
      statusText.textContent = "Click any incorrect letter thumbnail to edit or delete it.";
    };

    div.appendChild(crops);
    div.appendChild(editBtn);
    div.appendChild(confirm);
    reviewSection.appendChild(div);
  });
}

function handleSearch() {
  const word = wordInput.value.trim().toUpperCase();
  if (!word || ocrLetters.length === 0) return;

  redrawAllHighlights();

  const matches = findWord(word);
  if (matches.length === 0) {
    statusText.textContent = "Word not found.";
    return;
  }

  matches.forEach(match => highlightLetters(match));
  statusText.textContent = `Found ${matches.length} match(es).`;
}

function redrawAllHighlights() {
  if (!baseImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
  foundHighlights.forEach(h => drawLine(h));
}

function buildGrid(letters) {
  if (letters.length === 0) return [];
  let totalHeight = 0;
  letters.forEach(l => totalHeight += (l.bbox.y1 - l.bbox.y0));
  const avgHeight = totalHeight / letters.length;

  const sorted = [...letters].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  let currentRow = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const l = sorted[i];
    const prev = currentRow[0];
    if (Math.abs(l.bbox.y0 - prev.bbox.y0) < avgHeight * 0.6) {
      currentRow.push(l);
    } else {
      rows.push(currentRow);
      currentRow = [l];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  rows.forEach(row => row.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  return rows;
}

function estimateGridSpacing(grid2D) {
  let dxSum = 0; let dxCount = 0;
  for (let r = 0; r < grid2D.length; r++) {
    for (let c = 0; c < grid2D[r].length - 1; c++) {
      let l1 = grid2D[r][c];
      let l2 = grid2D[r][c + 1];
      let c1x = (l1.bbox.x0 + l1.bbox.x1) / 2;
      let c2x = (l2.bbox.x0 + l2.bbox.x1) / 2;
      dxSum += (c2x - c1x);
      dxCount++;
    }
  }
  let dySum = 0; let dyCount = 0;
  let rowLen = grid2D.length;
  for (let r = 0; r < rowLen - 1; r++) {
    let row1 = grid2D[r];
    let row2 = grid2D[r + 1];
    if (row1.length > 0 && row2.length > 0) {
      let c1y = (row1[0].bbox.y0 + row1[0].bbox.y1) / 2;
      let c2y = (row2[0].bbox.y0 + row2[0].bbox.y1) / 2;
      dySum += (c2y - c1y);
      dyCount++;
    }
  }

  let dx = dxCount > 0 ? dxSum / dxCount : 30;
  let dy = dyCount > 0 ? dySum / dyCount : 30;
  return { dx, dy };
}

function findWord(word) {
  const matches = [];
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  const grid = ocrLetters;
  if (grid.length === 0) return [];

  const grid2D = buildGrid(grid);
  const { dx: stepX, dy: stepY } = estimateGridSpacing(grid2D);

  for (let i = 0; i < grid.length; i++) {
    if (grid[i].char !== word[0]) continue;

    directions.forEach(([dx, dy]) => {
      const path = [grid[i]];
      let cx = (grid[i].bbox.x0 + grid[i].bbox.x1) / 2;
      let cy = (grid[i].bbox.y0 + grid[i].bbox.y1) / 2;

      for (let j = 1; j < word.length; j++) {
        let expectedCx = cx + dx * stepX;
        let expectedCy = cy + dy * stepY;

        let bestNext = null;
        let bestDist = Infinity;

        for (let k = 0; k < grid.length; k++) {
          let l = grid[k];
          if (l.char === word[j] && !path.includes(l)) {
            let lx = (l.bbox.x0 + l.bbox.x1) / 2;
            let ly = (l.bbox.y0 + l.bbox.y1) / 2;
            let dist = Math.hypot(lx - expectedCx, ly - expectedCy);

            // Allow 75% of step size as tolerance for drift/warp
            if (dist < Math.max(stepX, stepY) * 0.75 && dist < bestDist) {
              bestNext = l;
              bestDist = dist;
            }
          }
        }

        if (!bestNext) break;
        path.push(bestNext);
        cx = (bestNext.bbox.x0 + bestNext.bbox.x1) / 2;
        cy = (bestNext.bbox.y0 + bestNext.bbox.y1) / 2;
      }

      if (path.length === word.length) matches.push(path);
    });
  }
  return matches;
}

function highlightLetters(letters) {
  if (letters.length === 0) return;

  const first = letters[0].bbox;
  const last = letters[letters.length - 1].bbox;

  const startX = (first.x0 + first.x1) / 2;
  const startY = (first.y0 + first.y1) / 2;
  const endX = (last.x0 + last.x1) / 2;
  const endY = (last.y0 + last.y1) / 2;

  const color = `hsla(${Math.random() * 360}, 100%, 60%, 0.5)`;
  const highlight = { startX, startY, endX, endY, color };
  foundHighlights.push(highlight);
  drawLine(highlight);
}

function drawLine(h) {
  ctx.strokeStyle = h.color;
  ctx.lineWidth = 25;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(h.startX, h.startY);
  ctx.lineTo(h.endX, h.endY);
  ctx.stroke();
}

async function runWordBankOCR(img) {
  statusText.textContent = "Scanning Word Bank...";
  const result = await Tesseract.recognize(img, "eng");
  const text = result.data.text || "";
  const words = (text.match(/[A-Za-z]{3,}/g) || []).map(w => w.toUpperCase());

  let added = 0;
  words.forEach(w => {
    if (!wordBankSet.has(w)) {
      wordBankSet.add(w);
      added++;
    }
  });

  buildWordBankUI();
  statusText.textContent = `Added ${added} new word(s). Total: ${wordBankSet.size}.`;
}

function buildWordBankUI() {
  wordBankList.innerHTML = "";
  Array.from(wordBankSet).forEach(word => {
    const pill = document.createElement("div");
    pill.className = "word-pill";

    const label = document.createElement("span");
    label.textContent = word;
    pill.style.cursor = "pointer";
    pill.onclick = () => {
      if (!verified || ocrLetters.length === 0) {
        alert("Please scan the puzzle grid and confirm the letters first!");
        return;
      }
      redrawAllHighlights();
      const matches = findWord(word);
      if (matches.length === 0) {
        statusText.textContent = "Word not found.";
        return;
      }
      matches.forEach(m => highlightLetters(m));
      pill.classList.add("found");
      statusText.textContent = `Found ${matches.length} match(es).`;
    };

    const editBtn = document.createElement("button");
    editBtn.textContent = "✏️";
    editBtn.className = "word-edit";
    editBtn.title = "Edit";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      const edited = prompt("Edit word:", word);
      if (edited === null) return;
      const trimmed = edited.trim().toUpperCase();
      if (!trimmed) return;
      wordBankSet.delete(word);
      wordBankSet.add(trimmed);
      buildWordBankUI();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "❌";
    delBtn.className = "word-delete";
    delBtn.title = "Delete";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      wordBankSet.delete(word);
      buildWordBankUI();
    };

    pill.appendChild(label);
    pill.appendChild(editBtn);
    pill.appendChild(delBtn);

    wordBankList.appendChild(pill);
  });
}

// Resizable Scanner Box Logic
let isDragging = false;
let currentHandle = null;
let startX, startY, startW, startH, startLeft, startTop;

const resizeHandles = document.querySelectorAll(".resize-handle");

resizeHandles.forEach(handle => {
  handle.addEventListener("pointerdown", (e) => {
    isDragging = true;
    currentHandle = handle;
    const rect = scannerBox.getBoundingClientRect();
    const parentRect = scannerBox.parentElement.getBoundingClientRect();

    // Switch from translate(-50%, -50%) to absolute positioning for easier drag math
    if (scannerBox.style.transform !== "none") {
      scannerBox.style.transform = "none";
      scannerBox.style.left = (rect.left - parentRect.left) + "px";
      scannerBox.style.top = (rect.top - parentRect.top) + "px";
      scannerBox.style.width = rect.width + "px";
      scannerBox.style.height = rect.height + "px";
    }

    startX = e.clientX;
    startY = e.clientY;
    startW = rect.width;
    startH = rect.height;
    startLeft = parseInt(scannerBox.style.left || 0, 10);
    startTop = parseInt(scannerBox.style.top || 0, 10);

    e.preventDefault(); // prevent scrolling on touch
  });
});

window.addEventListener("pointermove", (e) => {
  if (!isDragging || !currentHandle) return;

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  let newW = startW;
  let newH = startH;
  let newLeft = startLeft;
  let newTop = startTop;

  const minSize = 50;
  const parentRect = scannerBox.parentElement.getBoundingClientRect();

  if (currentHandle.classList.contains("se")) {
    newW = Math.max(minSize, startW + dx);
    newH = Math.max(minSize, startH + dy);
  } else if (currentHandle.classList.contains("sw")) {
    newW = Math.max(minSize, startW - dx);
    newH = Math.max(minSize, startH + dy);
    if (startW - dx >= minSize) newLeft = startLeft + dx;
  } else if (currentHandle.classList.contains("ne")) {
    newW = Math.max(minSize, startW + dx);
    newH = Math.max(minSize, startH - dy);
    if (startH - dy >= minSize) newTop = startTop + dy;
  } else if (currentHandle.classList.contains("nw")) {
    newW = Math.max(minSize, startW - dx);
    newH = Math.max(minSize, startH - dy);
    if (startW - dx >= minSize) newLeft = startLeft + dx;
    if (startH - dy >= minSize) newTop = startTop + dy;
  }

  // Bounds check
  if (newLeft < 0) { newW += newLeft; newLeft = 0; }
  if (newTop < 0) { newH += newTop; newTop = 0; }
  if (newLeft + newW > parentRect.width) newW = parentRect.width - newLeft;
  if (newTop + newH > parentRect.height) newH = parentRect.height - newTop;

  scannerBox.style.width = newW + "px";
  scannerBox.style.height = newH + "px";
  scannerBox.style.left = newLeft + "px";
  scannerBox.style.top = newTop + "px";
});

window.addEventListener("pointerup", () => {
  isDragging = false;
  currentHandle = null;
});
