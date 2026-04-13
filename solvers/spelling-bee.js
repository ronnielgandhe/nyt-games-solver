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

    // --- Find Spelling Bee word list ---
    let answers = null;   // Array of valid words
    let pangrams = null;  // Array of pangram words

    // Strategy 1: Check window.gameData (NYT sometimes exposes this)
    if (window.gameData) {
      if (window.gameData.today) {
        answers = window.gameData.today.answers;
        pangrams = window.gameData.today.pangrams;
      }
    }

    // Strategy 2: React fiber
    if (!answers) {
      const rootEl = document.getElementById('__next') || document.getElementById('root')
        || document.getElementById('pz-game-root') || document.querySelector('.pz-game-field');

      if (rootEl) {
        const fiberKey = Object.keys(rootEl).find(k =>
          k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (fiberKey) {
          const fiber = rootEl[fiberKey];

          const state = findInFiber(fiber, val => {
            if (typeof val !== 'object' || val === null) return false;
            // Look for answers array of strings (words)
            if (Array.isArray(val.answers) && val.answers.length > 10 &&
              val.answers.every(w => typeof w === 'string')) return true;
            // Look for today.answers pattern
            if (val.today && Array.isArray(val.today.answers)) return true;
            return false;
          });

          if (state) {
            if (state.today) {
              answers = state.today.answers;
              pangrams = state.today.pangrams;
            } else {
              answers = state.answers;
              pangrams = state.pangrams;
            }
          }
        }
      }
    }

    // Strategy 3: Search window globals for gameData-like objects
    if (!answers) {
      for (const key of Object.keys(window)) {
        try {
          const val = window[key];
          if (val && typeof val === 'object') {
            if (val.today && Array.isArray(val.today.answers)) {
              answers = val.today.answers;
              pangrams = val.today.pangrams;
              break;
            }
            if (Array.isArray(val.answers) && val.answers.length > 10 &&
              val.answers.every(w => typeof w === 'string')) {
              answers = val.answers;
              pangrams = val.pangrams;
              break;
            }
          }
        } catch {}
      }
    }

    // Strategy 4: Parse from script tags
    if (!answers) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text) continue;
        // Look for answers array in inline scripts
        const match = text.match(/"answers"\s*:\s*\[((?:"[a-z]+"(?:\s*,\s*)?)+)\]/);
        if (match) {
          try {
            answers = JSON.parse(`[${match[1]}]`);
            const pangramMatch = text.match(/"pangrams"\s*:\s*\[((?:"[a-z]+"(?:\s*,\s*)?)+)\]/);
            if (pangramMatch) pangrams = JSON.parse(`[${pangramMatch[1]}]`);
          } catch {}
          break;
        }
      }
    }

    if (!answers || answers.length === 0) {
      window.__nytSolverResult = { error: 'Could not find Spelling Bee answers in page state' };
      return;
    }

    // Sort: pangrams first (they're worth more), then by length descending
    const pangramSet = new Set(pangrams || []);
    answers.sort((a, b) => {
      const ap = pangramSet.has(a) ? 1 : 0;
      const bp = pangramSet.has(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.length - a.length;
    });

    // --- Type each word ---
    let enteredCount = 0;

    for (const word of answers) {
      // Type each letter
      for (const letter of word) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true }));
        await delay(30);
      }

      // Press Enter to submit
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      enteredCount++;

      await delay(400); // Wait for acceptance animation
    }

    window.__nytSolverResult = {
      success: true,
      message: `Spelling Bee solved! ${enteredCount} words entered (${pangrams?.length || 0} pangrams)`,
    };
  } catch (e) {
    window.__nytSolverResult = { error: `Spelling Bee error: ${e.message}` };
  }
})();
