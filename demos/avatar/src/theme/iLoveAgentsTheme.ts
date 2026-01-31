import { webLightTheme, Theme } from "@fluentui/react-components";

export const brandAccent = "#0078d4"; // Primary color from iLoveAgents Fluent theme

export const iLoveAgentsTheme: Theme = {
  ...webLightTheme,
  colorBrandBackground: brandAccent,
  colorBrandBackground2: brandAccent,
  colorBrandBackgroundHover: "#106ebe",
  colorBrandBackgroundPressed: "#005a9e",
  colorBrandBackgroundSelected: "#106ebe",
  colorBrandForeground1: brandAccent,
  colorBrandForeground2: brandAccent,
  colorBrandForegroundLink: brandAccent,
  colorBrandForegroundOnLight: brandAccent,
  colorBrandForegroundInverted: "#ffffff",
  colorBrandForegroundInvertedHover: "#ffffff",
  colorBrandForegroundLinkPressed: "#005a9e",
  colorBrandForegroundLinkHover: "#106ebe",
  colorBrandStroke1: brandAccent,
  colorBrandStroke2: "#005a9e",
  colorNeutralForegroundOnBrand: "#ffffff",
};
