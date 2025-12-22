const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const Redis = require('ioredis');

try {
    require('dotenv').config();
} catch (e) {
    console.warn('dotenv not found, using default values');
}

/*
RenderでデプロイするのでRedisを使用
必ず.envファイルにREDIS_URLを定義すること
Redisを使用しない場合は、No-Redisフォルダを確認すること
*/
if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set');
    process.exit(1);
}

const redis = new Redis(process.env.REDIS_URL);
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', err => console.error('Redis error', err));

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));
app.use(express.json());

const ADMIN_PASS = process.env.ADMIN_PASS || 'adminkey1234';
const SECRET_KEY = process.env.SECRET_KEY || 'supersecretkey1234';
const PORT = process.env.PORT || 3000;

function notify(ioOrSocket, message, type = 'info') {
	ioOrSocket.emit('notify', { message, type });
}

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

async function verifyToken(token) {
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

    if (expected !== signature) return null;
    const stored = await redis.get(`token:${clientId}`);
    if (stored !== token) return null;
    return clientId;
}

app.get('/api/messages', async (req, res) => {
    try {
        const raw = await redis.lrange('messages', 0, -1);
        const messages = raw.map(JSON.parse).map(m => ({
            username: m.username,
            message: m.message,
            time: m.time,
            seed: m.seed
        }));
        res.json(messages);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Redis error' });
    }
});

app.post('/api/messages', async (req, res) => {
    const { username, message, token, seed } = req.body;
    if (!username || !message || !token || !seed)
        return res.status(400).json({ error: 'Invalid data' });
    if (typeof username !== 'string' || username.length === 0 || username.length > 24)
        return res.status(400).json({ error: 'Username length invalid' });
    if (typeof message !== 'string' || message.length === 0 || message.length > 800)
        return res.status(400).json({ error: 'Message length invalid' });

    const clientId = await verifyToken(token);
    if (!clientId) return res.status(403).json({ error: 'Invalid token' });

    const now = Date.now();
    const rateKey = `ratelimit:msg:${clientId}`;

    const last = await redis.get(rateKey);
    if (last && now - Number(last) < 1000) {
        return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });
    }
    await redis.set(rateKey, now, 'PX', 2000);

    const storedMsg = { 
        username, 
        message, 
        time: formatTime(new Date()), 
        clientId,
        seed 
    };
    try {
        await redis.rpush('messages', JSON.stringify(storedMsg));
        await redis.ltrim('messages', -100, -1);

        const publicMsg = {
            username: storedMsg.username,
            message: storedMsg.message,
            time: storedMsg.time,
            seed: storedMsg.seed
        };

        io.emit('newMessage', publicMsg);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Redis error' });
    }
});

app.post('/api/refresh-token', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'No token provided' });
    const clientId = await verifyToken(token);
    if (!clientId) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
    const newToken = generateToken(clientId);
    await redis.set(`token:${clientId}`, newToken, 'PX', 5 * 60 * 1000);

    res.json({ token: newToken });
});

app.post('/api/clear', async (req, res) => {
    const { password } = req.body;
    const ip = req.ip;
    if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

    const now = Date.now();
    const clearKey = `ratelimit:clear:${ip}`;

    const last = await redis.get(clearKey);
    if (last && now - Number(last) < 30000) {
        return res.status(429).json({ error: '削除には30秒以上間隔をあけてください' });
    }
    await redis.set(clearKey, now, 'PX', 60000);

    try {
        await redis.del('messages');
        io.emit('clearMessages');
		notify(io, '全メッセージ削除されました', 'warning');
        res.json({ message: '全メッセージ削除しました' });
    } catch (e) {
        console.error('Redis clear failed', e);
        res.status(500).json({ error: 'Redis error' });
    }
});

io.on('connection', async socket => {
    const clientId = crypto.randomUUID();
    const token = generateToken(clientId);

    await redis.set(
        `token:${clientId}`,
        token,
        'PX',
        5 * 60 * 1000
    );

    socket.emit('assignToken', token);

    await redis.incr('connections');
    const count = await redis.get('connections');
    io.emit('userCount', Number(count));

    socket.on('authenticate', async ({ token }) => {
        const verifiedId = await verifyToken(token);
        if (!verifiedId) {
            socket.emit('authFailed', { error: 'Invalid or expired token' });
            return;
        }
        socket.data = socket.data || {};
        socket.data.clientId = verifiedId;
    });

    socket.on('disconnect', async () => {
        await redis.decr('connections');
        const count = await redis.get('connections');
        io.emit('userCount', Number(count));
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
