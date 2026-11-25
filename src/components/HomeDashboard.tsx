"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "@/lib/location-context";

export default function HomeDashboard() {
  const { state: locationState } = useLocation();
  const [time, setTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  const seconds = time.getSeconds();
  const minutes = time.getMinutes();
  const hours = time.getHours();

  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;

  const getGreeting = () => {
    if (hours < 12) return "Good morning";
    if (hours < 17) return "Good afternoon";
    return "Good evening";
  };

  const locationLabel = locationState.displayName
    ? locationState.displayName.replace(/ \(default.*/, "")
    : "Your location";

  return (
    <div className="relative w-full h-full flex flex-col justify-between items-center p-8 sm:p-12 select-none pointer-events-none">
      {/* Top Header Row (Greeting & Weather Summary) */}
      <motion.header
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex items-start justify-between w-full max-w-6xl mx-auto pt-6"
      >
        {/* User Greeting & Date */}
        <div className="space-y-1">
          <span className="text-[11px] font-semibold tracking-widest uppercase text-white/50 block">
            {time.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </span>
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-white/95">
            {getGreeting()},{" "}
            <span className="font-semibold text-white">Yaser</span>
          </h1>
        </div>

        {/* Compact Weather & AQI Pill - placeholder, real data comes from weather-map */}
        <div className="pointer-events-auto flex items-center gap-3 bg-[#111215]/65 border border-white/12 backdrop-blur-xl px-4 py-2 rounded-2xl shadow-xl text-white">
          <div className="flex items-center gap-2 pr-3 border-r border-white/10">
            <span className="text-xl">📍</span>
            <div>
              <div className="text-sm font-semibold leading-tight">{locationLabel}</div>
              <div className="text-[10px] text-white/50 uppercase tracking-wider">
                {locationState.source === "default" ? "Default location" : locationState.source}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 pl-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <div className="text-xs font-semibold text-white/90">
              {locationState.latitude?.toFixed(4)}°, {locationState.longitude?.toFixed(4)}°
            </div>
          </div>
        </div>
      </motion.header>

      {/* Centered Analog Clock */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.15 }}
        className="flex flex-col items-center justify-center my-auto"
      >
        <div className="relative w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-[#111215]/35 border border-white/15 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.45)] flex items-center justify-center">
          {/* Hour Markers */}
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-full h-full flex justify-center"
              style={{ transform: `rotate(${i * 30}deg)` }}
            >
              <span
                className={`block rounded-full ${
                  i % 3 === 0 ? "w-1 h-3 bg-white/70" : "w-0.5 h-1.5 bg-white/20"
                }`}
              />
            </div>
          ))}

          {/* Hour Hand */}
          <div
            className="absolute bottom-1/2 left-1/2 w-1.5 h-12 sm:h-14 bg-white rounded-full origin-bottom"
            style={{
              transform: `translateX(-50%) rotate(${hourDeg}deg)`,
              transition: "transform 0.2s cubic-bezier(0.4, 2.08, 0.55, 0.44)",
            }}
          />

          {/* Minute Hand */}
          <div
            className="absolute bottom-1/2 left-1/2 w-1 h-16 sm:h-20 bg-white/85 rounded-full origin-bottom"
            style={{
              transform: `translateX(-50%) rotate(${minuteDeg}deg)`,
              transition: "transform 0.15s cubic-bezier(0.4, 2.08, 0.55, 0.44)",
            }}
          />

          {/* Second Hand */}
          <div
            className="absolute bottom-1/2 left-1/2 w-0.5 h-20 sm:h-24 bg-rose-400 rounded-full origin-bottom shadow-[0_0_8px_rgba(251,113,133,0.8)]"
            style={{
              transform: `translateX(-50%) rotate(${secondDeg}deg)`,
              transition: secondDeg === 0 ? "none" : "transform 0.1s linear",
            }}
          />

          {/* Center Pin */}
          <div className="relative z-10 w-3 h-3 rounded-full bg-white shadow-md border-2 border-neutral-900" />
        </div>

        {/* Digital Time & City Label */}
        <p className="mt-4 text-xs font-mono tracking-widest text-white/50 uppercase">
          {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • {locationLabel}
        </p>
      </motion.div>

      {/* Bottom Clearance for Navigation Capsule */}
      <div className="h-16 w-full" />
    </div>
  );
}