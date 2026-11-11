function normalizeLines(content) {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

function isDivider(line) {
  return /^[-=]{3,}\s*$/.test(line.trim());
}

function isHeading(line) {
  return /^\d+\.\s+/.test(line.trim()) || /^[A-Z]\.\s+/.test(line.trim());
}

function formatDocument(content) {
  const lines = normalizeLines(content);
  const blocks = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isDivider(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    if (/^(Last Updated|Effective Date):/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "metadata", text: line });
      continue;
    }
    if (isHeading(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: /^\d+\./.test(line) ? "section" : "subsection", text: line });
      continue;
    }
    if (list.length) {
      list[list.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function LegalDocument({ title, content }) {
  const blocks = formatDocument(content);
  const sourceTitle = blocks[0]?.type === "paragraph" ? blocks.shift().text : title;

  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="mb-10 border-b border-border pb-8 sm:mb-12">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Brokerage AI · Legal
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{sourceTitle}</p>
      </header>
      <div className="space-y-6 text-[0.9375rem] leading-7 text-muted-foreground sm:text-base sm:leading-8">
        {blocks.map((block, index) => {
          if (block.type === "section") {
            return (
              <h2 key={index} className="!mb-0 !mt-10 font-display text-xl font-semibold leading-snug text-foreground sm:text-2xl">
                {block.text}
              </h2>
            );
          }
          if (block.type === "subsection") {
            return (
              <h3 key={index} className="!mb-0 !mt-7 font-semibold leading-snug text-foreground">
                {block.text}
              </h3>
            );
          }
          if (block.type === "metadata") {
            return <p key={index} className="!mb-0 text-sm">{block.text}</p>;
          }
          if (block.type === "list") {
            return (
              <ul key={index} className="list-disc space-y-2 pl-6 marker:text-brand">
                {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{item}</li>)}
              </ul>
            );
          }
          return <p key={index}>{block.text}</p>;
        })}
      </div>
    </article>
  );
}
