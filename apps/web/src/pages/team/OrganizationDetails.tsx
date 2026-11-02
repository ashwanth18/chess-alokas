import { FormEvent, useEffect, useState } from 'react';
import type { UserOrganization } from '@chess-alokas/shared';
import { apiUpdateOrganization } from '../../api/client';

type Details = {
  name: string;
  description: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  city: string;
  state: string;
  country: string;
  paymentInstructions: string;
};

function detailsFrom(org: UserOrganization): Details {
  return {
    name: org.name,
    description: org.description ?? '',
    website: org.website ?? '',
    contactEmail: org.contactEmail ?? '',
    contactPhone: org.contactPhone ?? '',
    city: org.city ?? '',
    state: org.state ?? '',
    country: org.country ?? 'Malaysia',
    paymentInstructions: org.paymentInstructions ?? '',
  };
}

/** A bare address is what people type; the API only keeps web addresses. */
export function normalizeWebsite(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function statusLine(org: UserOrganization): string {
  const plan = org.planTier.replace('_', ' ');
  const players = org.maxPlayersPerTournament ?? 'Any number of';
  const tournaments = org.maxTournamentsQuota ?? 'Any number of';
  const label = `${plan} plan · ${org.verificationStatus.replace('_', ' ')}`;
  return `${label[0]!.toUpperCase()}${label.slice(1)} · ${tournaments} tournaments · ${players} players per tournament`;
}

/** The academy's own details, for an owner or admin, whatever its plan or verification. */
export default function OrganizationDetails({
  organization,
  onSaved,
}: {
  organization: UserOrganization;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<Details>(() => detailsFrom(organization));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(detailsFrom(organization));
  }, [organization]);

  // Saving reloads the organization, so only a different one clears the message.
  useEffect(() => {
    setError(null);
    setSaved(false);
  }, [organization.id]);

  const field = (key: keyof Details) => ({
    className: 'tm-input',
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setSaved(false);
      setForm((f) => ({ ...f, [key]: e.target.value }));
    },
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiUpdateOrganization(organization.id, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      website: normalizeWebsite(form.website),
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || null,
      paymentInstructions: form.paymentInstructions.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    await onSaved();
  }

  return (
    <section className="tm-section" aria-labelledby="tm-org-heading">
      <h2 id="tm-org-heading">Academy details</h2>
      <p className="tm-muted">{statusLine(organization)}</p>
      <form className="tm-form tm-form-stack" onSubmit={(e) => void save(e)}>
        <label>
          Name
          <input {...field('name')} required maxLength={120} />
        </label>
        <label>
          Description
          <textarea {...field('description')} rows={2} maxLength={1000} />
        </label>
        <label>
          Website
          <input {...field('website')} inputMode="url" maxLength={255} />
        </label>
        <label>
          Contact email
          <input {...field('contactEmail')} type="email" maxLength={255} />
        </label>
        <label>
          Contact phone
          <input {...field('contactPhone')} type="tel" maxLength={64} />
        </label>
        <label>
          City
          <input {...field('city')} maxLength={100} />
        </label>
        <label>
          State
          <input {...field('state')} maxLength={100} />
        </label>
        <label>
          Country
          <input {...field('country')} maxLength={100} />
        </label>
        <label>
          Payment instructions
          <textarea {...field('paymentInstructions')} rows={2} maxLength={2000} />
        </label>
        {error && (
          <p className="tm-note tm-note-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="tm-btn tm-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
          {saved && (
            <span className="tm-muted" role="status">
              {' '}
              Saved.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
