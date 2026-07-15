const htmlEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

export function stripHtml(value: string | null | undefined) {
  return (value ?? "").replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/gi, "").trim();
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&([a-zA-Z0-9#]+);/g, (match, entity: string) => {
    return htmlEntities[entity] ?? match;
  });
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "");
}

export function cleanSupportText(value: string | null | undefined) {
  return decodeHtmlEntities(value ?? "")
    .replace(/<mailto:([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<mailto:([^>]+)>/g, "$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_match, id, label) =>
      label ? `@${label}` : `@${id}`,
    )
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMarkdownSection(value: string, heading: string) {
  const lines = value.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  let isInSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (headingPattern.test(trimmedLine)) {
      isInSection = true;
      continue;
    }

    if (isInSection && /^##\s+/.test(trimmedLine)) break;
    if (isInSection) sectionLines.push(line);
  }

  const section = sectionLines
    .map((line) => stripMarkdown(line).trim())
    .filter(Boolean)
    .join(" ");

  return section ? cleanSupportText(section) : null;
}

export function getCardDescriptionPreview(
  description: string | null | undefined,
) {
  if (!description) return "";

  const plainDescription = stripHtml(description);
  if (!plainDescription) return "";

  const supportSummary = extractMarkdownSection(plainDescription, "Summary");
  if (supportSummary) return supportSummary;

  if (/^##\s+Hard Parameters\s*$/im.test(plainDescription)) {
    return "";
  }

  return cleanSupportText(stripMarkdown(plainDescription));
}

export function cleanSupportTitle(title: string) {
  const cleaned = cleanSupportText(stripMarkdown(title));
  return cleaned.replace(/^Slack support:\s*/i, "Slack: ");
}
