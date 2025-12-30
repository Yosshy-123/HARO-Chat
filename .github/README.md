# KAeRU Log

[日本語で読む](README.ja.md)

---

KAeRU Log is a lightweight chat application built using Node.js.

---

## Directory Structure

```
./
├─ .github/
│   ├─ README.md
│   └─ README.ja.md
├─ public/
│   ├─ index.html
│   ├─ main.js
│   ├─ socket.io.min.js
│   ├─ style.css
│   ├─ logo.png
│   ├─ favicon-16x16.png
│   ├─ favicon-32x32.png
│   └─ favicon-96x96.png
├─ server.js
├─ package.json
└─ LICENSE
```

---

## Operating Environment and Setup

This application runs in an environment where Node.js (v22 or later recommended) is installed.

### 1. Clone the Repository
```bash
git clone https://github.com/Yosshy-123/KAeRU-Log.git
cd KAeRU-Log
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Environment Variables

Create a `.env` file in the project root and add the following:

```env
REDIS_URL=redis://<host>:<port>

# Optional (Recommended)
ADMIN_PASS=<administrator password>
SECRET_KEY=<secret key for token>
```

`REDIS_URL` **must be defined**.

---

## How to Start

After configuring `.env`, start the server using the following command:

```bash
node server.js
```

---

## Demo

You can see a demo of the application's functionality here:

[https://kaeru-log.onrender.com](https://kaeru-log.onrender.com)

---

## Article

You can read an introductory article about KAeRU Log here:

[https://qiita.com/Yosshy_123/items/fa7289905f2fca60e450](https://qiita.com/Yosshy_123/items/fa7289905f2fca60e450)

---

## Bug Reports and Feedback

For bugs or feature requests, please create an **Issue** or contact us at *Yosshy_123@proton.me*.

---

## License

This project is released under the **MIT License**.
