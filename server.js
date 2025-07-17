const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Static dosyaları serve et
app.use(express.static(path.join(__dirname, 'public')));

// Veri yapıları
let rooms = new Map(); // roomId -> room data
let users = new Map(); // socketId -> user data

// Küfür filtreleme listesi
const profanityList = [
    'amk', 'mk', 'aq', 'oç', 'pic', 'it', 'salak', 'aptal', 'gerizekalı',
    'mal', 'dangalak', 'ahmak', 'budala', 'geri', 'zeka', 'beyinsiz'
];

// Küfür filtreleme fonksiyonu
function filterProfanity(message) {
    let filteredMessage = message;
    profanityList.forEach(word => {
        const regex = new RegExp(word, 'gi');
        filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
    });
    return filteredMessage;
}

// Rastgele kullanıcı adı oluşturma
function generateRandomUsername() {
    const adjectives = ['Gizli', 'Anonim', 'Bilinmez', 'Sır', 'Sessiz', 'Saklı'];
    const nouns = ['Kullanıcı', 'Kişi', 'Sohbet', 'Mesaj', 'Kimlik', 'Profil'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9999) + 1;
    return `${adj}${noun}${num}`;
}

// Oda oluşturma
function createRoom(roomData) {
    const roomId = roomData.code || uuidv4().substring(0, 6).toUpperCase();
    const room = {
        id: roomId,
        name: roomData.name || 'Genel Sohbet',
        type: roomData.type || 'general',
        admin: roomData.admin || null,
        users: new Map(),
        messages: [],
        settings: {
            maxUsers: roomData.maxUsers || 50,
            isModerated: roomData.isModerated !== false,
            isPrivate: roomData.isPrivate || false
        },
        createdAt: new Date()
    };
    rooms.set(roomId, room);
    return room;
}

// Genel sohbet odasını oluştur
if (!rooms.has('GENERAL')) {
    createRoom({
        code: 'GENERAL',
        name: 'Genel Sohbet',
        type: 'general',
        maxUsers: 100,
        isModerated: true,
        isPrivate: false
    });
}

// Rotalar
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/join', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/create', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'create.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

io.on('connection', (socket) => {
    console.log('Yeni kullanıcı bağlandı:', socket.id);

    // Kullanıcı odaya katılma
    socket.on('join-room', (data) => {
        const { username, roomCode, roomType } = data;
        let room;

        if (roomType === 'general') {
            room = rooms.get('GENERAL');
        } else {
            room = rooms.get(roomCode);
        }

        if (!room) {
            socket.emit('room-error', { message: 'Oda bulunamadı!' });
            return;
        }

        if (room.users.size >= room.settings.maxUsers) {
            socket.emit('room-error', { message: 'Oda dolu!' });
            return;
        }

        // Kullanıcı bilgilerini kaydet
        const user = {
            id: socket.id,
            username: username || generateRandomUsername(),
            joinedAt: new Date(),
            isAdmin: room.admin === socket.id,
            warnings: 0,
            isMuted: false
        };

        users.set(socket.id, { ...user, roomId: room.id });
        room.users.set(socket.id, user);
        socket.join(room.id);

        // Kullanıcıya oda bilgilerini gönder
        socket.emit('room-joined', {
            roomId: room.id,
            roomName: room.name,
            username: user.username,
            isAdmin: user.isAdmin,
            users: Array.from(room.users.values()),
            messages: room.messages.slice(-50) // Son 50 mesaj
        });

        // Diğer kullanıcılara yeni katılım bilgisini gönder
        socket.to(room.id).emit('user-joined', {
            username: user.username,
            userCount: room.users.size
        });

        console.log(`${user.username} ${room.name} odasına katıldı`);
    });

    // Oda oluşturma
    socket.on('create-room', (data) => {
        const room = createRoom({
            ...data,
            admin: socket.id
        });

        socket.emit('room-created', {
            roomId: room.id,
            roomName: room.name,
            roomCode: room.id
        });

        console.log(`Yeni oda oluşturuldu: ${room.name} (${room.id})`);
    });

    // Mesaj gönderme
    socket.on('send-message', (data) => {
        const user = users.get(socket.id);
        if (!user || user.isMuted) {
            socket.emit('message-error', { message: 'Mesaj gönderemezsiniz!' });
            return;
        }

        const room = rooms.get(user.roomId);
        if (!room) return;

        let message = data.message.trim();
        if (!message) return;

        // Küfür filtreleme
        if (room.settings.isModerated) {
            const originalMessage = message;
            message = filterProfanity(message);

            // Küfür tespit edilirse uyarı ver
            if (originalMessage !== message) {
                user.warnings++;
                socket.emit('warning', {
                    message: 'Küfür tespit edildi! Uyarı sayınız: ' + user.warnings,
                    warnings: user.warnings
                });

                // 3 uyarıda geçici susturma
                if (user.warnings >= 3) {
                    user.isMuted = true;
                    socket.emit('muted', { duration: 300000 });
                    setTimeout(() => {
                        if (users.has(socket.id)) {
                            users.get(socket.id).isMuted = false;
                            socket.emit('unmuted');
                        }
                    }, 300000);
                }
            }
        }

        const messageData = {
            id: uuidv4(),
            username: user.username,
            message: message,
            timestamp: new Date(),
            userId: socket.id
        };

        room.messages.push(messageData);

        // Mesaj geçmişini sınırla
        if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
        }

        // Tüm oda kullanıcılarına mesajı gönder
        io.to(room.id).emit('new-message', messageData);

        console.log(`Mesaj - ${user.username}: ${message}`);
    });

    // Yazıyor durumu
    socket.on('typing', () => {
        const user = users.get(socket.id);
        if (user) {
            socket.to(user.roomId).emit('user-typing', { username: user.username });
        }
    });

    // Yazmayı bırakma
    socket.on('stop-typing', () => {
        const user = users.get(socket.id);
        if (user) {
            socket.to(user.roomId).emit('user-stop-typing', { username: user.username });
        }
    });

    // Admin: Kullanıcı atma
    socket.on('kick-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin) return;

        const room = rooms.get(admin.roomId);
        if (!room || room.admin !== socket.id) {
            socket.emit('admin-error', { message: 'Yetkiniz yok!' });
            return;
        }

        const targetUser = Array.from(room.users.values()).find(u => u.username === data.username);
        if (!targetUser) return;

        // Kullanıcıyı odadan çıkar
        const targetSocket = io.sockets.sockets.get(targetUser.id);
        if (targetSocket) {
            targetSocket.leave(room.id);
            targetSocket.emit('kicked', { reason: data.reason || 'Yönetici tarafından atıldınız' });
        }

        room.users.delete(targetUser.id);
        users.delete(targetUser.id);

        // Diğer kullanıcılara bildir
        socket.to(room.id).emit('user-kicked', {
            username: targetUser.username,
            reason: data.reason,
            userCount: room.users.size
        });

        console.log(`${targetUser.username} ${admin.username} tarafından atıldı`);
    });

    // Admin: Mesaj silme
    socket.on('delete-message', (data) => {
        const admin = users.get(socket.id);
        if (!admin) return;

        const room = rooms.get(admin.roomId);
        if (!room || room.admin !== socket.id) {
            socket.emit('admin-error', { message: 'Yetkiniz yok!' });
            return;
        }

        const messageIndex = room.messages.findIndex(m => m.id === data.messageId);
        if (messageIndex !== -1) {
            room.messages.splice(messageIndex, 1);
            io.to(room.id).emit('message-deleted', { messageId: data.messageId });
            console.log(`Mesaj silindi: ${data.messageId}`);
        }
    });

    // Odadan ayrılma
    socket.on('leave-room', () => {
        leaveRoom(socket);
    });

    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı:', socket.id);
        leaveRoom(socket);
    });

    // Oda ayrılma fonksiyonu
    function leaveRoom(socket) {
        const user = users.get(socket.id);
        if (!user) return;

        const room = rooms.get(user.roomId);
        if (room) {
            room.users.delete(socket.id);
            socket.to(room.id).emit('user-left', {
                username: user.username,
                userCount: room.users.size
            });

            // Eğer admin ayrılırsa ve oda boş değilse, yeni admin ata
            if (room.admin === socket.id && room.users.size > 0) {
                const newAdmin = Array.from(room.users.values())[0];
                room.admin = newAdmin.id;
                newAdmin.isAdmin = true;
                io.to(newAdmin.id).emit('promoted-to-admin');
                socket.to(room.id).emit('new-admin', { username: newAdmin.username });
            }

            // Oda boşsa ve genel oda değilse sil
            if (room.users.size === 0 && room.id !== 'GENERAL') {
                rooms.delete(room.id);
                console.log(`Oda silindi: ${room.name}`);
            }
        }

        users.delete(socket.id);
    }

    // Oda listesi getirme
    socket.on('get-rooms', () => {
        const roomList = Array.from(rooms.values()).map(room => ({
            id: room.id,
            name: room.name,
            userCount: room.users.size,
            maxUsers: room.settings.maxUsers,
            isPrivate: room.settings.isPrivate
        }));
        socket.emit('rooms-list', roomList);
    });

    socket.on('find-partner', () => {
        const user = users.get(socket.id);
        if (!user) return;

        const roomId = uuidv4();
        const partner = waitingUsers.find(u => u.id !== socket.id);
        if (partner) {
            waitingUsers = waitingUsers.filter(u => u.id !== partner.id);
            activeRooms.set(socket.id, { roomId, partnerId: partner.id });
            activeRooms.set(partner.id, { roomId, partnerId: socket.id });
            socket.emit('chat-found', { roomId });
            partner.emit('chat-found', { roomId });
        } else {
            waitingUsers.push(socket);
            socket.emit('waiting-for-partner');
        }
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı:', socket.id);

        // Bekleme listesinden çıkar
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        // Aktif odadan çıkar ve partnere bildir
        const userRoom = activeRooms.get(socket.id);
        if (userRoom) {
            socket.to(userRoom.roomId).emit('partner-left');
            activeRooms.delete(userRoom.partnerId);
            activeRooms.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 PULSTAR Multi-Room Chat Server ${PORT} portunda çalışıyor`);
    console.log(`📱 Ana sayfa: http://localhost:${PORT}`);
    console.log(`💬 Genel sohbet odası hazır`);
});
