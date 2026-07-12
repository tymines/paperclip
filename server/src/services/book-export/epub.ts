/**
 * In-process EPUB builder — zero external dependencies.
 *
 * An .epub is just a ZIP archive with a fixed layout:
 *   mimetype                (MUST be the first entry, stored uncompressed)
 *   META-INF/container.xml  (points at the OPF package document)
 *   OEBPS/content.opf       (manifest + spine)
 *   OEBPS/nav.xhtml         (EPUB 3 navigation document)
 *   OEBPS/style.css
 *   OEBPS/chapter-N.xhtml   (one per chapter)
 *
 * We build the ZIP by hand using the STORE method (no compression) so we do
 * not need a zip dependency (none is present in server/package.json). STORE
 * entries are accepted by epubcheck and every reader. The mimetype entry is
 * written first and uncompressed, per the OCF spec.
 *
 * Chapter bodies are lightweight-markdown → XHTML. This is intentionally a
 * small converter (headings, paragraphs, emphasis, rules, blockquotes, simple
 * lists) rather than a full CommonMark implementation — the manuscript prose is
 * plain narrative text, so this keeps output valid XHTML without a markdown lib.
 */

// ── CRC-32 ────────────────────────────────────────────────────────────────
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Minimal STORE-only ZIP writer ───────────────────────────────────────────
interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose bit flag
    local.writeUInt16LE(0, 8); // compression method: 0 = store
    local.writeUInt16LE(0, 10); // last mod file time
    local.writeUInt16LE(0, 12); // last mod file date
    local.writeUInt32LE(crc, 14); // crc-32
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central file header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8); // general purpose bit flag
    central.writeUInt16LE(0, 10); // compression method
    central.writeUInt16LE(0, 12); // last mod file time
    central.writeUInt16LE(0, 14); // last mod file date
    central.writeUInt32LE(crc, 16); // crc-32
    central.writeUInt32LE(size, 20); // compressed size
    central.writeUInt32LE(size, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // file name length
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralOffset = offset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8); // central dir records on this disk
  end.writeUInt16LE(entries.length, 10); // total central dir records
  end.writeUInt32LE(centralDir.length, 12); // size of central dir
  end.writeUInt32LE(centralOffset, 16); // offset of central dir
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, end]);
}

// ── Lightweight markdown → XHTML ────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  let out = escapeXml(text);
  // bold (**text** or __text__) before italics so the single-char rules don't
  // consume the doubled markers.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return out;
}

function markdownToXhtmlBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${inlineMarkdown(paragraph.join(" ").trim())}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>\n${list.map((li) => `  <li>${inlineMarkdown(li)}</li>`).join("\n")}\n</ul>`);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 6);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push("<hr />");
      continue;
    }
    const listItem = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1].trim());
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      flushParagraph();
      blocks.push(`<blockquote><p>${inlineMarkdown(quote[1].trim())}</p></blockquote>`);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}

// ── EPUB assembly ───────────────────────────────────────────────────────────
export interface EpubChapter {
  title: string;
  /** Chapter body in lightweight markdown. */
  markdown: string;
}

export interface BuildEpubOptions {
  title: string;
  author?: string;
  language?: string;
  identifier?: string;
  chapters: EpubChapter[];
}

const STYLE_CSS = `body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; margin: 5%; }
h1, h2, h3 { font-family: Helvetica, Arial, sans-serif; line-height: 1.25; }
h1 { text-align: center; margin-top: 2em; }
p { margin: 0 0 0.9em; text-indent: 1.4em; }
p:first-of-type { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
hr { border: none; border-top: 1px solid #999; margin: 2em auto; width: 40%; }
`;

function chapterXhtml(chapter: EpubChapter): string {
  const body = markdownToXhtmlBody(chapter.markdown || "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
${body}
</body>
</html>`;
}

/**
 * Build a valid EPUB 3 archive entirely in-process and return it as a Buffer.
 * No external tools or npm packages are required.
 */
export function buildEpubBuffer(opts: BuildEpubOptions): Buffer {
  const title = opts.title || "Untitled";
  const author = opts.author || "Unknown Author";
  const language = opts.language || "en";
  const identifier = opts.identifier || `urn:uuid:${cheapUuidFrom(title)}`;
  const chapters = opts.chapters.length
    ? opts.chapters
    : [{ title, markdown: "*[This book has no drafted chapters yet.]*" }];

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const chapterFiles = chapters.map((ch, i) => ({
    id: `chapter-${i + 1}`,
    href: `chapter-${i + 1}.xhtml`,
    title: ch.title || `Chapter ${i + 1}`,
    content: chapterXhtml({ title: ch.title || `Chapter ${i + 1}`, markdown: ch.markdown }),
  }));

  const manifestItems = chapterFiles
    .map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml" />`)
    .join("\n");
  const spineItems = chapterFiles.map((c) => `    <itemref idref="${c.id}" />`).join("\n");

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="style.css" media-type="text/css" />
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;

  const navList = chapterFiles
    .map((c) => `      <li><a href="${c.href}">${escapeXml(c.title)}</a></li>`)
    .join("\n");

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;

  const entries: ZipEntry[] = [
    // mimetype MUST be first and stored uncompressed (we store everything).
    { name: "mimetype", data: Buffer.from("application/epub+zip", "ascii") },
    { name: "META-INF/container.xml", data: Buffer.from(containerXml, "utf-8") },
    { name: "OEBPS/content.opf", data: Buffer.from(contentOpf, "utf-8") },
    { name: "OEBPS/nav.xhtml", data: Buffer.from(navXhtml, "utf-8") },
    { name: "OEBPS/style.css", data: Buffer.from(STYLE_CSS, "utf-8") },
    ...chapterFiles.map((c) => ({ name: `OEBPS/${c.href}`, data: Buffer.from(c.content, "utf-8") })),
  ];

  return buildZip(entries);
}

/** Deterministic pseudo-UUID from a string — avoids importing crypto here and
 *  keeps identical books stable across exports. */
function cheapUuidFrom(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h);
  const b = hex(Math.imul(h ^ 0x9e3779b9, 0x85ebca6b));
  const c = hex(Math.imul(h + seed.length, 0xc2b2ae35));
  return `${a}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${c.slice(4)}${a.slice(0, 4)}`;
}
