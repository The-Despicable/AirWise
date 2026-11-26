import { mkdir, writeFile } from "node:fs/promises";

const TEXT = "Hi, this is AirWise AI, and I'm Laura, your personal assistant.";
const res = await fetch("http://localhost:3000/api/tts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: TEXT }),
});
if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
const audio = Buffer.from(await res.arrayBuffer());
await mkdir("public/audio", { recursive: true });
await writeFile("public/audio/intro.mp3", audio);
console.log("Wrote public/audio/intro.mp3", audio.length, "bytes");