// server.js (UPGRADED VERSION)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const wordsData = {
    hindi: ['मैं अच्छी हूँ', 'मैं अच्छा हूँ', 'आप कैसे हैं?', 'नमस्ते', 'फिर मिलेंगे', 'सब ठीक है', 'मिलकर खुशी हुई', 'गले लगाना', 'हाथ मिलाना', 'राम राम', 'जय श्री कृष्णा'],
    roman: ['Main achhee hoon', 'Main Achhaa hoon', 'Aap Kaise Hain?', 'Namaste', 'Phir Milenge', 'Sab Theek Hai', 'Milkar Khushee Hui', 'Gale Lagaanaa', 'Haath Milaanaa', 'Raam Raam', 'Jay Shree Krishnaa'],
    english: ['I am good (Female)', 'I am good (Male)', 'How are you?', 'Hello', 'See you again', 'Everything is fine', 'Nice to meet you', 'Hugging', 'Shake Hands', 'Victory of Ram', 'Victory of Krishna']
};

const rooms = {};

io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // --- Room Management (no changes here) ---
    socket.on('createRoom', ({ playerName }) => {
        let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        while (rooms[roomCode]) { roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); }
        rooms[roomCode] = { players: {}, gameState: 'lobby', currentWordIndex: -1, drawnWords: [], wordTimerInterval: null, gameTimerInterval: null, wordDuration: 15, gameDuration: 180, wordAnswered: false };
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName || 'Player 1');
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (!rooms[roomCode]) { return socket.emit('error', 'Room not found.'); }
        if (Object.keys(rooms[roomCode].players).length >= 8) { return socket.emit('error', 'Room is full.'); }
        if (rooms[roomCode].gameState !== 'lobby') { return socket.emit('error', 'Game has already started.'); }
        socket.join(roomCode);
        const playerNumber = Object.keys(rooms[roomCode].players).length + 1;
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName || `Player ${playerNumber}`);
        socket.emit('joinedRoom', { roomCode, players: rooms[roomCode].players });
        io.to(roomCode).emit('playerUpdate', rooms[roomCode].players);
    });

    // --- Game Logic ---
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.gameState = 'playing';
        Object.values(room.players).forEach(player => {
            player.bingoCard = generateBingoCard();
            const cardWords = player.bingoCard.map(index => ({ word: wordsData.roman[index], originalIndex: index }));
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

    // --- NEW: UPGRADED CELL CLICK LOGIC ---
    socket.on('cellClicked', ({ roomCode, cellIndex }) => {
        const room = rooms[roomCode];
        const player = room?.players[socket.id];
        if (!room || !player || room.gameState !== 'playing' || player.markedCells.has(cellIndex)) { return; }

        const cardWordIndex = player.bingoCard[cellIndex];
        const drawnWordIndex = room.currentWordIndex;

        if (cardWordIndex === drawnWordIndex) {
            player.score += 10;
            player.markedCells.add(cellIndex);
            
            // --- NEW: First Answer Bonus Logic ---
            if (!room.wordAnswered) {
                room.wordAnswered = true; // Mark word as answered
                player.score += 5; // Add bonus points
                io.to(roomCode).emit('firstAnswerBonus', { playerName: player.name });
                // Immediately move to the next word for everyone
                clearInterval(room.wordTimerInterval);
                setTimeout(() => drawNextWord(roomCode), 1500);
            }
            
            socket.emit('correctGuess', { cellIndex, newScore: player.score });
            io.to(roomCode).emit('playerUpdate', room.players);
        } else {
            player.score = Math.max(0, player.score - 5);
            socket.emit('incorrectGuess', { cellIndex, newScore: player.score });
            io.to(roomCode).emit('playerUpdate', room.players);
        }
    });

    // --- Disconnect Handling (no changes) ---
    socket.on('disconnect', () => { /* ... same as before ... */ });
});

function createNewPlayer(id, name) { return { id, name, score: 0, bingoCard: [], markedCells: new Set() }; }
function generateBingoCard() {
    let indices = Array.from({ length: wordsData.english.length }, (_, i) => i);
    let shuffled = indices.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 12);
}

function drawNextWord(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.wordTimerInterval) clearInterval(room.wordTimerInterval);
    
    // --- NEW: Reset the first answer flag for the new word ---
    room.wordAnswered = false;

    let newWordIndex;
    if (room.drawnWords.length === wordsData.english.length) { return endGame(roomCode, 'All words have been drawn!'); }
    do { newWordIndex = Math.floor(Math.random() * wordsData.english.length); } while (room.drawnWords.includes(newWordIndex));
    room.drawnWords.push(newWordIndex);
    room.currentWordIndex = newWordIndex;
    const newWord = wordsData.english[newWordIndex];
    io.to(roomCode).emit('newWord', { word: newWord, duration: room.wordDuration });
    let wordTimeLeft = room.wordDuration;
    room.wordTimerInterval = setInterval(() => {
        wordTimeLeft--;
        if (wordTimeLeft <= 0) { drawNextWord(roomCode); }
    }, 1000);
}

async function endGame(roomCode, message) {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;
    room.gameState = 'finished';
    clearInterval(room.gameTimerInterval);
    clearInterval(room.wordTimerInterval);
    const finalScores = Object.values(room.players).sort((a, b) => b.score - a.score).map(p => ({ name: p.name, score: p.score }));
    
    // --- NEW: Send the final list of drawn words to the clients for the card reveal ---
    io.to(roomCode).emit('gameOver', { message, finalScores, drawnWords: room.drawnWords });
    
    // The score submission part remains the same
    const wordpressApiUrl = 'https://your-wordpress-site.com/wp-json/bingo/v1/submit-score'; // MAKE SURE THIS IS YOUR URL
    for (const player of Object.values(room.players)) {
        if (player.score > 0) {
            try { await fetch(wordpressApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: player.name, score: player.score }) }); } 
            catch (error) { console.error('Failed to send score:', error); }
        }
    }
    setTimeout(() => { delete rooms[roomCode]; }, 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
