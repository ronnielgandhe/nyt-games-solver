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

    // --- Simulate a real click (works with React event delegation) ---
    function simulateClick(el) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    }

    // --- Find the clickable element for a given word ---
    function findWordElement(word) {
      const upper = word.toUpperCase();
      const candidates = [];

      // Scan ALL elements for exact text match
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent.trim().toUpperCase();
        if (text !== upper) continue;
        const rect = el.getBoundingClientRect();
        // Must be visible and reasonable card size
        if (rect.width < 50 || rect.height < 20) continue;
        if (rect.width > 500 || rect.height > 200) continue;
        candidates.push({ el, area: rect.width * rect.height });
      }

      if (candidates.length === 0) return null;

      // Among matches, pick the one that looks most like a clickable card:
      // - Has a React fiber with an onClick (best)
      // - Is a button or role=button
      // - Otherwise, pick the largest visible match (the card itself, not inner text span)
      for (const c of candidates) {
        const fk = Object.keys(c.el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
        if (fk) {
          const props = c.el[Object.keys(c.el).find(k => k.startsWith('__reactProps'))];
          if (props && (props.onClick || props.onPointerDown || props.onMouseDown)) {
            return c.el;
          }
        }
      }

      // Fallback: prefer button elements
      const btnMatch = candidates.find(c => c.el.tagName === 'BUTTON' || c.el.getAttribute('role') === 'button');
      if (btnMatch) return btnMatch.el;

      // Fallback: largest element (likely the card container, not inner text)
      candidates.sort((a, b) => b.area - a.area);
      return candidates[0].el;
    }

    // --- Find categories from React state ---
    let categories = null;

    const rootEl = document.getElementById('__next') || document.getElementById('root');
    if (rootEl) {
      const fiberKey = Object.keys(rootEl).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        const fiber = rootEl[fiberKey];

        const state = findInFiber(fiber, val => {
          if (typeof val !== 'object' || val === null) return false;
          const cats = val.categories || val.groups;
          if (Array.isArray(cats) && cats.length === 4) {
            return cats.every(c =>
              c && Array.isArray(c.cards || c.words || c.members) &&
              (c.cards || c.words || c.members).length === 4
            );
          }
          return false;
        });

        if (state) {
          const raw = state.categories || state.groups;
          categories = raw.map(c => ({
            name: c.title || c.name || c.category || '',
            words: (c.cards || c.words || c.members).map(w =>
              typeof w === 'string' ? w : (w.content || w.text || w.word || '')
            ),
            level: c.level ?? c.difficulty ?? 0,
          }));
        }
      }
    }

    // --- Fallback: try API ---
    if (!categories) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const resp = await fetch(`https://www.nytimes.com/svc/connections/v2/${today}.json`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.categories && data.categories.length === 4) {
            categories = data.categories.map(c => ({
              name: c.title || c.name || '',
              words: (c.cards || c.words || []).map(w =>
                typeof w === 'string' ? w : (w.content || w.text || '')
              ),
              level: c.level ?? 0,
            }));
          }
        }
      } catch {}
    }

    if (!categories || categories.length !== 4) {
      window.__nytSolverResult = { error: 'Could not find Connections categories' };
      return;
    }

    // Sort by difficulty (easiest first)
    categories.sort((a, b) => a.level - b.level);

    // --- Figure out which groups are already solved ---
    // Check which words are still visible on the board
    const remainingGroups = categories.filter(group =>
      group.words.some(word => findWordElement(word) !== null)
    );

    if (remainingGroups.length === 0) {
      window.__nytSolverResult = { success: true, message: 'Connections already solved!' };
      return;
    }

    // --- Click words and submit each remaining group ---
    let errors = [];
    let solvedCount = categories.length - remainingGroups.length;

    for (const group of remainingGroups) {
      // Hit "Deselect All" to clear stale selections
      const deselectBtn = Array.from(document.querySelectorAll('button')).find(b =>
        /deselect/i.test(b.textContent.trim())
      );
      if (deselectBtn) {
        simulateClick(deselectBtn);
        await delay(500);
      }

      // Select the 4 words
      let selectedCount = 0;
      for (const word of group.words) {
        const el = findWordElement(word);
        if (el) {
          simulateClick(el);
          selectedCount++;
        } else {
          errors.push(`"${word}" not found`);
        }
        await delay(400);
      }

      await delay(600);

      // Click Submit
      if (selectedCount === 4) {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent.trim().toLowerCase() === 'submit'
        );
        if (submitBtn) {
          simulateClick(submitBtn);
          solvedCount++;
        } else {
          errors.push('Submit button not found');
        }
      } else {
        errors.push(`Only found ${selectedCount}/4 words for "${group.name}"`);
      }

      await delay(3000); // Wait for animation
    }

    const names = categories.map(c => c.name).join(', ');
    const msg = `Connections solved! (${solvedCount}/4 groups) — ${names}`;
    if (errors.length) {
      window.__nytSolverResult = { error: `${msg} | Issues: ${errors.join('; ')}` };
    } else {
      window.__nytSolverResult = { success: true, message: msg };
    }
  } catch (e) {
    window.__nytSolverResult = { error: `Connections error: ${e.message}` };
  }
})();
