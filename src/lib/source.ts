import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";

// One place that turns the compiled MDX into pages, so the layout, the page
// route and any future search index all read the same tree.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
