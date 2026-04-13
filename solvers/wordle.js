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
        // Check memoizedState chain
        let st = fiber.memoizedState;
        for (let i = 0; i < 20 && st; i++) {
          const val = st.memoizedState ?? st.queue?.lastRenderedState;
          if (val && predicate(val)) return val;
          st = st.next;
        }
        // Check memoizedProps
        if (fiber.memoizedProps && predicate(fiber.memoizedProps)) return fiber.memoizedProps;
        // Check stateNode
        if (fiber.stateNode && fiber.stateNode !== root && typeof fiber.stateNode === 'object') {
          if (fiber.stateNode.state && predicate(fiber.stateNode.state)) return fiber.stateNode.state;
        }
        queue.push({ fiber: fiber.child, depth: depth + 1 });
        queue.push({ fiber: fiber.sibling, depth: depth + 1 });
        if (fiber.return && !visited.has(fiber.return)) {
          queue.push({ fiber: fiber.return, depth: depth + 1 });
        }
      }
      return null;
    }

    function deepSearch(obj, key, maxDepth = 10) {
      if (!obj || typeof obj !== 'object' || maxDepth <= 0) return undefined;
      if (key in obj) return obj[key];
      const visited = new Set();
      const stack = [{ o: obj, d: 0 }];
      while (stack.length) {
        const { o, d } = stack.pop();
        if (!o || typeof o !== 'object' || d > maxDepth || visited.has(o)) continue;
        visited.add(o);
        if (key in o) return o[key];
        for (const k of Object.keys(o)) {
          try { if (typeof o[k] === 'object' && o[k]) stack.push({ o: o[k], d: d + 1 }); } catch {}
        }
      }
      return undefined;
    }

    // --- Strategy 1: React fiber ---
    let solution = null;

    const rootEl = document.getElementById('wordle-app-game')
      || document.querySelector('[data-testid="game-wrapper"]')
      || document.getElementById('__next')
      || document.getElementById('root');

    if (rootEl) {
      const fiberKey = Object.keys(rootEl).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        const fiber = rootEl[fiberKey];
        // Look for an object with a `solution` property that's a 5-letter string
        const state = findInFiber(fiber, val => {
          if (typeof val === 'object' && val !== null) {
            const sol = val.solution;
            if (typeof sol === 'string' && /^[a-zA-Z]{5}$/.test(sol)) return true;
          }
          return false;
        });
        if (state) solution = state.solution.toLowerCase();
      }
    }

    // --- Strategy 2: Walk all DOM elements for fiber ---
    if (!solution) {
      const allEls = document.querySelectorAll('[class*="Board"], [class*="board"], [class*="game"], [data-testid]');
      for (const el of allEls) {
        const fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fk) continue;
        const state = findInFiber(el[fk], val => {
          if (typeof val === 'object' && val !== null) {
            const sol = val.solution;
            if (typeof sol === 'string' && /^[a-zA-Z]{5}$/.test(sol)) return true;
          }
          return false;
        });
        if (state) { solution = state.solution.toLowerCase(); break; }
      }
    }

    // --- Strategy 3: Search window/global stores ---
    if (!solution) {
      for (const key of Object.keys(window)) {
        try {
          const val = window[key];
          if (val && typeof val === 'object') {
            const sol = deepSearch(val, 'solution', 5);
            if (typeof sol === 'string' && /^[a-zA-Z]{5}$/.test(sol)) {
              solution = sol.toLowerCase();
              break;
            }
          }
        } catch {}
      }
    }

    // --- Strategy 4: Fetch today's puzzle from API ---
    if (!solution) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const resp = await fetch(`https://www.nytimes.com/svc/wordle/v2/${today}.json`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.solution && /^[a-zA-Z]{5}$/.test(data.solution)) {
            solution = data.solution.toLowerCase();
          }
        }
      } catch {}
    }

    if (!solution) {
      window.__nytSolverResult = { error: 'Could not find Wordle solution in page state or API' };
      return;
    }

    // --- Input the solution ---
    // Type each letter (dispatch to document only — both would double-enter letters)
    for (const letter of solution) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true }));
      await delay(80);
    }

    await delay(200);

    // Press Enter to submit
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await delay(2500); // Wait for row animation

    window.__nytSolverResult = { success: true, message: `Wordle solved: ${solution.toUpperCase()}` };
  } catch (e) {
    window.__nytSolverResult = { error: `Wordle error: ${e.message}` };
  }
})();
