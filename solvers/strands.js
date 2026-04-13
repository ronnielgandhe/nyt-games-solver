(async () => {
  try {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    if (document.querySelectorAll('*').length < 50) return;

    // --- Read board from DOM ---
    const allEls = document.querySelectorAll('*');
    const letterEls = [];
    for (const el of allEls) {
      const text = el.textContent.trim();
      if (text.length !== 1 || !/^[A-Z]$/i.test(text)) continue;
      let hasLetterChild = false;
      for (const child of el.children) {
        if (child.textContent.trim().length === 1 && /^[A-Z]$/i.test(child.textContent.trim())) {
          hasLetterChild = true; break;
        }
      }
      if (hasLetterChild) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10 || rect.width > 150) continue;
      letterEls.push({ el, letter: text.toUpperCase(), cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
    }

    if (letterEls.length < 48) return;

    letterEls.sort((a, b) => Math.abs(a.cy - b.cy) > 10 ? a.cy - b.cy : a.cx - b.cx);
    const allRows = [];
    let curY = letterEls[0].cy, curRow = [letterEls[0]];
    for (let i = 1; i < letterEls.length; i++) {
      if (Math.abs(letterEls[i].cy - curY) < 10) curRow.push(letterEls[i]);
      else { allRows.push(curRow); curY = letterEls[i].cy; curRow = [letterEls[i]]; }
    }
    allRows.push(curRow);

    const rowLengthCounts = {};
    allRows.forEach(r => { rowLengthCounts[r.length] = (rowLengthCounts[r.length] || 0) + 1; });
    const gridCols = Number(Object.entries(rowLengthCounts).sort((a, b) => b[1] - a[1])[0][0]);
    const rowGroups = allRows.filter(r => r.length === gridCols);
    if (rowGroups.length < 6) return;

    const ROWS = rowGroups.length, COLS = gridCols;
    const board = [], cells = [];
    for (const row of rowGroups) {
      row.sort((a, b) => a.cx - b.cx);
      board.push(row.map(l => l.letter));
      cells.push(row.map(l => l.el));
    }

    // --- Find theme words ---
    let themeWords = null;

    function extractWords(obj, maxDepth = 10) {
      let foundWords = null;
      let foundSpangram = null;
      const visited = new Set();
      function search(o, d) {
        if (!o || typeof o !== 'object' || d > maxDepth || visited.has(o)) return;
        visited.add(o);
        for (const [key, val] of Object.entries(o)) {
          try {
            // Look for the spangram (single word, stored separately)
            if (!foundSpangram && typeof val === 'string' && val.length >= 4 && val.length <= 25 &&
                /^[a-zA-Z]+$/.test(val) && /spangram/i.test(key)) {
              foundSpangram = val.toUpperCase();
            }

            // Look for word arrays
            if (!foundWords && Array.isArray(val) && val.length >= 4 && val.length <= 20) {
              const result = [];
              for (const item of val) {
                if (!item) continue;
                if (typeof item === 'string' && item.length >= 3 && item.length <= 25 && /^[a-zA-Z]+$/.test(item))
                  result.push(item.toUpperCase());
                else if (typeof item === 'object') {
                  for (const wk of ['word', 'text', 'value', 'answer', 'content', 'name']) {
                    const w = item[wk];
                    if (typeof w === 'string' && w.length >= 3 && w.length <= 25 && /^[a-zA-Z]+$/.test(w)) {
                      result.push(w.toUpperCase()); break;
                    }
                  }
                }
              }
              if (result.length >= 4) foundWords = result;
            }

            if (val && typeof val === 'object') search(val, d + 1);
          } catch {}
        }
      }
      search(obj, 0);

      // Merge spangram into word list if found
      if (foundWords && foundSpangram && !foundWords.includes(foundSpangram)) {
        foundWords.push(foundSpangram);
      }

      return foundWords;
    }

    try {
      const entries = performance.getEntriesByType('resource');
      const gameUrls = entries.map(e => e.name).filter(u => /strand/i.test(u) && /\.json/i.test(u));
      for (const url of gameUrls) {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          if (resp.ok) { themeWords = extractWords(await resp.json()); if (themeWords) break; }
        } catch {}
      }
    } catch {}

    if (!themeWords) {
      for (const el of allEls) {
        if (themeWords) break;
        const fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fk) continue;
        const visited = new Set();
        const queue = [{ fiber: el[fk], depth: 0 }];
        while (queue.length && !themeWords) {
          const { fiber, depth } = queue.shift();
          if (!fiber || depth > 50 || visited.has(fiber)) continue;
          visited.add(fiber);
          let st = fiber.memoizedState;
          for (let i = 0; i < 25 && st && !themeWords; i++) {
            const val = st.memoizedState ?? st.queue?.lastRenderedState;
            if (val && typeof val === 'object') themeWords = extractWords(val);
            st = st.next;
          }
          if (!themeWords && fiber.memoizedProps) themeWords = extractWords(fiber.memoizedProps);
          queue.push({ fiber: fiber.child, depth: depth + 1 });
          queue.push({ fiber: fiber.sibling, depth: depth + 1 });
        }
        break;
      }
    }

    if (!themeWords) {
      const today = new Date().toISOString().split('T')[0];
      for (const url of [`https://www.nytimes.com/svc/strands/v2/${today}.json`, `/svc/strands/v2/${today}.json`]) {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          if (resp.ok) { themeWords = extractWords(await resp.json()); if (themeWords) break; }
        } catch {}
      }
    }

    if (!themeWords || themeWords.length === 0) {
      window.__nytSolverResult = { error: 'No words found' };
      return;
    }

    // --- DFS paths ---
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    function findWordPath(word, globalUsed) {
      function dfs(r, c, idx, path, localUsed) {
        if (idx === word.length) return path.map(p => ({ ...p }));
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
        const key = r * COLS + c;
        if (localUsed.has(key) || globalUsed.has(key)) return null;
        if (board[r][c] !== word[idx]) return null;
        localUsed.add(key);
        path.push({ row: r, col: c });
        for (const [dr, dc] of dirs) {
          const result = dfs(r + dr, c + dc, idx + 1, path, localUsed);
          if (result) return result;
        }
        path.pop();
        localUsed.delete(key);
        return null;
      }
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const result = dfs(r, c, 0, [], new Set());
          if (result) return result;
        }
      return null;
    }

    const globalUsed = new Set();
    const wordPaths = [];
    for (const word of themeWords) {
      const path = findWordPath(word, globalUsed);
      if (path) {
        wordPaths.push({ word, path });
        path.forEach(p => globalUsed.add(p.row * COLS + p.col));
      }
    }

    if (wordPaths.length === 0) {
      window.__nytSolverResult = { error: 'Words found but no DFS paths' };
      return;
    }

    // --- Build CDP click coordinates with VERIFICATION support ---
    // For each word, send coords AND the expected letters so background can verify
    const wordDrags = wordPaths.map(({ word, path }) => {
      const coords = path.map(({ row, col }) => {
        const el = cells[row][col];
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          letter: board[row][col],
        };
      });
      return { word, coords };
    });

    window.__nytSolverResult = {
      needsCDP: true,
      wordDrags,
      message: `Strands: ${wordPaths.length} words — ${themeWords.join(', ')}`,
    };
  } catch (e) {
    window.__nytSolverResult = { error: `Strands: ${e.message}` };
  }
})();
