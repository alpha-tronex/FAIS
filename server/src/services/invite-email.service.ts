import nodemailer from 'nodemailer';

export type InviteEmailParams = {
  to: string;
  uname: string;
  password: string;
  appUrl: string;
};

function formatInviteText(p: InviteEmailParams): string {
  return (
    `Your FAIS account has been created.\n\n` +
    `App: ${p.appUrl}\n` +
    `Username: ${p.uname}\n` +
    `Password: ${p.password}\n\n` +
    `After you log in the first time, you will be prompted to complete registration and reset your password.\n`
  );
}

/**
 * Sends an invite email if SMTP is configured.
 *
 * Env:
 * - SMTP_URL (e.g. smtp://user:pass@smtp.example.com:587)
 * - SMTP_FROM (e.g. "FAIS <no-reply@example.com>")
 */
export async function sendInviteEmail(p: InviteEmailParams): Promise<void> {
  const smtpUrl = process.env.SMTP_URL?.trim();
  const from = process.env.SMTP_FROM?.trim() || 'no-reply@localhost';

  const subject = 'FAIS account created';
  const text = formatInviteText(p);

  if (!smtpUrl) {
    // Dev-friendly fallback: print the email content.
    console.log('[invite-email] SMTP_URL not configured; skipping send.');
    console.log('[invite-email] To:', p.to);
    console.log('[invite-email] Subject:', subject);
    console.log(text);
    return;
  }

  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({ from, to: p.to, subject, text });
}
