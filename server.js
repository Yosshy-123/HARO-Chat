const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const cors = require('cors');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
let messages = [];

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

app.post('/api/register',(req,res)=>{
  const seed = [...Array(16)].map(()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  res.json({seed});
});

app.post('/api/username',(req,res)=>{
  res.json({ok:true});
});

app.get('/api/messages',(req,res)=>{
  res.json(messages);
});

app.post('/api/messages',(req,res)=>{
  const { seed, message, time, username } = req.body;
  if(!seed || !message || !username) return res.status(400).json({ message:'Invalid' });
  messages.push({ seed, message, time, username });
  io.emit('newMessage',{ seed, message, time, username });
  res.json({ok:true});
});

app.post('/api/pass',(req,res)=>{
  const { password, messageId } = req.body;
  if(password !== ADMIN_PASSWORD) return res.status(403).json({ message:'パスワード違い' });
  if(typeof messageId==='number' && messages[messageId]){
    messages.splice(messageId,1);
    io.emit('clearMessages');
    return res.json({message:'メッセージ削除しました'});
  }
  messages = [];
  io.emit('clearMessages');
  res.json({message:'全メッセージ削除しました'});
});

io.on('connection', socket=>{
  socket.emit('userCount', io.engine.clientsCount);
  io.emit('userCount', io.engine.clientsCount);
  socket.on('disconnect', ()=>{ io.emit('userCount', io.engine.clientsCount); });
});

http.listen(process.env.PORT||3000);
