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

let messages = [];
const lastMessageTime = new Map();
const lastClearTime = new Map();

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

    const now = Date.now();
    const MAX_AGE = 5 * 60 * 1000;
    if (timestamp > now + 60_000) return null;
    if (now - timestamp > MAX_AGE) return null;

    const data = `${clientId}.${timestamp}`;
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(data);
    const expected = hmac.digest('hex');

    return expected === signature ? clientId : null;
}

app.get('/api/messages', (req, res) => res.json(messages));

app.post('/api/messages', (req, res) => {
    const { username, message, token } = req.body;
    if (!username || !message || !token) return res.status(400).json({ error: 'Invalid data' });
    if (typeof username !== 'string' || username.length === 0 || username.length > 24)
        return res.status(400).json({ error: 'Username length invalid' });
    if (typeof message !== 'string' || message.length === 0 || message.length > 800)
        return res.status(400).json({ error: 'Message length invalid' });

    const clientId = verifyToken(token);
    if (!clientId) return res.status(403).json({ error: 'Invalid token' });

    const now = Date.now();
    const lastTime = lastMessageTime.get(clientId) || 0;
    if (now - lastTime < 1000) return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });
    lastMessageTime.set(clientId, now);

    const msg = { 
        username, 
        message, 
        time: formatTime(new Date()), 
        clientId 
    };
    messages.push(msg);
    if (messages.length > 100) messages.shift();
    io.emit('newMessage', msg);
    res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
    const { password } = req.body;
    const ip = req.ip;
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

    const now = Date.now();
    const lastTime = lastClearTime.get(ip) || 0;
    if (now - lastTime < 30000) return res.status(429).json({ error: '削除には30秒以上間隔をあけてください' });
    lastClearTime.set(ip, now);

    messages = [];
    io.emit('clearMessages');
    res.json({ message: '全メッセージ削除しました' });
});

io.on('connection', socket => {
    const clientId = crypto.randomUUID();
    const token = generateToken(clientId);
    socket.emit('assignToken', token);
    io.emit('userCount', io.engine.clientsCount);
    socket.on('disconnect', () => io.emit('userCount', io.engine.clientsCount));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
