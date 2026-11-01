import { Link } from 'react-router-dom';
import LegalLayout, { LegalContact, LegalTable, type LegalSection } from './LegalLayout';
import { operatorName, providerLocation } from './legalConfig';

/*
 * Written from what the code does, not from a template. If behaviour changes (retention, deletion,
 * consent, what public routes return), change this page in the same commit and update the date in
 * legalConfig.ts. Do not claim PDPA or GDPR compliance, certification or deletion that doesn't happen.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are and who this covers',
    body: (
      <>
        <p>
          Chess Alokas is tournament software. It is run by {operatorName()}, called &ldquo;we&rdquo;
          on this page. <LegalContact />
        </p>
        <p>
          This page covers the website at chess-manager.alokas.com, the desktop app, the mobile app,
          floor scoring pages, public live pages and the venue TV screen. It applies to organizers and
          their staff, arbiters, players, parents and guardians, and anyone visiting the site.
        </p>
      </>
    ),
  },
  {
    id: 'roles',
    title: 'Organizers, parents and us',
    body: (
      <>
        <p>
          <strong>Organizers run events.</strong> An organizer or academy decides who plays, what goes
          on the roster, whether to import a player list, whether to approve an entry, and whether to
          turn on a public live page. For event data, we generally act on the organizer&apos;s behalf.
          Ask the organizer first about an event&apos;s data, including how they use it outside Chess
          Alokas. If you can&apos;t reach them, contact us.
        </p>
        <p>
          <strong>Organizers have duties of their own.</strong> They must tell players and parents how
          event data is used, and must have permission to upload it, including a parent&apos;s or
          guardian&apos;s consent for anyone under 18.
        </p>
        <p>
          <strong>We decide how some data is used ourselves.</strong> This covers accounts, player and
          family profiles, academy verification, usage statistics, error reports and security.
        </p>
        <p>
          <strong>Parents and guardians</strong> often enter a child&apos;s details. See section 3.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <>
        <p>
          Many players are under 18, so we hold children&apos;s personal data, including names, year of
          birth and school.
        </p>
        <p>
          A parent or guardian should create any account and submit any registration for a child under
          18. When you enter a child&apos;s details, you are telling us that you are their parent or
          guardian, or that you have that person&apos;s permission, and that you accept this page on
          the child&apos;s behalf.
        </p>
        <p>
          <strong>What we record.</strong> A registration for someone under 18, or with no age given,
          and a child&apos;s profile need a tick confirming you are the parent or guardian, or have
          their permission. We record when that happened and which version of this page applied. An
          organizer importing a roster must confirm they have permission, and we record who confirmed
          and when.
        </p>
        <div className="lg-note">
          <p>
            <strong>What this doesn&apos;t do.</strong> We don&apos;t check anyone&apos;s age or
            identity, or that the person ticking really is a parent or guardian. Ages are what people
            enter. On a roster import, the organizer confirms for the whole list, and no parent takes
            part in Chess Alokas. A roster typed in by hand, or a registration approved by an organizer,
            has no separate confirmation step.
          </p>
        </div>
        <p>
          If you are a parent and think a child&apos;s data is here without your permission, contact
          the organizer or us. See section 12.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <LegalTable
          caption="Types of personal data and when they are collected."
          head={['Type', 'What it includes', 'Where it comes from']}
          rows={[
            [
              'Account',
              'Email address, password (handled by our sign-in provider, Supabase), display name, whether you are a player, an organizer or both, and sign-in records.',
              'You, when you sign up and sign in.',
            ],
            [
              'Academy',
              'Academy name, description, logo, website, contact email and phone, city and state, payment instructions and payment QR.',
              'The organizer.',
            ],
            [
              'Team',
              'An invited person’s email and role, who invited them, and each member’s confirmed email and display name.',
              'The owner or admin, and the member.',
            ],
            [
              'Player and family profile',
              'Full name, username, relationship to you, date or year of birth, gender, FIDE ID and ratings, school, club, city, state, country, email and phone.',
              'You, or a parent or coach.',
            ],
            [
              'Event registration',
              'Name, age, year of birth, gender, FIDE ID, rating, school, club, city, state, country, email, phone, chosen category, any answers to extra questions on that event’s form, and status and reviewer notes. We keep this as a copy made when the form is sent.',
              'The person registering.',
            ],
            [
              'Payment receipt',
              'The file you upload: PNG, JPEG, WebP or PDF. It may show names, bank details, amounts and references. We also keep the amount due and the payment status.',
              'The person registering.',
            ],
            [
              'Roster',
              'The registration details above, or whichever of them an organizer imports or types, plus seed, check-in, absences and withdrawals.',
              'The organizer, or an approved registration.',
            ],
            [
              'Games',
              'Pairings, results and standings, warnings and illegal moves, and a record of result changes.',
              'The organizer and arbiters.',
            ],
            [
              'Floor scoring',
              'The name an arbiter types, the results they enter, and any note sent when calling the chief arbiter.',
              'The arbiter.',
            ],
            [
              'Certificates',
              'Recipient name and email, rank, category, serial number, the PDF itself, and whether it was emailed.',
              'The organizer and tournament results.',
            ],
            [
              'FIDE list',
              'Name, federation, birth year, title, sex and ratings, used to look up players.',
              'FIDE’s public rating list.',
            ],
            [
              'Usage statistics',
              'Page path (with any live link, invite link or table link removed), a one-way hash of the live link, page type, the tournament, the referring site, browser details and time. For downloads and the desktop app: event, operating system, app version, language, time zone and a hashed random install ID. These records don’t store your IP address or link to your account.',
              'Your browser or app.',
            ],
            [
              'Server logs',
              'IP address, web address requested and time. Our application removes coordinates, searches and link secrets from the address before writing it, and limits its logs to about 50 MB per service, overwriting older lines. The proxy in front of our server may record the full address.',
              'Your browser or app.',
            ],
            [
              'Error reports',
              'Technical details of a crash or error. See section 8.',
              'Your browser or app, and our server.',
            ],
          ]}
        />
        <h3>ID numbers</h3>
        <p>
          Our forms don&apos;t ask for IC or passport numbers. Our database and server still have a
          field that can hold a national ID on a player profile. Please don&apos;t put an ID number in
          any name, note or answer box.
        </p>
        <h3>Location</h3>
        <p>
          Near me on the Find a tournament page asks your browser for your location, and only if you
          press it. The coordinates go to our server to sort events by distance. We don&apos;t save
          them in the database, and our application removes them from its logs. The proxy in front
          of our server may still record them. The mobile app can do the same with
          your approximate location, if you allow it. Organizers can publish a venue&apos;s
          address and coordinates.
        </p>
        <h3>What you must give us</h3>
        <p>
          An account needs an email address and a password or email code. A registration needs the
          player&apos;s name. Other fields are voluntary for us, but an organizer may need them to accept
          an entry or place a player in a category. A paid entry normally needs a receipt, or the
          organizer has to confirm payment another way. Without what&apos;s required, you can&apos;t
          create the account or complete the entry.
        </p>
      </>
    ),
  },
  {
    id: 'why',
    title: 'Why we use it',
    body: (
      <ul>
        <li>To run tournaments: rosters, pairings, results, standings and certificates.</li>
        <li>To handle registrations and let organizers check payment receipts.</li>
        <li>To show the public pages an organizer turns on.</li>
        <li>To provide accounts, family profiles, match information and tournament history.</li>
        <li>To send sign-in emails, team invites and certificates.</li>
        <li>To review academies, apply plan limits and act on misuse.</li>
        <li>To keep the service secure, fix errors and see which features are used.</li>
      </ul>
    ),
  },
  {
    id: 'public',
    title: 'What is shown publicly',
    body: (
      <>
        <p>
          <strong>Children&apos;s names can appear on these pages.</strong> Anyone with the link can
          see them. There is no password, and a link can be passed on.
        </p>
        <LegalTable
          caption="What each public page shows and does not show."
          head={['Page', 'Shows', 'When']}
          rows={[
            [
              'Live page and venue TV',
              'Tournament name and date. Player names, ratings, seed, city, state, country and category. Pairings, results, standings, and counts of warnings and illegal moves.',
              'When the organizer turns on the public live page.',
            ],
            [
              'Event and registration page',
              'Organizer name, event details, venue, entry fee, payment instructions and QR. Names, ratings, FIDE IDs and categories of players on the roster.',
              'When the organizer sets up a registration link.',
            ],
            [
              'Find a tournament',
              'Event name, organizer, venue and location.',
              'When a verified organizer lists the event.',
            ],
          ]}
        />
        <p>
          These pages don&apos;t show email addresses, phone numbers, school, club, age or year of
          birth. Receipts and certificates are not public. Floor pages show player names only after an
          arbiter enters the round PIN.
        </p>
        <p>
          A single player can&apos;t hide their name with a setting. If you want a name removed or
          changed, ask the organizer. We don&apos;t promise that search engines or other people
          won&apos;t copy what a public page has shown.
        </p>
      </>
    ),
  },
  {
    id: 'access',
    title: 'Who can see private data',
    body: (
      <ul>
        <li>
          <strong>The organizer and their team</strong> can see their event&apos;s registrations,
          contact details and receipts, according to their role.
        </li>
        <li>
          <strong>Arbiters using a round PIN</strong> can see boards and player names for that round.
        </li>
        <li>
          <strong>People who run Chess Alokas</strong> can see academy details and usage statistics in
          our admin tools. They can also reach stored data when needed for support, security or fixing
          faults.
        </li>
        <li>
          <strong>Our service providers</strong> handle data for us. See section 8.
        </li>
        <li>
          <strong>Authorities</strong> may receive data where the law requires it, or to protect
          people&apos;s rights and safety.
        </li>
      </ul>
    ),
  },
  {
    id: 'providers',
    title: 'Service providers and transfers abroad',
    body: (
      <>
        <LegalTable
          caption="Service providers, what they do and where they store data."
          head={['Provider', 'What it does', 'Location']}
          rows={[
            [
              'Supabase',
              'Database, sign-in and file storage. This holds almost everything on this page, including receipts and certificates.',
              providerLocation('supabase'),
            ],
            [
              'Hostinger',
              'The server that runs the website and our API, and holds server logs.',
              providerLocation('hostinger'),
            ],
            [
              'Resend',
              'Sends certificate and invite emails, and sign-in emails if set up for them. It receives the address, the message and any attached certificate.',
              providerLocation('resend'),
            ],
            [
              'Sentry',
              'Error reports and performance samples.',
              providerLocation('sentry'),
            ],
            [
              'GitHub',
              'Hosts desktop downloads and update checks. The landing page also asks it for the latest version. It receives your IP address when you do these things.',
              providerLocation('github'),
            ],
          ]}
        />
        <h3>Error reports</h3>
        <p>
          Reports from the website and desktop app are filtered to remove emails, passwords, tokens,
          live links and home folder names, and carry only an opaque user ID. Reports from our server
          filter sign-in headers and coordinates and searches in the address, and when a signed-in
          request fails they carry that opaque ID, not an email address. Other text in an error message
          isn&apos;t filtered on the server.
        </p>
        <h3>Sending data outside Malaysia</h3>
        <p>
          These providers operate internationally, so your data may be stored or handled outside
          Malaysia, in places whose laws may give less protection. If you want more detail about a
          transfer, contact us.
        </p>
        <h3>Links you choose to open</h3>
        <p>
          A venue link opens Google Maps. That is Google&apos;s service, under Google&apos;s terms.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep data',
    body: (
      <>
        <div className="lg-note">
          <p>
            <strong>We have no general retention period yet.</strong> The only scheduled deletion
            is what follows a deleted account, below. Otherwise registrations, receipts, rosters,
            results, certificates and usage statistics stay until someone removes them by hand. We
            can&apos;t give you an end date today. We will publish retention periods here once they are
            set.
          </p>
        </div>
        <h3>When you delete your account</h3>
        <p>You can do this on the Account page on the website. The mobile app can&apos;t do it yet.</p>
        <LegalTable
          caption="What is removed and what stays when an account is deleted."
          head={['Data', 'What happens']}
          rows={[
            ['Sign-in account, display name, team memberships', 'Removed.'],
            ['Player and family profiles on the account', 'Removed.'],
            [
              'Registrations you or your profiles made, with the copy of the player’s details',
              'Contact details, other details and answers are removed straight away. Open entries are cancelled. An approved entry keeps only the player’s name, which the organizer’s roster already shows. Payment status and amount stay.',
            ],
            [
              'Receipts on those registrations',
              'Kept for 30 days so the organizer can settle payments, then deleted by a scheduled job. Deletion can run later than day 30, and a failed attempt is tried again.',
            ],
            [
              'Roster entries, results and certificates in an organizer’s event',
              'Stay with the event. Ask the organizer to change or remove them.',
            ],
            [
              'Tournaments you own that belong to an organization',
              'Stay with the organization, under its owner.',
            ],
            [
              'Tournaments of your own, outside any organization',
              'Hidden straight away, then erased after 30 days with their rosters, results, registrations, receipts and certificates.',
            ],
            [
              'An organization where you are the only owner',
              'Its longest-serving admin, or else director, becomes owner. If there is neither, it closes: it is suspended, its tournaments are hidden and any arbiters lose access. After 30 days the tournaments are erased and the organization’s name and contact details are removed.',
            ],
            [
              'Registrations entered without signing in',
              'Not touched: nothing links them to your account. Contact the organizer or us.',
            ],
            ['Usage statistics, server logs, error reports', 'Stay.'],
            ['Data on your own devices', 'Stays until you remove it. See section 11.'],
          ]}
        />
        <p>
          Deleting removes the sign-in account straight away and can&apos;t be undone. The 30 days are
          for organizers and don&apos;t let you restore the account.
        </p>
        <h3>Other deletions</h3>
        <p>
          Deleting a player profile removes that profile, but not past registrations or roster entries.
          When an organizer deletes a tournament, it is marked as deleted, not erased.
        </p>
        <p>
          If you want something erased, contact us or the organizer. We handle these requests by hand
          and may need the organizer&apos;s agreement. We may have to keep some records, for example
          where the law requires it. We haven&apos;t published a backup schedule, so we can&apos;t say
          how long a copy could remain in a provider&apos;s backup.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <>
        <p>What we do:</p>
        <ul>
          <li>The website uses HTTPS.</li>
          <li>Sign-in and database access rules limit who can read each organizer&apos;s data.</li>
          <li>Receipts go to private storage and are served only through a route that checks the organizer&apos;s access.</li>
          <li>Uploaded receipts are checked for file type and size.</li>
          <li>Floor scoring needs a PIN, and changing the PIN ends older sessions.</li>
          <li>Public routes omit private fields and have rate limits.</li>
        </ul>
        <p>
          What you should know: no system is fully secure. We hold no security certification, and
          Chess Alokas has had no independent security audit. Desktop builds aren&apos;t code-signed
          yet. Local desktop backups aren&apos;t encrypted. A public live link, or a round PIN, gives
          access to anyone who has it, so share them with care.
        </p>
        <p>
          If a breach affects your data, we will notify the authorities and affected people where the
          law requires it.
        </p>
      </>
    ),
  },
  {
    id: 'device',
    title: 'Data on your own devices',
    body: (
      <>
        <p>
          <strong>Browser.</strong> The organizer desk keeps tournament data in your browser&apos;s
          local database, including players&apos; names and contact details. The browser also stores your
          sign-in session, a random install ID, players you star on a live page, and floor results
          waiting to send. Anyone using that browser profile may be able to see this. Sign out and clear
          site data on a shared computer.
        </p>
        <p>
          <strong>Desktop app.</strong> It keeps the same data on your computer, plus log files and up to
          20 automatic backups. Backups hold player names and contact details and aren&apos;t encrypted.
          Files you export are yours to look after. Deleting your account doesn&apos;t remove any of this.
        </p>
        <p>
          <strong>Mobile app.</strong> It keeps your session in the phone&apos;s secure storage, and can
          keep registration drafts, a chosen receipt and an offline copy of match information on the
          phone. It has no setting to delete your account yet.
        </p>
        <p>
          <strong>Cookies.</strong> We don&apos;t use advertising cookies. Sign-in and the features above
          use your browser&apos;s local storage, and the website caches its own files so it can open
          offline.
        </p>
      </>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights and choices',
    body: (
      <>
        <p>
          Under Malaysian personal data law, you can ask to access your personal data and to correct it.
          Parents and guardians can ask for a child under 18. You can also withdraw consent, ask us to
          limit how data is used, and ask for your data to be sent to another organization where that is
          technically possible. The law gives some exceptions, and access requests can carry a fee set
          by law.
        </p>
        <ul>
          <li>
            <strong>Do it yourself:</strong> view and edit profiles in the <Link to="/player">Player
            Portal</Link>, delete a family profile, or delete your account.
          </li>
          <li>
            <strong>Event data:</strong> ask the organizer to correct or remove a roster entry,
            registration or certificate.
          </li>
          <li>
            <strong>Anything else:</strong> there is no self-service data export yet, so we handle
            these requests by hand. <LegalContact />
          </li>
          <li>
            <strong>Limiting use:</strong> leave out optional fields, don&apos;t use Near me, and ask the
            organizer about public pages.
          </li>
        </ul>
        <p>
          If withdrawing consent or removing data means an organizer can no longer run your entry, they
          may have to cancel it.
        </p>
        <p>
          If you aren&apos;t happy with how we handle a request, you can complain to the Personal Data
          Protection Commissioner of Malaysia (<a href="https://www.pdp.gov.my/">pdp.gov.my</a>).
        </p>
      </>
    ),
  },
  {
    id: 'sale',
    title: 'No sale of data',
    body: (
      <p>
        We don&apos;t sell personal data. We don&apos;t show advertising, and we don&apos;t share data
        with advertisers.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this page',
    body: (
      <p>
        We will update this page when what we do changes, and change the date at the top. If a change
        matters to you, we will try to tell you on the site or by email. We don&apos;t keep a record of
        which version each person has read.
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

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      path="/privacy"
      summary={
        <>
          <h2>The short version</h2>
          <ul>
            <li>Organizers decide what happens with their event&apos;s data. We provide the tools.</li>
            <li>Many players are children. Their names can appear on public pages an organizer turns on.</li>
            <li>We don&apos;t sell personal data or show ads.</li>
            <li>We have no fixed retention period yet. Some data stays after you delete your account.</li>
            <li>Our service providers may hold data outside Malaysia.</li>
            <li>You can ask to see and correct your data.</li>
          </ul>
        </>
      }
      sections={SECTIONS}
    />
  );
}
