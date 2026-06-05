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
        <p className="text-sm text-muted-foreground mb-10">Last updated: May 27, 2026</p>

        <section className="space-y-6 text-base text-muted-foreground">
          <p>
            US Tow AI-Connect is operated by Blue Collar AI on behalf of the US Tow
            Alliance. This Privacy Policy describes the personal information we
            collect, how we use it, the third parties we share it with, and the rights
            you have over your data. By creating an account, using the dashboard, or
            allowing our AI phone attendant to answer calls on your behalf, you agree
            to this Privacy Policy.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">1. Who we are</h2>
          <p>
            US Tow AI-Connect ("we," "us," or "our") is a software-as-a-service product
            owned and operated by Blue Collar AI, an Ohio company. Our mailing address
            is 731 Mulberry St, Columbus, OH 43215. Our primary email contact for
            privacy questions is privacy@bluecollarai.online.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            2. Information we collect from towing-company customers
          </h2>
          <p>
            When you sign up your towing company for US Tow AI-Connect, we collect: the
            company's legal and operating names, address, primary phone number, billing
            email, owner or contact name, and US Tow Alliance membership status. We
            collect the credentials you provide for any towing-management software you
            ask us to connect to, such as Towbook, TowLogs, Omadi, or your AAA Club
            Alliance contractor portal. We collect payment information through Stripe;
            we do not store full card numbers on our servers.
          </p>
          <p>
            We collect every API request, dashboard action, and call event generated
            through your account, along with the IP address and user-agent of the
            device that initiated each action. We use this information to operate the
            service, to bill you accurately, to respond to support requests, and to
            audit security events.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            3. Information we collect from your customers (callers)
          </h2>
          <p>
            When a caller reaches the AI phone attendant we operate on your behalf, we
            receive the caller's phone number, the audio of the conversation, a written
            transcript of the conversation, and any personal information the caller
            voluntarily shares (such as name, vehicle, pickup location, drop-off
            location, and the reason for the tow). We store this information so you can
            review and audit calls, so we can populate your dispatch records, and so we
            can improve the accuracy of the AI agent over time. We do not sell caller
            data.
          </p>
          <p>
            For inbound and outbound calls placed through the voice engine, we and our
            voice-engine partner (Thinkrr, operated by G$D) process the audio and
            transcript. For SMS messages we send on your behalf (status updates, flip
            notifications, CONVINI links), we and our telephony partner (Twilio)
            process the message body and recipient number.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            4. Information we collect from third-party systems
          </h2>
          <p>
            With your authorization and using the credentials you provide, we connect
            to your towing-management software (Towbook, TowLogs, Omadi, Dispatch
            Anywhere) and motor-club portals (such as AAA Club Alliance) to read active
            job data, ETAs, driver assignments, and customer contact information. We
            use this data solely to power your AI phone attendant, your dispatch board,
            and your outbound confirmation calls. We do not share this data with any
            third party other than the sub-processors listed below, and we do not
            retain it longer than necessary to provide the service.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">5. How we use information</h2>
          <p>
            We use the information we collect to operate the service, to authenticate
            users, to bill you, to send service notifications, to populate the AI
            agent's knowledge of your business so it can answer calls accurately, to
            power outbound confirmation and flip calls, to send SMS notifications to
            you and your customers, to investigate security incidents, to comply with
            legal obligations, and to improve the product. We do not use your customer
            data, your credentials, or your call data to train any general-purpose AI
            model owned by us or any third party.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            6. How we protect information
          </h2>
          <p>
            All credentials you provide for towing-management software and motor-club
            portals are encrypted at rest using AES-256-GCM with a tenant-scoped key.
            Access to production data is restricted to a small number of administrators
            and is logged. Production traffic uses TLS 1.2 or higher. We use rate
            limiting, IP allow-listing, and audit logging on every administrative
            endpoint. We host the service on Railway with managed PostgreSQL and Redis.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">7. Sub-processors</h2>
          <p>
            We share information with the following sub-processors strictly to provide
            the service. Each sub-processor is contractually obligated to protect the
            information we share.
          </p>
          <ul className="ml-6 mt-2 list-disc space-y-1">
            <li>Railway (US-based) — hosting, database, Redis cache.</li>
            <li>Stripe (US-based) — payment processing.</li>
            <li>Twilio (US-based) — SMS and telephony.</li>
            <li>Thinkrr / G$D — AI voice engine for inbound and outbound calls.</li>
            <li>SendGrid (US-based) — transactional email.</li>
            <li>
              Google Cloud (US-based) — Places API and Geocoding API for destination
              classification.
            </li>
            <li>Sentry (US-based) — error monitoring.</li>
          </ul>

          <h2 className="mt-10 text-2xl font-bold text-foreground">8. Data retention</h2>
          <p>
            We retain operational data (call logs, transcripts, dispatch records, audit
            logs) for the term of your subscription plus ninety days unless you request
            earlier deletion. We retain financial records for as long as required by
            tax and accounting law. We delete encrypted credentials immediately upon
            disconnection of the corresponding integration.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">9. Your rights</h2>
          <p>
            You may request a copy of the information we hold about your account, ask
            us to correct inaccuracies, or ask us to delete your account and associated
            data, by emailing privacy@bluecollarai.online. If you are a California
            resident, you have additional rights under the California Consumer Privacy
            Act (CCPA); if you are a resident of the European Union or the United
            Kingdom, you have additional rights under the General Data Protection
            Regulation (GDPR). We respond to verified rights requests within thirty
            days.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">10. Children</h2>
          <p>
            The service is intended for business use only. We do not knowingly collect
            personal information from anyone under the age of eighteen.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">11. Recording disclosure</h2>
          <p>
            Calls handled by the AI phone attendant are recorded and transcribed. The
            AI agent discloses that it is an AI when asked directly. If your
            jurisdiction requires two-party consent for call recording, you are
            responsible for configuring the agent's greeting to include an appropriate
            consent notice. We provide a default consent template in the agent's
            settings.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">12. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post the
            updated policy on this page and update the "Last updated" date. Material
            changes will be communicated by email to the primary contact on file at
            least thirty days before they take effect.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">13. Contact</h2>
          <p>
            Questions about this Privacy Policy should be directed to
            privacy@bluecollarai.online or by mail to Blue Collar AI, 731 Mulberry St,
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
