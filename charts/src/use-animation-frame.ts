"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * High-performance animation loop hook using requestAnimationFrame.
 * Designed for real-time chart updates at target FPS.
 */
export function useAnimationFrame(
  callback: (deltaTime: number) => void,
  active: boolean,
  targetFps: number = 60
) {
  const requestRef = useRef<number>(0);
  const previousTimeRef = useRef<number>(0);
  const intervalMs = 1000 / targetFps;

  const animate = useCallback(
    (time: number) => {
      if (previousTimeRef.current !== 0) {
        const delta = time - previousTimeRef.current;
        if (delta >= intervalMs) {
          callback(delta);
          previousTimeRef.current = time;
        }
      } else {
        previousTimeRef.current = time;
      }
      requestRef.current = requestAnimationFrame(animate);
    },
    [callback, intervalMs]
  );

  useEffect(() => {
    if (active) {
      requestRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(requestRef.current);
    }
    previousTimeRef.current = 0;
  }, [active, animate]);
}

/**
 * Interpolates between two values with configurable smoothing.
 * Used for smooth price transitions in real-time charts.
 */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Spring-based interpolation for more natural price animations.
 * Returns the new value and velocity.
 */
export function springInterpolate(
  current: number,
  target: number,
  velocity: number,
  stiffness: number = 180,
  damping: number = 24,
  dt: number = 1 / 60
): { value: number; velocity: number } {
  const force = -stiffness * (current - target);
  const dampingForce = -damping * velocity;
  const acceleration = force + dampingForce;
  const newVelocity = velocity + acceleration * dt;
  const newValue = current + newVelocity * dt;
  return { value: newValue, velocity: newVelocity };
}
