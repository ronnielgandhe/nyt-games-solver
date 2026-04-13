// NYT Games Solver — Background Service Worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'cdp-drag-words') {
    handleCDPDragWords(msg.tabId, msg.wordDrags).then(sendResponse);
    return true;
  }
});

async function handleCDPDragWords(tabId, wordDrags) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    let solvedCount = 0;

    for (const { word, coords } of wordDrags) {
      // Hover to first cell
      await mouseCmd(tabId, 'mouseMoved', coords[0].x, coords[0].y);
      await sleep(30);

      // Press on first cell
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: coords[0].x, y: coords[0].y,
        button: 'left', clickCount: 1,
      });
      await sleep(60);

      // Smooth drag through each cell
      for (let i = 1; i < coords.length; i++) {
        const from = coords[i - 1];
        const to = coords[i];

        for (let s = 1; s <= 6; s++) {
          const t = s / 6;
          const x = Math.round(from.x + (to.x - from.x) * t);
          const y = Math.round(from.y + (to.y - from.y) * t);
          await mouseCmd(tabId, 'mouseMoved', x, y, true);
          await sleep(8);
        }

        await sleep(40);
      }

      // Release — submits the word
      const last = coords[coords.length - 1];
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: last.x, y: last.y,
        button: 'left', clickCount: 1,
      });

      solvedCount++;
      await sleep(1800);
    }

    await chrome.debugger.detach({ tabId });
    return { success: true, count: solvedCount };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { error: e.message };
  }
}

async function mouseCmd(tabId, type, x, y, pressed) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type, x, y,
    button: pressed ? 'left' : 'none',
    buttons: pressed ? 1 : 0,
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
