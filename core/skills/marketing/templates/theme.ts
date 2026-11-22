import { loadFont } from "@remotion/google-fonts/GoogleSans";
import { loadFont as loadMono } from "@remotion/google-fonts/GoogleSansCode";
import { Easing } from "remotion";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

export const { fontFamily: monoFamily } = loadMono("normal", {
  weights: ["500"],
  subsets: ["latin"],
});

export const C = {
  bg: "#0C0B1E",
  bg2: "rgba(255,255,255,0.05)",
  card: "#1C1E26",
  line: "rgba(255,255,255,0.10)",
  text: "#F5F6FA",
  mute: "#9BA0AE",
  blue: "#4C8DFF",
  blueSoft: "#A8C7FA",
  violet: "#9B7BFF",
  green: "#34C466",
  greenSoft: "#8BE0A4",
  yellow: "#FBBC04",
  red: "#FF5A4E",
  redSoft: "#FFB4AE",
};

export const GRADIENT =
  "linear-gradient(100deg, #7FB2FF 0%, #A58CFF 45%, #6EE7A8 100%)";

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
