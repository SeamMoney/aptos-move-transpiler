import { describe, it, expect } from "vitest";

describe("package exports", () => {
  it("exports all chart components", async () => {
    const mod = await import("../index");
    expect(mod.CandlestickChart).toBeDefined();
    expect(mod.TickerLineChart).toBeDefined();
  });

  it("exports supporting components", async () => {
    const mod = await import("../index");
    expect(mod.ChartGrid).toBeDefined();
    expect(mod.ChartTooltip).toBeDefined();
    expect(mod.Crosshair).toBeDefined();
    expect(mod.PriceLine).toBeDefined();
    expect(mod.TooltipDot).toBeDefined();
    expect(mod.PriceAxis).toBeDefined();
    expect(mod.TimeAxis).toBeDefined();
    expect(mod.CurrentPriceLabel).toBeDefined();
    expect(mod.VolumeBars).toBeDefined();
  });

  it("exports context and hooks", async () => {
    const mod = await import("../index");
    expect(mod.ChartProvider).toBeDefined();
    expect(mod.useChart).toBeDefined();
    expect(mod.chartCssVars).toBeDefined();
    expect(mod.useAnimationFrame).toBeDefined();
    expect(mod.lerp).toBeDefined();
    expect(mod.springInterpolate).toBeDefined();
  });

  it("exports data generators", async () => {
    const mod = await import("../index");
    expect(mod.generateOHLCData).toBeDefined();
    expect(mod.generateTickerData).toBeDefined();
    expect(mod.createPriceStream).toBeDefined();
  });

  it("exports theming utilities", async () => {
    const mod = await import("../index");
    expect(mod.cssVars).toBeDefined();
    expect(mod.darkThemeVars).toBeDefined();
    expect(mod.lightThemeVars).toBeDefined();
    expect(typeof mod.cssVars.bullish).toBe("string");
    expect(typeof mod.cssVars.bearish).toBe("string");
    expect(typeof mod.darkThemeVars).toBe("string");
  });

  it("exports Liveline canvas chart", async () => {
    const mod = await import("../index");
    expect(mod.Liveline).toBeDefined();
  });
});
