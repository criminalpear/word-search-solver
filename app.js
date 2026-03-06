const video = document.getElementById("video");
const scannerBox = document.getElementById("scannerBox");
const captureBtn = document.getElementById("captureBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const wordInput = document.getElementById("wordInput");
const searchBtn = document.getElementById("searchBtn");
const statusText = document.getElementById("statusText");
const reviewSection = document.getElementById("reviewSection");

let ocrLetters = [];
let baseImage = null;
let verified = false;

initCamera();
captureBtn.addEventListener("click", captureFrame);
searchBtn.addEventListener("click", handleSearch);

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  video.srcObject = stream;
}

async function captureFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  canvas.width = vw;
  canvas.height = vh;
  ctx.drawImage(video, 0, 0, vw, vh);

  const rect = scannerBox.getBoundingClientRect();
  const videoRect = video.getBoundingClientRect();

  const scaleX = vw / videoRect.width;
  const scaleY = vh / videoRect.height;

  const sx = (rect.left - videoRect.left) * scaleX;
  const sy = (rect.top - videoRect.top) * scaleY;
  const sw = rect.width * scaleX;
  const sh = rect.height * scaleY;

  const cropped = ctx.getImageData(sx, sy, sw, sh);

  preprocess(cropped);
  ctx.putImageData(cropped, 0, 0);
  canvas.width = sw;
  canvas.height = sh;
  ctx.putImageData(cropped, 0, 0);

  baseImage = new Image();
  baseImage.src = canvas.toDataURL();

  await runOCR(baseImage);
}

function preprocess(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    const high = gray > 128 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = high;
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

  ocrLetters = result.data.symbols
    .filter(s => /^[A-Z]$/.test(s.text))
    .map(s => ({ char: s.text, bbox: s.bbox }));

  buildReviewUI();
}

function buildReviewUI() {
  reviewSection.innerHTML = "";
  reviewSection.classList.remove("hidden");

  const groups = {};
  ocrLetters.forEach((l, idx) => {
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
      temp.width = x1 - x0;
      temp.height = y1 - y0;
      temp.getContext("2d").drawImage(canvas, x0, y0, temp.width, temp.height, 0, 0, temp.width, temp.height);

      temp.className = "crop";
      temp.onclick = () => {
        const newChar = prompt("Correct letter:", item.char);
        if (newChar && /^[A-Z]$/.test(newChar)) {
          ocrLetters[item.index].char = newChar;
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

    div.appendChild(crops);
    div.appendChild(confirm);
    reviewSection.appendChild(div);
  });
}

function handleSearch() {
  const word = wordInput.value.trim().toUpperCase();
  if (!word || ocrLetters.length === 0) return;

  redrawBaseImage();

  const matches = findWord(word);
  if (matches.length === 0) {
    statusText.textContent = "Word not found.";
    return;
  }

  matches.forEach(match => highlightLetters(match));
  statusText.textContent = `Found ${matches.length} match(es).`;
}

function redrawBaseImage() {
  if (baseImage) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
  }
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
  ctx.fillStyle = "rgba(0, 255, 204, 0.35)";
  letters.forEach(l => {
    const { x0, y0, x1, y1 } = l.bbox;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  });
}
