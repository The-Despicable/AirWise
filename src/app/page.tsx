"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { motion, PanInfo } from "framer-motion";
import HomeDashboard from "@/components/HomeDashboard";
import WeatherDetails from "@/components/WeatherDetails";
import WeatherMap from "@/components/WeatherMap";
import MorphingNav from "@/components/MorphingNav";
import { LocationProvider } from "@/lib/location-context";

export default function Home() {
  const [activePage, setActivePage] = useState<number>(0); // 0 = Clock, 1 = Metrics, 2 = Geological Map

  // Keyboard navigation for Left/Right/Up/Down/Home/End
  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // Do not hijack arrow keys while typing in the chat input.
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case "ArrowRight":
          setActivePage((prev) => Math.min(prev + 1, 2));
          break;

        case "ArrowLeft":
          setActivePage((prev) => Math.max(prev - 1, 0));
          break;

        case "ArrowDown":
          setActivePage((prev) => Math.min(prev + 1, 2));
          break;

        case "ArrowUp":
          setActivePage((prev) => Math.max(prev - 1, 0));
          break;

        case "Home":
          setActivePage(0);
          break;

        case "End":
          setActivePage(2);
          break;

        default:
          return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyboardNavigation);
    return () => window.removeEventListener("keydown", handleKeyboardNavigation);
  }, []);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const swipeThreshold = 50;
    if (info.offset.x < -swipeThreshold && activePage < 2) {
      setActivePage((prev) => prev + 1);
    } else if (info.offset.x > swipeThreshold && activePage > 0) {
      setActivePage((prev) => prev - 1);
    }
  };

  return (
    <LocationProvider>
      <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none">
      {/* Background Image */}
      <Image
        src="/hero-bg.jpg"
        alt="Background"
        priority
        fill
        className="object-cover brightness-[0.78] contrast-[1.05]"
      />

      {/* Ambient Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none z-0" />

      {/* Top Center 3-Page Pagination Bubbles */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-[#111215]/70 border border-white/12 backdrop-blur-xl px-3.5 py-1.5 rounded-full shadow-2xl">
        {[
          { idx: 0, label: "Home Clock" },
          { idx: 1, label: "Weather Breakdown" },
          { idx: 2, label: "Geological Map" },
        ].map(({ idx, label }) => (
          <button
            key={idx}
            onClick={() => setActivePage(idx)}
            aria-label={label}
            className="p-1 cursor-pointer focus:outline-none"
          >
            <motion.div
              layout
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className={`rounded-full transition-all duration-200 ${
                activePage === idx
                  ? "w-7 h-2.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
                  : "w-2.5 h-2.5 bg-white/30 hover:bg-white/60"
              }`}
            />
          </button>
        ))}
      </div>

      {/* 3-Screen Horizontal Carousel Track */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
        animate={{
          x: activePage === 0 ? "0%" : activePage === 1 ? "-33.333%" : "-66.666%",
        }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="relative z-10 flex w-[300vw] h-full cursor-grab active:cursor-grabbing"
      >
        {/* Screen 0: Clock & Welcome Greeting */}
        <section className="w-[100vw] h-full flex-shrink-0 overflow-hidden flex items-center justify-center">
          <HomeDashboard />
        </section>

        {/* Screen 1: Weather Breakdown */}
        <section className="w-[100vw] h-full flex-shrink-0 overflow-hidden flex items-center justify-center">
          <WeatherDetails />
        </section>

        {/* Screen 2: Weather Map */}
        <section className="w-[100vw] h-full flex-shrink-0 overflow-y-auto overscroll-contain">
          <WeatherMap activePage={activePage} />
        </section>
      </motion.div>

      {/* On-Screen Directional Navigation Pad */}
      <div className="fixed bottom-24 right-6 z-40 hidden sm:grid grid-cols-3 gap-1.5 select-none">
        <div />

        <button
          onClick={() => setActivePage((prev) => Math.max(prev - 1, 0))}
          disabled={activePage === 0}
          aria-label="Navigate to previous page"
          className="w-10 h-10 rounded-xl bg-[#111215]/80 border border-white/12 text-white/80 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-xl transition-all cursor-pointer"
        >
          ↑
        </button>

        <div />

        <button
          onClick={() => setActivePage((prev) => Math.max(prev - 1, 0))}
          disabled={activePage === 0}
          aria-label="Navigate left"
          className="w-10 h-10 rounded-xl bg-[#111215]/80 border border-white/12 text-white/80 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-xl transition-all cursor-pointer"
        >
          ←
        </button>

        <button
          onClick={() => setActivePage(1)}
          aria-label="Go to weather metrics"
          className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 text-white/90 hover:bg-white/20 backdrop-blur-xl transition-all cursor-pointer"
        >
          •
        </button>

        <button
          onClick={() => setActivePage((prev) => Math.min(prev + 1, 2))}
          disabled={activePage === 2}
          aria-label="Navigate right"
          className="w-10 h-10 rounded-xl bg-[#111215]/80 border border-white/12 text-white/80 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-xl transition-all cursor-pointer"
        >
          →
        </button>

        <div />

        <button
          onClick={() => setActivePage((prev) => Math.min(prev + 1, 2))}
          disabled={activePage === 2}
          aria-label="Navigate to next page"
          className="w-10 h-10 rounded-xl bg-[#111215]/80 border border-white/12 text-white/80 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-xl transition-all cursor-pointer"
        >
          ↓
        </button>

        <div />
      </div>

      {/* Floating Bottom AI Chat Bubble */}
      <MorphingNav />
    </main>
    </LocationProvider>
  );
}
