import Link from "next/link";
import { Phone } from "lucide-react";

export const metadata = {
  title: "Terms of Service · US Tow AI-Connect",
  description: "Terms governing your use of the US Tow AI-Connect service.",
};

export default function TermsPage() {
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
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="container max-w-3xl py-16 leading-relaxed">
        <h1 className="text-4xl font-black tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: May 27, 2026</p>

        <section className="space-y-6 text-base text-muted-foreground">
          <p>
            These Terms of Service ("Terms") govern your access to and use of US Tow
            AI-Connect (the "Service"), operated by Blue Collar AI on behalf of the US
            Tow Alliance. By creating an account, subscribing to the Service, or using
            any feature of the Service, you agree to be bound by these Terms. If you do
            not agree, do not use the Service.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">1. Eligibility</h2>
          <p>
            You may use the Service only if you are at least eighteen years old, can
            form a binding contract under the laws of the United States, and are
            authorized to bind the towing company on whose behalf you create an
            account. You represent that the company you sign up is a lawful towing or
            roadside-service business in good standing.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">2. The Service</h2>
          <p>
            US Tow AI-Connect provides a multi-tenant software platform that includes
            an AI phone attendant, an outbound confirmation and flip engine, a dispatch
            dashboard, integrations with third-party towing-management software and
            motor-club portals, SMS notifications, and reporting. We may add, modify,
            or remove features at any time. Some features are available only on certain
            subscription tiers, only to verified US Tow Alliance members, or only after
            additional sub-processor agreements are in place.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            3. Account, credentials, and authorization
          </h2>
          <p>
            You are responsible for all activity that occurs under your account. You
            agree to keep your login credentials confidential and to notify us
            immediately of any unauthorized access. When you provide credentials for a
            third-party system such as Towbook or AAA Club Alliance, you represent that
            you are authorized to share those credentials with us and that we are
            authorized to access the corresponding system on your behalf for the
            purpose of operating the Service.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">4. Acceptable use</h2>
          <p>
            You agree not to (a) use the Service to violate any law, regulation, or
            third-party right, (b) attempt to gain unauthorized access to any portion
            of the Service or any other tenant's data, (c) use the Service to send
            spam, unsolicited messages, or content that violates the Telephone Consumer
            Protection Act (TCPA), CAN-SPAM, or any other applicable communications
            law, (d) impersonate any person or misrepresent your affiliation with any
            organization, or (e) interfere with the operation of the Service, including
            by scraping, automating, or reverse-engineering any part of it without our
            written permission. You are solely responsible for obtaining all consents
            required by law for the calls and SMS messages we send on your behalf.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            5. AI phone attendant — limitations and your responsibilities
          </h2>
          <p>
            The AI phone attendant we provide is designed to handle common inbound and
            outbound calls accurately, but it is not a substitute for human judgment.
            The agent may misclassify an issue, mishear a caller, or quote a price
            incorrectly if your knowledge pack is out of date. You are responsible for
            keeping your knowledge pack accurate, for monitoring the agent's call log,
            and for correcting any errors before they cause harm. You agree to
            indemnify us for losses caused by errors in the knowledge pack you provide
            or by your failure to monitor the agent's behavior.
          </p>
          <p>
            By default, all calls handled by the agent are recorded and transcribed for
            quality, training, and dispute resolution. If your jurisdiction requires
            two-party consent for call recording, you are responsible for configuring
            the agent's greeting to include the appropriate consent notice.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            6. Outbound calls and the flip engine
          </h2>
          <p>
            The Service includes an outbound confirmation and flip engine that
            automatically places calls to customers identified by your dispatch
            software or motor-club portal. You acknowledge that you are the sole
            determining party in the decision to place outbound calls and that you are
            responsible for ensuring those calls comply with TCPA, state telemarketing
            laws, and your contracts with motor clubs and other third parties. We
            provide tools — such as the AAA-branded hard guardrail, the per-tenant
            blocklist, and the confidence-gated category exclusions — to help you stay
            compliant, but the ultimate responsibility for compliance lies with you.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            7. Subscriptions, billing, and refunds
          </h2>
          <p>
            Subscription fees are billed in advance through Stripe at the rate
            disclosed at the time of purchase. Per-minute usage is metered and billed
            on the cycle indicated in your plan. We may change prices for new billing
            cycles with at least thirty days' notice. All fees are non-refundable
            except where required by law. If a payment fails, we may suspend the
            Service after a five-day grace period until the payment is resolved.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            8. US Tow Alliance ownership offering
          </h2>
          <p>
            US Tow Alliance offers, separately from the Service, the opportunity for
            verified towing-business owners to purchase equity in solutions built and
            owned by the Alliance. Eligibility, share price, share cap, dividends, and
            all other terms are governed exclusively by the subscription agreement
            signed by the shareholder and US Tow Alliance, and not by these Terms.
            Nothing in these Terms grants any ownership interest in the Service or in
            US Tow Alliance.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            9. Intellectual property
          </h2>
          <p>
            We own the Service, including all software, designs, content, trademarks,
            and trade secrets. We grant you a limited, non-exclusive, non-transferable
            license to use the Service for the duration of your subscription, solely
            for the purpose of operating your towing business. You may not sublicense,
            resell, white-label, or otherwise exploit the Service without our written
            permission.
          </p>
          <p>
            Data you upload or generate through the Service (including call
            transcripts, dispatch data, and customer contact information) remains
            yours. You grant us a non-exclusive license to process and store that data
            solely for the purpose of providing the Service to you.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            10. Third-party services
          </h2>
          <p>
            The Service relies on third-party providers for hosting, telephony, AI
            voice processing, payments, and other functions. Your use of the Service is
            also subject to the terms of those providers (Stripe, Twilio, Thinkrr /
            G$D, Railway, Google Cloud, SendGrid, Sentry). We are not responsible for
            outages, data loss, or other failures caused by those providers.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            11. Service-level expectations
          </h2>
          <p>
            We target ninety-nine point five percent availability for the Service
            measured monthly, excluding scheduled maintenance, third-party outages, and
            force-majeure events. We do not commit to formal SLAs unless they are
            stated in a separate signed agreement.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            12. Suspension and termination
          </h2>
          <p>
            We may suspend or terminate your account at any time for non-payment, for
            breach of these Terms, or for activity we reasonably believe to be illegal,
            fraudulent, or harmful to the Service or to other users. You may cancel
            your subscription at any time from the dashboard; cancellation takes effect
            at the end of the current billing period. Upon termination, we will disable
            your account and, within ninety days, delete the data associated with it
            (subject to legal retention requirements).
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            13. Disclaimer of warranties
          </h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." WE DISCLAIM ALL
            WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
            THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF SECURITY
            VULNERABILITIES.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            14. Limitation of liability
          </h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL CUMULATIVE LIABILITY
            ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE WILL NOT EXCEED
            THE GREATER OF (A) THE FEES YOU PAID US IN THE TWELVE MONTHS BEFORE THE
            EVENT GIVING RISE TO THE CLAIM OR (B) ONE HUNDRED DOLLARS. WE WILL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY
            DAMAGES, INCLUDING LOST PROFITS OR LOST REVENUE, EVEN IF WE HAVE BEEN
            ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">15. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless Blue Collar AI, the US
            Tow Alliance, and our officers, employees, and agents from any claim, loss,
            liability, or expense (including reasonable attorneys' fees) arising out of
            (a) your use of the Service, (b) your breach of these Terms, (c) your
            violation of any law or third-party right, including TCPA and any contract
            with a motor club, or (d) the content or accuracy of the knowledge pack you
            provide.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            16. Governing law and dispute resolution
          </h2>
          <p>
            These Terms are governed by the laws of the State of Ohio, without regard
            to its conflict-of-laws principles. Any dispute arising out of or relating
            to these Terms or the Service will be resolved by binding arbitration
            administered by the American Arbitration Association under its Commercial
            Arbitration Rules, seated in Franklin County, Ohio. Each party waives any
            right to a jury trial and to participate in a class action.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            17. Changes to these Terms
          </h2>
          <p>
            We may update these Terms from time to time. We will post the updated Terms
            on this page and update the "Last updated" date. Material changes will be
            communicated by email to the primary contact on file at least thirty days
            before they take effect. Continued use of the Service after the effective
            date constitutes acceptance of the updated Terms.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">
            18. Entire agreement
          </h2>
          <p>
            These Terms, together with the Privacy Policy and any signed order form or
            addendum, constitute the entire agreement between you and us regarding the
            Service and supersede all prior agreements and understandings.
          </p>

          <h2 className="mt-10 text-2xl font-bold text-foreground">19. Contact</h2>
          <p>
            Questions about these Terms should be directed to legal@bluecollarai.online
            or by mail to Blue Collar AI, 731 Mulberry St, Columbus, OH 43215.
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
