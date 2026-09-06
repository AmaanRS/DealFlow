import nodemailer from 'nodemailer'
import { config } from './config.js'

let transport

function mailSettings() {
  const settings = {
    host: config.get('mail_host'),
    port: config.get('mail_port'),
    secure: config.get('mail_secure'),
    user: config.get('mail_user'),
    password: config.get('mail_app_password'),
    from: config.get('mail_from'),
  }
  const missing = ['host', 'port', 'user', 'password'].filter(
    (key) => settings[key] === null,
  )

  if (missing.length > 0) {
    const error = new Error(
      `Password-reset email is not configured. Missing: ${missing.join(', ')}.`,
    )
    error.status = 503
    error.code = 'EMAIL_DELIVERY_NOT_CONFIGURED'
    throw error
  }

  return {
    ...settings,
    secure: settings.secure ?? settings.port === 465,
    from: settings.from ?? settings.user,
  }
}

function getTransport(settings) {
  transport ??= nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.password,
    },
  })
  return transport
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function assertPasswordResetEmailConfigured() {
  mailSettings()
}

export async function sendPasswordResetEmail({
  to,
  fullName,
  resetUrl,
  expiresInMinutes,
}) {
  const settings = mailSettings()
  const safeName = escapeHtml(fullName || 'there')
  const safeUrl = escapeHtml(resetUrl)

  return getTransport(settings).sendMail({
    from: settings.from,
    to,
    subject: 'Reset your DealFlow360 password',
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'Use this link to reset your DealFlow360 password:',
      resetUrl,
      '',
      `This one-time link expires in ${expiresInMinutes} minutes.`,
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:560px;margin:auto">
        <h2>Reset your DealFlow360 password</h2>
        <p>Hello ${safeName},</p>
        <p>Use the button below to create a new password.</p>
        <p style="margin:28px 0">
          <a href="${safeUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">Reset password</a>
        </p>
        <p>This one-time link expires in ${expiresInMinutes} minutes.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}
