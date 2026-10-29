import Link from "next/link";
export const metadata = { title: "Privacy policy — FlashMail" };
export default function Privacy() {
  return (
    <main className="policy">
      <Link href="/">← Back to FlashMail</Link>
      <h1>Privacy, in plain language.</h1>
      <p>
        FlashMail provides receive-only temporary inboxes without account
        registration.
      </p>
      <h2>What we store</h2>
      <p>
        We store a hashed session token, inbox address, expiration time, and
        incoming messages and attachments. Your browser receives a secure
        HttpOnly session cookie. It is required to access your inbox. No
        advertising cookies or analytics are included.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Inboxes expire after 24 hours by default, or the period configured by
        the operator. Expired inboxes, messages and attachments are removed by a
        worker running every minute. You can delete messages immediately or
        replace your address, which deletes your previous inbox. Operator
        database backups may retain data until their own retention period ends.
      </p>
      <h2>Inbound processing</h2>
      <p>
        The configured email provider processes incoming email before delivering
        it to FlashMail. Its privacy and retention policies also apply. Safe
        HTML viewing strips scripts, links, and remote tracking content.
        Attachments must pass a malware scan, but no scanner can guarantee every
        file is safe.
      </p>
      <h2>Operational data</h2>
      <p>
        Redis stores short-lived rate-limit identifiers, webhook replay
        protection, admin sessions and aggregate counters. Application logs omit
        message content. Hosting and email providers may separately record
        network metadata. Administrators can see inbox addresses and aggregate
        statistics, and can delete abusive inboxes.
      </p>
      <h2>Use responsibly</h2>
      <p>
        Email is not end-to-end encrypted. Do not use temporary inboxes for
        banking, account recovery, sensitive information, or long-term accounts.
        Deleted and expired inboxes cannot be recovered. No email sending is
        supported.
      </p>
    </main>
  );
}
