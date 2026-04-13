const VERSION = '1.0';

const GAME_URLS = {
  wordle: 'https://www.nytimes.com/games/wordle',
  connections: 'https://www.nytimes.com/games/connections',
  'mini-crossword': 'https://www.nytimes.com/crosswords/game/mini',
  strands: 'https://www.nytimes.com/games/strands',
  'spelling-bee': 'https://www.nytimes.com/puzzles/spelling-bee',
};

const GAME_SLUGS = {
  wordle: '/games/wordle',
  connections: '/games/connections',
  'mini-crossword': '/crosswords/game/mini',
  strands: '/games/strands',
  'spelling-bee': '/puzzles/spelling-bee',
};

function setStatus(type, text) {
  const el = document.getElementById('status');
  const icon = document.getElementById('status-icon');
  const textEl = document.getElementById('status-text');
  el.className = `status ${type}`;
  textEl.textContent = text;
  icon.textContent = type === 'solving' ? '\u23F3' : type === 'success' ? '\u2705' : '\u274C';
}

function disableButtons(disabled) {
  document.querySelectorAll('.game-card').forEach(btn => btn.disabled = disabled);
}

async function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

// Poll for solver result from ANY frame
async function pollForResult(tabId, maxAttempts, intervalMs) {
  let lastError = null;
  let errorSince = 0;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const checks = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => window.__nytSolverResult,
      });
      for (const check of checks) {
        if (check?.result?.success || check?.result?.needsCDP) return check.result;
        if (check?.result?.error) {
          if (!lastError) errorSince = i;
          lastError = check.result;
        }
      }
      if (lastError && (i - errorSince) > 50) return lastError;
    } catch {
      return null;
    }
  }
  return lastError;
}

async function solveGame(game) {
  disableButtons(true);
  setStatus('solving', `Opening ${game}...`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const slug = GAME_SLUGS[game];
    const isOnPage = tab.url && tab.url.includes(slug);

    if (!isOnPage) {
      await chrome.tabs.update(tab.id, { url: GAME_URLS[game] });
      await waitForTabLoad(tab.id);
      await new Promise(r => setTimeout(r, 1500));
    }

    setStatus('solving', `Solving ${game}...`);

    // Clear previous result in ALL frames
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        func: () => { window.__nytSolverResult = null; },
      });
    } catch (e) {
      setStatus('error', 'Clear failed: ' + e.message);
      disableButtons(false);
      return;
    }

    // Inject solver into ALL frames (MAIN world for React fiber access)
    const solverFile = game === 'mini-crossword' ? 'solvers/mini-crossword.js'
      : game === 'spelling-bee' ? 'solvers/spelling-bee.js'
      : `solvers/${game}.js`;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        files: [solverFile],
      });
    } catch (e) {
      setStatus('error', 'Inject failed: ' + e.message);
      disableButtons(false);
      return;
    }

    setStatus('solving', `Waiting for solution...`);

    const result = await pollForResult(tab.id, 300, 100);

    if (result && result.needsCDP) {
      // Strands needs CDP for trusted drag events — send all words at once
      setStatus('solving', `Dragging words via CDP...`);
      // Show debug info for first word before dragging
      if (result.debug && result.debug.length > 0) {
        const w = result.debug[0];
        const info = w.letters ? w.letters.join(' → ') : 'no letters';
        const coordInfo = w.coords ? w.coords.map(c => `${c.x},${c.y}`).join(' → ') : 'no coords';
        setStatus('solving', `${w.word}: ${info}\nCoords: ${coordInfo}`);
        await new Promise(r => setTimeout(r, 3000)); // Show for 3s so user can read
      }

      const cdpResult = await chrome.runtime.sendMessage({
        type: 'cdp-drag-words',
        tabId: tab.id,
        wordDrags: result.wordDrags,
      });
      if (cdpResult?.error) {
        setStatus('error', `CDP error: ${cdpResult.error}`);
        disableButtons(false);
        return;
      }
      setStatus('success', result.message || `${game} solved!`);
    } else if (result && result.success) {
      setStatus('success', result.message || `${game} solved!`);
    } else if (result && result.error) {
      setStatus('error', result.error);
    } else {
      setStatus('error', 'Timed out — no result after 30s');
    }
  } catch (err) {
    setStatus('error', err.message);
  }

  disableButtons(false);
}

// Debug button
document.getElementById('debug-btn').addEventListener('click', async () => {
  setStatus('solving', 'Running diagnostics...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        const totalElements = document.querySelectorAll('*').length;
        if (totalElements < 50) return null;

        // Detect game type
        let gameType = 'unknown';
        const url = location.href;
        if (url.includes('/wordle')) gameType = 'wordle';
        else if (url.includes('/connections')) gameType = 'connections';
        else if (url.includes('/crosswords/game/mini')) gameType = 'mini-crossword';
        else if (url.includes('/strands')) gameType = 'strands';
        else if (url.includes('/spelling-bee')) gameType = 'spelling-bee';

        // Check for React fiber
        const root = document.getElementById('__next') || document.getElementById('root') || document.getElementById('wordle-app-game');
        let hasReactFiber = false;
        if (root) {
          const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          hasReactFiber = !!fiberKey;
        }

        const result = window.__nytSolverResult;

        return {
          url: url.substring(0, 80),
          gameType,
          totalElements,
          hasReactFiber,
          rootId: root?.id || 'none',
          prevResult: result ? JSON.stringify(result).substring(0, 100) : null,
        };
      },
    });

    let msg = `v${VERSION} | Frames: ${results.length}`;
    for (let i = 0; i < results.length; i++) {
      const d = results[i]?.result;
      if (!d) continue;
      msg += `\n\nFrame ${i}: ${d.gameType} | ${d.url}`;
      msg += `\n  elements:${d.totalElements} fiber:${d.hasReactFiber} root:${d.rootId}`;
      if (d.prevResult) msg += `\n  prevResult: ${d.prevResult}`;
    }
    setStatus('success', msg);
  } catch (e) {
    setStatus('error', `Debug failed: ${e.message}`);
  }
});

// Game buttons
document.querySelectorAll('.game-card').forEach(btn => {
  btn.addEventListener('click', () => {
    const game = btn.dataset.game;
    solveGame(game);
  });
});

// Auto-detect: if already on a game page, start solving immediately
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    for (const [game, slug] of Object.entries(GAME_SLUGS)) {
      if (tab.url.includes(slug)) {
        solveGame(game);
        return;
      }
    }
  } catch {}
})();
