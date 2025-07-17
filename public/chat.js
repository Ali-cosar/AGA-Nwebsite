// Socket.IO bağlantısı
const socket = io();

// DOM elementleri
const waitingScreen = document.getElementById('waitingScreen');
const chatScreen = document.getElementById('chatScreen');
const disconnectedScreen = document.getElementById('disconnectedScreen');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const findNewChatBtn = document.getElementById('findNewChatBtn');
const homeBtn = document.getElementById('homeBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const charCount = document.getElementById('charCount');
const typingIndicator = document.getElementById('typingIndicator');
const roomInfo = document.getElementById('roomInfo');
const userCount = document.getElementById('userCount');
const adminControls = document.getElementById('adminControls');

// Durum değişkenleri
let currentRoom = null;
let currentUser = null;
let isConnected = false;
let messageHistory = [];
let isAdmin = false;
let typingUsers = new Set();
let typingTimeout = null;

// Sayfa yüklendiğinde localStorage'dan bilgileri al
document.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('username');
    const roomType = localStorage.getItem('roomType');
    const roomCode = localStorage.getItem('roomCode');
    const adminStatus = localStorage.getItem('isAdmin');
    
    if (!username || !roomType) {
        // Bilgiler eksikse ana sayfaya yönlendir
        window.location.href = '/';
        return;
    }
    
    currentUser = {
        username: username,
        roomType: roomType,
        roomCode: roomCode,
        isAdmin: adminStatus === 'true'
    };
    
    updateStatus('connecting', 'Odaya bağlanıyor...');
    
    // Odaya katıl
    socket.emit('join-room', {
        username: username,
        roomType: roomType,
        roomCode: roomCode
    });
});

// Socket olayları
socket.on('connect', () => {
    isConnected = true;
    console.log('Sunucuya bağlandı');
});

socket.on('disconnect', () => {
    isConnected = false;
    updateStatus('disconnected', 'Bağlantı kesildi');
    showScreen('disconnected');
});

// Oda katılım başarılı
socket.on('room-joined', (data) => {
    currentRoom = data.roomId;
    currentUser.username = data.username;
    isAdmin = data.isAdmin;
    
    updateStatus('connected', `${data.roomName} - ${data.username}`);
    showScreen('chat');
    
    // Oda bilgilerini güncelle
    updateRoomInfo(data.roomName, data.users.length);
    
    // Admin kontrollerini göster/gizle
    if (isAdmin) {
        showAdminControls();
    }
    
    // Mevcut mesajları göster
    data.messages.forEach(message => {
        displayMessage(message);
    });
    
    // Kullanıcı listesini güncelle
    updateUserList(data.users);
    
    console.log(`${data.roomName} odasına katıldı: ${data.username}`);
});

// Oda hatası
socket.on('room-error', (data) => {
    alert(data.message);
    window.location.href = '/';
});

// Yeni kullanıcı katıldı
socket.on('user-joined', (data) => {
    updateUserCount(data.userCount);
    displaySystemMessage(`${data.username} odaya katıldı`);
});

// Kullanıcı ayrıldı
socket.on('user-left', (data) => {
    updateUserCount(data.userCount);
    displaySystemMessage(`${data.username} odadan ayrıldı`);
});

// Yeni mesaj
socket.on('new-message', (data) => {
    displayMessage(data);
});

// Kullanıcı yazıyor
socket.on('user-typing', (data) => {
    typingUsers.add(data.username);
    updateTypingIndicator();
});

// Kullanıcı yazmayı bıraktı
socket.on('user-stop-typing', (data) => {
    typingUsers.delete(data.username);
    updateTypingIndicator();
});

// Uyarı mesajı
socket.on('warning', (data) => {
    displayWarning(data.message);
});

// Susturulma
socket.on('muted', (data) => {
    messageInput.disabled = true;
    sendBtn.disabled = true;
    displaySystemMessage(`${data.duration / 1000} saniye susturuldunuz!`, 'error');
});

// Susturma kaldırıldı
socket.on('unmuted', () => {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    displaySystemMessage('Susturma kaldırıldı', 'success');
});

// Atılma
socket.on('kicked', (data) => {
    alert(`Odadan atıldınız: ${data.reason}`);
    window.location.href = '/';
});

// Kullanıcı atıldı
socket.on('user-kicked', (data) => {
    updateUserCount(data.userCount);
    displaySystemMessage(`${data.username} odadan atıldı: ${data.reason}`, 'warning');
});

// Mesaj silindi
socket.on('message-deleted', (data) => {
    const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageElement) {
        messageElement.remove();
    }
});

// Admin olarak terfi
socket.on('promoted-to-admin', () => {
    isAdmin = true;
    showAdminControls();
    displaySystemMessage('Admin olarak terfi ettiniz!', 'success');
});

// Yeni admin
socket.on('new-admin', (data) => {
    displaySystemMessage(`${data.username} yeni admin oldu`, 'info');
});

// Ekran gösterme fonksiyonu
function showScreen(screenType) {
    // Tüm ekranları gizle
    waitingScreen.classList.remove('active');
    chatScreen.classList.remove('active');
    disconnectedScreen.classList.remove('active');
    
    // İlgili ekranı göster
    switch(screenType) {
        case 'waiting':
            waitingScreen.classList.add('active');
            break;
        case 'chat':
            chatScreen.classList.add('active');
            break;
        case 'disconnected':
            disconnectedScreen.classList.add('active');
            break;
    }
}

// Durum güncelleme
function updateStatus(status, text) {
    statusText.textContent = text;
    statusIndicator.className = `status-indicator ${status}`;
}

// Chat input'u aktif/pasif yapma
function enableChatInput() {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
}

function disableChatInput() {
    messageInput.disabled = true;
    sendBtn.disabled = true;
}

// Mesaj ekleme
function addMessage(text, sender, timestamp) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = text;
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = timestamp || new Date().toLocaleTimeString('tr-TR');
    
    messageContent.appendChild(messageTime);
    messageDiv.appendChild(messageContent);
    messagesContainer.appendChild(messageDiv);
    
    // Mesaj geçmişine ekle
    messageHistory.push({ text, sender, timestamp });
    
    scrollToBottom();
}

// Mesaj gönderme
function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
        // Kendi mesajımızı ekle
        addMessage(message, 'own');
        
        // Sunucuya gönder
        socket.emit('send-message', { message });
        
        // Input'u temizle
        messageInput.value = '';
        updateCharCount();
        messageInput.focus();
    }
}

// Mesajları temizle
function clearMessages() {
    // Chat başlangıç mesajı hariç tüm mesajları temizle
    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(message => message.remove());
    messageHistory = [];
}

// Scroll to bottom
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Karakter sayısını güncelle
function updateCharCount() {
    const count = messageInput.value.length;
    charCount.textContent = `${count}/500`;
    
    if (count > 450) {
        charCount.style.color = '#ef4444';
    } else if (count > 400) {
        charCount.style.color = '#f59e0b';
    } else {
        charCount.style.color = '#94a3b8';
    }
}

// Typing indicator temizle
function clearTypingIndicator() {
    typingIndicator.textContent = '';
}

// Event listeners
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', updateCharCount);

sendBtn.addEventListener('click', sendMessage);

newChatBtn.addEventListener('click', () => {
    if (currentRoom) {
        socket.emit('find-new-chat');
    }
});

findNewChatBtn.addEventListener('click', () => {
    socket.emit('find-new-chat');
});

homeBtn.addEventListener('click', () => {
    window.location.href = '/';
});

// Typing indicator (gelecekte kullanılabilir)
let typingTimer;
messageInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    
    // Typing indicator göster (partner için)
    // socket.emit('typing-start');
    
    typingTimer = setTimeout(() => {
        // Typing indicator gizle
        // socket.emit('typing-stop');
    }, 1000);
});

// Sayfa kapatılırken bağlantıyı kes
window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});

// Responsive tasarım için mesaj container'ı ayarla
function adjustMessageContainer() {
    const headerHeight = document.querySelector('.chat-header').offsetHeight;
    const inputHeight = document.querySelector('.message-input-container').offsetHeight;
    const availableHeight = window.innerHeight - headerHeight - inputHeight;
    messagesContainer.style.height = `${availableHeight}px`;
}

// Sayfa yüklendiğinde ve pencere boyutu değiştiğinde ayarla
window.addEventListener('load', adjustMessageContainer);
window.addEventListener('resize', adjustMessageContainer);

// Animasyonlar için intersection observer
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const messageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Yeni mesajları gözlemle
const observeNewMessages = () => {
    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(message => {
        if (!message.dataset.observed) {
            messageObserver.observe(message);
            message.dataset.observed = 'true';
        }
    });
};

// Mutation observer ile yeni mesajları yakala
const messageContainerObserver = new MutationObserver(observeNewMessages);
messageContainerObserver.observe(messagesContainer, { childList: true });

// İlk yüklemede mevcut mesajları gözlemle
observeNewMessages();
