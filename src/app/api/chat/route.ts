// src/app/api/chat/route.ts

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getEnvironmentalData, weatherCodeToCondition, aqiCategory, windDirectionToCompass } from "@/lib/environmental";

const apiKey = process.env.NVIDIA_NIM_API_KEY;

// NVIDIA NIM hosted endpoint implements OpenAI Chat Completions API
const nim = apiKey
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: apiKey,
    })
  : null;

// Helper to strip thinking tokens or unclosed reasoning blocks
function extractCleanResponse(text: string): string {
  if (!text) return "";

  // 1. If closed </think> block is present, extract everything after </think>
  if (text.includes("</think>")) {
    const parts = text.split("</think>");
    return parts[parts.length - 1].trim();
  }

  // 2. If an open </think> tag consumed the entire max_tokens budget without closing
  if (text.startsWith("...")) {
    const stripped = text.replace("...", "").trim();
    const lines = stripped.split("\n").filter((l) => l.trim().length > 0);
    return lines[lines.length - 1] || "";
  }

  // 3. Regex fallback for any inline reasoning tags
  return text.replace(/...[\s\S]*?<\/...>/gi, "").trim();
}

function validateCoordinate(
  value: unknown,
  name: string,
  min: number,
  max: number
): { valid: number | null; error: string | null } {
  if (value === null || value === undefined || value === "") {
    return { valid: null, error: `${name} is required.` };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { valid: null, error: `${name} must be a finite number.` };
  }
  if (num < min || num > max) {
    return { valid: null, error: `${name} must be between ${min} and ${max}.` };
  }
  return { valid: num, error: null };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, latitude, longitude, locationName } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "A valid message is required." }, { status: 400 });
    }

    // Validate optional coordinates
    let resolvedLat = 17.385;
    let resolvedLon = 78.4867;
    let resolvedName = "Hyderabad, Telangana, India";
    let isDefault = true;
    let tz = "Asia/Kolkata";

    const latValidation = validateCoordinate(latitude, "latitude", -90, 90);
    const lonValidation = validateCoordinate(longitude, "longitude", -180, 180);

    if (!latValidation.error && !lonValidation.error) {
      resolvedLat = latValidation.valid!;
      resolvedLon = lonValidation.valid!;
      resolvedName = locationName || `${resolvedLat.toFixed(4)}, ${resolvedLon.toFixed(4)}`;
      isDefault = false;
    }

    // 1. Fetch environmental data for the selected location
    const env = await getEnvironmentalData(resolvedLat, resolvedLon, isDefault);
    tz = env.timezone;

    // 2. Build system prompt with actual location and temporal context
    const aqiInfo = env.aqiUs !== null ? aqiCategory(env.aqiUs) : { category: "Unavailable", color: "" };
    const windCompass = env.windDirection !== null ? windDirectionToCompass(env.windDirection) : "--";
    const condition = env.weatherCode !== null ? weatherCodeToCondition(env.weatherCode) : "Unknown";

    const systemPrompt = `/no_think
You are the AirWise Climate & Lifestyle Assistant.

LOCATION:
- Selected Place: ${resolvedName}
- Coordinates: ${resolvedLat.toFixed(4)}, ${resolvedLon.toFixed(4)}
- Elevation: ${env.elevation !== null ? env.elevation + " m" : "Unavailable"}
- Timezone: ${tz}
${isDefault ? "- NOTE: Using default Hyderabad coordinates. User has not shared their location." : ""}

TEMPORAL CONTEXT:
- Current Date: ${env.formattedDate} (${env.dayOfWeek})
- Current Time: ${env.formattedTime}

CURRENT CONDITIONS (Open-Meteo model estimate):
- Temperature: ${env.temperature !== null ? env.temperature + "°C" : "Unavailable"}
- Feels Like: ${env.apparentTemperature !== null ? env.apparentTemperature + "°C" : "Unavailable"}
- Condition: ${condition}
- Humidity: ${env.humidity !== null ? env.humidity + "%" : "Unavailable"}
- Wind: ${env.windSpeed !== null ? env.windSpeed + " km/h" : "Unavailable"} from ${windCompass}
- Gusts: ${env.windGusts !== null ? env.windGusts + " km/h" : "Unavailable"}
- Precipitation: ${env.precipitation !== null ? env.precipitation + " mm" : "Unavailable"}
- Cloud Cover: ${env.cloudCover !== null ? env.cloudCover + "%" : "Unavailable"}
- Surface Pressure: ${env.surfacePressure !== null ? env.surfacePressure + " hPa" : "Unavailable"}
- Air Quality: ${env.aqiUs !== null ? "US AQI " + env.aqiUs + " (" + aqiInfo.category + ")" : "Unavailable"}
  ${env.pm25 !== null ? "PM2.5: " + env.pm25 + " µg/m³" : ""}
  ${env.pm10 !== null ? "PM10: " + env.pm10 + " µg/m³" : ""}

IMPORTANT: These values are model-based estimates from Open-Meteo, not physical sensor readings or live radar. Do not present them as measured station data.

BEHAVIOR RULES:
1. DIRECT RELEVANCE: Directly answer the user's specific question about the selected location.
2. TEMPORAL QUERIES: If asked about the day, date, or time, answer directly using the Temporal Context above.
3. WEATHER QUERIES: Use the current conditions and forecast data above. Be honest about uncertainty — say "model estimate" when appropriate.
4. HEALTH & ACTIVITIES: Use AQI to provide actionable advice for outdoor activities.
5. GENERAL KNOWLEDGE: For non-weather questions, answer politely and factually.
6. FORMAT: Respond directly in 2 to 3 natural, conversational sentences without internal thought tags.`;

    if (!nim) {
      return NextResponse.json({
        reply: `[Demo Mode] ${resolvedName} reports ${env.temperature}°C, condition: ${condition}, AQI: ${env.aqiUs ?? "unavailable"}. Set NVIDIA_NIM_API_KEY in .env.local for full Nemotron 3.5 Lightning inference.`,
        location: { latitude: resolvedLat, longitude: resolvedLon, name: resolvedName, isDefault },
      });
    }

    // 3. Fast Inference with adequate token headroom
    const completion = await nim.chat.completions.create({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const rawOutput = completion.choices[0]?.message?.content || "";
    const cleanReply = extractCleanResponse(rawOutput);

    return NextResponse.json({
      reply: cleanReply || `I don't have current weather details for ${resolvedName} right now.`,
      location: { latitude: resolvedLat, longitude: resolvedLon, name: resolvedName, isDefault },
    });
  } catch (error: any) {
    console.error("Nemotron 3.5 Lightning Error:", error);
    return NextResponse.json(
      { error: "NVIDIA NIM inference service encountered an error." },
      { status: 500 }
    );
  }
}
