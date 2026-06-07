import { FormEvent, useMemo, useState } from 'react';
import { copyText } from '../utils/clipboard';
import { hasQortalBridge, requestQortal } from '../qdn/qortalClient';

const CONTACT_RECIPIENT_NAME = 'Corbett';

type Notice = {
  type: 'success' | 'error' | 'info';
  message: string;
};

type ContactFormState = {
  senderName: string;
  replyTo: string;
  subject: string;
  message: string;
};

const initialFormState: ContactFormState = {
  senderName: '',
  replyTo: '',
  subject: '',
  message: ''
};

function normalizeSubject(value: string) {
  const trimmed = value.trim();
  return trimmed || 'Message from The Corbett Report Qortal site';
}

function buildDirectMessageBody(form: ContactFormState) {
  const lines = [
    `Subject: ${normalizeSubject(form.subject)}`,
    `Sent via: The Corbett Report Qortal contact form`,
    `Recipient Qortal name: ${CONTACT_RECIPIENT_NAME}`,
    `Sender name: ${form.senderName.trim() || 'Not provided'}`,
    `Reply/contact info: ${form.replyTo.trim() || 'Not provided'}`,
    `Created at: ${new Date().toISOString()}`,
    '',
    form.message.trim()
  ];

  return lines.join('\n');
}

export function ContactPage() {
  const [form, setForm] = useState<ContactFormState>(initialFormState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const directMessageBody = useMemo(() => buildDirectMessageBody(form), [form]);
  const bridgeAvailable = hasQortalBridge();

  function updateField(field: keyof ContactFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function resolveRecipientAddress() {
    const response = await requestQortal<{ name?: string; owner?: string }>({
      action: 'GET_NAME_DATA',
      name: CONTACT_RECIPIENT_NAME
    });

    if (!response || !response.owner) {
      throw new Error(`Qortal name ${CONTACT_RECIPIENT_NAME} was not found.`);
    }

    return response.owner;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = form.message.trim();
    if (!message) {
      setNotice({ type: 'error', message: 'Please write a message before sending.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      if (!bridgeAvailable) {
        setNotice({
          type: 'error',
          message: 'Direct messages can only be sent when this app is opened inside Qortal UI or Qortal Hub.'
        });
        return;
      }

      const recipientAddress = await resolveRecipientAddress();
      await requestQortal({
        action: 'SEND_CHAT_MESSAGE',
        destinationAddress: recipientAddress,
        message: directMessageBody
      });

      setNotice({
        type: 'success',
        message: `Message sent directly to ${CONTACT_RECIPIENT_NAME}.`
      });
      setForm(initialFormState);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to send the direct message.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyPreview() {
    const copied = await copyText(directMessageBody);
    setNotice({
      type: copied ? 'success' : 'error',
      message: copied ? 'Message copied to clipboard.' : 'Unable to copy the message to clipboard.'
    });
  }

  return (
    <section className="page-shell contact-page">
      <article>
        <h1>Contact</h1>
        <p className="contact-intro">
          Send a direct Qortal message to the name <strong>{CONTACT_RECIPIENT_NAME}</strong>. The app resolves that
          name to its current owner address and sends the message through Qortal&apos;s private chat message action.
        </p>

        <form className="contact-form" onSubmit={handleSubmit}>
          <label>
            Your name
            <input
              type="text"
              value={form.senderName}
              onChange={(event) => updateField('senderName', event.target.value)}
              placeholder="Name or Qortal name"
              autoComplete="name"
            />
          </label>

          <label>
            Reply/contact info
            <input
              type="text"
              value={form.replyTo}
              onChange={(event) => updateField('replyTo', event.target.value)}
              placeholder="Qortal name, email, or other contact detail"
              autoComplete="email"
            />
          </label>

          <label>
            Subject
            <input
              type="text"
              value={form.subject}
              onChange={(event) => updateField('subject', event.target.value)}
              placeholder="Message subject"
            />
          </label>

          <label>
            Message
            <textarea
              required
              value={form.message}
              onChange={(event) => updateField('message', event.target.value)}
              placeholder="Write your message"
              rows={8}
            />
          </label>

          <div className="contact-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending message...' : `Send direct message to ${CONTACT_RECIPIENT_NAME}`}
            </button>
            <button type="button" className="secondary" onClick={copyPreview}>
              Copy message
            </button>
          </div>
        </form>

        {notice && <p className={`contact-notice ${notice.type}`} role="status">{notice.message}</p>}

        <aside className="contact-fallback">
          <h2>Manual fallback</h2>
          <p>
            If direct sending is unavailable, copy this prepared message and send it manually to {CONTACT_RECIPIENT_NAME}
            {' '}through Q-Chat or Q-Mail inside Qortal.
          </p>
          <textarea readOnly value={directMessageBody} aria-label="Prepared direct message" />
        </aside>
      </article>
    </section>
  );
}
