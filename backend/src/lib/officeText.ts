import JSZip from "jszip";

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Each entity is decoded once, in a single pass. Decoding "&amp;" first and
 * the others after it turned "&amp;lt;" (the text "&lt;") into "<".
 */
function decodeXml(text: string) {
  return text.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi,
    (match, name?: string, decimal?: string, hex?: string) => {
      if (name) return XML_ENTITIES[name.toLowerCase()] ?? match;
      return String.fromCharCode(
        decimal ? Number(decimal) : Number.parseInt(hex!, 16),
      );
    },
  );
}

function extractTagText(xml: string, tagName: string) {
  const parts: string[] = [];
  const re = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) parts.push(decodeXml(match[1]));
  return parts;
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function readZipText(zip: JSZip, path: string) {
  const entry = zip.file(path);
  return entry ? entry.async("text") : null;
}

export async function extractPresentationText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalSort);

  const slides: string[] = [];
  for (let index = 0; index < slidePaths.length; index++) {
    const xml = await readZipText(zip, slidePaths[index]);
    if (!xml) continue;
    const text = extractTagText(xml, "a:t")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    if (text) slides.push(`## Slide ${index + 1}\n\n${text}`);
  }
  return slides.join("\n\n").trim();
}
