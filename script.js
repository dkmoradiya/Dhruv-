// Basic Ludo game scaffold with 2-4 players, menu flow, and a playable board.

// ==== DOM ==== 
const menuOverlay = document.getElementById('menuOverlay');
const modeOverlay = document.getElementById('modeOverlay');
const playBtn = document.getElementById('playBtn');
const exitBtn = document.getElementById('exitBtn');
const backToMenuBtn = document.getElementById('backToMenuBtn');
const gameUI = document.getElementById('gameUI');
const rollBtn = document.getElementById('rollBtn');
const diceValueEl = document.getElementById('diceValue');
const currentPlayerBadge = document.getElementById('currentPlayerBadge');
const restartBtn = document.getElementById('restartBtn');
const quitBtn = document.getElementById('quitBtn');
const messageEl = document.getElementById('message');
const boardCanvas = document.getElementById('board');
const ctx = boardCanvas.getContext('2d');

// ==== Constants ====
const TILE = 40; // base tile size
const BOARD_SIZE = 15; // 15x15 grid commonly used for Ludo layout
const CANVAS_SIZE = TILE * BOARD_SIZE; // 600
// But our canvas is 720, we will scale drawing
const DRAW_SCALE = boardCanvas.width / CANVAS_SIZE;

// Player colors (up to 4)
const PLAYER_COLORS = [
  '#ef4444', // red
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // yellow
];

// ==== Game State ====
/** @type {GameState} */
let gameState = null;

// ==== Models ====
/**
 * @typedef {Object} Token
 * @property {number} id index 0..3 per player
 * @property {number} position -1 for home, else index on player path 0..56
 * @property {boolean} finished whether token reached end
 */

/**
 * @typedef {Object} Player
 * @property {number} id 0..3
 * @property {string} color hex color
 * @property {Token[]} tokens length 4
 * @property {number[]} path array of board coordinates indices
 */

/**
 * @typedef {Object} GameState
 * @property {number} numPlayers
 * @property {Player[]} players
 * @property {number} currentPlayerIdx
 * @property {number|null} dice
 * @property {boolean} awaitingMove
 * @property {boolean} gameOver
 */

// We will precompute a generic 56-step looped path and rotate for each player.
// For a simplified implementation, we use a conceptual ring of 52 + 6 home stretch.
// Board coordinate mapping for visuals will be handled by a helper grid.

// Layout helper: 15x15 grid with center cross. We'll define main path positions in grid coordinates.
const GRID = createLudoGridPath();

function createLudoGridPath() {
  // Returns path definitions for each player: ring (52) + home (6)
  // Using standard ordering starting from top-left player's exit moving clockwise.
  // We'll create a shared ring of 52 grid cells.
  const ring = [];
  // Define ring coordinates by tracing along the perimeter cross typical in ludo.
  // We'll approximate a nice path across the 15x15 board. Center at (7,7).
  // Path coordinates manually listed for balanced look. This is a compact, readable set.

  // Helper to push sequence
  const pushLine = (x0, y0, x1, y1) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    ring.push([x, y]);
    while (x !== x1 || y !== y1) {
      x += dx; y += dy;
      ring.push([x, y]);
    }
  };

  // Construct a loop shaped around center:
  // This set is crafted to produce 52 unique cells. We'll build a rectangular loop with offsets.
  // Top row segment
  pushLine(6, 1, 8, 1);
  pushLine(8, 1, 8, 6);
  pushLine(8, 6, 13, 6);
  pushLine(13, 6, 13, 8);
  pushLine(13, 8, 8, 8);
  pushLine(8, 8, 8, 13);
  pushLine(8, 13, 6, 13);
  pushLine(6, 13, 6, 8);
  pushLine(6, 8, 1, 8);
  pushLine(1, 8, 1, 6);
  pushLine(1, 6, 6, 6);
  pushLine(6, 6, 6, 1);

  // Above produced duplicates on corners; deduplicate while preserving order
  const dedup = [];
  const seen = new Set();
  for (const p of ring) {
    const key = p.join(',');
    if (!seen.has(key)) { dedup.push(p); seen.add(key); }
  }

  // Ensure we have 52 steps by smoothing with additional segments if short
  // If length < 52, we can walk around the loop again until 52.
  const full = [];
  while (full.length < 52) {
    for (const p of dedup) {
      if (full.length >= 52) break;
      full.push(p);
    }
  }

  // Home stretch for each player, 6 cells towards center (7,7)
  const center = [7, 7];
  const homeStretches = [
    // Player 0 (top-left red) enters from (6,1)->(6,6) direction; home to center along +y (5 cells then center)
    [[6, 2],[6, 3],[6, 4],[6, 5],[6, 6]],
    // Player 1 (top-right green) enter from (13,6)->(8,6); home to center along -x
    [[12, 6],[11, 6],[10, 6],[9, 6],[8, 6]],
    // Player 2 (bottom-right blue) enter from (8,13)->(8,8); home to center along -y
    [[8, 12],[8, 11],[8, 10],[8, 9],[8, 8]],
    // Player 3 (bottom-left yellow) enter from (1,8)->(6,8); home to center along +x
    [[2, 8],[3, 8],[4, 8],[5, 8],[6, 8]],
  ];

  // Starting tile indexes for each player on ring
  const startIdx = [0, 13, 26, 39];
  // Entry tiles to home stretch (the 'colored' row start)
  const entryIdx = [10, 23, 36, 49];

  return {
    ring: full, // 52 entries of [x,y]
    homeStretches,
    startIdx,
    entryIdx,
    center,
  };
}

function createGame(numPlayers) {
  /** @type {Player[]} */
  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    const tokens = Array.from({ length: 4 }, (_, t) => ({ id: t, position: -1, finished: false }));
    players.push({ id: i, color: PLAYER_COLORS[i], tokens, path: [] });
  }

  return {
    numPlayers,
    players,
    currentPlayerIdx: 0,
    dice: null,
    awaitingMove: false,
    gameOver: false,
  };
}

// Compute path index for a player's token position value
function getBoardCoordForPosition(playerId, position) {
  // position -1 means in home yard, return null
  if (position < 0) return null;

  const ringLen = 52;
  const start = GRID.startIdx[playerId];
  const entry = GRID.entryIdx[playerId];
  const stepsToEntry = (entry - start + ringLen) % ringLen; // positions 0..stepsToEntry are ring before home stretch

  if (position <= stepsToEntry) {
    const ringIdx = (start + position) % ringLen;
    return GRID.ring[ringIdx];
  } else {
    const homeIdx = position - stepsToEntry - 1; // 0-based into home stretch (5 cells), then center
    if (homeIdx >= 0 && homeIdx < 5) {
      return GRID.homeStretches[playerId][homeIdx];
    } else if (homeIdx === 5) {
      return GRID.center; // finished at center
    }
  }
  return null;
}

function canTokenMove(playerId, token, dice) {
  if (token.finished) return false;
  if (token.position === -1) {
    // Needs 6 to enter
    return dice === 6;
  }
  const ringLen = 52;
  const start = GRID.startIdx[playerId];
  const entry = GRID.entryIdx[playerId];
  const stepsToEntry = (entry - start + ringLen) % ringLen;
  const target = token.position + dice;
  // Can move into home if exact within 5 cells after entry, then center
  return target <= stepsToEntry + 5; // allow center if exact
}

function applyMove(state, player, token, dice) {
  if (token.position === -1) {
    token.position = 0; // enter the board at player's start
  } else {
    token.position += dice;
  }
  // Check finish
  const ringLen = 52;
  const start = GRID.startIdx[player.id];
  const entry = GRID.entryIdx[player.id];
  const stepsToEntry = (entry - start + ringLen) % ringLen;
  const homeIdx = token.position - stepsToEntry - 1;
  if (homeIdx === 5) {
    token.finished = true;
  }
  // Handle capture on ring tiles only (not in home stretch)
  const posCoord = getBoardCoordForPosition(player.id, token.position);
  const onHomeStretch = token.position > stepsToEntry;
  if (!onHomeStretch && posCoord) {
    for (const other of state.players) {
      if (other.id === player.id) continue;
      for (const ot of other.tokens) {
        if (ot.position < 0 || ot.finished) continue;
        const oc = getBoardCoordForPosition(other.id, ot.position);
        if (oc && oc[0] === posCoord[0] && oc[1] === posCoord[1]) {
          // send back to home if on same tile
          ot.position = -1;
        }
      }
    }
  }
}

function allTokensFinished(player) {
  return player.tokens.every(t => t.finished);
}

// ==== Rendering ====
function clearCanvas() {
  ctx.save();
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.restore();
}

function drawBoard() {
  ctx.save();
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  // background grid
  ctx.fillStyle = '#0b1023';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Draw ring cells
  for (const [x, y] of GRID.ring) {
    drawCell(x, y, 'rgba(255,255,255,0.04)');
  }
  // Draw home stretches in player colors
  for (let p = 0; p < 4; p++) {
    const arr = GRID.homeStretches[p];
    const color = PLAYER_COLORS[p];
    for (let i = 0; i < arr.length; i++) {
      const [x, y] = arr[i];
      drawCell(x, y, hexToRgba(color, i < 5 ? 0.35 : 0.6));
    }
  }
  // Draw center
  drawCircle(GRID.center[0], GRID.center[1], TILE * 0.45, 'rgba(255,255,255,0.06)');

  // Start tiles markers
  for (let p = 0; p < 4; p++) {
    const idx = GRID.startIdx[p];
    const [x, y] = GRID.ring[idx];
    drawCell(x, y, hexToRgba(PLAYER_COLORS[p], 0.55));
  }

  ctx.restore();
}

function drawCell(gridX, gridY, fill) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(gridX * TILE, gridY * TILE, TILE, TILE);
  ctx.fill();
  ctx.stroke();
}

function drawCircle(gridX, gridY, radius, fill) {
  const cx = gridX * TILE + TILE / 2;
  const cy = gridY * TILE + TILE / 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawTokens(state) {
  ctx.save();
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  // Compute highlight set when awaiting move
  let highlightTokenIds = new Set();
  if (state && state.awaitingMove && state.dice != null) {
    const current = state.players[state.currentPlayerIdx];
    for (const t of current.tokens) {
      if (canTokenMove(current.id, t, state.dice)) highlightTokenIds.add(t.id);
    }
  }
  for (const player of state.players) {
    for (const token of player.tokens) {
      let coord = getBoardCoordForPosition(player.id, token.position);
      let cx, cy;
      if (!coord) {
        // Arrange at home yard corners around player's quadrant
        const homePositions = homeYardSpots(player.id);
        const hp = homePositions[token.id];
        cx = hp[0] * TILE + TILE / 2;
        cy = hp[1] * TILE + TILE / 2;
      } else {
        cx = coord[0] * TILE + TILE / 2;
        cy = coord[1] * TILE + TILE / 2;
      }
      // draw token
      let baseColor = player.color;
      let isHighlight = (state.awaitingMove && player.id === state.currentPlayerIdx && highlightTokenIds.has(token.id));
      ctx.fillStyle = isHighlight ? hexToRgba(baseColor, 0.85) : baseColor;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // finished marker ring
      if (token.finished) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isHighlight) {
        // glow ring
        ctx.strokeStyle = hexToRgba('#ffffff', 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.47, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function homeYardSpots(playerId) {
  // Define four home positions per player in their quadrant
  switch (playerId) {
    case 0: return [[2,2],[4,2],[2,4],[4,4]]; // top-left
    case 1: return [[10,2],[12,2],[10,4],[12,4]]; // top-right
    case 2: return [[10,10],[12,10],[10,12],[12,12]]; // bottom-right
    case 3: return [[2,10],[4,10],[2,12],[4,12]]; // bottom-left
    default: return [[0,0],[1,0],[0,1],[1,1]];
  }
}

function render() {
  clearCanvas();
  drawBoard();
  if (gameState) {
    drawTokens(gameState);
  }
}

// ==== Input and Flow ====
playBtn.addEventListener('click', () => {
  menuOverlay.classList.add('hidden');
  modeOverlay.classList.remove('hidden');
});

exitBtn.addEventListener('click', () => {
  // In a browser, "exit" can just close menu or show message
  messageEl.textContent = 'Thanks for visiting!';
});

backToMenuBtn.addEventListener('click', () => {
  modeOverlay.classList.add('hidden');
  menuOverlay.classList.remove('hidden');
});

document.querySelectorAll('#modeOverlay .btn.primary').forEach(btn => {
  btn.addEventListener('click', () => {
    const num = Number(btn.getAttribute('data-players'));
    startGame(num);
  });
});

restartBtn.addEventListener('click', () => {
  if (gameState) startGame(gameState.numPlayers);
});

quitBtn.addEventListener('click', () => {
  // Return to menu
  gameUI.classList.add('hidden');
  menuOverlay.classList.remove('hidden');
  modeOverlay.classList.add('hidden');
});

rollBtn.addEventListener('click', () => {
  if (!gameState || gameState.gameOver) return;
  if (gameState.awaitingMove) return;
  const dice = Math.floor(Math.random() * 6) + 1;
  gameState.dice = dice;
  diceValueEl.textContent = String(dice);

  const current = gameState.players[gameState.currentPlayerIdx];
  const movables = current.tokens.filter(t => canTokenMove(current.id, t, dice));
  if (movables.length === 0) {
    messageEl.textContent = `No moves. Next player.`;
    nextTurn();
    return;
  }
  // If only one move, auto-move; else let user click token
  if (movables.length === 1) {
    applyMove(gameState, current, movables[0], dice);
    postMoveAdvance(current, dice);
  } else {
    gameState.awaitingMove = true;
    messageEl.textContent = `Select a token to move ${dice}.`;
  }
  render();
});

boardCanvas.addEventListener('click', (ev) => {
  if (!gameState || !gameState.awaitingMove) return;
  const rect = boardCanvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / DRAW_SCALE;
  const y = (ev.clientY - rect.top) / DRAW_SCALE;

  const current = gameState.players[gameState.currentPlayerIdx];
  const dice = gameState.dice;
  let clickedToken = null;
  for (const token of current.tokens) {
    const coord = getBoardCoordForPosition(current.id, token.position);
    const [cx, cy] = coord
      ? [coord[0] * TILE + TILE / 2, coord[1] * TILE + TILE / 2]
      : (homeYardSpots(current.id)[token.id].map(v => v * TILE + TILE / 2));
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= (TILE * 0.4) * (TILE * 0.4)) {
      clickedToken = token;
      break;
    }
  }
  if (clickedToken && canTokenMove(current.id, clickedToken, dice)) {
    applyMove(gameState, current, clickedToken, dice);
    gameState.awaitingMove = false;
    postMoveAdvance(current, dice);
    render();
  }
});

boardCanvas.addEventListener('mousemove', (ev) => {
  if (!gameState || !gameState.awaitingMove) {
    boardCanvas.style.cursor = 'default';
    return;
  }
  const rect = boardCanvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / DRAW_SCALE;
  const y = (ev.clientY - rect.top) / DRAW_SCALE;
  const current = gameState.players[gameState.currentPlayerIdx];
  const dice = gameState.dice;
  let hoverMovable = false;
  for (const token of current.tokens) {
    const coord = getBoardCoordForPosition(current.id, token.position);
    const [cx, cy] = coord
      ? [coord[0] * TILE + TILE / 2, coord[1] * TILE + TILE / 2]
      : (homeYardSpots(current.id)[token.id].map(v => v * TILE + TILE / 2));
    const dx = x - cx, dy = y - cy;
    const isOver = (dx * dx + dy * dy <= (TILE * 0.4) * (TILE * 0.4));
    if (isOver && canTokenMove(current.id, token, dice)) {
      hoverMovable = true;
      break;
    }
  }
  boardCanvas.style.cursor = hoverMovable ? 'pointer' : 'default';
});

function postMoveAdvance(current, dice) {
  if (allTokensFinished(current)) {
    gameState.gameOver = true;
    messageEl.textContent = `Player ${current.id + 1} wins!`;
    rollBtn.disabled = true;
    return;
  }
  const extraTurn = dice === 6;
  if (extraTurn) {
    messageEl.textContent = `Rolled 6! ${playerLabel(current)} goes again.`;
    updateBadge();
    return; // same player keeps turn
  }
  nextTurn(false);
}

function nextTurn() {
  gameState.currentPlayerIdx = (gameState.currentPlayerIdx + 1) % gameState.numPlayers;
  gameState.dice = null;
  diceValueEl.textContent = '-';
  updateBadge();
  messageEl.textContent = `${playerLabel(gameState.players[gameState.currentPlayerIdx])}'s turn. Roll the dice.`;
}

function updateBadge() {
  const p = gameState.players[gameState.currentPlayerIdx];
  currentPlayerBadge.textContent = `Player ${p.id + 1}`;
  currentPlayerBadge.style.background = hexToRgba(p.color, 0.25);
}

function playerLabel(p) { return `Player ${p.id + 1}`; }

function startGame(numPlayers) {
  gameState = createGame(numPlayers);
  rollBtn.disabled = false;
  messageEl.textContent = `Starting ${numPlayers}-player game. ${playerLabel(gameState.players[0])} begins.`;
  updateBadge();
  menuOverlay.classList.add('hidden');
  modeOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');
  render();
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Initial render
render();

