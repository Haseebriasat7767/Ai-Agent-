import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep native/heavy server libs out of the bundler so they load at runtime.
  serverExternalPackages: ["pg", "unpdf", "nodemailer", "pdf-lib", "docx"],
  experimental: {
    // Attachments up to 25 MB are accepted by the upload route handler.
    serverActions: { bodySizeLimit: "26mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Production denies framing outright (clickjacking protection — see
          // the security posture section of the README). In development the app
          // is rendered inside the sandbox's preview frame, so the header is
          // omitted there; the production behaviour above is unchanged.
          ...(isProduction ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
      {
        // Private uploads are never publicly cached.
        source: "/api/files/:id/raw",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default config;
