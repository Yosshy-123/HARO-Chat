import { useEffect, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const ws = useRef();

  useEffect(() => {
    ws.current = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "init") setMessages(data.messages);
      if (data.type === "newMessage") setMessages((prev) => [...prev, data.message]);
      if (data.type === "deleteMessage") setMessages((prev) => prev.filter((m) => m.id !== data.id));
      if (data.type === "deleteAllMessages") setMessages([]);
    };

    return () => ws.current.close();
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;
    const message = { id: uuidv4(), text: input };
    ws.current.send(JSON.stringify({ type: "newMessage", ...message }));
    setInput("");
  };

  const deleteMessage = (id) => ws.current.send(JSON.stringify({ type: "deleteMessage", id }));
  const deleteAllMessages = () => ws.current.send(JSON.stringify({ type: "deleteAllMessages" }));

  return (
    <div style={{ padding: 20 }}>
      <h1>リアルタイムチャット</h1>
      <div style={{ marginBottom: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ width: 300, marginRight: 10 }}
        />
        <button onClick={sendMessage}>送信</button>
        <button onClick={deleteAllMessages} style={{ marginLeft: 10 }}>全削除</button>
      </div>
      <ul>
        {messages.map((m) => (
          <li key={m.id} style={{ marginBottom: 5 }}>
            {escapeHtml(m.text)} <button onClick={() => deleteMessage(m.id)}>削除</button>
          </li>
        ))}
      </ul>
      <div id="toast-container" style={{ position: "fixed", top: 10, right: 10 }}></div>
    </div>
  );
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
