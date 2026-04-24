// server.js
// Anonymous Chat System with Node.js + Socket.io
// Features: In-memory message storage, anonymous callsigns, typing indicators, live user list

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// ------------------------------
// Express & HTTP Server Setup
// ------------------------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",  // Allow all origins (for easy deployment)
        methods: ["GET", "POST"]
    }
});

// Server port - Render/Vercel will use process.env.PORT
const PORT = process.env.PORT || 3000;

// Serve static files (our index.html)
app.use(express.static(__dirname));

// Simple root route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ------------------------------
// In-Memory Data Structures
// ------------------------------
// Store all messages (limit to last 100 to prevent memory bloat)
let chatMessages = [];
const MAX_MESSAGES = 100;

// Store connected users: socket.id -> { callsign: string }
const connectedUsers = new Map();

// Generate unique, cool callsigns (avoid duplicates if possible)
const prefixes = ["Neon", "Cyber", "Void", "Rogue", "Phantom", "Echo", "Shadow", "Nova", "Cipher", "Glitch", "Synth", "Rift", "Static", "Hex", "Flux", "Quantum"];
const suffixes = ["Wraith", "Ghost", "Spectre", "Reaper", "Havoc", "Knight", "Raven", "Stalker", "Phantom", "Drift", "Vector", "Flux", "Mirage", "Pulse", "Vortex"];

function generateUniqueCallsign() {
    let callsign;
    let isUnique = false;
    let attempts = 0;
    const existingCallsigns = Array.from(connectedUsers.values()).map(u => u.callsign);
    
    while (!isUnique && attempts < 20) {
        const pre = prefixes[Math.floor(Math.random() * prefixes.length)];
        const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
        const num = Math.floor(Math.random() * 100);
        callsign = `${pre}_${suf}${num}`;
        if (!existingCallsigns.includes(callsign)) {
            isUnique = true;
        }
        attempts++;
    }
    // If all else fails, add timestamp
    if (!isUnique) {
        callsign = `Ghost_${Date.now().toString(36)}`;
    }
    return callsign;
}

// ------------------------------
// Socket.io Connection Handling
// ------------------------------
io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Assign a random callsign to new user
    const userCallsign = generateUniqueCallsign();
    connectedUsers.set(socket.id, { callsign: userCallsign, id: socket.id });
    
    // Send identity confirmation to the client
    socket.emit('identity', { callsign: userCallsign });
    
    // Send chat history (last 50 messages for performance)
    const historyToSend = chatMessages.slice(-50);
    socket.emit('chat history', historyToSend);
    
    // Broadcast updated user list to all clients
    broadcastUserList();
    
    // Notify others that a new user joined (system message)
    const systemJoinMessage = {
        callsign: "🕶️ SYSTEM",
        text: `${userCallsign} has entered the Nexus.`,
        timestamp: new Date().toISOString()
    };
    chatMessages.push(systemJoinMessage);
    if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
    io.emit('new message', systemJoinMessage);
    
    // --------------------------
    // Handle incoming chat messages
    // --------------------------
    socket.on('chat message', (data) => {
        // Validate message
        if (!data.text || data.text.trim() === "") return;
        if (data.text.length > 500) return; // Sanity limit
        
        const user = connectedUsers.get(socket.id);
        if (!user) return;
        
        const messageObj = {
            callsign: user.callsign,
            text: data.text.trim(),
            timestamp: new Date().toISOString()
        };
        
        // Store in memory
        chatMessages.push(messageObj);
        if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
        
        // Broadcast to ALL connected clients
        io.emit('new message', messageObj);
    });
    
    // --------------------------
    // Handle typing indicators
    // --------------------------
    socket.on('typing', (data) => {
        // Broadcast to everyone except the sender
        socket.broadcast.emit('user typing', { callsign: data.callsign });
    });
    
    // --------------------------
    // Handle callsign update (if client requests a new one)
    // --------------------------
    socket.on('set-callsign', (requestedCallsign) => {
        // Sanitize: only allow alphanumeric and underscore, max 25 chars
        let clean = requestedCallsign.replace(/[^a-zA-Z0-9_]/g, '');
        if (clean.length > 25) clean = clean.substring(0, 25);
        if (clean.length < 3) clean = generateUniqueCallsign();
        
        // Check for uniqueness
        const existingCallsigns = Array.from(connectedUsers.values()).map(u => u.callsign);
        let finalCallsign = clean;
        if (existingCallsigns.includes(finalCallsign) && finalCallsign !== connectedUsers.get(socket.id)?.callsign) {
            finalCallsign = generateUniqueCallsign();
        }
        
        const oldCallsign = connectedUsers.get(socket.id)?.callsign;
        connectedUsers.set(socket.id, { callsign: finalCallsign, id: socket.id });
        
        // Notify the user of their new identity
        socket.emit('identity', { callsign: finalCallsign });
        
        // Broadcast system message about name change
        if (oldCallsign && oldCallsign !== finalCallsign) {
            const renameMessage = {
                callsign: "🕶️ SYSTEM",
                text: `${oldCallsign} is now known as ${finalCallsign}`,
                timestamp: new Date().toISOString()
            };
            chatMessages.push(renameMessage);
            if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
            io.emit('new message', renameMessage);
        }
        
        // Update user list for everyone
        broadcastUserList();
    });
    
    // --------------------------
    // Handle disconnection
    // --------------------------
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            const leaveMessage = {
                callsign: "🕶️ SYSTEM",
                text: `${user.callsign} has left the Nexus.`,
                timestamp: new Date().toISOString()
            };
            chatMessages.push(leaveMessage);
            if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
            io.emit('new message', leaveMessage);
        }
        connectedUsers.delete(socket.id);
        broadcastUserList();
        console.log(`Disconnected: ${socket.id}`);
    });
    
    // Helper to broadcast current user list to all clients
    function broadcastUserList() {
        const userList = Array.from(connectedUsers.values()).map(user => user.callsign);
        io.emit('update users', userList);
    }
});

// ------------------------------
// Graceful shutdown & cleanup
// ------------------------------
process.on('SIGINT', () => {
    console.log('\nShutting down server gracefully...');
    io.close(() => {
        console.log('Socket.io closed');
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`✨ Anonymous Chat Server running on http://localhost:${PORT}`);
    console.log(`⚡ Socket.io ready | Memory mode (no database)`);
});
