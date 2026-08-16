import { useEffect, useState } from 'react';
import {
  FAVORITES_STORAGE_KEY,
  readSavedVenuesFromStorage,
  removeSavedVenue,
  savedVenueDetailHref,
  writeSavedVenuesToStorage,
  type SavedVenueEntry,
} from '@/domain/favorites';

function formatSpend(entry: SavedVenueEntry) {
  if (entry.averageSpend == null) return null;
  return `€${entry.averageSpend}`;
}

function formatTravel(entry: SavedVenueEntry) {
  if (entry.travelMinutes == null) return null;
  return entry.fixtureOnly
    ? `${entry.travelMinutes} min dal Duomo demo`
    : `${entry.travelMinutes} min stimati`;
}

export default function SavedVenues() {
  const [saved, setSaved] = useState<SavedVenueEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSaved(readSavedVenuesFromStorage(window.localStorage));
    setReady(true);

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== FAVORITES_STORAGE_KEY) return;
      setSaved(readSavedVenuesFromStorage(window.localStorage));
    };
    window.addEventListener('storage', syncAcrossTabs);
    return () => window.removeEventListener('storage', syncAcrossTabs);
  }, []);

  const persist = (next: SavedVenueEntry[]) => {
    setSaved(next);
    try {
      writeSavedVenuesToStorage(window.localStorage, next);
    } catch {
      // Il contenuto resta visibile nella sessione anche se lo storage non è disponibile.
    }
  };

  if (!ready) return <p className="saved-status" role="status">Caricamento dei preferiti locali…</p>;

  if (!saved.length) {
    return (
      <div className="saved-empty">
        <span aria-hidden="true">◇</span>
        <h2>Il tuo taccuino è ancora vuoto.</h2>
        <p>Salva una scelta dal podio o da Esplora: resterà soltanto su questo dispositivo, senza creare un account.</p>
        <a href="/cerca/">Trova la tua top 3</a>
      </div>
    );
  }

  return (
    <div>
      <div className="saved-toolbar">
        <p aria-live="polite">{saved.length} {saved.length === 1 ? 'luogo salvato' : 'luoghi salvati'} su questo dispositivo.</p>
        <button type="button" onClick={() => persist([])}>Rimuovi tutti</button>
      </div>
      <ul className="saved-grid">
        {saved.map((venue) => {
          const href = savedVenueDetailHref(venue);
          const spend = formatSpend(venue);
          const travel = formatTravel(venue);
          const meta = [spend, travel].filter(Boolean).join(' · ');
          return (
            <li key={venue.id}>
              <article className="saved-card">
                <a className="saved-card__media" href={href}>
                  <img
                    src={venue.image}
                    alt={venue.imageAlt}
                    width={venue.imageWidth}
                    height={venue.imageHeight}
                  />
                </a>
                <div className="saved-card__body">
                  <span>
                    {venue.category} · {venue.neighborhood}
                    {venue.fixtureOnly ? ' · demo' : ''}
                  </span>
                  <h2><a href={href}>{venue.name}</a></h2>
                  {venue.features.length ? <p>{venue.features.slice(0, 2).join(' · ')}</p> : null}
                  <div>
                    {meta ? <strong>{meta}</strong> : <strong>{venue.fixtureOnly ? 'Scheda demo' : 'Scheda catalogo'}</strong>}
                    <button
                      type="button"
                      aria-label={`Rimuovi ${venue.name} dai preferiti`}
                      onClick={() => persist(removeSavedVenue(saved, venue.id))}
                    >
                      Rimuovi
                    </button>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
