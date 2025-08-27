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
        if (rooms[roomCode].gameState !== 'lobby') { return socket.emit('error', 'Game has already star
