import { expect, it } from "vitest";
import { decodeEntities } from "./html-extract-utils.js";

// Search snippets and page metadata consume this decoder independently of Markdown.
it.each([
  ["plain &unknown; text", "plain &unknown; text"],
  ["&amp; &lt; &gt; &quot; &apos; &nbsp;", "& < > \" '  "],
  ["&mdash; &ndash; &hellip; &bull;", "— – … •"],
  ["&#169; &#128514; &#x26; &#x1F602;", "© 😂 & 😂"],
  ["&#0; &#x0;", "� �"],
  ["&#55296; &#xD800; &#xDFFF;", "&#55296; &#xD800; &#xDFFF;"],
  ["&#1114112; &#x110000; &#99999999999; &#xFFFFFFFF;", "&#1114112; &#x110000; &#99999999999; &#xFFFFFFFF;"],
])("decodes entities without corrupting invalid scalars: %s", (input, expected) => {
  expect(decodeEntities(input)).toBe(expected);
});
