const socket = io();
let messages = [];
let myName = localStorage.getItem('chat_username') || '';
const el = {
  messages: document.getElementById('messages'),
  input: document.getElementById('messageInput'),
  send: document.getElementById('sendBtn'),
  usernameTag: document.getElementById('usernameTag'),
  toast: document.getElementById('toast'),
  userModal: document.getElementById('userModal'),
  usernameInput: document.getElementById('username'),
  userOpen: document.getElementById('openUser'),
  userCancel: document.getElementById('userCancel'),
  userSave: document.getElementById('userSave'),
  adminModal: document.getElementById('adminModal'),
  adminOpen: document.getElementById('openAdmin'),
  adminClose: document.getElementById('adminClose'),
  adminPass: document.getElementById('adminPass'),
  clearBtn: document.getElementById('clearBtn'),
  newMsgIndicator: document.getElementById('newMsgIndicator')
};
let isAutoScroll = true;

function sanitize(text){return String(text||'');}
function showToast(msg, ms=1800){el.toast.textContent=msg;el.toast.classList.add('show');clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.toast.classList.remove('show'),ms);}
function nowTime(){const d=new Date();return d.toLocaleString();}
function scrollToBottom(smooth){el.messages.scrollTo({top:el.messages.scrollHeight,behavior:smooth?'smooth':'auto'});}
function atBottom(){return el.messages.scrollHeight-el.messages.scrollTop-el.messages.clientHeight<80;}
function renderMessage(msg){const wrap=document.createElement('div');wrap.className='msg'+(msg.username===myName?' self':'');const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=msg.username.slice(0,2).toUpperCase();const bubble=document.createElement('div');bubble.className='bubble';const meta=document.createElement('div');meta.className='meta';const nameEl=document.createElement('span');nameEl.className='name';nameEl.textContent=sanitize(msg.username);const dot=document.createElement('span');dot.textContent='•';dot.style.opacity='0.6';const timeEl=document.createElement('span');timeEl.textContent=sanitize(msg.time);meta.append(nameEl,dot,timeEl);const textEl=document.createElement('div');textEl.className='text';textEl.textContent=sanitize(msg.message);bubble.append(meta,textEl);wrap.append(avatar,bubble);return wrap;}
function renderAll(){el.messages.innerHTML='';messages.forEach(m=>el.messages.appendChild(renderMessage(m)));if(isAutoScroll)scrollToBottom(false);}
async function fetchMessages(){try{const res=await fetch('/api/messages');messages=await res.json();renderAll();}catch{showToast('メッセージ取得失敗');}}
async function sendMessage(){const txt=el.input.value.trim();if(!txt){return;}if(!myName){openUserModal();showToast('ユーザー名を設定してください');return;}try{const res=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:myName,message:txt})});if(!res.ok){const j=await res.json();throw j;}el.input.value='';fetchMessages();}catch{showToast('送信失敗');}}
function openUserModal(){el.usernameInput.value=myName||'';el.userModal.classList.add('show');}
function closeUserModal(){el.userModal.classList.remove('show');}
function openAdminModal(){el.adminPass.value='';el.adminModal.classList.add('show');el.adminPass.focus();}
function closeAdminModal(){el.adminModal.classList.remove('show');}
async function clearAllMessages(){const p=el.adminPass.value;if(!p){showToast('パスワード入力');return;}try{const res=await fetch('/api/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});const j=await res.json();if(!res.ok)throw j;showToast(j.message||'削除しました');el.adminModal.classList.remove('show');fetchMessages();}catch{showToast('削除失敗');}}
el.send.addEventListener('click',sendMessage);
el.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
el.userOpen.addEventListener('click',openUserModal);
el.userCancel.addEventListener('click',closeUserModal);
el.userSave.addEventListener('click',()=>{const v=el.usernameInput.value.trim();if(!v||v.length>24){showToast('1〜24文字で設定');return;}myName=v;localStorage.setItem('chat_username',myName);el.usernameTag.textContent=myName;closeUserModal();showToast('保存');});
el.adminOpen.addEventListener('click',openAdminModal);
el.adminClose.addEventListener('click',closeAdminModal);
el.clearBtn.addEventListener('click',clearAllMessages);
el.messages.addEventListener('scroll',()=>{isAutoScroll=atBottom();if(isAutoScroll)el.newMsgIndicator.style.display='none';});
socket.on('connect',()=>{fetchMessages();});
socket.on('newMessage',msg=>{messages.push(msg);renderAll();if(!atBottom())el.newMsgIndicator.style.display='block';});
socket.on('clearMessages',()=>{messages=[];renderAll();showToast('全メッセージ削除されました');});
