const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));
app.use(bodyParser.json());

const ADMIN_PASS = 'admin123';
let messages = [];
const lastMessageTime = new Map();
const lastClearTime = new Map();

app.get('/api/messages', (req, res) => res.json(messages));

app.post('/api/messages', (req, res) => {
  const { username, message, clientId } = req.body;
  if (!username || !message || !clientId) return res.status(400).json({ error: 'Invalid data' });
  if (typeof username !== 'string' || username.length === 0 || username.length > 24)
    return res.status(400).json({ error: 'Username length invalid' });
  if (typeof message !== 'string' || message.length === 0 || message.length > 800)
    return res.status(400).json({ error: 'Message length invalid' });

  const now = Date.now();
  const lastTime = lastMessageTime.get(clientId) || 0;
  if (now - lastTime < 1000) return res.status(429).json({ error: '送信には1秒以上間隔をあけてください' });
  lastMessageTime.set(clientId, now);

  const msg = { username, message, time: new Date().toLocaleString(), clientId };
  messages.push(msg);
  io.emit('newMessage', msg);
  res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
  const { password } = req.body;
  const ip = req.ip;
  if (password !== ADMIN_PASS) return res.status(403).json({ error: 'Unauthorized' });

  const now = Date.now();
  const lastTime = lastClearTime.get(ip) || 0;
  if (now - lastTime < 5000) return res.status(429).json({ error: '削除には5秒以上間隔をあけてください' });
  lastClearTime.set(ip, now);

  messages = [];
  io.emit('clearMessages');
  res.json({ message: '全メッセージ削除しました' });
});

io.on('connection', socket => {
  const clientId = randomUUID();
  socket.emit('assignId', clientId);
  io.emit('userCount', io.engine.clientsCount);
  socket.on('disconnect', () => io.emit('userCount', io.engine.clientsCount));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
