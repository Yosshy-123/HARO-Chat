const SERVER_URL = window.location.origin.replace(/\/$/, ''); // サーバーのURLを定義
const socket = io(SERVER_URL);
let messages = [];
let myToken = localStorage.getItem('chatToken') || '';
let myName = localStorage.getItem('chat_username') || '';
let mySeed = localStorage.getItem('chat_seed');
if (!mySeed) {
	mySeed = generateSeed(40);
	localStorage.setItem('chat_seed', mySeed);
}

function generateSeed(length) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	const array = new Uint32Array(length);
	crypto.getRandomValues(array);
	for (let i = 0; i < length; i++) {
		result += chars[array[i] % chars.length];
	}
	return result;
}

const el = {
	container: document.querySelector('main'),
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
	connText: document.getElementById('connText'),
	connDot: document.getElementById('connDot'),
	userCount: document.getElementById('userCount')
};

if (el.usernameTag) el.usernameTag.textContent = myName || '未設定';
let isAutoScroll = true;

function showToast(t, ms = 1800) {
	if (!el.toast) return;
	el.toast.textContent = t;
	el.toast.classList.add('show');
	clearTimeout(showToast._t);
	showToast._t = setTimeout(() => el.toast.classList.remove('show'), ms);
}

function nowTime() {
	return new Date().toLocaleString();
}

function atBottom() {
	const c = el.container || document.documentElement;
	return c.scrollHeight - c.scrollTop - c.clientHeight < 80;
}

function scrollToBottom(smooth = true) {
	const c = el.container || document.documentElement;
	c.scrollTo({
		top: c.scrollHeight,
		behavior: smooth ? 'smooth' : 'auto'
	});
}

function initials(name) {
	if (!name) return '?';
	const s = name.trim().split(/\s+/).map(p => p[0] || '').join('').toUpperCase();
	return s.slice(0, 2);
}

function focusInput(elm = el.input) {
	if (!elm) return;
	elm.focus();
	elm.scrollIntoView({
		behavior: 'smooth',
		block: 'center'
	});
	if (elm.value !== undefined) {
		const val = elm.value;
		elm.value = '';
		elm.value = val;
	}
}
function renderMessage(msg) {
	const isSelf = msg.seed === mySeed;
	const wrap = document.createElement('div');
	wrap.className = 'msg' + (isSelf ? ' self' : '');
	const avatar = document.createElement('div');
	avatar.className = 'avatar';
	avatar.textContent = initials(msg.username);
	const bubble = document.createElement('div');
	bubble.className = 'bubble';
	const meta = document.createElement('div');
	meta.className = 'meta';
	const nameEl = document.createElement('span');
	nameEl.className = 'name';
	nameEl.textContent = msg.username || '匿名';
	const dot = document.createElement('span');
	dot.textContent = '•';
	dot.style.opacity = '0.6';
	const timeEl = document.createElement('span');
	timeEl.textContent = msg.time || '';
	meta.append(nameEl, dot, timeEl);
	const textEl = document.createElement('div');
	textEl.className = 'text';
	textEl.textContent = msg.message || '';
	bubble.append(meta, textEl);
	wrap.append(avatar, bubble);
	return wrap;
}

async function fetchMessages() {
	try {
		const res = await fetch(`${SERVER_URL}/api/messages`, {
			cache: 'no-store'
		});
		if (!res.ok) throw 0;
		messages = await res.json();
		if (el.messages) {
			el.messages.innerHTML = '';
			messages.forEach(msg => el.messages.appendChild(renderMessage(msg)));
		}
		if (isAutoScroll) scrollToBottom(false);
	} catch {
		showToast('メッセージ取得に失敗しました');
	}
}

async function sendMessage() {
	const txt = (el.input && el.input.value || '').trim();
	if (!txt) return;
	if (!myName) {
		if (el.userModal) el.userModal.classList.add('show');
		showToast('ユーザー名を設定してください');
		return;
	}
	if (!myToken) {
		showToast('接続中です');
		return;
	}
	try {
		const payload = {
			username: myName,
			message: txt,
			token: myToken,
			seed: mySeed 
		};
		const res = await fetch(`${SERVER_URL}/api/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw await res.json().catch(() => ({}));
		if (el.input) el.input.value = '';
		await fetchMessages();
	} catch {
		showToast('送信に失敗しました');
	}
}

function openUserModal() {
	if (el.usernameInput) el.usernameInput.value = myName || '';
	if (el.userModal) el.userModal.classList.add('show');
	focusInput(el.usernameInput);
}

function closeUserModal() {
	if (el.userModal) el.userModal.classList.remove('show');
}

function openAdminModal() {
	if (el.adminPass) el.adminPass.value = '';
	if (el.adminModal) el.adminModal.classList.add('show');
	focusInput(el.adminPass);
}

function closeAdminModal() {
	if (el.adminModal) el.adminModal.classList.remove('show');
}

async function clearAllMessages() {
	const p = el.adminPass && el.adminPass.value || '';
	if (!p) {
		showToast('パスワードを入力してください');
		return;
	}
	try {
		const res = await fetch(`${SERVER_URL}/api/clear`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				password: p
			})
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw j;
		showToast(j.message || '全メッセージ削除しました');
		closeAdminModal();
		focusInput();
		await fetchMessages();
	} catch {
		showToast('削除に失敗しました');
	}
}

if (el.send) el.send.addEventListener('click', sendMessage);
if (el.input) {
	const isMobileLike = window.matchMedia('(max-width: 820px) and (pointer: coarse)').matches;
	el.input.addEventListener('keydown', e => {
		if (isMobileLike) return;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});
	if (el.userOpen) el.userOpen.addEventListener('click', openUserModal);
	if (el.userCancel) el.userCancel.addEventListener('click', () => {
		closeUserModal();
		focusInput();
	});
	if (el.userSave) el.userSave.addEventListener('click', async () => {
		const v = (el.usernameInput && el.usernameInput.value || '').trim().slice(0, 24);
		if (!v) {
			showToast('ユーザー名は1〜24文字で設定してください');
			return;
		}
		myName = v;
		localStorage.setItem('chat_username', myName);
		if (el.usernameTag) el.usernameTag.textContent = myName;
		closeUserModal();
		showToast('プロフィールを保存しました');
		await fetchMessages();
		focusInput();
	});
	if (el.adminOpen) el.adminOpen.addEventListener('click', openAdminModal);
	if (el.adminClose) el.adminClose.addEventListener('click', () => {
		closeAdminModal();
		focusInput();
	});
	if (el.clearBtn) el.clearBtn.addEventListener('click', clearAllMessages);
	if (el.container) el.container.addEventListener('scroll', () => {
		isAutoScroll = atBottom();
	});
}

socket.on('connect', () => {
	if (el.connText) el.connText.textContent = 'オンライン';
	if (el.connDot) {
		el.connDot.classList.remove('offline');
		el.connDot.classList.add('online');
	}
});
socket.on('disconnect', () => {
	if (el.connText) el.connText.textContent = '切断';
	if (el.connDot) {
		el.connDot.classList.remove('online');
		el.connDot.classList.add('offline');
	}
});
socket.on('assignToken', token => {
	myToken = token;
	localStorage.setItem('chatToken', token);
});
socket.on('newMessage', msg => {
	messages.push(msg);
	if (el.messages) el.messages.appendChild(renderMessage(msg));
	if (isAutoScroll) scrollToBottom(true);
});
socket.on('clearMessages', () => {
	messages = [];
	if (el.messages) el.messages.innerHTML = '';
	showToast('全メッセージ削除されました');
});
socket.on('notify', data => {
	if (!data) return;
	const msg =
		typeof data === 'string'
			? data
			: data.message;
	if (!msg) return;
	showToast(msg);
});
socket.on('userCount', d => {
	if (!d) return;
	if (typeof d === 'number' || typeof d === 'string') {
		if (el.userCount) el.userCount.textContent = `オンライン: ${d}`;
	} else if (typeof d === 'object' && d.userCount !== undefined) {
		if (el.userCount) el.userCount.textContent = `オンライン: ${d.userCount}`;
	}
});

focusInput();
fetchMessages();
