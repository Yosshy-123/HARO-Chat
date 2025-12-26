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

// 1ヶ月ごとにRedisDBをリセット
async function resetTokensIfMonthChanged() {
    const now = new Date();
    const currentMonth =
        now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const savedMonth = await redis.get('system:current_month');
    if (savedMonth === currentMonth) return;

    const lockKey = 'system:reset_lock';
    const locked = await redis.set(lockKey, '1', 'NX', 'EX', 30);
    if (!locked) return;

    try {
        console.log('[Redis] Month changed, FLUSHDB start');

        await redis.flushdb();

		await redis.set('system:current_month', currentMonth);

        console.log('[Redis] FLUSHDB completed');
    } catch (err) {
        console.error('[Redis] FLUSHDB failed', err);
    } finally {
        await redis.del(lockKey);
    }
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

async function verifyToken(token, clientIp) {
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

    if (expected !== signature) return null;

    const storedRaw = await redis.get(`token:${clientId}`);
    if (!storedRaw) return null;

    let stored;
    try {
        stored = JSON.parse(storedRaw);
    } catch {
        return null;
    }

    if (stored.token !== token) return null;
    if (stored.ip !== clientIp) return null;
    return clientId;
}

app.get('/api/messages/:roomId', async (req, res) => {
    try {
		const roomId = req.params.roomId;
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
            return res.status(400).json({ error: 'invalid roomId' });
        }
        const raw = await redis.lrange(`messages:${roomId}`, 0, -1);
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
    const { username, message, token, seed, roomId } = req.body;
    if (!roomId)
        return res.status(400).json({ error: 'roomId required' });
	if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
        return res.status(400).json({ error: 'invalid roomId' });
    }
    if (!username || !message || !token || !seed)
        return res.status(400).json({ error: 'Invalid data' });
    if (typeof username !== 'string' || username.length === 0 || username.length > 24)
        return res.status(400).json({ error: 'Username length invalid' });
    if (typeof message !== 'string' || message.length === 0 || message.length > 800)
        return res.status(400).json({ error: 'Message length invalid' });

    const clientId = await verifyToken(token, req.ip);
    if (!clientId) return res.status(403).json({ error: 'Invalid token or IP mismatch' });

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
        const roomKey = `messages:${roomId}`;

        await redis.rpush(roomKey, JSON.stringify(storedMsg));
        await redis.ltrim(roomKey, -100, -1);

        const publicMsg = {
            username: storedMsg.username,
            message: storedMsg.message,
            time: storedMsg.time,
            seed: storedMsg.seed
        };

        io.to(roomId).emit('newMessage', publicMsg);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Redis error' });
    }
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
        const { roomId } = req.body;
        if (!roomId) return res.status(400).json({ error: 'roomId required' });
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
            return res.status(400).json({ error: 'invalid roomId' });
        }
        await redis.del(`messages:${roomId}`);
        io.to(roomId).emit('clearMessages');
		notify(io.to(roomId), '全メッセージ削除されました', 'warning');
        res.json({ message: '全メッセージ削除しました' });
    } catch (e) {
        console.error('Redis clear failed', e);
        res.status(500).json({ error: 'Redis error' });
    }
});

io.on('connection', socket => {
    socket.on('authenticate', async ({ token }) => {
        let clientId = token ? await verifyToken(token, socket.handshake.address) : null;
        let assignedToken = null;
        const clientIp = socket.handshake.address;

        if (!clientId) {
            clientId = crypto.randomUUID();
            assignedToken = generateToken(clientId);

            await redis.set(`token:${clientId}`, JSON.stringify({ token: assignedToken, ip: clientIp }), 'EX', 60 * 60 * 24);

            const countKey = `ipTokenCount:${clientIp}`;
            const count = await redis.incr(countKey);
            await redis.expire(countKey, 3600);

            if (count > 30) {
                console.warn(`[RateLimit] IP ${clientIp} generated ${count} tokens in the last hour`);
            }
        }

        socket.data = socket.data || {};
        socket.data.clientId = clientId;

        if (assignedToken) {
            socket.emit('assignToken', assignedToken);
        }
        socket.emit('authenticated');
    });

    socket.on('joinRoom', ({ roomId }) => {
        if (!socket.data?.clientId) {
            socket.emit('authRequired');
            return;
        }

        if (!roomId || !/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) return;

        if (socket.data.roomId) {
            socket.leave(socket.data.roomId);
        }

        socket.join(roomId);
        socket.data.roomId = roomId;

        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('roomUserCount', roomSize);

        socket.emit('joinedRoom', { roomId });
    });

    socket.on('disconnecting', () => {
        const roomId = socket.data?.roomId;
        if (roomId) {
            const roomSize = (io.sockets.adapter.rooms.get(roomId)?.size || 1) - 1;
            io.to(roomId).emit('roomUserCount', roomSize);
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

(async () => {
  try {
    await resetTokensIfMonthChanged();
  } catch (err) {
    console.error('Token reset failed', err);
  } finally {
    server.listen(PORT, () =>
      console.log(`Server running on port ${PORT}`)
    );
  }
})();
