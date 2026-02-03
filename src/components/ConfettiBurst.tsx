import React from "react";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  x: number;
  y: number;
  colors: string[];
  active: boolean;
};

type Particle = {
  id: string;
  dx: number;
  dy: number;
  fall: number;
  size: number;
  shape: "rect" | "dot";
  color: string;
  rot: number;
};

function makeParticles(colors: string[]): Particle[] {
  const count = 14;
  const parts: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const up = -1;
    const dx = (Math.random() - 0.5) * 90;        // subtle spread
    const dy = up * (40 + Math.random() * 50);     // up then fall via keyframes
    const size = 3 + Math.random() * 3;
    const fall = 20 + Math.random() * 40;
    const shape = Math.random() < 0.7 ? "rect" : "dot";
    const rot = (Math.random() - 0.5) * 120;
    const color = colors[Math.floor(Math.random() * colors.length)];
    parts.push({
      id: `${i}-${Math.random().toString(16).slice(2)}`,
      dx,
      dy,
      fall,
      size,
      shape,
      color,
      rot,
    });
  }
  return parts;
}

export function ConfettiBurst({ x, y, colors, active }: Props) {
  const particles = React.useMemo(
    () => (active ? makeParticles(colors) : []),
    [colors, active]
  );

  return (
    <AnimatePresence>
      {active && (
        <div className="fixed inset-0 pointer-events-none z-[9999]">
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{
                opacity: 0.9,
                x,
                y,
                rotate: 0,
              }}
              animate={{
                opacity: [0.9, 0.9, 0],
                x: x + p.dx,
                y: [y, y + p.dy, y + p.fall], // gentle fall
                rotate: p.rot,
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.65,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                width: p.shape === "dot" ? p.size : p.size * 2,
                height: p.shape === "dot" ? p.size : Math.max(2, p.size * 0.7),
                borderRadius: p.shape === "dot" ? 999 : 2,
                background: p.color,
              }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
