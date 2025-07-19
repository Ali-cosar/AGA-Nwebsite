const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

// Oda veritabanı simülasyonu
const rooms = new Map();
const userRoomCount = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function profanityFilter(str) {
  const banned = ["badword", "kufur"];
  return banned.every(word => !str.toLowerCase().includes(word));
}

function canCreateRoom(userId) {
    const now = Date.now();
    if (!userRoomCreationLog.has(userId)) userRoomCreationLog.set(userId, []);
    let timestamps = userRoomCreationLog.get(userId).filter(ts => now - ts < 60 * 60 * 1000);
    if (timestamps.length >= ROOM_CREATION_LIMIT) return false;
    timestamps.push(now);
    userRoomCreationLog.set(userId, timestamps);
    return true;
}

function createRoom(roomData, userId) {
    // Spam limiti kontrolü
    if (!canCreateRoom(userId)) {
        throw new Error('Saatte en fazla 5 oda oluşturabilirsiniz!');
    }
    // Oda adı ve açıklama doğrulama + küfür filtresi
    if (!roomData.name || roomData.name.trim().length < 3 || roomData.name.trim().length > 30)
        throw new Error('Oda adı 3-30 karakter arasında olmalı');
    filterProfanityStrict(roomData.name);
    let description = roomData.description?.trim() || '';
    if (description.length > 100) description = description.substring(0, 100);
    if (description) filterProfanityStrict(description);
    // Kategori kontrolü
    let category = roomData.category?.toLowerCase() || 'genel';
    if (!ROOM_CATEGORIES.includes(category)) category = 'diğer';
    // Maksimum kullanıcı
    let maxUsers = parseInt(roomData.maxUsers) || 10;
    maxUsers = Math.max(2, Math.min(maxUsers, 50));
    // Oda süresi
    let durationKey = roomData.duration || 'süresiz';
    let duration = ROOM_DURATIONS[durationKey] ?? null;
    // Şifre
    let passwordHash = null;
    if (roomData.password && roomData.password.length > 0) {
        if (roomData.password.length < 3 || roomData.password.length > 30) throw new Error('Şifre 3-30 karakter olmalı');
        passwordHash = hashPassword(roomData.password);
    }
    // Oda kodu benzersizliği
    let roomId;
    do {
        roomId = (roomData.code || uuidv4().substring(0, 6)).toUpperCase();
    } while (rooms.has(roomId));
    // Oda nesnesi
    const now = new Date();
    const room = {
        id: roomId,
        name: roomData.name.trim(),
        description,
        category,
        maxUsers,
        passwordHash,
        duration,
        createdAt: now,
        lastActivity: now,
        admin: userId,
        users: new Map(),
        messages: [],
        waitingList: [],
        settings: {
            isModerated: roomData.isModerated !== false,
            isPrivate: !!roomData.isPrivate
        },
        status: 'açık', // açık/dolu/şifreli
        isActive: true
    };
    rooms.set(roomId, room);
    return room;
}
    // Oda adı doğrulaması
    if (!roomData.name || roomData.name.trim().length < 3 || roomData.name.trim().length > 30) {
        throw new Error('Oda adı 3-30 karakter arasında olmalıdır');
    }

    // Oda kodu oluştur veya kontrol et
    let roomId;
    if (roomData.code) {
        roomId = roomData.code.toUpperCase();
        if (rooms.has(roomId)) {
            throw new Error('Bu oda kodu zaten kullanılıyor');
        }
    } else {
        // Benzersiz oda kodu oluştur
        do {
            roomId = uuidv4().substring(0, 6).toUpperCase();
        } while (rooms.has(roomId));
    }

    // Oda verilerini temizle ve doğrula
    const cleanName = roomData.name.trim();
    const maxUsers = Math.min(Math.max(parseInt(roomData.settings?.maxUsers) || 25, 2), 100);
    const description = roomData.settings?.description?.trim() || '';

    const room = {
        id: roomId,
        name: cleanName,
        type: roomData.type || 'private',
        admin: roomData.admin || null,
        users: new Map(),
        messages: [],
        settings: {
            maxUsers: maxUsers,
            isModerated: roomData.settings?.isModerated !== false,
            isPrivate: roomData.settings?.isPrivate || false,
            description: description.length > 200 ? description.substring(0, 200) : description
        },
        createdAt: new Date(),
        lastActivity: new Date()
    };

    rooms.set(roomId, room);
    console.log(`Yeni oda oluşturuldu: ${room.name} (${room.id}) - Admin: ${room.admin}`);
    return room;


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
        try {
            // Kullanıcı adı doğrulama ve spam limiti
            if (!data.username || data.username.trim().length < 3 || data.username.trim().length > 20) {
                socket.emit('room-error', { message: 'Kullanıcı adı 3-20 karakter arasında olmalı' });
                return;
            }
            filterProfanityStrict(data.username);
            // Oda oluştur (tüm parametrelerle)
            const room = createRoom({
                name: data.name,
                description: data.description,
                category: data.category,
                maxUsers: data.maxUsers,
                password: data.password,
                duration: data.duration,
                isModerated: data.isModerated,
                isPrivate: data.isPrivate
            }, socket.id);
            // Oda sahibini odaya ekle
            const user = {
                id: socket.id,
                username: data.username.trim(),
                joinedAt: new Date(),
                isAdmin: true,
                warnings: 0,
                isMuted: false
            };
            users.set(socket.id, { ...user, roomId: room.id });
            room.users.set(socket.id, user);
            socket.join(room.id);
            // Yanıtı gönder
            socket.emit('room-created', {
                success: true,
                roomId: room.id,
                roomName: room.name,
                roomCode: room.id,
                settings: room.settings,
                createdAt: room.createdAt,
                category: room.category,
                maxUsers: room.maxUsers,
                description: room.description,
                duration: room.duration,
                isPrivate: room.settings.isPrivate,
                isModerated: room.settings.isModerated
            });
            console.log(`✅ Oda oluşturuldu: ${room.name} (${room.id}) - Admin: ${user.username}`);
        } catch (error) {
            console.error('❌ Oda oluşturma hatası:', error.message);
            socket.emit('room-error', { message: error.message || 'Oda oluşturulamadı' });
        }
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

    // Oda listesi getirme (gelişmiş)
    socket.on('get-rooms', () => {
        const now = Date.now();
        const roomList = Array.from(rooms.values()).map(room => ({
            id: room.id,
            name: room.name,
            category: room.category,
            userCount: room.users.size,
            maxUsers: room.maxUsers,
            status: room.status,
            isPrivate: room.settings.isPrivate,
            isModerated: room.settings.isModerated,
            description: room.description,
            lastActivity: room.lastActivity,
            passwordProtected: !!room.passwordHash,
            createdAt: room.createdAt,
            duration: room.duration
        }));
        socket.emit('room-list', roomList);
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

// Boş odaları temizleme
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const isEmpty = room.users.length === 0;
    const expired = (room.duration !== "unlimited") &&
      ((room.duration === "1h" && now - room.createdAt > 3600000) ||
       (room.duration === "6h" && now - room.createdAt > 21600000) ||
       (room.duration === "1d" && now - room.createdAt > 86400000));

    if (isEmpty && expired) {
      rooms.delete(code);
      console.log("Silinen oda:", code);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
