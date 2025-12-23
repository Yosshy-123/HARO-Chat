/* 
Redisを使わないシンプルな構成
サーバを再起動するとメッセージデータが消えるので実務には不向き
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

try {
    require('dotenv').config();
} catch (e) {
    console.warn('dotenv not found, using default values');
}

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));
app.use(express.json());

const ADMIN_PASS = process.env.ADMIN_PASS || 'adminkey1234';
const SECRET_KEY = process.env.SECRET_KEY || 'supersecretkey1234';
const PORT = process.env.PORT || 3000;

const messagesByRoom = {};
const lastMessageTime = new Map();
const lastClearTime = new Map();
const tokens = new Map();
let currentTokenMonth = null;

function formatTime(date) {
    // UTCベースで9時間足してJSTに変換
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

    const yyyy = jst.getUTCFullYear();
    const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(jst.getUTCDate()).padStart(2, '0');
    const hh = String(jst.getUTCHours()).padStart(2, '0');
    const min = String(jst.getUTCMinutes()).padStart(2, '0');

    return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

/* サーバーが必ずJSTタイムゾーンで動作している場合のみ使用
function formatTime(date) {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const hh = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}
*/

function resetTokensIfMonthChanged() {
    const now = new Date();
    const month =
        now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    if (currentTokenMonth !== month) {
        console.log('[Token] Month changed, clearing all tokens');
        tokens.clear();
        currentTokenMonth = month;
    }
}

function generateToken(clientId) {
    const timestamp = Date.now();
    const data = `${clientId}.${timestamp}`;

    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(data);
    const signature = hmac.digest('hex');

    return `${clientId}.${timestamp}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [clientId, timestampStr, signature] = parts;
    const timestamp = Number(timestampStr);
    if (!timestamp) return null;

    const data = `${clientId}.${timestamp}`;
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(data);
    const expected = hmac.digest('hex');

    return expected === signature ? clientId : null;
}

app.get('/api/messages/:roomId', (req, res) => {
    const roomId = req.params.roomId;

    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
        return res.status(400).json({ error: 'invalid roomId' });
    }

    const messages = messagesByRoom[roomId] || [];
    res.json(
        messages.map(m => ({
            username: m.username,
            message: m.message,
            time: m.time,
            seed: m.seed
        }))
    );
});

app.post('/api/messages', (req, res) => {
    const { username, message, token, seed, roomId } = req.body;
    if (!roomId)
        return res.status(400).json({ error: 'roomId required' });
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId))
        return res.status(400).json({ error: 'invalid roomId' });
    if (!username || !message || !token || !seed)
        return res.status(400).json({ error: 'Invalid data' });
    if (typeof username !== 'string' || username.length === 0 || username.length > 24)
        return res.status(400).json({ error: 'Username length invalid' });
    if (typeof message !== 'string' || message.length === 0 || message.length > 800)
        return res.status(400).json({ error: 'Message length invalid' });

    const clientId = verifyToken(token);
    if (!clientId || tokens.get(clientId) !== token) return res.status(403).json({ error: 'Invalid token' });

    const now = Date.now();
    const lastTime = lastMessageTime.get(clientId) || 0;
    if (now - lastTime < 1000) return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });
    lastMessageTime.set(clientId, now);

    const storedMsg = { 
        username, 
        message, 
        time: formatTime(new Date()), 
        clientId,
        seed 
    };
    if (!messagesByRoom[roomId]) {
        messagesByRoom[roomId] = [];
    }

    messagesByRoom[roomId].push(storedMsg);
    messagesByRoom[roomId] = messagesByRoom[roomId].slice(-100);

    const publicMsg = {
        username: storedMsg.username,
        message: storedMsg.message,
        time: storedMsg.time,
        seed: storedMsg.seed
    };

    io.to(roomId).emit('newMessage', publicMsg);
    res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
	const { password, roomId } = req.body;
    const ip = req.ip;
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });
    if (!roomId)
        return res.status(400).json({ error: 'roomId required' });
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId))
        return res.status(400).json({ error: 'invalid roomId' });
    const now = Date.now();
    const key = `${ip}:${roomId}`;
    const lastTime = lastClearTime.get(key) || 0;
    if (now - lastTime < 30000) return res.status(429).json({ error: '削除には30秒以上間隔をあけてください' });
    lastClearTime.set(key, now);

    delete messagesByRoom[roomId];
    io.to(roomId).emit('clearMessages');
    res.json({ message: '全メッセージ削除しました' });
});

io.on('connection', socket => {
    resetTokensIfMonthChanged();

    const clientId = crypto.randomUUID();
    const token = generateToken(clientId);
    tokens.set(clientId, token);

    socket.emit('assignToken', token);

    socket.on('authenticate', ({ token }) => {
        const verifiedId = verifyToken(token);
        if (!verifiedId || tokens.get(verifiedId) !== token) {
            socket.emit('authFailed', { error: 'Invalid or expired token' });
            return;
        }

        socket.data = socket.data || {};
        socket.data.clientId = verifiedId;
		socket.data.authenticated = true;
        socket.emit('authenticated');
    });

    socket.on('joinRoom', ({ roomId }) => {
		socket.data = socket.data || {};
        if (!socket.data.clientId || !socket.data.authenticated) {
            socket.emit('authRequired');
            return;
        }

        if (!roomId) return;
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) return;

        if (socket.data.roomId) {
            socket.leave(socket.data.roomId);
        }

        socket.join(roomId);
        socket.data.roomId = roomId;

        const roomSize =
            io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('roomUserCount', roomSize);

        socket.emit('joinedRoom', { roomId });
    });

    socket.on('disconnecting', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            const roomSize =
                (io.sockets.adapter.rooms.get(roomId)?.size || 1) - 1;
            io.to(roomId).emit('roomUserCount', roomSize);
        }
    });
});

resetTokensIfMonthChanged();

app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);
