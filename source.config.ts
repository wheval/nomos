import { defineDocs, defineConfig } from "fumadocs-mdx/config";

// Docs content lives in content/docs as MDX. Frontmatter (title, description)
// drives the sidebar, the page header and the generated llms.txt.
export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
