import { NextRequest, NextResponse } from "next/server";

const VOICE_ID = "kYPR50VCNKK6L89q8w6Y";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY not configured" },
        { status: 501 }
      );
    }

    // Clean markdown symbols before voice generation
    const cleanText = text.replace(/[*#_`]/g, "").trim().slice(0, 1000);

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_turbo_v2_5", // low latency model
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("ElevenLabs error:", err);
      return NextResponse.json({ error: "Failed to generate speech" }, { status: res.status });
    }

    const audioBuffer = await res.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("TTS Route Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
