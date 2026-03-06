const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Fix Word Bank click logic so the ENTIRE pill searches
code = code.replace(
`    const label = document.createElement("span");
    label.textContent = word;
    label.style.cursor = "pointer";
    label.onclick = () => {
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
      statusText.textContent = \`Found \${matches.length} match(es).\`;
    };`,

`    const label = document.createElement("span");
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
      statusText.textContent = \`Found \${matches.length} match(es).\`;
    };`
);

fs.writeFileSync('app.js', code);
