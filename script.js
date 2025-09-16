"use strict";

// Minimal Ludo implementation supporting 2, 3, or 4 players.
// Board rendered on a canvas; tokens are clickable to move when legal.

// ----- DOM -----
const screens = {
	menu: document.getElementById("menu-screen"),
	mode: document.getElementById("mode-screen"),
	game: document.getElementById("game-screen"),
};

const btnPlay = document.getElementById("btn-play");
const btnExit = document.getElementById("btn-exit");
const btnBackMenu = document.getElementById("btn-back-menu");
const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
const btnRoll = document.getElementById("btn-roll");
const btnRestart = document.getElementById("btn-restart");
const btnQuit = document.getElementById("btn-quit");
const currentPlayerIndicator = document.getElementById("current-player-indicator");
const diceResultEl = document.getElementById("dice-result");
const helpText = document.getElementById("help-text");
const canvas = document.getElementById("board-canvas");
const ctx = canvas.getContext("2d");

// ----- Game State -----
const PLAYER_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#eab308"]; // red, green, blue, yellow

/**
 * A token is at either base (home yard), on track at index [0..51], in home run [0..5], or finished.
 */
class Token {
	constructor(playerIndex, tokenIndex) {
		this.playerIndex = playerIndex;
		this.tokenIndex = tokenIndex;
		this.inBase = true;
		this.trackIndex = -1; // 0..51 absolute
		this.homeIndex = -1; // 0..5
		this.isFinished = false;
	}
}

class PlayerState {
	constructor(index) {
		this.index = index;
		this.color = PLAYER_COLORS[index];
		this.tokens = [0,1,2,3].map(i => new Token(index, i));
	}
}

const GamePhases = Object.freeze({ Idle: "idle", Rolling: "rolling", Moving: "moving", Finished: "finished" });

const START_TRACK_INDEX = [0, 13, 26, 39]; // where a player enters the main ring
const HOME_ENTRY_INDEX = [50, 11, 24, 37]; // where each player's home run begins after passing full ring

let game = {
	players: [], // PlayerState[]
	numPlayers: 4,
	currentTurn: 0,
	phase: GamePhases.Idle,
	lastRoll: null,
};

// ----- Navigation -----
function showScreen(name) {
	for (const key of Object.keys(screens)) {
		screens[key].classList.toggle("hidden", key !== name);
	}
}

btnPlay.addEventListener("click", () => showScreen("mode"));
btnExit.addEventListener("click", () => {
	// In a browser, exit just shows a thank you and disables UI
	btnPlay.disabled = true;
	btnExit.disabled = true;
	alert("Thanks for playing!");
});
btnBackMenu.addEventListener("click", () => showScreen("menu"));

modeButtons.forEach((b) => b.addEventListener("click", () => startGame(parseInt(b.dataset.players, 10))));
btnQuit.addEventListener("click", () => { showScreen("menu"); });
btnRestart.addEventListener("click", () => { startGame(game.numPlayers); });

btnRoll.addEventListener("click", onRollDice);

// ----- Geometry helpers -----
const BOARD_SIZE = 720;
const CELL = BOARD_SIZE / 15; // classic 15x15 grid
canvas.width = BOARD_SIZE;
canvas.height = BOARD_SIZE;

function drawBoard() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// background
	ctx.fillStyle = "#0f172a";
	ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

	// draw grid light
	ctx.strokeStyle = "rgba(255,255,255,0.06)";
	ctx.lineWidth = 1;
	for (let i = 0; i <= 15; i++) {
		ctx.beginPath(); ctx.moveTo(i*CELL,0); ctx.lineTo(i*CELL, BOARD_SIZE); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(0,i*CELL); ctx.lineTo(BOARD_SIZE, i*CELL); ctx.stroke();
	}

	// home yards (simplified colored squares)
	const yards = [
		{ x:0, y:0, c:PLAYER_COLORS[0] },
		{ x:9*CELL, y:0, c:PLAYER_COLORS[1] },
		{ x:0, y:9*CELL, c:PLAYER_COLORS[2] },
		{ x:9*CELL, y:9*CELL, c:PLAYER_COLORS[3] },
	];
	yards.forEach(y => { ctx.fillStyle = y.c + "55"; ctx.fillRect(y.x, y.y, 6*CELL, 6*CELL); });

	// center star triangle
	ctx.fillStyle = "#334155";
	ctx.beginPath();
	ctx.moveTo(6*CELL, 6*CELL); ctx.lineTo(9*CELL, 9*CELL); ctx.lineTo(6*CELL, 9*CELL); ctx.closePath(); ctx.fill();
	ctx.beginPath();
	ctx.moveTo(9*CELL, 6*CELL); ctx.lineTo(9*CELL, 9*CELL); ctx.lineTo(6*CELL, 6*CELL); ctx.closePath(); ctx.fill();

	// draw safe cells (every 13 steps from each start including start)
	const safeIndices = new Set([0,8,13,21,26,34,39,47]);
	for (const idx of safeIndices) {
		const { x, y } = trackIndexToCell(idx);
		ctx.fillStyle = "#06b6d4";
		ctx.fillRect(x*CELL, y*CELL, CELL, CELL);
	}

	// draw track path squares (outline)
	ctx.strokeStyle = "rgba(255,255,255,0.25)";
	const pathCells = mainTrackCells();
	pathCells.forEach(({x,y}) => { ctx.strokeRect(x*CELL, y*CELL, CELL, CELL); });

	// draw home runs per player
	for (let p = 0; p < game.numPlayers; p++) {
		const hr = homeRunCells(p);
		ctx.fillStyle = PLAYER_COLORS[p] + "66";
		hr.forEach(({x,y}) => ctx.fillRect(x*CELL, y*CELL, CELL, CELL));
	}
}

function mainTrackCells() {
	// Precomputed standard ludo ring indices layout mapped onto 15x15 grid (simplified)
	const cells = [];
	// Top row (6..8 columns are center), path goes clockwise starting at top-left entrance
	for (let i = 6; i <= 8; i++) cells.push({x:i, y:0});
	for (let i = 0; i <= 5; i++) cells.push({x:8, y:i});
	for (let i = 9; i <= 14; i++) cells.push({x:i, y:6});
	for (let i = 0; i <= 5; i++) cells.push({x:14, y:i});
	for (let i = 8; i >= 6; i--) cells.push({x:i, y:8});
	for (let i = 9; i <= 14; i++) cells.push({x:i, y:14});
	for (let i = 8; i >= 6; i--) cells.push({x:i, y:14});
	for (let i = 14; i >= 9; i--) cells.push({x:i, y:8});
	for (let i = 14; i >= 9; i--) cells.push({x:i, y:9});
	for (let i = 6; i >= 0; i--) cells.push({x:6, y:i});
	for (let i = 0; i <= 5; i++) cells.push({x:i, y:6});
	for (let i = 6; i >= 0; i--) cells.push({x:i, y:8});
	for (let i = 5; i >= 0; i--) cells.push({x:0, y:i});
	for (let i = 6; i <= 8; i++) cells.push({x:i, y:6});
	for (let i = 0; i <= 5; i++) cells.push({x:6, y:i});
	// This layout provides at least 52 cells; we will slice/normalize below.
	return normalizeTrack(cells, 52);
}

function normalizeTrack(cells, desired) {
	const out = [];
	for (let i = 0; i < desired; i++) out.push(cells[i % cells.length]);
	return out;
}

function trackIndexToCell(idx) {
	const c = mainTrackCells()[((idx % 52) + 52) % 52];
	return c;
}

function homeRunCells(playerIndex) {
	// 6 cells leading to the center from that player's entry
	const entry = HOME_ENTRY_INDEX[playerIndex];
	const entryCell = trackIndexToCell(entry);
	const center = { x: 7, y: 7 };
	const dx = Math.sign(center.x - entryCell.x);
	const dy = Math.sign(center.y - entryCell.y);
	const cells = [];
	let x = entryCell.x, y = entryCell.y;
	for (let i = 0; i < 6; i++) { x += dx; y += dy; cells.push({x, y}); }
	return cells;
}

// ----- Rendering tokens -----
function drawTokens() {
	// draw tokens in base yards or along track/home
	for (const player of game.players) {
		for (const token of player.tokens) {
			let cx, cy;
			if (token.inBase) {
				const base = baseSlotCenter(player.index, token.tokenIndex);
				cx = base.x; cy = base.y;
			} else if (token.isFinished) {
				const center = {x: 7.5*CELL, y: 7.5*CELL};
				cx = center.x + (token.tokenIndex-1.5)*8;
				cy = center.y + (player.index-1.5)*8;
			} else if (token.homeIndex >= 0) {
				const hr = homeRunCells(token.playerIndex)[token.homeIndex];
				cx = (hr.x + 0.5) * CELL; cy = (hr.y + 0.5) * CELL;
			} else {
				const c = trackIndexToCell(token.trackIndex);
				cx = (c.x + 0.5) * CELL; cy = (c.y + 0.5) * CELL;
			}
			drawTokenCircle(cx, cy, player.color, token.isFinished ? 10 : 14, token);
		}
	}
}

function drawTokenCircle(cx, cy, color, r, token) {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI*2);
	ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.4)";
	ctx.lineWidth = 2;
	ctx.stroke();
	// small index dot
	ctx.fillStyle = "#0b1220";
	ctx.font = "bold 12px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(String(token.tokenIndex+1), cx, cy);
}

function baseSlotCenter(playerIndex, tokenIndex) {
	const baseX = (playerIndex % 2 === 0) ? 1.5*CELL : 10.5*CELL;
	const baseY = (playerIndex < 2) ? 1.5*CELL : 10.5*CELL;
	const dx = (tokenIndex % 2 === 0) ? -CELL*1.2 : CELL*1.2;
	const dy = (tokenIndex < 2) ? -CELL*1.2 : CELL*1.2;
	return { x: baseX + dx, y: baseY + dy };
}

// ----- Interaction -----
canvas.addEventListener("click", onCanvasClick);

function onRollDice() {
	if (game.phase !== GamePhases.Rolling) return;
	const roll = 1 + Math.floor(Math.random() * 6);
	game.lastRoll = roll;
	diceResultEl.textContent = `Dice: ${roll}`;
	game.phase = GamePhases.Moving;
	updateHelpForMoves();
	render();
}

function onCanvasClick(evt) {
	if (game.phase !== GamePhases.Moving) return;
	const rect = canvas.getBoundingClientRect();
	const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
	const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
	// find if a token of current player was clicked and a legal move exists
	const current = game.players[game.currentTurn];
	const token = current.tokens.find(t => pointNearToken(x,y,t));
	if (!token) return;
	const legal = legalMovesForToken(token, game.lastRoll);
	if (!legal) return;
	executeMove(token, game.lastRoll);
	afterMoveAdvanceTurn();
	render();
}

function pointNearToken(px, py, token) {
	let cx, cy;
	if (token.inBase) { const b = baseSlotCenter(token.playerIndex, token.tokenIndex); cx=b.x; cy=b.y; }
	else if (token.isFinished) { const c={x:7.5*CELL,y:7.5*CELL}; cx=c.x; cy=c.y; }
	else if (token.homeIndex >= 0) { const hr = homeRunCells(token.playerIndex)[token.homeIndex]; cx=(hr.x+0.5)*CELL; cy=(hr.y+0.5)*CELL; }
	else { const c = trackIndexToCell(token.trackIndex); cx=(c.x+0.5)*CELL; cy=(c.y+0.5)*CELL; }
	const dx = px - cx, dy = py - cy; return (dx*dx + dy*dy) <= (16*16);
}

// ----- Rules -----
function legalMovesForToken(token, roll) {
	if (token.isFinished) return false;
	if (token.inBase) return roll === 6; // need a 6 to exit base
	if (token.homeIndex >= 0) {
		return token.homeIndex + roll <= 5; // must land exactly at end
	}
	// on track
	const distToHomeEntry = distanceAround(token.trackIndex, HOME_ENTRY_INDEX[token.playerIndex]);
	if (roll <= distToHomeEntry) return true; // still on main ring
	const intoHome = roll - distToHomeEntry - 1; // move into home cells
	return intoHome <= 5;
}

function executeMove(token, roll) {
	if (token.inBase) {
		token.inBase = false;
		token.trackIndex = START_TRACK_INDEX[token.playerIndex];
		if (roll > 6) return; // impossible
		if (roll > 1) {
			// advance remaining steps on track
			advanceOnTrack(token, roll - 1);
		}
		maybeCapture(token);
		return;
	}
	if (token.homeIndex >= 0) {
		const target = token.homeIndex + roll;
		if (target === 5) { token.homeIndex = -1; token.isFinished = true; }
		else { token.homeIndex = target; }
		return;
	}
	// on ring
	const before = token.trackIndex;
	const distToHome = distanceAround(before, HOME_ENTRY_INDEX[token.playerIndex]);
	if (roll <= distToHome) {
		advanceOnTrack(token, roll);
		maybeCapture(token);
		return;
	}
	// enter home
	const over = roll - distToHome - 1;
	if (over <= 5) { token.trackIndex = -1; token.homeIndex = over; }
}

function advanceOnTrack(token, steps) {
	token.trackIndex = (token.trackIndex + steps) % 52;
}

function maybeCapture(movedToken) {
	// If landed on opponent's token and it's not a safe cell, capture them back to base
	const safe = new Set([0,8,13,21,26,34,39,47]);
	if (safe.has(((movedToken.trackIndex % 52)+52)%52)) return;
	for (const player of game.players) {
		if (player.index === movedToken.playerIndex) continue;
		for (const t of player.tokens) {
			if (!t.inBase && t.homeIndex < 0 && !t.isFinished && t.trackIndex === movedToken.trackIndex) {
				t.inBase = true; t.trackIndex = -1; t.homeIndex = -1;
			}
		}
	}
}

function distanceAround(from, to) {
	const diff = (to - from + 52) % 52;
	return diff;
}

function afterMoveAdvanceTurn() {
	if (checkWin()) {
		game.phase = GamePhases.Finished;
		helpText.innerHTML = `<span class="winner-banner">Player ${game.currentTurn+1} wins!</span>`;
		btnRoll.disabled = true;
		return;
	}
	if (game.lastRoll === 6) {
		// extra turn
		game.phase = GamePhases.Rolling;
		updateIndicators();
		return;
	}
	game.currentTurn = (game.currentTurn + 1) % game.numPlayers;
	if (!isPlayerActive(game.currentTurn)) {
		// skip eliminated or inactive players (when playing 2-3 players)
		advanceToNextActive();
	}
	game.phase = GamePhases.Rolling;
	updateIndicators();
}

function checkWin() {
	const player = game.players[game.currentTurn];
	return player.tokens.every(t => t.isFinished);
}

function isPlayerActive(pIndex) {
	return pIndex < game.numPlayers;
}

function advanceToNextActive() {
	let tries = 0;
	while (!isPlayerActive(game.currentTurn) && tries < 4) {
		game.currentTurn = (game.currentTurn + 1) % 4;
		tries++;
	}
}

// ----- Game lifecycle -----
function startGame(numPlayers) {
	game.numPlayers = numPlayers;
	game.players = [];
	for (let i = 0; i < 4; i++) game.players.push(new PlayerState(i));
	game.currentTurn = 0;
	game.phase = GamePhases.Rolling;
	game.lastRoll = null;
	showScreen("game");
	updateIndicators();
	updateHelpForMoves();
	render();
}

function updateIndicators() {
	currentPlayerIndicator.innerHTML = `Current: <strong style="color:${PLAYER_COLORS[game.currentTurn]}">Player ${game.currentTurn+1}</strong>`;
	btnRoll.disabled = game.phase !== GamePhases.Rolling;
}

function updateHelpForMoves() {
	if (game.phase === GamePhases.Rolling) { helpText.textContent = "Roll the dice."; return; }
	if (game.phase === GamePhases.Moving) {
		const p = game.players[game.currentTurn];
		const any = p.tokens.some(t => legalMovesForToken(t, game.lastRoll));
		helpText.textContent = any ? "Click a token to move." : "No moves. Turn passes.";
		if (!any) { afterMoveAdvanceTurn(); }
	}
}

function render() {
	drawBoard();
	drawTokens();
}

// Initialize app
showScreen("menu");
drawBoard();
render();

