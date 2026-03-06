const video = document.getElementById("video");
const scannerBox = document.getElementById("scannerBox");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const wordInput = document.getElementById("wordInput");
const searchBtn = document.getElementById("searchBtn");
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
}

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  video.srcObject = stream;
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

  const cropped = offCtx.getImageData(cropX, cropY, cropWidth, cropHeight);
  preprocess(cropped);

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

function preprocess(imageData) {
  const data = imageData.data;
  // Grayscale only; let Tesseract handle binarization
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
}

async function runOCR(img) {
  statusText.textContent = "Running OCR...";
  verified = false;
  wordInput.disabled = true;
  searchBtn.disabled = true;

  const result = await Tesseract.recognize(img, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    logger: m => {
      if (m.status === "recognizing text") {
        statusText.textContent = `OCR ${Math.round(m.progress * 100)}%`;
      }
    }
  });

  const letters = [];
  const CONF_THRESHOLD = 80;

  if (result.data.symbols && result.data.symbols.length > 0) {
    result.data.symbols.forEach(s => {
      if (!/^[A-Z]$/.test(s.text)) return;

      const { x0, y0, x1, y1 } = s.bbox;
      const width = x1 - x0;
      const height = y1 - y0;
      const confidence = typeof s.confidence === "number" ? s.confidence : 100;

      if (width > height * 1.25) {
        const pieces = Math.max(1, Math.round(width / height));
        const pieceWidth = width / pieces;

        for (let i = 0; i < pieces; i++) {
          const px0 = Math.floor(x0 + i * pieceWidth);
          const px1 = Math.floor(x0 + (i + 1) * pieceWidth);
          letters.push({
            char: s.text,
            bbox: { x0: px0, y0, x1: px1, y1 },
            confidence
          });
        }
      } else {
        letters.push({ char: s.text, bbox: s.bbox, confidence });
      }
    });
  }

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
    statusText.textContent = "OCR complete. All letters auto-confirmed.";
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

function findWord(word) {
  const matches = [];
  const directions = [
    [1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]
  ];

  const grid = ocrLetters;

  for (let i = 0; i < grid.length; i++) {
    if (grid[i].char !== word[0]) continue;

    directions.forEach(([dx,dy]) => {
      const path = [grid[i]];
      let { x0, y0 } = grid[i].bbox;

      for (let j = 1; j < word.length; j++) {
        const next = grid.find(l =>
          l.char === word[j] &&
          Math.abs(l.bbox.x0 - (x0 + dx*20)) < 15 &&
          Math.abs(l.bbox.y0 - (y0 + dy*20)) < 15
        );

        if (!next) return;
        path.push(next);
        x0 = next.bbox.x0;
        y0 = next.bbox.y0;
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

  const color = `hsla(${Math.random()*360}, 100%, 60%, 0.5)`;
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
