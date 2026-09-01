import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
};

// Compiles content/docs/*.mdx and generates the source map Fumadocs reads.
export default createMDX()(nextConfig);
