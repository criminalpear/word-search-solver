const imageInput = document.getElementById("imageInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const wordInput = document.getElementById("wordInput");
const searchBtn = document.getElementById("searchBtn");
const statusText = document.getElementById("statusText");

let ocrLetters = [];
let baseImage = null;

imageInput.addEventListener("change", handleImageUpload);
searchBtn.addEventListener("click", handleSearch);

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  statusText.textContent = "Loading image...";

  const img = new Image();
  img.src = URL.createObjectURL(file);

  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    baseImage = img;

    statusText.textContent = "Running OCR...";

    const result = await Tesseract.recognize(img, "eng", {
      logger: m => {
        if (m.status === "recognizing text") {
          statusText.textContent = `OCR Progress: ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    ocrLetters = result.data.symbols
      .filter(s => /^[A-Za-z]$/.test(s.text))
      .map(s => ({
        char: s.text.toUpperCase(),
        bbox: s.bbox
      }));

    statusText.textContent = `OCR complete. ${ocrLetters.length} letters detected.`;
  };
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

  for (let i = 0; i < ocrLetters.length; i++) {
    if (ocrLetters[i].char !== word[0]) continue;

    const candidate = [ocrLetters[i]];
    let lastY = ocrLetters[i].bbox.y0;

    for (let j = 1; j < word.length; j++) {
      const next = ocrLetters.find(l =>
        l.char === word[j] &&
        Math.abs(l.bbox.y0 - lastY) < 10 &&
        l.bbox.x0 > candidate[candidate.length - 1].bbox.x0
      );

      if (!next) break;

      candidate.push(next);
      lastY = next.bbox.y0;
    }

    if (candidate.length === word.length) {
      matches.push(candidate);
    }
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
