import nodemailer from "nodemailer";

// Same Gmail SMTP limitation named everywhere else in this build (Decision #21):
// single hardcoded sender, no verified domain, weaker deliverability at volume than
// a real transactional provider would offer. Fine for this project's scale.
function getTransport() {
  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function sendMail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const transport = getTransport();
  if (!transport) {
    return { ok: false, error: "Gmail SMTP is not configured (GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD)." };
  }
  try {
    await transport.sendMail({ from: process.env.GMAIL_SMTP_USER, to, subject, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
