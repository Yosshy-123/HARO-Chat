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
redisClient.on('connect', () => console.log('Redis connected'));
redisClient.on('error', err => console.error('Redis error', err));

/**
 * 月が変わったら Redis を全リセット
 */
async function resetRedisIfMonthChanged() {
	const now = new Date();
	const currentMonth =
		now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

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

/**
 * クライアントへ通知送信
 */
function sendNotification(target, message, type = 'info') {
	target.emit('notify', { message, type });
}

/**
 * JST 表示用 時刻フォーマット
 */
function formatJSTTime(date) {
	const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

	const yyyy = jst.getUTCFullYear();
	const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(jst.getUTCDate()).padStart(2, '0');
	const hh = String(jst.getUTCHours()).padStart(2, '0');
	const min = String(jst.getUTCMinutes()).padStart(2, '0');

	return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

/**
 * 認証トークン生成
 */
function createAuthToken(clientId) {
	const timestamp = Date.now();
	const data = `${clientId}.${timestamp}`;

	const hmac = crypto.createHmac('sha256', SECRET_KEY);
	hmac.update(data);
	const signature = hmac.digest('hex');

	return `${clientId}.${timestamp}.${signature}`;
}

/**
 * トークン検証
 */
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

/* ---------------- API ---------------- */

app.get('/api/messages/:roomId', async (req, res) => {
	try {
		const { roomId } = req.params;
		if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
			return res.status(400).json({ error: 'invalid roomId' });
		}

		const rawMessages = await redisClient.lrange(`messages:${roomId}`, 0, -1);
		const messages = rawMessages.map(JSON.parse).map(m => ({
			username: m.username,
			message: m.message,
			time: m.time,
			seed: m.seed
		}));

		res.json(messages);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Redis error' });
	}
});

app.post('/api/messages', async (req, res) => {
	const { username, message, token, seed, roomId } = req.body;

	if (!roomId) return res.status(400).json({ error: 'roomId required' });
	if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
		return res.status(400).json({ error: 'invalid roomId' });
	}

	if (!username || !message || !token || !seed) {
		return res.status(400).json({ error: 'Invalid data' });
	}

	if (username.length === 0 || username.length > 24) {
		return res.status(400).json({ error: 'Username length invalid' });
	}

	if (message.length === 0 || message.length > 800) {
		return res.status(400).json({ error: 'Message length invalid' });
	}

	const clientId = await validateAuthToken(token);
	if (!clientId) return res.status(403).json({ error: 'Invalid token' });

	const muteKey = `msg:mute:${clientId}`;
	if (await redisClient.exists(muteKey)) {
		return res.status(429).json({ error: true });
	}

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

				io.to(clientId).emit('notify', {
					message: '連続送信のため20秒間ミュートされました',
					type: 'warning'
				});

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
	if (lastSent && now - Number(lastSent) < 1000) {
		return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });
	}

	await redisClient.set(rateLimitKey, now, 'PX', 2000);

	const storedMessage = {
		username,
		message,
		time: formatJSTTime(new Date()),
		clientId,
		seed
	};

	try {
		const roomKey = `messages:${roomId}`;

		await redisClient.rpush(roomKey, JSON.stringify(storedMessage));
		await redisClient.ltrim(roomKey, -100, -1);

		io.to(roomId).emit('newMessage', {
			username,
			message,
			time: storedMessage.time,
			seed
		});

		res.json({ ok: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Redis error' });
	}
});

app.post('/api/clear', async (req, res) => {
	const { password, roomId } = req.body;
	const requesterIp = req.ip;

	if (password !== ADMIN_PASSWORD) {
		return res.status(403).json({ error: 'Unauthorized' });
	}

	const now = Date.now();
	const rateKey = `ratelimit:clear:${requesterIp}`;
	const last = await redisClient.get(rateKey);

	if (last && now - Number(last) < 30000) {
		return res.status(429).json({ error: '削除には30秒以上間隔をあけてください' });
	}

	await redisClient.set(rateKey, now, 'PX', 60000);

	try {
		if (!roomId) return res.status(400).json({ error: 'roomId required' });
		if (!/^[a-zA-Z0-9_-]{1,32}$/.test(roomId)) {
			return res.status(400).json({ error: 'invalid roomId' });
		}

		await redisClient.del(`messages:${roomId}`);
		io.to(roomId).emit('clearMessages');
		sendNotification(io.to(roomId), '全メッセージ削除されました', 'warning');

		res.json({ message: '全メッセージ削除しました' });
	} catch (err) {
		console.error('Redis clear failed', err);
		res.status(500).json({ error: 'Redis error' });
	}
});

/* ---------------- Socket.IO ---------------- */

io.on('connection', socket => {
	socket.on('authenticate', async ({ token }) => {
		const now = Date.now();
		const ip =
			socket.handshake.headers['x-forwarded-for']
				?.split(',')[0]
				?.trim() || socket.handshake.address;

		let clientId = token ? await validateAuthToken(token) : null;
		let newToken = null;

		socket.data ||= {};

		if (!clientId) {
			const reissueKey = `ratelimit:reissue:${ip}`;
			const last = await redisClient.get(reissueKey);

			if (last && now - Number(last) < 30000) {
				socket.emit('authRequired');
				return;
			}

			clientId = crypto.randomUUID();
			newToken = createAuthToken(clientId);

			await redisClient.set(`token:${clientId}`, newToken, 'EX', 60 * 60 * 24);
			await redisClient.set(reissueKey, now, 'PX', 30000);

			socket.data.clientId = clientId;
			socket.emit('assignToken', newToken);
		} else {
			socket.data.clientId = clientId;
		}

		socket.emit('authenticated');
		socket.join(clientId);
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
			const roomSize =
				(io.sockets.adapter.rooms.get(roomId)?.size || 1) - 1;
			io.to(roomId).emit('roomUserCount', roomSize);
		}
	});
});

app.get('*', (req, res) => {
	res.sendFile(__dirname + '/public/index.html');
});

/* ---------------- Startup ---------------- */

(async () => {
	try {
		await resetRedisIfMonthChanged();
	} catch (err) {
		console.error('Token reset failed', err);
	} finally {
		httpServer.listen(PORT, () => {
			console.log(`Server running on port ${PORT}`);
		});
	}
})();
