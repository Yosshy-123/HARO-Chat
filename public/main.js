(async () => {
	const socket = io();
	let seed = localStorage.getItem('chat_seed');
	if (!seed) {
		const res = await fetch('/api/register', {
			method: 'POST'
		}).then(r => r.json());
		seed = res.seed;
		localStorage.setItem('chat_seed', seed);
	}
	let username = localStorage.getItem('chat_username') || '';
	const el = {
		messages: document.getElementById('messages'),
		input: document.getElementById('messageInput'),
		send: document.getElementById('sendBtn'),
		editUserBtn: document.getElementById('editUserBtn'),
		userModal: document.getElementById('userModal'),
		usernameInput: document.getElementById('usernameInput'),
		saveUsernameBtn: document.getElementById('saveUsernameBtn'),
		closeUserModalBtn: document.getElementById('closeUserModalBtn'),
		adminModal: document.getElementById('adminModal'),
		openAdminBtn: document.getElementById('openAdminBtn'),
		closeAdminModalBtn: document.getElementById('closeAdminModalBtn'),
		adminPassword: document.getElementById('adminPassword'),
		clearAllBtn: document.getElementById('clearAllBtn'),
		userCount: document.getElementById('userCount')
	};

	let isAutoScroll = true;
	const newMsgIndicator = document.createElement('div');
	newMsgIndicator.id = 'newMsgIndicator';
	newMsgIndicator.textContent = '新着メッセージ';
	document.body.appendChild(newMsgIndicator);
	newMsgIndicator.addEventListener('click', () => {
		scrollToBottom();
		newMsgIndicator.style.display = 'none';
	});

	const messagesContainer = document.querySelector('main');

	messagesContainer.addEventListener('scroll', () => {
		const threshold = 80;
		const pos = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
		isAutoScroll = pos <= threshold;
		if (isAutoScroll) newMsgIndicator.style.display = 'none';
	});

	function scrollToBottom() {
		messagesContainer.scrollTo({
			top: messagesContainer.scrollHeight,
			behavior: 'smooth'
		});
	}

	function showUserModal() {
		el.usernameInput.value = username;
		el.userModal.classList.add('show');
	}

	function hideUserModal() {
		el.userModal.classList.remove('show');
	}

	function showAdminModal() {
		el.adminPassword.value = '';
		el.adminModal.classList.add('show');
	}

	function hideAdminModal() {
		el.adminModal.classList.remove('show');
	}

	el.editUserBtn.addEventListener('click', showUserModal);
	el.closeUserModalBtn.addEventListener('click', hideUserModal);
	el.saveUsernameBtn.addEventListener('click', async () => {
		username = el.usernameInput.value.trim().slice(0, 24);
		if (username === '') return;
		await fetch('/api/username', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				seed,
				username
			})
		});
		localStorage.setItem('chat_username', username);
		hideUserModal();
		fetchMessages();
	});

	el.openAdminBtn.addEventListener('click', showAdminModal);
	el.closeAdminModalBtn.addEventListener('click', hideAdminModal);
	el.clearAllBtn.addEventListener('click', async () => {
		await fetch('/api/pass', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				password: el.adminPassword.value
			})
		});
		hideAdminModal();
	});

	async function fetchMessages() {
		const msgs = await fetch('/api/messages').then(r => r.json());
		el.messages.innerHTML = '';
		msgs.forEach((m, i) => {
			const div = document.createElement('div');
			div.className = 'msg' + (m.seed === seed ? ' self' : '');
			const bubble = document.createElement('div');
			bubble.className = 'bubble';
			bubble.textContent = `[${m.time}] ${m.username}: ${m.message}`;
			if (el.adminPassword.value) {
				const btn = document.createElement('button');
				btn.className = 'delete-btn';
				btn.textContent = '×';
				btn.addEventListener('click', async () => {
					await fetch('/api/pass', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							password: el.adminPassword.value,
							messageId: i
						})
					});
				});
				div.appendChild(btn);
			}
			div.appendChild(bubble);
			el.messages.appendChild(div);
		});
		if (isAutoScroll) scrollToBottom();
		else newMsgIndicator.style.display = 'block';
	}

	socket.on('newMessage', () => fetchMessages());
	socket.on('clearMessages', () => fetchMessages());
	socket.on('userCount', n => el.userCount.textContent = n);

	fetchMessages();

	el.send.addEventListener('click', async () => {
		const msg = el.input.value.trim();
		if (!msg) return;
		const time = new Date().toLocaleString();
		await fetch('/api/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				seed,
				message: msg,
				time,
				username
			})
		});
		el.input.value = '';
	});
	el.input.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			el.send.click();
		}
	});
})();
