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

function validateRoomParams(params) {
  const { name, maxUsers, category, duration } = params;
  return (
    typeof name === "string" && name.length >= 3 && name.length <= 30 &&
    typeof maxUsers === "number" && maxUsers >= 2 && maxUsers <= 50 &&
    ["genel", "oyun", "muzik", "egitim"].includes(category) &&
    ["1h", "6h", "1d", "unlimited"].includes(duration) &&
    profanityFilter(name) &&
    (!params.description || (params.description.length <= 100 && profanityFilter(params.description)))
  );
}

app.post("/create-room", (req, res) => {
  const ip = req.ip;
  const current = userRoomCount.get(ip) || 0;
  if (current >= 5) return res.status(429).json({ error: "Oda oluşturma sınırına ulaştınız." });

  const params = req.body;
  if (!validateRoomParams(params)) return res.status(400).json({ error: "Geçersiz oda bilgileri." });

  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));

  const room = {
    id: uuidv4(),
    code,
    name: params.name,
    description: params.description || "",
    maxUsers: params.maxUsers,
    password: params.password || null,
    category: params.category,
    duration: params.duration,
    owner: params.owner,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    users: [],
    messages: []
  };

  rooms.set(code, room);
  userRoomCount.set(ip, current + 1);

  res.json({ success: true, code });
});

io.on("connection", socket => {
  console.log("Yeni bağlantı:", socket.id);

  socket.on("join-room", ({ code, username, password }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit("error", "Oda bulunamadı.");
    if (room.password && room.password !== password) return socket.emit("error", "Şifre yanlış.");
    if (room.users.length >= room.maxUsers) return socket.emit("error", "Oda dolu.");

    socket.join(code);
    room.users.push({ id: socket.id, name: username });
    room.lastActivity = Date.now();

    io.to(code).emit("room-update", room);
    socket.emit("join-success", room);
  });

  socket.on("send-message", ({ code, message }) => {
    const room = rooms.get(code);
    if (!room) return;
    const user = room.users.find(u => u.id === socket.id);
    if (!user) return;
    const newMessage = { sender: user.name, text: message, timestamp: Date.now() };
    room.messages.push(newMessage);
    room.lastActivity = Date.now();
    io.to(code).emit("new-message", newMessage);
  });

  socket.on("disconnecting", () => {
    for (const code of socket.rooms) {
      const room = rooms.get(code);
      if (room) {
        room.users = room.users.filter(u => u.id !== socket.id);
        room.lastActivity = Date.now();
        io.to(code).emit("room-update", room);
      }
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
