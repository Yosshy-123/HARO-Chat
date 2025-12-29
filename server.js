const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const crypto = require('crypto');
const Redis = require('ioredis');

try {
    require('dotenv').config();
} catch {
    console.warn('dotenv not found, using default values');
}

/*
  Render でデプロイするため Redis を使用
  .env に REDIS_URL を必ず定義すること
*/
if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set');
    process.exit(1);
}

const redisClient = new Redis(process.env.REDIS_URL);
redisClient.on('connect', function() { console.log('Redis connected'); });
redisClient.on('error', function(err) { console.error('Redis error', err); });

/*
  月が変わったら Redis を全リセット
*/
async function resetRedisIfMonthChanged() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const savedMonth = await redisClient.get('system:current_month');
    if (savedMonth === currentMonth) return;

    const lockKey = 'system:reset_lock';
    const locked = await redisClient.set(lockKey, '1', 'NX', 'EX', 30);
    if (!locked) return;

    try {
        console.log('[Redis] Month changed, FLUSHDB start');
        await redisClient.flushdb();
        await redisClient.set('system:current_month', currentMonth);
        console.log('[Redis] FLUSHDB completed');
    } catch (err) {
        console.error('[Redis] FLUSHDB failed', err);
    } finally {
        await redisClient.del(lockKey);
    }
}

const app = express();
app.set('trust proxy', true);

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

app.use(express.static('public'));
app.use(express.json());

const ADMIN_PASS = process.env.ADMIN_PASS || 'adminkey1234';
const SECRET_KEY = process.env.SECRET_KEY || 'supersecretkey1234';
const PORT = process.env.PORT || 3000;

/* ---------------- ログ ---------------- */
function logUserAction(clientId, action, extra = {}) {
    const time = formatJSTTime(new Date());
    const username = extra.username ? ` [Username:${extra.username}]` : '';
    const info = { ...extra };
    delete info.username;
    const extraStr = Object.keys(info).length ? ` ${JSON.stringify(info)}` : '';
    console.log(`[${time}] [User:${clientId}]${username} Action: ${action}${extraStr}`);
}

/* ---------------- 通知 ---------------- */
function sendNotification(target, message, type = 'info') {
    target.emit('notify', { message, type });
}

/* ---------------- JST 時刻フォーマット ---------------- */
function formatJSTTime(date) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const yyyy = jst.getUTCFullYear();
    const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(jst.getUTCDate()).padStart(2, '0');
    const hh = String(jst.getUTCHours()).padStart(2, '0');
    const min = String(jst.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

/* ---------------- 認証トークン生成 ---------------- */
function createAuthToken(clientId) {
    const timestamp = Date.now();
    const data = `${clientId}.${timestamp}`;
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return `${clientId}.${timestamp}.${signature}`;
}

/* ---------------- トークン検証 ---------------- */
async function validateAuthToken(token) {
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [clientId, timestampStr, signature] = parts;
    const timestamp = Number(timestampStr);
    if (!timestamp) return null;

    const data = `${clientId}.${timestamp}`;
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(data);
    const expectedSignature = hmac.digest('hex');
    if (expectedSignature !== signature) return null;

    const storedToken = await redisClient.get(`token:${clientId}`);
    if (storedToken !== token) return null;

    return clientId;
}

/* ---------------- HTML エスケープ ---------------- */
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ---------------- API ---------------- */

app.get('/api/messages/:roomId', async function(req, res) {
    try {
        const { roomId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
            return res.status(400).json({ error: 'invalid roomId' });
        }

        const rawMessages = await redisClient.lrange(`messages:${roomId}`, 0, -1);
        const messages = rawMessages.map(JSON.parse).map(function(m) {
            return {
                username: m.username,
                message: m.message,
                time: m.time,
                seed: m.seed
            };
        });

        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Redis error' });
    }
});

app.post('/api/messages', async function(req, res) {
    const { username, message, token, seed, roomId } = req.body;

    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) return res.status(400).json({ error: 'invalid roomId' });
    if (!username || !message || !token || !seed) return res.status(400).json({ error: 'Invalid data' });
    if (username.length === 0 || username.length > 24) return res.status(400).json({ error: 'Username length invalid' });
    if (message.length === 0 || message.length > 800) return res.status(400).json({ error: 'Message length invalid' });

    const clientId = await validateAuthToken(token);
    if (!clientId) return res.status(403).json({ error: 'Invalid token' });

    const muteKey = `msg:mute:${clientId}`;
    if (await redisClient.exists(muteKey)) return res.status(429).json({ error: true });

    const now = Date.now();
    const rateLimitKey = `ratelimit:msg:${clientId}`;
    const lastTimestampKey = `msg:last_ts:${clientId}`;
    const lastIntervalKey = `msg:last_interval:${clientId}`;
    const repeatCountKey = `msg:same_count:${clientId}`;

    const lastTimestamp = await redisClient.get(lastTimestampKey);

    if (lastTimestamp) {
        const interval = now - Number(lastTimestamp);
        const lastInterval = await redisClient.get(lastIntervalKey);

        if (lastInterval && Math.abs(interval - Number(lastInterval)) <= 100) {
            const repeatCount = await redisClient.incr(repeatCountKey);
            if (repeatCount >= 5) {
                await redisClient.set(muteKey, '1', 'EX', 20);
                await redisClient.del(repeatCountKey, lastIntervalKey);
                io.to(clientId).emit('notify', { message: '連続送信のため20秒間ミュートされました', type: 'warning' });
                return res.status(429).json({ error: true });
            }
        } else {
            await redisClient.set(repeatCountKey, 0, 'EX', 30);
            await redisClient.set(lastIntervalKey, interval, 'EX', 30);
        }
    } else {
        await redisClient.set(repeatCountKey, 0, 'EX', 30);
    }

    await redisClient.set(lastTimestampKey, now, 'EX', 30);

    const lastSent = await redisClient.get(rateLimitKey);
    if (lastSent && now - Number(lastSent) < 1000) return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });

    await redisClient.set(rateLimitKey, now, 'PX', 2000);

    const storedMessage = {
        username: escapeHTML(username),
        message: escapeHTML(message),
        time: formatJSTTime(new Date()),
        clientId,
        seed
    };

    try {
        const roomKey = `messages:${roomId}`;
        await redisClient.rpush(roomKey, JSON.stringify(storedMessage));
        await redisClient.ltrim(roomKey, -100, -1);

        io.to(roomId).emit('newMessage', {
            username: storedMessage.username,
            message: storedMessage.message,
            time: storedMessage.time,
            seed
        });

        logUserAction(clientId, 'sendMessage', { roomId, username: storedMessage.username, message: storedMessage.message });

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Redis error' });
    }
});
