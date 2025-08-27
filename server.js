const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let gameRooms = {}; // Stores the state of all game rooms

// Game Data (same as your original file)
const HINDI_WORDS = ['मैं अच्छी हूँ', 'मैं अच्छा हूँ', 'आप कैसे हैं?', 'नमस्ते', 'फिर मिलेंगे', 'सब ठीक है', 'मिलकर खुशी हुई', 'गले लगाना', 'हाथ मिलाना', 'राम राम', 'जय श्री कृष्णा'];
const ROMAN_HINDI_WORDS = ['Main achhee hoon', 'Main Achhaa hoon', 'Aap Kaise Hain?', 'Namaste', 'Phir Milenge', 'Sab Theek Hai', 'Milkar Khushee Hui', 'Gale Lagaanaa', 'Haath Milaanaa', 'Raam Raam', 'Jay Shree Krishnaa'];
const ENGLISH_WORDS = ['I am good (Female)', 'I am good (Male)', 'How are you?', 'Hello', 'See you again', 'Everything is fine', 'Nice to meet you', 'Hugging', 'Shake Hands', 'Victory of Ram', 'Victory of Krishna'];

const GAME_DURATION = 180; // seconds
const WORD_DURATION = 15; // seconds

io.on('connection', (socket) => {
    console.log(`New player connected: ${socket.id}`);

    socket.on('joinGame', (playerName) => {
        let roomName = findAvailableRoom();
        if (!roomName) {
            roomName = `room-${Math.random().toString(36).substr(2, 5)}`;
            createNewRoom(roomName);
        }

        socket.join(roomName);
        const player = {
            id: socket.id,
            name: playerName || 'Anonymous',
            score: 0
        };
        gameRooms[roomName].players.push(player);

        console.log(`Player ${player.name} (${player.id}) joined room ${roomName}`);

        // Notify all players in the room about the new player
        io.to(roomName).emit('updatePlayers', gameRooms[roomName].players);
        
        // Send the current game state to the new player
        socket.emit('gameJoined', {
            roomName: roomName,
            gameState: gameRooms[roomName]
        });

        // Start the game if enough players have joined (e.g., 2 players)
        if (gameRooms[roomName].players.length >= 1 && !gameRooms[roomName].gameStarted) {
             startGame(roomName);
        }
    });
    
    socket.on('markCell', (data) => {
        const { roomName, wordIndex, drawnWord } = data;
        const room = gameRooms[roomName];
        if (!room || !room.gameStarted) return;

        const englishIndex = ENGLISH_WORDS.indexOf(drawnWord);

        if (wordIndex === englishIndex) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                // Award points
                player.score += 10;
                // Add bonus for speed
                const remainingTime = data.wordTimeLeft;
                if (remainingTime >= 7) player.score += 5;
                else if (remainingTime >= 5) player.score += 3;

                // Mark the word as 'claimed' so others can't get points for it
                room.drawnWords[room.drawnWords.length - 1].claimedBy = player.id;

                io.to(roomName).emit('cellMarkedCorrectly', {
                    playerId: socket.id,
                    score: player.score,
                    englishWord: drawnWord
                });
                
                // Move to the next word immediately
                clearTimeout(room.wordTimer);
                drawNextWord(roomName);
            }
        } else {
             // Handle incorrect answer (e.g., deduct points)
             const player = room.players.find(p => p.id === socket.id);
             if (player) {
                player.score = Math.max(0, player.score - 5); // Don't go below 0
                io.to(roomName).emit('updatePlayers', room.players); // Update score for everyone
             }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        // Find which room the player was in and remove them
        for (const roomName in gameRooms) {
            const room = gameRooms[roomName];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                io.to(roomName).emit('updatePlayers', room.players);
                
                // If room is empty, delete it
                if (room.players.length === 0) {
                    console.log(`Deleting empty room: ${roomName}`);
                    clearTimeout(room.gameTimer);
                    clearTimeout(room.wordTimer);
                    delete gameRooms[roomName];
                }
                break;
            }
        }
    });
});

function findAvailableRoom() {
    for (const roomName in gameRooms) {
        // Example logic: join a room if it's not full and the game hasn't started
        if (gameRooms[roomName].players.length < 4 && !gameRooms[roomName].gameStarted) {
            return roomName;
        }
    }
    return null;
}

function createNewRoom(roomName) {
    // Generate a shuffled bingo card that all players in this room will share
    let words = Array.from({ length: HINDI_WORDS.length }, (_, i) => i);
    let bingoCard = [];
    for (let i = 0; i < HINDI_WORDS.length; i++) {
        const randomIndex = Math.floor(Math.random() * words.length);
        const wordIndex = words.splice(randomIndex, 1)[0];
        bingoCard.push(wordIndex);
    }

    gameRooms[roomName] = {
        players: [],
        bingoCard: bingoCard,
        wordPool: [...ENGLISH_WORDS].sort(() => 0.5 - Math.random()), // Shuffle words to draw
        drawnWords: [],
        gameStarted: false,
        gameTimer: null,
        wordTimer: null,
        timeLeft: GAME_DURATION
    };
    console.log(`Created new room: ${roomName}`);
}

function startGame(roomName) {
    const room = gameRooms[roomName];
    room.gameStarted = true;
    io.to(roomName).emit('gameStart', {
        bingoCard: room.bingoCard,
        players: room.players,
        gameDuration: GAME_DURATION
    });
    
    // Start the main game timer
    room.gameTimer = setInterval(() => {
        room.timeLeft--;
        io.to(roomName).emit('updateTimer', room.timeLeft);
        if (room.timeLeft <= 0) {
            endGame(roomName, "Time's up!");
        }
    }, 1000);
    
    // Draw the first word
    drawNextWord(roomName);
}

function drawNextWord(roomName) {
    const room = gameRooms[roomName];
    if (!room || room.wordPool.length === 0) {
        endGame(roomName, "All words have been drawn!");
        return;
    }

    const nextWord = room.wordPool.pop();
    room.drawnWords.push({ word: nextWord, claimedBy: null });

    io.to(roomName).emit('newWordDrawn', {
        word: nextWord,
        duration: WORD_DURATION
    });
    
    // Set a timer for the next word if this one isn't answered
    room.wordTimer = setTimeout(() => {
        drawNextWord(roomName);
    }, WORD_DURATION * 1000);
}

function endGame(roomName, reason) {
    const room = gameRooms[roomName];
    if (!room || !room.gameStarted) return;
    
    console.log(`Game ended in room ${roomName}. Reason: ${reason}`);

    // Stop all timers
    clearInterval(room.gameTimer);
    clearTimeout(room.wordTimer);

    // Sort players by score to determine winner
    room.players.sort((a, b) => b.score - a.score);
    
    io.to(roomName).emit('gameOver', {
        reason: reason,
        leaderboard: room.players
    });

    // Reset the room for a new game or delete it
    delete gameRooms[roomName];
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
