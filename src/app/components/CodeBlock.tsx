"use client";

import styles from "../uni.module.css";

// Lightweight regex tokenizer for the three shapes of static code shown on
// the landing page (JSON responses, cURL requests, HTTP-header-then-JSON
// webhook payloads) - no syntax-highlighting library needed for a handful
// of hand-authored snippets that never change at runtime.
type Tok = { text: string; cls?: string };

function tokenizeJson(src: string): Tok[] {
  const re = /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\b\d+\.?\d*\b|\btrue\b|\bfalse\b|\bnull\b|[{}[\]:,]/g;
  const toks: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) toks.push({ text: src.slice(last, m.index) });
    const matched = m[0];
    let cls = "tokPunct";
    if (matched === "true" || matched === "false" || matched === "null") cls = "tokBool";
    else if (/^-?\d/.test(matched)) cls = "tokNum";
    else if (matched.startsWith('"')) {
      const isKey = /^\s*:/.test(src.slice(re.lastIndex));
      cls = isKey ? "tokKey" : "tokString";
    }
    toks.push({ text: matched, cls });
    last = re.lastIndex;
  }
  if (last < src.length) toks.push({ text: src.slice(last) });
  return toks;
}

function tokenizeBash(src: string): Tok[] {
  const re = /\bcurl\b|https?:\/\/[^\s'"\\]+|"(?:[^"\\]|\\.)*"|-{1,2}[A-Za-z][A-Za-z-]*/g;
  const toks: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) toks.push({ text: src.slice(last, m.index) });
    const matched = m[0];
    let cls = "tokFlag";
    if (matched === "curl") cls = "tokKeyword";
    else if (matched.startsWith("http")) cls = "tokUrl";
    else if (matched.startsWith('"')) cls = "tokString";
    toks.push({ text: matched, cls });
    last = re.lastIndex;
  }
  if (last < src.length) toks.push({ text: src.slice(last) });
  return toks;
}

function tokenizeHttp(src: string): Tok[] {
  const blankIdx = src.indexOf("\n\n");
  if (blankIdx === -1) return tokenizeJson(src);
  const head = src.slice(0, blankIdx);
  const rest = src.slice(blankIdx);
  const toks: Tok[] = [];
  head.split("\n").forEach((line, i) => {
    if (i > 0) toks.push({ text: "\n" });
    const method = line.match(/^(GET|POST|PUT|DELETE|PATCH)\b/);
    if (method) {
      toks.push({ text: method[1], cls: "tokKeyword" });
      toks.push({ text: line.slice(method[1].length) });
      return;
    }
    const header = line.match(/^([A-Za-z][A-Za-z0-9-]*):/);
    if (header) {
      toks.push({ text: header[1], cls: "tokKey" });
      toks.push({ text: line.slice(header[1].length) });
      return;
    }
    toks.push({ text: line });
  });
  toks.push(...tokenizeJson(rest));
  return toks;
}

export default function CodeBlock({ code, lang }: { code: string; lang: "json" | "bash" | "http" }) {
  const toks = lang === "json" ? tokenizeJson(code) : lang === "bash" ? tokenizeBash(code) : tokenizeHttp(code);
  return (
    <pre className={styles.demoCode}>
      <code>
        {toks.map((t, i) => (t.cls ? <span key={i} className={styles[t.cls]}>{t.text}</span> : <span key={i}>{t.text}</span>))}
      </code>
    </pre>
  );
}
