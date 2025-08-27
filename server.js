// server.js (SUPER FUN Edition)

// 1. Setup (no changes here)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// 2. Game Data (no changes here)
const wordsData = {
    hindi: ['मैं अच्छी हूँ', 'मैं अच्छा हूँ', 'आप कैसे हैं?', 'नमस्ते', 'फिर मिलेंगे', 'सब ठीक है', 'मिलकर खुशी हुई', 'गले लगाना', 'हाथ मिलाना', 'राम राम', 'जय श्री कृष्णा'],
    roman: ['Main achhee hoon', 'Main Achhaa hoon', 'Aap Kaise Hain?', 'Namaste', 'Phir Milenge', 'Sab Theek Hai', 'Milkar Khushee Hui', 'Gale Lagaanaa', 'Haath Milaanaa', 'Raam Raam', 'Jay Shree Krishnaa'],
    english: ['I am good (Female)', 'I am good (Male)', 'How are you?', 'Hello', 'See you again', 'Everything is fine', 'Nice to meet you', 'Hugging', 'Shake Hands', 'Victory of Ram', 'Victory of Krishna']
};
const rooms = {};

// 3. Main Connection Handler
io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // --- Room Management (no major changes) ---
    // ... (copy the 'createRoom' and 'joinRoom' functions from your previous server.js) ...
    socket.on('createRoom', ({ playerName }) => {
        let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        while (rooms[roomCode]) { roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); }
        rooms[roomCode] = {
            players: {}, gameState: 'lobby', currentWordIndex: -1,
            drawnWords: [], wordTimerInterval: null, gameTimerInterval: null,
            wordDuration: 15, gameDuration: 180,
            // NEW: Track who answered the current word first
            wordAnsweredBy: null
        };
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (!rooms[roomCode]) { return socket.emit('error', 'Room not found.'); }
        if (Object.keys(rooms[roomCode].players).length >= 8) { return socket.emit('error', 'Room is full.'); }
        if (rooms[roomCode].gameState !== 'lobby') { return socket.emit('error', 'Game has already started.'); }
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName);
        socket.emit('joinedRoom', { roomCode, players: rooms[roomCode].players });
        io.to(roomCode).emit('playerUpdate', rooms[roomCode].players);
    });

    // --- Game Logic (significant changes) ---
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.gameState = 'playing';
        Object.values(room.players).forEach(player => {
            player.bingoCard = generateBingoCard();
            const cardWords = player.bingoCard.map(index => wordsData.roman[index]);
            io.to(player.id).emit('gameStart', { words: cardWords });
        });
        let timeLeft = room.gameDuration;
        io.to(roomCode).emit('gameTimerUpdate', timeLeft);
        room.gameTimerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('gameTimerUpdate', timeLeft);
            if (timeLeft <= 0) { endGame(roomCode, 'Time\'s up!'); }
        }, 1000);
        drawNextWord(roomCode);
    });

    socket.on('cellClicked', ({ roomCode, cellIndex }) => {
        const room = rooms[roomCode];
        const player = room?.players[socket.id];
        if (!room || !player || room.gameState !== 'playing' || player.markedCells.has(cellIndex)) { return; }

        const cardWordIndex = player.bingoCard[cellIndex];
        const drawnWordIndex = room.currentWordIndex;
        player.markedCells.add(cellIndex);

        if (cardWordIndex === drawnWordIndex) {
            // --- CORRECT GUESS ---
            let bonusPoints = 10;
            // NEW: Bonus for being the first to answer!
            if (!room.wordAnsweredBy) {
                room.wordAnsweredBy = player.name;
                bonusPoints += 5; // First gets 5 extra points
                io.to(roomCode).emit('firstCorrect', player.name);
            }
            player.score += bonusPoints;
            socket.emit('correctGuess', { cellIndex, newScore: player.score });
            io.to(roomCode).emit('playerUpdate', room.players);
        } else {
            // --- INCORRECT GUESS ---
            player.score = Math.max(0, player.score - 5);
            socket.emit('incorrectGuess', { cellIndex, newScore: player.score });
            io.to(roomCode).emit('playerUpdate', room.players);
        }
    });
    
    // --- NEW: POWER-UP LOGIC ---
    socket.on('usePowerUp', ({ roomCode, powerUpType }) => {
        const room = rooms[roomCode];
        const player = room?.players[socket.id];
        if (!room || !player || !player.powerUps[powerUpType] || player.powerUps[powerUpType] <= 0) {
            return; // Player doesn't have this power-up
        }

        if (powerUpType === 'fiftyFifty') {
            player.powerUps.fiftyFifty--; // Use the power-up

            const correctWordIndex = room.currentWordIndex;
            const playerCard = player.bingoCard;
            
            // Find the index of the correct cell on the player's card
            const correctCellIndex = playerCard.findIndex(wordIdx => wordIdx === correctWordIndex);

            // Find all incorrect cells
            const incorrectCellIndices = [];
            playerCard.forEach((wordIdx, cellIdx) => {
                if (wordIdx !== correctWordIndex && !player.markedCells.has(cellIdx)) {
                    incorrectCellIndices.push(cellIdx);
                }
            });

            // Shuffle and pick some to remove
            incorrectCellIndices.sort(() => 0.5 - Math.random());
            const cellsToRemove = incorrectCellIndices.slice(0, 2); // Remove 2 wrong answers

            // Tell the player's client which cells to disable
            socket.emit('powerUpResult', { type: 'fiftyFifty', cellsToRemove, powerUps: player.powerUps });
        }
    });

    // --- Disconnect Handling (no changes) ---
    // ... (copy the 'disconnect' function from your previous server.js) ...
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        for (const roomCode in rooms) {
            if (rooms[roomCode].players[socket.id]) {
                delete rooms[roomCode].players[socket.id];
                io.to(roomCode).emit('playerUpdate', rooms[roomCode].players);
                if (Object.keys(rooms[roomCode].players).length === 0) {
                    clearInterval(rooms[roomCode].gameTimerInterval);
                    clearInterval(rooms[roomCode].wordTimerInterval);
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

// 4. Helper Functions (updated)
function createNewPlayer(id, name) {
    return {
        id, name, score: 0, bingoCard: [], markedCells: new Set(),
        // NEW: Give each player power-ups at the start
        powerUps: {
            fiftyFifty: 1
        }
    };
}
function generateBingoCard() { /* ... no change ... */ }

function drawNextWord(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.wordTimerInterval) clearInterval(room.wordTimerInterval);
    
    // NEW: Reset the 'first answer' tracker for the new word
    room.wordAnsweredBy = null;

    let newWordIndex;
    if (room.drawnWords.length === wordsData.english.length) {
        return endGame(roomCode, 'All words have been drawn!');
    }
    do { newWordIndex = Math.floor(Math.random() * wordsData.english.length); }
    while (room.drawnWords.includes(newWordIndex));

    room.drawnWords.push(newWordIndex);
    room.currentWordIndex = newWordIndex;
    const newWord = wordsData.english[newWordIndex];
    io.to(roomCode).emit('newWord', { word: newWord, duration: room.wordDuration });
    let wordTimeLeft = room.wordDuration;
    room.wordTimerInterval = setInterval(() => {
        wordTimeLeft--;
        if (wordTimeLeft <= 0) {
            drawNextWord(roomCode);
        }
    }, 1000);
}

// END GAME Function (no changes from last version)
async function endGame(roomCode, message) { /* ... no change ... */ }

// 5. Start Server (no changes)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
