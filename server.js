require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const xss = require('xss');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
let messages = [];

app.post('/api/deleteMessage', (req, res) => {
	const { id, key } = req.body;
	if (key !== SECRET_KEY) return res.status(403).json({ success: false, message: 'Unauthorized' });
	const index = messages.findIndex(m => m.id === id);
	if (index === -1) return res.status(404).json({ success: false, message: 'Message not found' });
	messages.splice(index, 1);
	io.emit('deleteMessage', id);
	res.json({ success: true });
});

app.post('/api/deleteAllMessages', (req, res) => {
	const { key } = req.body;
	if (key !== SECRET_KEY) return res.status(403).json({ success: false, message: 'Unauthorized' });
	messages = [];
	io.emit('deleteAllMessages');
	res.json({ success: true });
});

io.on('connection', (socket) => {
	socket.emit('init', messages);

	socket.on('sendMessage', (data) => {
		const cleanMessage = {
			id: uuidv4(),
			user: xss(data.user),
			content: xss(data.content),
			time: new Date().toISOString()
		};
		messages.push(cleanMessage);
		io.emit('newMessage', cleanMessage);
	});
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
