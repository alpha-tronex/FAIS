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
 * Builds nodemailer transport from env.
 * Supports either:
 * - SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465)
 * - Or SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS (port 465 = SSL, 587 = STARTTLS).
 */
function getSmtpTransport(): nodemailer.Transporter | null {
  const smtpUrl = process.env.SMTP_URL?.trim();
  if (smtpUrl) {
    return nodemailer.createTransport(smtpUrl);
  }
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT ?? '465', 10);
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

/** Sender address. Yahoo (and many SMTP providers) require From to match the authenticated account; default to SMTP_USER when using SMTP_HOST. */
function getFromAddress(): string {
  const explicit = process.env.SMTP_FROM?.trim();
  if (explicit) return explicit;
  const user = process.env.SMTP_USER?.trim();
  if (user) return `FAIS <${user}>`;
  return 'no-reply@localhost';
}

/**
 * Sends an invite email if SMTP is configured.
 *
 * Env:
 * - SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) OR
 * - SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS
 * - SMTP_FROM (e.g. "FAIS <no-reply@example.com>"). For Yahoo, use your Yahoo address or leave unset to use SMTP_USER.
 */
export async function sendInviteEmail(p: InviteEmailParams): Promise<void> {
  const transport = getSmtpTransport();
  const from = getFromAddress();

  const subject = 'FAIS account created';
  const text = formatInviteText(p);

  if (!transport) {
    // Dev-friendly fallback: print the email content.
    console.log('[invite-email] SMTP not configured (set SMTP_URL or SMTP_HOST/USER/PASS); skipping send.');
    console.log('[invite-email] To:', p.to);
    console.log('[invite-email] Subject:', subject);
    console.log(text);
    return;
  }

  await transport.sendMail({ from, to: p.to, subject, text });
}

export type PasswordResetEmailParams = {
  to: string;
  appUrl: string;
  resetToken: string;
};

function formatPasswordResetText(p: PasswordResetEmailParams): string {
  const resetUrl = `${p.appUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(p.resetToken)}`;
  return (
    `You requested a password reset for your FAIS account.\n\n` +
    `Click the link below to set a new password (link expires in 1 hour):\n\n` +
    `${resetUrl}\n\n` +
    `If you did not request this, you can ignore this email.\n`
  );
}

/**
 * Sends a password-reset email with a link containing the token.
 * Uses same SMTP env as invite: SMTP_URL or SMTP_HOST/USER/PASS, and SMTP_FROM.
 */
export async function sendPasswordResetEmail(p: PasswordResetEmailParams): Promise<void> {
  const transport = getSmtpTransport();
  const from = getFromAddress();

  const subject = 'FAIS password reset';
  const text = formatPasswordResetText(p);

  if (!transport) {
    console.log('[password-reset-email] SMTP not configured; skipping send.');
    console.log('[password-reset-email] To:', p.to);
    console.log('[password-reset-email] Subject:', subject);
    console.log(text);
    return;
  }

  await transport.sendMail({ from, to: p.to, subject, text });
}
