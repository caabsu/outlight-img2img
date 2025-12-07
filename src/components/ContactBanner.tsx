"use client";

import { useState } from "react";

// ============ CONFIGURATION TYPES ============

export type TextStyle = {
  fontSize: string;      // e.g., "2rem", "24px", "1.5rem"
  fontWeight: string;    // e.g., "400", "600", "bold"
  color: string;         // e.g., "#ffffff", "white", "rgb(255,255,255)"
  fontFamily?: string;   // e.g., "Georgia, serif"
  lineHeight?: string;   // e.g., "1.4", "1.6"
  letterSpacing?: string; // e.g., "0.02em"
};

export type ButtonStyle = {
  backgroundColor: string;
  textColor: string;
  hoverBackgroundColor?: string;
  hoverTextColor?: string;
  borderRadius?: string;  // e.g., "8px", "0.5rem"
  paddingX?: string;      // e.g., "2rem", "32px"
  paddingY?: string;      // e.g., "0.75rem", "12px"
  fontSize?: string;
  fontWeight?: string;
};

export type ContactBannerConfig = {
  // Background
  backgroundImage: string;  // URL or path to image
  backgroundBlur: number;   // 0-20 px blur amount
  overlayOpacity?: number;  // 0-1, optional dark overlay

  // Container
  containerMaxWidth?: string;  // e.g., "800px"
  containerPadding?: { desktop: string; mobile: string };
  containerBorderRadius?: string;
  containerBackgroundColor?: string; // e.g., "rgba(255,255,255,0.1)"
  containerBackdropBlur?: number;    // blur for the glass effect

  // Heading text
  heading: string;
  headingStyle: { desktop: TextStyle; mobile: TextStyle };

  // Subheading text
  subheading: string;
  subheadingStyle: { desktop: TextStyle; mobile: TextStyle };

  // Button
  buttonText: string;
  buttonLink?: string;
  buttonStyle: { desktop: ButtonStyle; mobile: ButtonStyle };

  // Footer text (e.g., "Average wait: 2 mins")
  footerText?: string;
  footerStyle?: { desktop: TextStyle; mobile: TextStyle };

  // Section height
  sectionHeight?: { desktop: string; mobile: string };
};

// ============ DEFAULT CONFIGURATION ============

export const defaultContactBannerConfig: ContactBannerConfig = {
  backgroundImage: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80",
  backgroundBlur: 8,
  overlayOpacity: 0.3,

  containerMaxWidth: "900px",
  containerPadding: { desktop: "3rem 4rem", mobile: "1.5rem 1.25rem" },
  containerBorderRadius: "16px",
  containerBackgroundColor: "rgba(255, 255, 255, 0.12)",
  containerBackdropBlur: 12,

  heading: "We're here for you.",
  headingStyle: {
    desktop: {
      fontSize: "2.25rem",
      fontWeight: "400",
      color: "#ffffff",
      fontFamily: "Georgia, 'Times New Roman', serif",
      lineHeight: "1.2",
    },
    mobile: {
      fontSize: "1.5rem",
      fontWeight: "400",
      color: "#ffffff",
      fontFamily: "Georgia, 'Times New Roman', serif",
      lineHeight: "1.2",
    },
  },

  subheading: "Whether it's tracking an order or choosing the right finish, our team is ready to help you layer your light.",
  subheadingStyle: {
    desktop: {
      fontSize: "1rem",
      fontWeight: "300",
      color: "rgba(255, 255, 255, 0.85)",
      lineHeight: "1.6",
    },
    mobile: {
      fontSize: "0.875rem",
      fontWeight: "300",
      color: "rgba(255, 255, 255, 0.85)",
      lineHeight: "1.5",
    },
  },

  buttonText: "Contact Us",
  buttonLink: "/contact",
  buttonStyle: {
    desktop: {
      backgroundColor: "#d4874c",
      textColor: "#ffffff",
      hoverBackgroundColor: "#c47a42",
      borderRadius: "6px",
      paddingX: "2.5rem",
      paddingY: "0.875rem",
      fontSize: "1rem",
      fontWeight: "500",
    },
    mobile: {
      backgroundColor: "#d4874c",
      textColor: "#ffffff",
      hoverBackgroundColor: "#c47a42",
      borderRadius: "6px",
      paddingX: "2rem",
      paddingY: "0.75rem",
      fontSize: "0.875rem",
      fontWeight: "500",
    },
  },

  footerText: "Average wait: 2 mins",
  footerStyle: {
    desktop: {
      fontSize: "0.8rem",
      fontWeight: "400",
      color: "rgba(255, 255, 255, 0.7)",
    },
    mobile: {
      fontSize: "0.75rem",
      fontWeight: "400",
      color: "rgba(255, 255, 255, 0.7)",
    },
  },

  sectionHeight: { desktop: "280px", mobile: "auto" },
};

// ============ COMPONENT ============

type ContactBannerProps = {
  config?: Partial<ContactBannerConfig>;
  onButtonClick?: () => void;
};

export function ContactBanner({ config: customConfig, onButtonClick }: ContactBannerProps) {
  const config = { ...defaultContactBannerConfig, ...customConfig };
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (onButtonClick) {
      onButtonClick();
    } else if (config.buttonLink) {
      window.location.href = config.buttonLink;
    }
  };

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{
        minHeight: config.sectionHeight?.desktop,
      }}
    >
      {/* Background Image with Blur */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${config.backgroundImage})`,
          filter: `blur(${config.backgroundBlur}px)`,
          transform: "scale(1.1)", // Prevent blur edge artifacts
        }}
      />

      {/* Optional Dark Overlay */}
      {config.overlayOpacity && config.overlayOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0, 0, 0, ${config.overlayOpacity})` }}
        />
      )}

      {/* Content Container */}
      <div
        className="relative z-10 flex items-center justify-center w-full h-full"
        style={{
          minHeight: config.sectionHeight?.desktop,
          padding: "2rem 1rem",
        }}
      >
        {/* Glass Card */}
        <div
          className="w-full flex flex-col md:flex-row items-center md:items-center justify-between gap-6 md:gap-8"
          style={{
            maxWidth: config.containerMaxWidth,
            padding: config.containerPadding?.desktop,
            borderRadius: config.containerBorderRadius,
            backgroundColor: config.containerBackgroundColor,
            backdropFilter: config.containerBackdropBlur ? `blur(${config.containerBackdropBlur}px)` : undefined,
            WebkitBackdropFilter: config.containerBackdropBlur ? `blur(${config.containerBackdropBlur}px)` : undefined,
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          {/* Text Content */}
          <div className="flex-1 text-center md:text-left">
            {/* Heading - Desktop */}
            <h2
              className="hidden md:block mb-3"
              style={{
                fontSize: config.headingStyle.desktop.fontSize,
                fontWeight: config.headingStyle.desktop.fontWeight,
                color: config.headingStyle.desktop.color,
                fontFamily: config.headingStyle.desktop.fontFamily,
                lineHeight: config.headingStyle.desktop.lineHeight,
                letterSpacing: config.headingStyle.desktop.letterSpacing,
              }}
            >
              {config.heading}
            </h2>
            {/* Heading - Mobile */}
            <h2
              className="md:hidden mb-2"
              style={{
                fontSize: config.headingStyle.mobile.fontSize,
                fontWeight: config.headingStyle.mobile.fontWeight,
                color: config.headingStyle.mobile.color,
                fontFamily: config.headingStyle.mobile.fontFamily,
                lineHeight: config.headingStyle.mobile.lineHeight,
                letterSpacing: config.headingStyle.mobile.letterSpacing,
              }}
            >
              {config.heading}
            </h2>

            {/* Subheading - Desktop */}
            <p
              className="hidden md:block"
              style={{
                fontSize: config.subheadingStyle.desktop.fontSize,
                fontWeight: config.subheadingStyle.desktop.fontWeight,
                color: config.subheadingStyle.desktop.color,
                fontFamily: config.subheadingStyle.desktop.fontFamily,
                lineHeight: config.subheadingStyle.desktop.lineHeight,
                letterSpacing: config.subheadingStyle.desktop.letterSpacing,
                maxWidth: "500px",
              }}
            >
              {config.subheading}
            </p>
            {/* Subheading - Mobile */}
            <p
              className="md:hidden"
              style={{
                fontSize: config.subheadingStyle.mobile.fontSize,
                fontWeight: config.subheadingStyle.mobile.fontWeight,
                color: config.subheadingStyle.mobile.color,
                fontFamily: config.subheadingStyle.mobile.fontFamily,
                lineHeight: config.subheadingStyle.mobile.lineHeight,
                letterSpacing: config.subheadingStyle.mobile.letterSpacing,
              }}
            >
              {config.subheading}
            </p>
          </div>

          {/* Button Section */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            {/* Button - Desktop */}
            <button
              className="hidden md:block transition-colors duration-200 cursor-pointer"
              onClick={handleClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              style={{
                backgroundColor: isHovered
                  ? (config.buttonStyle.desktop.hoverBackgroundColor || config.buttonStyle.desktop.backgroundColor)
                  : config.buttonStyle.desktop.backgroundColor,
                color: isHovered
                  ? (config.buttonStyle.desktop.hoverTextColor || config.buttonStyle.desktop.textColor)
                  : config.buttonStyle.desktop.textColor,
                borderRadius: config.buttonStyle.desktop.borderRadius,
                padding: `${config.buttonStyle.desktop.paddingY} ${config.buttonStyle.desktop.paddingX}`,
                fontSize: config.buttonStyle.desktop.fontSize,
                fontWeight: config.buttonStyle.desktop.fontWeight,
                border: "none",
                minWidth: "160px",
              }}
            >
              {config.buttonText}
            </button>
            {/* Button - Mobile */}
            <button
              className="md:hidden transition-colors duration-200 cursor-pointer w-full"
              onClick={handleClick}
              style={{
                backgroundColor: config.buttonStyle.mobile.backgroundColor,
                color: config.buttonStyle.mobile.textColor,
                borderRadius: config.buttonStyle.mobile.borderRadius,
                padding: `${config.buttonStyle.mobile.paddingY} ${config.buttonStyle.mobile.paddingX}`,
                fontSize: config.buttonStyle.mobile.fontSize,
                fontWeight: config.buttonStyle.mobile.fontWeight,
                border: "none",
              }}
            >
              {config.buttonText}
            </button>

            {/* Footer Text */}
            {config.footerText && (
              <>
                {/* Desktop */}
                <span
                  className="hidden md:block mt-1"
                  style={{
                    fontSize: config.footerStyle?.desktop.fontSize,
                    fontWeight: config.footerStyle?.desktop.fontWeight,
                    color: config.footerStyle?.desktop.color,
                    fontFamily: config.footerStyle?.desktop.fontFamily,
                  }}
                >
                  {config.footerText}
                </span>
                {/* Mobile */}
                <span
                  className="md:hidden mt-1"
                  style={{
                    fontSize: config.footerStyle?.mobile.fontSize,
                    fontWeight: config.footerStyle?.mobile.fontWeight,
                    color: config.footerStyle?.mobile.color,
                    fontFamily: config.footerStyle?.mobile.fontFamily,
                  }}
                >
                  {config.footerText}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile-specific height override */}
      <style jsx>{`
        @media (max-width: 768px) {
          section {
            min-height: ${config.sectionHeight?.mobile} !important;
          }
          section > div:nth-child(3) {
            min-height: ${config.sectionHeight?.mobile} !important;
            padding: 1.5rem 1rem !important;
          }
          section > div:nth-child(3) > div {
            padding: ${config.containerPadding?.mobile} !important;
          }
        }
      `}</style>
    </section>
  );
}

// ============ EXAMPLE USAGE ============
/*
import { ContactBanner, ContactBannerConfig } from "@/components/ContactBanner";

// Use with defaults:
<ContactBanner />

// Use with custom config:
const myConfig: Partial<ContactBannerConfig> = {
  backgroundImage: "/my-image.jpg",
  backgroundBlur: 12,
  heading: "Need Help?",
  headingStyle: {
    desktop: { fontSize: "3rem", fontWeight: "700", color: "#fff" },
    mobile: { fontSize: "1.75rem", fontWeight: "700", color: "#fff" },
  },
  buttonStyle: {
    desktop: { backgroundColor: "#3b82f6", textColor: "#fff", borderRadius: "9999px", paddingX: "3rem", paddingY: "1rem" },
    mobile: { backgroundColor: "#3b82f6", textColor: "#fff", borderRadius: "9999px", paddingX: "2rem", paddingY: "0.75rem" },
  },
};

<ContactBanner config={myConfig} onButtonClick={() => console.log("clicked!")} />
*/
