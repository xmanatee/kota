/**
 * Nodemailer wrapper — creates and caches a transporter for SMTP sending.
 */

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

export type SmtpConfig = {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
};

export type SendMailOptions = {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
};

export type Mailer = {
  send(opts: SendMailOptions): Promise<void>;
  verify(): Promise<void>;
  close(): void;
};

export function createMailer(smtp: SmtpConfig): Mailer {
  const transportOpts: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port ?? 587,
    secure: smtp.secure ?? false,
    auth: smtp.auth
      ? { user: smtp.auth.user, pass: smtp.auth.pass }
      : undefined,
  };

  const transporter = nodemailer.createTransport(transportOpts);

  return {
    async send(opts) {
      await transporter.sendMail({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      });
    },

    async verify() {
      await transporter.verify();
    },

    close() {
      transporter.close();
    },
  };
}
