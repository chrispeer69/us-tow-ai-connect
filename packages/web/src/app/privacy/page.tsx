import Link from "next/link";
import { Phone } from "lucide-react";

export const metadata = {
  title: "Privacy Policy · US Tow AI-Connect",
  description:
    "How US Tow AI-Connect collects, uses, and protects personal information.",
};

export default function PrivacyPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 z-30 bg-background/70 backdrop-blur-xl">
        <div className="container flex items-center justify-between h-16 lg:h-20">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight tracking-tight">
                US Tow AI-Connect
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-medium">
                By Blue Collar AI
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="container max-w-3xl py-16 leading-relaxed">
        <h1 className="text-4xl font-black tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: June 12, 2026</p>

        <section className="space-y-6 text-base text-muted-foreground">
          <p>
            US Tow AI-Connect is operated by Blue Collar AI for towing companies and
            roadside-service providers. This Privacy Policy explains what information
            we collect, how we use it, and how SMS consent is handled.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">1. Who we are</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>Service name: US Tow AI-Connect.</li>
            <li>Operator: Blue Collar AI.</li>
            <li>Mailing address: 731 Mulberry St, Columbus, OH 43215.</li>
            <li>Contact email: alerts@ustowdispatch.com.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">2. Information we collect</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>Business information, including company name, address, email, and phone number.</li>
            <li>Account information, including user names, login activity, and dashboard actions.</li>
            <li>Dispatch information, including job details, vehicle details, pickup/drop-off addresses, ETAs, and driver assignments.</li>
            <li>Caller information, including name, phone number, call audio, transcripts, service needs, and location details shared during calls.</li>
            <li>Integration credentials provided by customers for connected dispatch or towing-management systems.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">3. How we use information</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>To answer inbound calls and place authorized outbound calls.</li>
            <li>To send dispatch updates, service notifications, reports, and support messages.</li>
            <li>To populate dispatch records and help towing companies manage jobs.</li>
            <li>To operate, secure, audit, bill, and improve the service.</li>
            <li>We do not sell customer, caller, or SMS consent data.</li>
            <li>We do not use customer call data or credentials to train general-purpose AI models.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">4. SMS consent and messaging</h2>
          <p>
            US Tow AI-Connect sends informational and transactional SMS messages only
            to registered business users, company staff, and service contacts who have
            provided a phone number for account, dispatch, reporting, or service
            communications.
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              Users opt in by providing their mobile phone number during account
              registration, onboarding, company setup, or service intake and by
              agreeing to receive SMS notifications. Any SMS consent checkbox is not
              pre-checked.
            </li>
            <li>
              Messages may include dispatch updates, service follow-ups, support
              messages, account notifications, report notifications, and service links.
            </li>
            <li>SMS consent is not required as a condition of purchasing the service.</li>
            <li>Message frequency varies. Message and data rates may apply.</li>
            <li>Reply STOP, CANCEL, END, QUIT, UNSUBSCRIBE, or STOPALL to unsubscribe.</li>
            <li>Reply START or YES to resubscribe after opting out.</li>
            <li>Reply HELP or INFO for help.</li>
            <li>
              SMS opt-in consent, phone numbers, and text-message consent are not
              sold, rented, or shared with third parties or affiliates for marketing
              or promotional purposes.
            </li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">5. SMS examples</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              US Tow AI-Connect: Your daily dispatch report is ready. Reply HELP for
              help, STOP to unsubscribe. Msg&Data rates may apply.
            </li>
            <li>
              US Tow AI-Connect: Your account profile was updated. If this was not
              you, contact support at alerts@ustowdispatch.com. Reply STOP to opt out.
            </li>
            <li>
              US Tow AI-Connect: Scheduled maintenance is planned tonight at 11 PM ET.
              Reply HELP for help, STOP to unsubscribe.
            </li>
            <li>
              US Tow AI-Connect: New service report available in your dashboard.
              Reply STOP to unsubscribe.
            </li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">6. Service providers</h2>
          <p>We use trusted service providers only to operate the product:</p>
          <ul className="ml-6 mt-2 list-disc space-y-1">
            <li>Railway: hosting, database, and Redis cache.</li>
            <li>Twilio: SMS and telephony.</li>
            <li>SendGrid: transactional email.</li>
            <li>Stripe: payment processing.</li>
            <li>Google Cloud: maps, geocoding, and Places data.</li>
            <li>Thinkrr / Retell or other configured voice providers: AI voice calls.</li>
            <li>Sentry: error monitoring.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">7. Data protection</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>Production traffic is protected using TLS.</li>
            <li>Integration credentials are encrypted at rest.</li>
            <li>Administrative access is restricted and logged.</li>
            <li>We retain operational data only as needed to provide the service, meet legal obligations, resolve disputes, and maintain security.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">8. Your choices</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>You may request access, correction, or deletion of account information by emailing alerts@ustowdispatch.com.</li>
            <li>You may opt out of SMS messages by replying STOP.</li>
            <li>You may request help by replying HELP or contacting alerts@ustowdispatch.com.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">9. Children</h2>
          <p>
            The service is intended for business use only. We do not knowingly collect
            personal information from anyone under the age of eighteen.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">10. Call recording</h2>
          <p>
            Calls handled by the AI phone attendant may be recorded and transcribed
            for dispatch, quality, audit, and support purposes. Towing companies are
            responsible for using any required call-recording notices in their
            jurisdiction.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">11. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post the
            updated policy on this page and update the "Last updated" date.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">12. Contact</h2>
          <p>
            Questions about this Privacy Policy should be directed to
            alerts@ustowdispatch.com or by mail to Blue Collar AI, 731 Mulberry St,
            Columbus, OH 43215.
          </p>
        </section>

        <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            ← Back to home
          </Link>
        </footer>
      </main>
    </div>
  );
}
