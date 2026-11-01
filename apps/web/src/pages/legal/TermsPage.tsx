import { Link } from 'react-router-dom';
import LegalLayout, { LegalContact, type LegalSection } from './LegalLayout';
import { operatorName } from './legalConfig';

/* Keep this true of the product. No prices here, and no promise of uptime, rating acceptance or endorsement. */

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'These terms',
    body: (
      <>
        <p>
          These terms are an agreement between you and {operatorName()} (&ldquo;we&rdquo;), who run Chess
          Alokas. They cover the website, the desktop app, the mobile app, floor scoring pages and public
          pages. By using Chess Alokas, you agree to them. If you don&apos;t agree, don&apos;t use it.
        </p>
        <p>
          If you use Chess Alokas for an academy, club or school, you confirm that you may accept these
          terms for it. Anyone under 18 needs a parent or guardian to accept for them.
        </p>
        <p>
          The <Link to="/privacy">Privacy Policy</Link> explains how we handle personal data.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'What Chess Alokas does',
    body: (
      <p>
        Chess Alokas helps people run chess tournaments: rosters, registration, pairings, results,
        standings, public pages and certificates. We can change, add or remove features. We will try to
        give notice of a change that seriously affects paying organizers.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts',
    body: (
      <ul>
        <li>You sign in with your email address, using a password or an email code.</li>
        <li>Give accurate details, and keep your email address working.</li>
        <li>Keep your password and codes private. You are responsible for what happens on your account.</li>
        <li>
          Owners and admins are responsible for who they invite and which role they give. Remove staff
          who no longer need access.
        </li>
        <li>
          Treat round PINs, floor sessions and invite links like passwords. A live link can be seen by
          anyone who has it.
        </li>
      </ul>
    ),
  },
  {
    id: 'plans',
    title: 'Trial and paid plans',
    body: (
      <>
        <p>
          <strong>Trial.</strong> A new academy starts on a free trial while we review it. The trial allows
          one active tournament and up to 24 players per tournament, and new tournaments can be started
          for 14 days. It can&apos;t take paid entries or list events publicly. Sign-up doesn&apos;t ask for
          a card.
        </p>
        <p>
          <strong>Verification.</strong> We decide whether to verify an academy, and may ask for
          information to do so. We can refuse or withdraw verification. Verification only unlocks
          features. It isn&apos;t our endorsement of an academy or an event.
        </p>
        <p>
          <strong>Paid plans.</strong> We tell you the price, limits and length of a plan before you buy.
          These are agreed with you when you buy, and that agreement applies alongside these terms. There
          is no online checkout today. You pay us by the method we give you, and you are responsible for
          any taxes on your side.
        </p>
        <p>
          <strong>Refunds.</strong> Plan fees are refundable only as agreed when you buy or as the law
          requires.
        </p>
        <p>
          Player and parent accounts don&apos;t need a plan.
        </p>
      </>
    ),
  },
  {
    id: 'organizers',
    title: 'Organizers are responsible for their events',
    body: (
      <>
        <p>
          We provide tools. We don&apos;t run, sanction or supervise events. If you are an organizer, you
          are responsible for:
        </p>
        <ul>
          <li>Your event: its rules, eligibility, prizes, schedule, venue, safety and any cancellation.</li>
          <li>Arbiting decisions, and handling disputes with players and parents.</li>
          <li>Checking rosters, pairings, results, standings and certificates before relying on them.</li>
          <li>
            Personal data you collect or upload. You must tell people how it is used, have the right to
            upload it, and have a parent&apos;s or guardian&apos;s consent for anyone under 18.
          </li>
          <li>
            Collecting only what your event needs. Don&apos;t collect IC or passport numbers, health
            details or similar sensitive data through Chess Alokas.
          </li>
          <li>
            Deciding whether to turn on a public live page, which shows players&apos; names, including
            children&apos;s.
          </li>
          <li>Keeping your own copies of records you need. See section 9.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'money',
    title: 'Entry fees',
    body: (
      <>
        <p>
          Entry money goes straight from the parent or player to the organizer, by DuitNow or bank transfer,
          using the details the organizer publishes. Chess Alokas has no payment gateway. We don&apos;t
          collect, hold, transfer or refund entry fees, and we take no share of them.
        </p>
        <p>
          Approving a receipt is the organizer&apos;s own check. We don&apos;t verify receipts or payments.
          Questions about an entry fee or a refund go to the organizer, who is responsible for them.
        </p>
        <p>
          Parents and players: check that you trust the organizer before you pay. If an event looks fake,
          tell us. <LegalContact />
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <>
        <p>Don&apos;t use Chess Alokas to:</p>
        <ul>
          <li>Create fake events, or collect money or data under false pretences.</li>
          <li>Upload personal data you have no right to share, or anything unlawful, abusive or misleading.</li>
          <li>Enter false results, or tamper with an event you aren&apos;t authorized to manage.</li>
          <li>Pretend to be someone else, or share a child&apos;s data for anything other than their chess events.</li>
          <li>Get around plan limits, security or access controls, or guess PINs and links.</li>
          <li>Upload malware, overload the service, or scrape it, including public pages.</li>
          <li>Send unwanted email through certificate or invite features.</li>
          <li>Copy or resell the service, or reverse engineer it, except where the law allows.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'pairings',
    title: 'Pairings, ratings and FIDE',
    body: (
      <>
        <p>
          Chess Alokas offers a built-in Swiss engine, and FIDE Dutch Swiss pairing using bbpPairings, a
          separate Dutch-system pairing program made by others. Pairings depend on the data entered and on
          software that can contain errors.
        </p>
        <ul>
          <li>We don&apos;t guarantee that a pairing, tiebreak or standing is correct or follows any rule set.</li>
          <li>
            We don&apos;t guarantee that FIDE, the Malaysian Chess Federation or any other body will accept
            an event, its pairings or its results for rating. Check their requirements first.
          </li>
          <li>Chess Alokas doesn&apos;t currently export TRF tournament reports.</li>
          <li>Chess Alokas isn&apos;t endorsed by FIDE or any chess federation.</li>
          <li>The arbiter&apos;s decision at the event is the organizer&apos;s responsibility, not ours.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'offline',
    title: 'Offline use and availability',
    body: (
      <>
        <p>
          Chess Alokas is designed so the desk keeps working without internet after you have signed in
          online on that device. Some things always need a connection, including FIDE Dutch pairing in the
          browser and on macOS, floor PINs, QR stickers, sync and public pages.
        </p>
        <p>
          We don&apos;t promise that the service will always be available, error-free or fast. It relies on
          your device, the venue&apos;s internet and providers we don&apos;t control. Local data can be lost
          if a browser is cleared or a device fails. When two devices change the same record offline, the
          most recent change usually wins.
        </p>
        <p>
          <strong>Have a fallback for event day</strong>, such as paper pairings, and keep your own copies of
          anything important. We don&apos;t promise that we can restore lost data.
        </p>
        <p>
          Desktop builds aren&apos;t code-signed yet, so your system may warn you when you install them.
          Download them only from links on our site.
        </p>
      </>
    ),
  },
  {
    id: 'content',
    title: 'Your content and our software',
    body: (
      <>
        <p>
          You keep your rights in what you put into Chess Alokas. You let us store, copy and display it as
          needed to run the service, including on public pages you turn on and in emails you send through
          it.
        </p>
        <p>
          We and our licensors own the software, its design and the Chess Alokas name. You may use them
          only to use the service. Third-party components, including bbpPairings, come under their own
          licences.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Limits on our liability',
    body: (
      <>
        <p>
          Chess Alokas is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. As far as the law
          allows, we give no promises other than those in these terms.
        </p>
        <p>As far as the law allows:</p>
        <ul>
          <li>
            We aren&apos;t liable for indirect or consequential loss, or for lost profit, entry fees, prizes,
            ratings, reputation or data.
          </li>
          <li>
            We aren&apos;t liable for an organizer&apos;s event, decisions, conduct or handling of money, or
            for a provider&apos;s failure that we couldn&apos;t reasonably control.
          </li>
          <li>
            Our total liability for all claims is limited to what you paid us for the service in the 12 months
            before the claim. If you paid nothing, that amount is zero.
          </li>
        </ul>
        <p>
          Nothing here removes rights or liability that the law doesn&apos;t allow us to exclude or limit,
          including rights a consumer has under Malaysian law.
        </p>
        <p>
          If someone makes a claim against us because of your event, your data or your breach of these terms,
          you will cover our reasonable losses, as far as the law allows.
        </p>
      </>
    ),
  },
  {
    id: 'ending',
    title: 'Suspension and ending',
    body: (
      <>
        <p>
          You can stop using Chess Alokas at any time, and can delete your account on the Account page on the
          website. Deleting an account doesn&apos;t erase everything. The{' '}
          <Link to="/privacy#retention">Privacy Policy</Link> says what stays.
        </p>
        <p>
          We can suspend or close an account, an academy or an event if you breach these terms, if we
          reasonably suspect fraud or harm, or if the law requires it. We will try to give notice unless
          that would be unsafe or unlawful, and we will try not to interrupt an event that is running unless
          we have a serious reason.
        </p>
        <p>
          We can end the service with reasonable notice. Sections that by their nature should continue, such
          as limits on liability, continue after these terms end.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may change these terms and will update the date at the top. If a change is significant, we will
        try to tell you on the site or by email. If you keep using Chess Alokas after a change, you accept the
        new terms. A change doesn&apos;t alter a plan you have already paid for until that plan ends, unless
        the law requires it.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: (
      <p>
        These terms are governed by the laws of Malaysia. Disputes go to the courts of Malaysia. Please
        contact us first so we can try to resolve the problem.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        {operatorName()[0]!.toUpperCase() + operatorName().slice(1)}. <LegalContact />
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      path="/terms"
      summary={
        <>
          <h2>The short version</h2>
          <ul>
            <li>Organizers are responsible for their events and the data they upload.</li>
            <li>Entry money goes straight to organizers. We hold no funds.</li>
            <li>Check pairings and results. We don&apos;t guarantee them or their acceptance for rating.</li>
            <li>Chess Alokas isn&apos;t endorsed by FIDE.</li>
            <li>We don&apos;t promise constant availability. Keep a fallback for event day.</li>
            <li>Malaysian law applies.</li>
          </ul>
        </>
      }
      sections={SECTIONS}
    />
  );
}
