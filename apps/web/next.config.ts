import { randomUUID } from "node:crypto";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const buildRevision = randomUUID();
const nextConfig: NextConfig = {
    transpilePackages: ["@reader/epub"],
};

export default withSerwistInit({
    swSrc: "src/app/sw.ts",
    swDest: "public/sw.js",
    disable: process.env.NODE_ENV === "development",
    additionalPrecacheEntries: [
        { url: "/", revision: buildRevision },
        { url: "/offline/read", revision: buildRevision },
    ],
})(nextConfig);
