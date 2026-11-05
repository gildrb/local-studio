import remarkParse from "remark-parse";
import { unified, type PluggableList } from "unified";

/** Parses Markdown into the same transformed mdast tree react-markdown renders from.
    Remark transformers rewrite the tree in place, so the parsed root is the result. */
export function parseMarkdownTree(markdown: string, plugins: PluggableList) {
  const processor = unified().use(remarkParse).use(plugins);
  const tree = processor.parse(markdown);
  processor.runSync(tree);
  return tree;
}
