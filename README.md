# AirWise

A location-aware weather and air-quality assistant for Indian cities. It reads current conditions, then explains in plain language what they mean for your day, with reasons.

AirWise combines live model data from Open-Meteo with a conversational assistant (NVIDIA Nemotron) and spoken replies (ElevenLabs). It was built for the PromptWars Virtual Challenge 6, Urban Air Quality Assistant, which asks for a GenAI assistant that helps families and communities respond to urban air pollution with practical, personalised, explained guidance.

## Why AirWise

Air-quality apps usually show a number. People need a decision: Is it fine for my child to play outside this evening? Should I drive or share a ride? What can I do at home? AirWise keeps the numbers grounded in real data and uses a language model only to interpret them, not to invent them.

## Features

- **Personal setup.** A short first-run flow collects an optional name, a location (Indian city search or device location), and optional context such as parent with children, daily commuter, student / outdoor sports, cooks at home or lives near a busy road, or sensitive to air quality. Everything is stored on your device.
- **Location-aware conditions.** Temperature, humidity, wind, precipitation, PM2.5, PM10 and US AQI for the selected place, fetched from Open-Meteo on every request.
- **Conversational guidance.** Ask about outdoor activity, commuting, indoor air quality or lower-emission alternatives. Answers use your supplied context, explain why, and say so when data is missing.
- **Voice.** Replies can be read aloud through ElevenLabs text-to-speech. A short greeting plays when you press Start.
- **Weather dashboard and map.** A three-screen carousel with a home view, a weather dashboard, and a MapLibre map on CARTO basemaps. Click the map or search a city to change the active location.
- **Honest failure modes.** If the AI service is unavailable, AirWise says so and still shows the weather readings. It does not present a canned message as an AI answer.

## How it works

1. The browser sends the question, the active coordinates, and a bounded recent history to `/api/chat`.
2. The server validates the request, fetches current conditions from Open-Meteo, and builds the model input itself. Client-supplied system or developer messages are rejected.
3. The model receives the conditions as data and your profile as labelled context, never as instructions.
4. The server extracts the final answer, hides any model reasoning, and returns either a model reply or an explicit degraded response with the weather readings.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling and motion | Tailwind CSS 4, Framer Motion |
| Map | MapLibre GL JS with CARTO basemaps |
| Weather and air quality | Open-Meteo forecast, air-quality and geocoding APIs |
| Reverse geocoding | OpenStreetMap Nominatim (public instance) |
| Language model | NVIDIA NIM, nvidia/nemotron-3.5-lightning-30b-a3b, through the OpenAI-compatible SDK |
| Text to speech | ElevenLabs |

## Project structure

```text
src/
  app/
    page.tsx                 Home page and three-screen carousel
    api/
      chat/                  Chat endpoint (validation, context, inference)
      tts/                   Text-to-speech endpoint
      weather-map/           Map weather data endpoint
      test/                  Development test route
  components/
    MorphingNav.tsx          Floating assistant pill and chat
    HomeDashboard.tsx        Home screen
    WeatherDetails.tsx       Weather dashboard
    WeatherMap.tsx           MapLibre map
    OnboardingGate.tsx       First-run setup controller
    OnboardingOverlay.tsx    Start page and setup form
  lib/
    environmental.ts         Open-Meteo data helper
    env-context.ts           Normalised environmental snapshot
    chat-schemas.ts          Request and response validation
    message-builder.ts       Server-side model message construction
    nim-adapter.ts           NVIDIA NIM client wrapper
    answer-parser.ts         Final-answer extraction
    persona.ts               Assistant instructions
    profile.ts, useProfile.ts  Local profile storage and validation
    location-context.tsx     Shared location state
    geocode.ts               Reverse geocoding
    diagnostics.ts           Privacy-safe request logging
    use-tts.ts               Playback hook
    __tests__/               Unit tests
public/
  audio/                     Static greeting audio
scripts/
  generate-intro.mjs         One-off generator for the greeting audio
```

## Getting started

### Prerequisites

- A Node.js version supported by Next.js 16, and npm
- An NVIDIA NIM API key
- An ElevenLabs API key (for spoken replies)
- A CARTO basemaps key, if you use CARTO tiles that require one

### Install and run

```bash
git clone https://github.com/The-Despicable/AirWise.git
cd AirWise
npm ci
cp .env.example .env.local     # then fill in your own values
npm run dev
```

Open http://localhost:3000. To test a first visit again, clear the `airwise.profile.v1` entry in your browser's local storage.

## Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `NVIDIA_NIM_API_KEY` | Server | Required for AI replies |
| `ELEVENLABS_API_KEY` | Server | Required for spoken replies |
| `NEXT_PUBLIC_CARTO_API_KEY` | Browser | Visible to every visitor. Restrict it by domain and never put a secret here |
| `NIM_TIMEOUT_MS` | Server | Optional, default 30000 |

Never commit `.env.local`. Only `.env.example`, which contains no values, belongs in the repository.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

Unit tests are plain TypeScript scripts run with `npx tsx`:

```bash
npx tsx src/lib/__tests__/chat-schemas.test.ts
npx tsx src/lib/__tests__/answer-parser.test.ts
```

Do not run `npm run build` while a production server is serving the same `.next` folder.

## Try it: sample inputs for evaluators

Complete the first-run setup, then ask the assistant:

| Persona | Setup chips | Try asking |
| --- | --- | --- |
| Parent | Parent with children | "My child wants to play outdoors this evening. What do today's readings suggest, and why?" |
| Commuter | Daily commuter | "I normally drive alone to work. Suggest a practical lower-emission alternative and explain the trade-offs." |
| Student | Student / outdoor sports | "Should I do outdoor sports today? Explain using the available air-quality information." |
| Household | Cooks at home / busy road nearby | "We cook frequently and live near a busy road. What practical indoor air-quality steps should we consider?" |

Then:

- Search for another Indian city, such as Delhi or Mumbai. The readings, label and advice should update.
- Ask "Why did you recommend that?" to see the reasoning.
- Ask "What changed compared with the previous place?" after switching cities.

## Data and accuracy

- Values are model-based estimates from Open-Meteo, not readings from physical monitoring stations or live radar. The assistant is instructed to say so.
- AQI is the US AQI reported by Open-Meteo. AirWise does not compute India's NAQI, which is defined over averaged pollutant concentrations rather than a single instant.
- AirWise does not measure indoor air. Indoor guidance is general advice based on outdoor conditions and the context you provide.
- AirWise does not provide medical advice. The sensitivity option is user-reported and only shapes the tone of general guidance.

## Privacy and security

- Your name, location and context chips are stored in your browser's local storage (`airwise.profile.v1`). There are no accounts and no database.
- API keys are read only on the server. The one `NEXT_PUBLIC_` key is intended to be public and should be restricted by domain.
- Requests are validated at runtime, including coordinate ranges, message length and history shape. Client-supplied system roles are rejected.
- Profile fields are allowlisted, and your name is passed to the model as data, not as instructions.
- Logs contain request IDs, durations and status, not prompts, conversations, names or keys.
- Rate limiting is in memory and applies per server instance. It is not a production-grade distributed limit.

## Testing and verification

Unit tests cover request validation and final-answer parsing.

Lint, type-checking and a production build run clean in the author's environment, with a small number of existing lint warnings in map and test code.

Chat, location changes and spoken replies were exercised manually. Browser automation scripts are in the repository root and under `scripts/` for map and onboarding checks.

## Known limitations

- Open-Meteo values are model estimates. Adding station data from OpenAQ or CPCB is the main planned improvement.
- The in-memory rate limiter does not coordinate across serverless instances.
- Reverse geocoding uses the public Nominatim service, which has its own usage policy and rate limits.
- Answers come from a language model. They are general guidance and can be wrong or incomplete.
- Greeting audio plays only after a click, because browsers block audio that starts without a user gesture.
- Local profile data does not follow you across devices.

## Roadmap

- Station-based air-quality data (OpenAQ / CPCB) alongside model estimates
- Indian NAQI using proper averaging periods
- Shared rate limiting and usage budgets
- Saved routines and a daily morning / afternoon / evening planner
- Hindi and other Indian-language support
- Test script and CI

## How AI was used in this project

Runtime AI: NVIDIA Nemotron interprets supplied conditions; ElevenLabs speaks the replies.

## Acknowledgements and terms

Weather and air-quality data by Open-Meteo. Please review their terms for attribution and usage requirements.

Basemaps © CARTO, map data © OpenStreetMap contributors.

Reverse geocoding by Nominatim.

Language model hosted by NVIDIA NIM. Voice by ElevenLabs.

## License

No license has been chosen yet. Add a `LICENSE` file before inviting reuse.
