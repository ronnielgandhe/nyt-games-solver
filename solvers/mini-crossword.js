(async () => {
  try {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    // --- React Fiber walker ---
    function findInFiber(root, predicate, maxDepth = 80) {
      const visited = new Set();
      const queue = [{ fiber: root, depth: 0 }];
      while (queue.length) {
        const { fiber, depth } = queue.shift();
        if (!fiber || depth > maxDepth || visited.has(fiber)) continue;
        visited.add(fiber);
        let st = fiber.memoizedState;
        for (let i = 0; i < 20 && st; i++) {
          const val = st.memoizedState ?? st.queue?.lastRenderedState;
          if (val && predicate(val)) return val;
          st = st.next;
        }
        if (fiber.memoizedProps && predicate(fiber.memoizedProps)) return fiber.memoizedProps;
        if (fiber.stateNode && fiber.stateNode !== root && typeof fiber.stateNode === 'object') {
          if (fiber.stateNode.state && predicate(fiber.stateNode.state)) return fiber.stateNode.state;
        }
        queue.push({ fiber: fiber.child, depth: depth + 1 });
        queue.push({ fiber: fiber.sibling, depth: depth + 1 });
      }
      return null;
    }

    // --- Find crossword solution ---
    let cells = null;
    let gridSize = 5;

    const rootEl = document.getElementById('__next') || document.getElementById('root')
      || document.querySelector('.pz-game-field') || document.querySelector('[data-group="crossword"]');

    if (rootEl) {
      const fiberKey = Object.keys(rootEl).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        const fiber = rootEl[fiberKey];

        const state = findInFiber(fiber, val => {
          if (typeof val !== 'object' || val === null) return false;
          const c = val.cells || val.grid || val.board;
          if (Array.isArray(c) && c.length >= 25) {
            return c.some(cell => cell && (typeof cell.answer === 'string' || typeof cell.solution === 'string'));
          }
          if (val.body && Array.isArray(val.body)) {
            return val.body.some(b => b && Array.isArray(b.cells));
          }
          return false;
        });

        if (state) {
          const rawCells = state.cells || state.grid || state.board;
          if (Array.isArray(rawCells)) {
            cells = rawCells.map((c, i) => ({
              index: i,
              solution: c.answer || c.solution || '',
              isBlack: c.type === 'block' || c.answer === '.' || c.answer === null,
            }));
            gridSize = Math.round(Math.sqrt(rawCells.length));
          } else if (state.body) {
            cells = [];
            for (const section of state.body) {
              if (section.cells) {
                for (const c of section.cells) {
                  cells.push({
                    index: cells.length,
                    solution: c.answer || c.solution || '',
                    isBlack: !c.answer || c.answer === '.',
                  });
                }
              }
            }
            gridSize = Math.round(Math.sqrt(cells.length));
          }
        }
      }
    }

    // --- Fallback: search window globals ---
    if (!cells) {
      for (const key of Object.keys(window)) {
        try {
          const val = window[key];
          if (val && typeof val === 'object' && val.cells && Array.isArray(val.cells)) {
            if (val.cells.some(c => c && typeof c.answer === 'string')) {
              cells = val.cells.map((c, i) => ({
                index: i,
                solution: c.answer || '',
                isBlack: !c.answer || c.answer === '.',
              }));
              gridSize = Math.round(Math.sqrt(cells.length));
              break;
            }
          }
        } catch {}
      }
    }

    // --- Fallback: try API ---
    if (!cells) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const resp = await fetch(`https://www.nytimes.com/svc/crosswords/v6/puzzle/mini/${today}.json`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.body && data.body[0] && data.body[0].cells) {
            cells = data.body[0].cells.map((c, i) => ({
              index: i,
              solution: c.answer || '',
              isBlack: !c.answer || c.answer === '.',
            }));
            gridSize = Math.round(Math.sqrt(cells.length));
          }
        }
      } catch {}
    }

    if (!cells || cells.length === 0) {
      window.__nytSolverResult = { error: 'Could not find crossword puzzle data' };
      return;
    }

    // --- Fill in the grid ---
    const cellEls = document.querySelectorAll(
      '.xwd__cell, [data-testid="cell"], .cell, [class*="Cell"], rect[data-group="cells"]'
    );
    const svgCells = document.querySelectorAll('g[data-group="cells"] rect, g.xwd__cell');
    const allCellEls = cellEls.length > 0 ? cellEls : svgCells;

    if (allCellEls.length > 0) {
      let cellIndex = 0;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.isBlack || !cell.solution) continue;

        if (cellIndex < allCellEls.length) {
          const el = allCellEls[cellIndex];
          el.click();
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await delay(50);

          const letter = cell.solution.toUpperCase();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true }));
          await delay(50);
        }
        cellIndex++;
      }
    } else {
      const grid = document.querySelector('.xwd__board, [data-group="board"], .crossword-board, [class*="Board"]');
      if (grid) grid.click();
      await delay(200);

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.isBlack || !cell.solution) continue;
        const letter = cell.solution.toUpperCase();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true }));
        await delay(50);
      }
    }

    await delay(500);

    const letterCount = cells.filter(c => !c.isBlack && c.solution).length;
    window.__nytSolverResult = { success: true, message: `Mini Crossword solved! ${letterCount} letters filled` };
  } catch (e) {
    window.__nytSolverResult = { error: `Crossword error: ${e.message}` };
  }
})();
