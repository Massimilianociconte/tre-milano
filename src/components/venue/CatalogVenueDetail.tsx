import { useEffect, useState } from 'react';
import { parseCatalogDetailResponse, type CatalogVenueDetail as VenueDetail } from '@/domain/catalog-detail';
import { isPublicHttpsUrl, isValidVenueTelephone } from '@/domain/venue';
import { catalogLocalVisualFor } from '@/components/discovery/catalog-venue-adapter';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'] as const;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; venue: VenueDetail }
  | { status: 'invalid-request' }
  | { status: 'not-found' }
  | { status: 'error' };

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Data da verificare';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(value));
}

function formatTime(value: string | null) {
  return value?.slice(0, 5) ?? '';
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function safeEmail(value: string) {
  return value.length <= 254 && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value) ? value : null;
}

function safeTelephone(value: string) {
  const normalized = value.trim().replace(/^0039/, '+39').replace(/[\s().-]/g, '');
  return isValidVenueTelephone(normalized) ? normalized : null;
}

function contactHref(kind: string, value: string) {
  const normalizedKind = kind.toLocaleLowerCase('it-IT');
  if (['website', 'social', 'instagram', 'facebook', 'tiktok', 'other_social', 'reservation'].includes(normalizedKind)) {
    return isPublicHttpsUrl(value) ? value : null;
  }
  if (['phone', 'telephone', 'telefono'].includes(normalizedKind)) {
    const telephone = safeTelephone(value);
    return telephone ? `tel:${telephone}` : null;
  }
  if (['email', 'e-mail'].includes(normalizedKind)) {
    const email = safeEmail(value);
    return email ? `mailto:${email}` : null;
  }
  return null;
}

function contactLabel(kind: string) {
  const labels: Record<string, string> = {
    website: 'Sito ufficiale',
    phone: 'Telefono',
    telephone: 'Telefono',
    telefono: 'Telefono',
    email: 'Email',
    'e-mail': 'Email',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    other_social: 'Profilo social',
    reservation: 'Prenotazione',
    social: 'Profilo social',
  };
  return labels[kind.toLocaleLowerCase('it-IT')] ?? kind;
}

function LoadingState() {
  return (
    <section className="catalog-detail-state" aria-live="polite" aria-busy="true">
      <span className="catalog-detail-state__mark" aria-hidden="true">✦</span>
      <p className="editorial-eyebrow">Venue passport</p>
      <h1>Stiamo verificando la scheda</h1>
      <p>Recuperiamo fatti, orari e fonti dal catalogo TRE Milano.</p>
      <div className="catalog-detail-state__progress" aria-hidden="true"><span /></div>
    </section>
  );
}

function FailureState({ state, onRetry }: { state: Exclude<LoadState['status'], 'loading' | 'ready'>; onRetry: () => void }) {
  const copy = state === 'invalid-request'
    ? { title: 'Link della scheda non valido', body: 'Il riferimento del locale è assente o non rispetta il formato previsto.' }
    : state === 'not-found'
      ? { title: 'Locale non disponibile', body: 'La scheda non esiste, non è pubblicata oppure richiede una nuova verifica.' }
      : { title: 'Scheda temporaneamente non disponibile', body: 'Il catalogo non ha risposto correttamente. Puoi riprovare senza perdere la ricerca.' };
  return (
    <section className="catalog-detail-state catalog-detail-state--error" role="alert">
      <span className="catalog-detail-state__mark" aria-hidden="true">◇</span>
      <p className="editorial-eyebrow">Catalogo verificato</p>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <div className="catalog-detail-state__actions">
        {state !== 'invalid-request' ? <button type="button" className="button button--dark" onClick={onRetry}>Riprova</button> : null}
        <a className="button button--ghost" href="/cerca/">Torna alla ricerca</a>
      </div>
    </section>
  );
}

function VenuePassport({ venue }: { venue: VenueDetail }) {
  const visual = catalogLocalVisualFor(
    venue.category.name,
    venue.category.slug,
    venue.name,
    venue.images[0] ?? null,
    window.location.origin,
  ) ?? {
    path: '/images/galleria-milano.webp' as const,
    alt: 'Visual editoriale di Milano',
    width: 1400,
    height: 933,
  };
  const neighborhood = venue.address.neighborhood?.name ?? 'Milano';
  const exactSpend = venue.price?.averageSpendCents && venue.price.averageSpendCents > 0
    ? venue.price.averageSpendCents
    : null;
  const directions = new URL('https://www.google.com/maps/search/');
  directions.searchParams.set('api', '1');
  directions.searchParams.set('query', `${venue.address.latitude},${venue.address.longitude}`);
  const primaryContacts = [...venue.contacts].sort((left, right) => Number(right.primary) - Number(left.primary));
  const groupedHours = WEEKDAYS.map((label, weekday) => ({
    label,
    entries: venue.weeklyHours.filter((hour) => hour.weekday === weekday).sort((left, right) => left.sequence - right.sequence),
  }));

  return (
    <article className="catalog-detail">
      <div className="shell">
        <nav className="catalog-detail__breadcrumbs" aria-label="Percorso">
          <a href="/">Home</a><span aria-hidden="true">/</span>
          <a href="/cerca/">Ricerca</a><span aria-hidden="true">/</span>
          <span aria-current="page">{venue.name}</span>
        </nav>

        <header className="catalog-detail__hero">
          <figure className="catalog-detail__visual">
            <img
              src={visual.path}
              alt={visual.alt}
              width={visual.width}
              height={visual.height}
              loading="eager"
              fetchPriority="high"
            />
            <figcaption>Visual editoriale di categoria · non fotografia documentale del locale</figcaption>
          </figure>
          <div className="catalog-detail__intro">
            <div className="catalog-detail__kicker">
              <span className="editorial-eyebrow">
                {venue.verification.status === 'verified' ? 'Venue passport · verificato' : 'Scheda importata · non verificata'}
              </span>
              <span className="catalog-detail__confidence">{Math.round(venue.verification.confidenceScore * 100)}% confidenza</span>
            </div>
            <h1>{venue.name}</h1>
            {venue.officialName && venue.officialName !== venue.name ? <p className="catalog-detail__official">Nome ufficiale: {venue.officialName}</p> : null}
            <p className="catalog-detail__meta">{venue.category.name}{venue.subcategory ? ` · ${venue.subcategory.name}` : ''} · {neighborhood}</p>
            <p className="catalog-detail__lede">{venue.description ?? venue.shortDescription ?? 'Descrizione editoriale in fase di verifica.'}</p>

            <dl className="catalog-detail__facts">
              <div><dt>Spesa media</dt><dd>{exactSpend ? formatCurrency(exactSpend) : 'Prezzo da verificare'}</dd></div>
              <div><dt>Ultima verifica</dt><dd>{venue.verification.verifiedAt
                ? <time dateTime={venue.verification.verifiedAt}>{formatDate(venue.verification.verifiedAt)}</time>
                : 'Non ancora verificato'}</dd></div>
              <div><dt>Completezza</dt><dd>{Math.round(venue.verification.completenessScore)}%</dd></div>
            </dl>

            <div className="catalog-detail__actions" aria-label="Azioni per il locale">
              {primaryContacts.flatMap((contact) => {
                const href = contactHref(contact.kind, contact.value);
                if (!href || !contact.official) return [];
                const external = href.startsWith('https://');
                return (
                  <a key={`${contact.kind}:${contact.value}`} className="button button--dark" href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                    {contactLabel(contact.kind)}
                  </a>
                );
              }).slice(0, 2)}
              <a className="button button--ghost" href={directions.toString()} target="_blank" rel="noreferrer">Indicazioni</a>
            </div>
          </div>
        </header>

        <div className="catalog-detail__layout">
          <div className="catalog-detail__main">
            <section className="catalog-detail__section" aria-labelledby="catalog-detail-address">
              <div className="catalog-detail__section-heading"><span>01</span><div><p>Coordinate essenziali</p><h2 id="catalog-detail-address">Dove si trova</h2></div></div>
              <address>{venue.address.formatted}</address>
              <p>{venue.address.municipality ? `Municipio ${venue.address.municipality} · ` : ''}{neighborhood}</p>
            </section>

            <section className="catalog-detail__section" aria-labelledby="catalog-detail-hours">
              <div className="catalog-detail__section-heading"><span>02</span><div><p>Orari dichiarati</p><h2 id="catalog-detail-hours">Quando andare</h2></div></div>
              <div className="catalog-detail__hours">
                {groupedHours.map(({ label, entries }) => (
                  <div key={label}><span>{label}</span><strong>{entries.length
                    ? entries.map((entry) => entry.closed ? 'Chiuso' : `${formatTime(entry.opensAt)}–${formatTime(entry.closesAt)}${entry.closesNextDay ? ' (+1)' : ''}`).join(' · ')
                    : 'Da verificare'}</strong></div>
                ))}
              </div>
              {venue.hourExceptions.length ? (
                <div className="catalog-detail__exceptions">
                  <h3>Eccezioni comunicate</h3>
                  <ul>{venue.hourExceptions.map((entry) => <li key={`${entry.date}:${entry.sequence}`}><time dateTime={entry.date}>{formatDate(entry.date)}</time>: {entry.closed ? 'chiuso' : `${formatTime(entry.opensAt)}–${formatTime(entry.closesAt)}`}{entry.note ? ` · ${entry.note}` : ''}</li>)}</ul>
                </div>
              ) : null}
            </section>

            <section className="catalog-detail__section" aria-labelledby="catalog-detail-services">
              <div className="catalog-detail__section-heading"><span>03</span><div><p>Fatti verificati</p><h2 id="catalog-detail-services">Servizi e caratteristiche</h2></div></div>
              {venue.services.length
                ? <ul className="catalog-detail__services">{venue.services.map((service) => <li key={service.slug}>{service.name}</li>)}</ul>
                : <p>Nessun servizio è ancora pubblicato come verificato.</p>}
              {venue.price?.note ? <p className="catalog-detail__price-note"><strong>Nota prezzi:</strong> {venue.price.note}</p> : null}
            </section>

            {venue.ratings.length ? (
              <section className="catalog-detail__section" aria-labelledby="catalog-detail-ratings">
                <div className="catalog-detail__section-heading"><span>04</span><div><p>Metriche distinte per fonte</p><h2 id="catalog-detail-ratings">Valutazioni aggregate</h2></div></div>
                <div className="catalog-detail__ratings">{venue.ratings.map((rating) => {
                  const safeUrl = rating.sourceUrl && isPublicHttpsUrl(rating.sourceUrl) ? rating.sourceUrl : null;
                  return <article key={`${rating.source}:${rating.observedAt}`}><span>{rating.source}</span><strong>{rating.rating.toLocaleString('it-IT', { maximumFractionDigits: 1 })}/{rating.scale}</strong><small>{rating.reviewCount.toLocaleString('it-IT')} recensioni · osservate il {formatDate(rating.observedAt)}</small>{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">Apri la fonte</a> : null}</article>;
                })}</div>
              </section>
            ) : null}
          </div>

          <aside className="catalog-detail__aside" aria-label="Contatti e provenienza">
            <section>
              <p className="editorial-eyebrow">Contatti verificati</p>
              <h2>Informazioni rapide</h2>
              <dl className="catalog-detail__contacts">
                {primaryContacts.length ? primaryContacts.map((contact) => {
                  const href = contactHref(contact.kind, contact.value);
                  const external = href?.startsWith('https://');
                  return <div key={`${contact.kind}:${contact.value}`}><dt>{contactLabel(contact.kind)}{contact.official ? ' · ufficiale' : ''}</dt><dd>{href ? <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{contact.value}</a> : contact.value}</dd></div>;
                }) : <div><dt>Contatti</dt><dd>Da verificare</dd></div>}
              </dl>
            </section>

            <section>
              <p className="editorial-eyebrow">Provenienza</p>
              <h2>Fonti del record</h2>
              {venue.sources.length ? <ul className="catalog-detail__sources">{venue.sources.map((source, index) => {
                const safeUrl = source.url && isPublicHttpsUrl(source.url) ? source.url : null;
                return <li key={`${source.name}:${index}`}><strong>{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">{source.name}</a> : source.name}</strong><span>{source.kind.replace(/_/g, ' ')}{source.lastObservedAt ? ` · ${formatDate(source.lastObservedAt)}` : ''}</span>{source.attribution ? <small>{source.attribution}</small> : null}</li>;
              })}</ul> : <p>Fonte dettagliata in fase di pubblicazione.</p>}
            </section>

            <div className="catalog-detail__notice" role="note">
              <strong>Prima di andare</strong>
              <p>Orari, prezzi e disponibilità possono cambiare. Verifica sempre sul canale ufficiale del locale.</p>
              <a href="/correzioni/">Segnala una correzione</a>
            </div>
          </aside>
        </div>
      </div>
    </article>
  );
}

export default function CatalogVenueDetail() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [slug, setSlug] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get('slug') ?? '';
    setSlug(candidate.length <= 180 && SLUG.test(candidate) ? candidate : null);
  }, []);

  useEffect(() => {
    if (slug === undefined) return;
    if (!slug) {
      setState({ status: 'invalid-request' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void fetch(`/api/venues/${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 404) {
        setState({ status: 'not-found' });
        return;
      }
      if (!response.ok) throw new Error(`catalog_detail_${response.status}`);
      const venue = parseCatalogDetailResponse(await response.json());
      if (!venue || venue.slug !== slug) throw new Error('catalog_detail_invalid');
      document.title = `${venue.name} · TRE Milano`;
      setState({ status: 'ready', venue });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: 'error' });
      if (error instanceof Error) {
        // Provider and database details intentionally remain outside the UI.
      }
    });
    return () => controller.abort();
  }, [attempt, slug]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status !== 'ready') return <FailureState state={state.status} onRetry={() => setAttempt((value) => value + 1)} />;
  return <VenuePassport venue={state.venue} />;
}
