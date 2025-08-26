// server.js

// 1. Setup Express, Socket.IO, and node-fetch
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);

// 2. Configure Socket.IO with CORS
// This is very important to allow your WordPress site to connect to this server.
const io = socketIo(server, {
  cors: {
    origin: "*", // Allows any website to connect. For better security later, change this to your WordPress site's URL.
    methods: ["GET", "POST"]
  }
});

// 3. Game Data
const wordsData = {
    hindi: ['मैं अच्छी हूँ', 'मैं अच्छा हूँ', 'आप कैसे हैं?', 'नमस्ते', 'फिर मिलेंगे', 'सब ठीक है', 'मिलकर खुशी हुई', 'गले लगाना', 'हाथ मिलाना', 'राम राम', 'जय श्री कृष्णा'],
    roman: ['Main achhee hoon', 'Main Achhaa hoon', 'Aap Kaise Hain?', 'Namaste', 'Phir Milenge', 'Sab Theek Hai', 'Milkar Khushee Hui', 'Gale Lagaanaa', 'Haath Milaanaa', 'Raam Raam', 'Jay Shree Krishnaa'],
    english: ['I am good (Female)', 'I am good (Male)', 'How are you?', 'Hello', 'See you again', 'Everything is fine', 'Nice to meet you', 'Hugging', 'Shake Hands', 'Victory of Ram', 'Victory of Krishna']
};

// This object will store all the active game rooms
const rooms = {};

// 4. Handle all client connections
io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // --- Room Management ---
    socket.on('createRoom', ({ playerName }) => {
        let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        while (rooms[roomCode]) { // Ensure room code is unique
            roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        }
        rooms[roomCode] = {
            players: {},
            gameState: 'lobby', // Can be 'lobby', 'playing', or 'finished'
            currentWordIndex: -1,
            drawnWords: [],
            wordTimerInterval: null,
            gameTimerInterval: null,
            wordDuration: 15, // seconds per word
            gameDuration: 180, // seconds for the whole game
        };
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName || 'Player 1');
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (!rooms[roomCode]) {
            return socket.emit('error', 'Room not found.');
        }
        if (Object.keys(rooms[roomCode].players).length >= 8) {
            return socket.emit('error', 'Room is full.');
        }
        if (rooms[roomCode].gameState !== 'lobby') {
            return socket.emit('error', 'Game has already started.');
        }
        socket.join(roomCode);
        const playerNumber = Object.keys(rooms[roomCode].players).length + 1;
        rooms[roomCode].players[socket.id] = createNewPlayer(socket.id, playerName || `Player ${playerNumber}`);
        socket.emit('joinedRoom', { roomCode, players: rooms[roomCode].players });
        io.to(roomCode).emit('playerUpdate', rooms[roomCode].players); // Update everyone in the room
    });

    // --- Game Logic ---
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.gameState = 'playing';
        
        // Give each player a unique bingo card
        Object.values(room.players).forEach(player => {
            player.bingoCard = generateBingoCard();
            const cardWords = player.bingoCard.map(index => wordsData.roman[index]); // Send Roman words
            io.to(player.id).emit('gameStart', { words: cardWords });
        });

        // Start the main game timer
        let timeLeft = room.gameDuration;
        io.to(roomCode).emit('gameTimerUpdate', timeLeft);
        room.gameTimerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('gameTimerUpdate', timeLeft);
            if (timeLeft <= 0) {
                endGame(roomCode, 'Time\'s up!');
            }
        }, 1000);
        drawNextWord(roomCode);
    });

    socket.on('cellClicked', ({ roomCode, cellIndex }) => {
    const room = rooms[roomCode];
    const player = room?.players[socket.id];
    // Make sure the cell hasn't already been correctly guessed by this player
    if (!room || !player || room.gameState !== 'playing' || player.markedCells.has(cellIndex)) {
        return;
    }

    const cardWordIndex = player.bingoCard[cellIndex];
    const drawnWordIndex = room.currentWordIndex;

    if (cardWordIndex === drawnWordIndex) {
        // --- LOGIC FOR CORRECT GUESS ---
        player.score += 10;
        player.markedCells.add(cellIndex);
        socket.emit('correctGuess', { cellIndex, newScore: player.score });
        io.to(roomCode).emit('playerUpdate', room.players);

        // --- NEW: Immediately move to the next word! ---
        clearInterval(room.wordTimerInterval); // Stop the current word's timer
        
        // Draw the next word after a short delay so players can see the result
        setTimeout(() => {
            drawNextWord(roomCode);
        }, 1500); // 1.5 second delay before the next word

    } else {
        // --- LOGIC FOR INCORRECT GUESS ---
        player.score = Math.max(0, player.score - 5);
        socket.emit('incorrectGuess', { cellIndex, newScore: player.score });
        io.to(roomCode).emit('playerUpdate', room.players);
    }
});

    // --- Disconnect Handling ---
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

// 5. Helper Functions
function createNewPlayer(id, name) {
    return { id, name, score: 0, bingoCard: [], markedCells: new Set() };
}

function generateBingoCard() {
    let indices = Array.from({ length: wordsData.english.length }, (_, i) => i);
    let shuffled = indices.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 12); // A 12-cell bingo card
}

function drawNextWord(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.wordTimerInterval) clearInterval(room.wordTimerInterval);
    
    let newWordIndex;
    if (room.drawnWords.length === wordsData.english.length) {
        return endGame(roomCode, 'All words have been drawn!');
    }
    do {
        newWordIndex = Math.floor(Math.random() * wordsData.english.length);
    } while (room.drawnWords.includes(newWordIndex));

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

async function endGame(roomCode, message) {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;
    room.gameState = 'finished';
    clearInterval(room.gameTimerInterval);
    clearInterval(room.wordTimerInterval);
    
    const finalScores = Object.values(room.players)
        .sort((a, b) => b.score - a.score)
        .map(p => ({ name: p.name, score: p.score }));

    // IMPORTANT: Replace this with your actual WordPress site URL
    const wordpressApiUrl = 'https://your-wordpress-site.com/wp-json/bingo/v1/submit-score';
    
    for (const player of Object.values(room.players)) {
        if (player.score > 0) {
            try {
                await fetch(wordpressApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: player.name, score: player.score }),
                });
                console.log(`Sent score for ${player.name} to WordPress.`);
            } catch (error) {
                console.error('Failed to send score to WordPress:', error);
            }
        }
    }

    io.to(roomCode).emit('gameOver', { message, finalScores });
    setTimeout(() => { delete rooms[roomCode]; }, 30000); // Clean up the room after 30 seconds
}

// 6. Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
