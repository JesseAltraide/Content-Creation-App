import { marked } from "marked";

// The adaptation tool asks the model for `body_markdown`, and the send passed that
// straight into nodemailer's `text` field. So every subscriber received the markdown
// itself: literal asterisks around what should have been bold, and hashes where
// headings were meant to be. The model was right, the transport was wrong.
//
// Fixed at the send rather than by telling the model to stop writing markdown,
// because markdown is the correct thing for it to produce: it renders properly on
// the page, it is what the evaluator reads, and a newsletter that cannot use a
// heading or a bolded phrase is a worse newsletter.
//
// Every email gets both parts. The HTML is what almost everyone sees; the plain text
// is the fallback for clients that refuse HTML, and it has the markup stripped rather
// than left in, which is the bug this fixes.

// Inlined, because email clients drop <style> blocks and have no CSS cascade worth
// relying on. Deliberately plain: system fonts, generous line height, no fixed
// colours beyond a readable grey, so it survives dark mode instead of fighting it.
const STYLES: Record<string, string> = {
  p: "margin:0 0 16px 0;line-height:1.6;",
  h1: "margin:28px 0 12px 0;font-size:22px;line-height:1.3;",
  h2: "margin:24px 0 10px 0;font-size:18px;line-height:1.3;",
  h3: "margin:20px 0 8px 0;font-size:16px;line-height:1.3;",
  ul: "margin:0 0 16px 0;padding-left:22px;",
  ol: "margin:0 0 16px 0;padding-left:22px;",
  li: "margin:0 0 6px 0;line-height:1.6;",
  blockquote: "margin:0 0 16px 0;padding-left:14px;border-left:3px solid #d4d4d8;color:#52525b;",
  a: "color:#4f46e5;",
};

function inlineStyles(html: string): string {
  return html.replace(/<(p|h1|h2|h3|ul|ol|li|blockquote|a)(\s|>)/g, (_m, tag: string, next: string) => {
    const style = STYLES[tag];
    const attrs = next === ">" ? "" : " ";
    return `<${tag} style="${style}"${attrs}${next === ">" ? ">" : ""}`;
  });
}

/** Markdown to the plain text a fallback client should show: markup removed, not left in. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "- ")
    .trim();
}

export function newsletterHtml(bodyMarkdown: string, unsubscribeUrl: string): string {
  const rendered = inlineStyles(marked.parse(bodyMarkdown, { async: false }) as string);

  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    // A table, not a div with max-width: Outlook ignores max-width on block elements,
    // and this is the one layout construct every client honours.
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;">',
    '<tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#18181b;">',
    rendered,
    '<hr style="border:none;border-top:1px solid #e4e4e7;margin:28px 0 16px 0;" />',
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;">You are receiving this because you subscribed. <a href="${unsubscribeUrl}" style="color:#71717a;">Unsubscribe</a>.</p>`,
    "</td></tr></table>",
    "</td></tr></table></body></html>",
  ].join("");
}
