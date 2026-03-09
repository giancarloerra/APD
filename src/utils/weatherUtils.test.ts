import { describe, it, expect } from "vitest";
import {
  calculateAstrophotographyScore,
  getScoreLabel,
  getScoreColor,
} from "./weatherUtils";

describe("calculateAstrophotographyScore", () => {
  it("returns 100 for perfect conditions (0% cloud, 0% precipitation)", () => {
    expect(calculateAstrophotographyScore(0, 0)).toBe(100);
  });

  it("returns 0 for worst conditions (100% cloud, 100% precipitation)", () => {
    expect(calculateAstrophotographyScore(100, 100)).toBe(0);
  });

  it("never goes below 0", () => {
    expect(calculateAstrophotographyScore(200, 200)).toBe(0);
  });

  it("applies correct weight for cloud cover", () => {
    // 50% cloud → -40 points, 0% precip → 0 penalty = 60
    expect(calculateAstrophotographyScore(50, 0)).toBe(60);
  });

  it("applies correct weight for precipitation", () => {
    // 0% cloud → 0 penalty, 50% precip → -10 points = 90
    expect(calculateAstrophotographyScore(0, 50)).toBe(90);
  });

  it("returns an integer", () => {
    const score = calculateAstrophotographyScore(33, 17);
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe("getScoreLabel", () => {
  it("labels 100 as Excellent", () => expect(getScoreLabel(100)).toBe("Excellent"));
  it("labels 90 as Excellent", () => expect(getScoreLabel(90)).toBe("Excellent"));
  it("labels 89 as Very Good", () => expect(getScoreLabel(89)).toBe("Very Good"));
  it("labels 75 as Very Good", () => expect(getScoreLabel(75)).toBe("Very Good"));
  it("labels 74 as Good", () => expect(getScoreLabel(74)).toBe("Good"));
  it("labels 60 as Good", () => expect(getScoreLabel(60)).toBe("Good"));
  it("labels 59 as Fair", () => expect(getScoreLabel(59)).toBe("Fair"));
  it("labels 45 as Fair", () => expect(getScoreLabel(45)).toBe("Fair"));
  it("labels 44 as Poor", () => expect(getScoreLabel(44)).toBe("Poor"));
  it("labels 30 as Poor", () => expect(getScoreLabel(30)).toBe("Poor"));
  it("labels 29 as Very Poor", () => expect(getScoreLabel(29)).toBe("Very Poor"));
  it("labels 0 as Very Poor", () => expect(getScoreLabel(0)).toBe("Very Poor"));
});

describe("getScoreColor", () => {
  it("returns emerald colour for ≥90", () => {
    expect(getScoreColor(95)).toContain("emerald");
  });
  it("returns green colour for ≥75 and <90", () => {
    expect(getScoreColor(80)).toContain("green");
  });
  it("returns yellow colour for ≥60 and <75", () => {
    expect(getScoreColor(65)).toContain("yellow");
  });
  it("returns orange colour for ≥45 and <60", () => {
    expect(getScoreColor(50)).toContain("orange");
  });
  it("returns red colour for ≥30 and <45", () => {
    expect(getScoreColor(35)).toContain("red");
  });
  it("returns red-600 colour for <30", () => {
    expect(getScoreColor(10)).toContain("red-600");
  });
});
