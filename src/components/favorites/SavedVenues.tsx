import { useEffect, useMemo, useState } from 'react';
import { venues } from '@/data/venues';
import { FAVORITES_STORAGE_KEY } from '@/domain/favorites';

function readSaved() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export default function SavedVenues() {
  const [saved, setSaved] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const savedVenues = useMemo(() => venues.filter((venue) => saved.includes(venue.id)), [saved]);

  useEffect(() => {
    setSaved(readSaved());
    setReady(true);

    const syncAcrossTabs = () => setSaved(readSaved());
    window.addEventListener('storage', syncAcrossTabs);
    return () => window.removeEventListener('storage', syncAcrossTabs);
  }, []);

  const persist = (next: string[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Il contenuto resta visibile nella sessione anche se lo storage non è disponibile.
    }
  };

  if (!ready) return <p className="saved-status" role="status">Caricamento dei preferiti locali…</p>;

  if (!savedVenues.length) {
    return (
      <div className="saved-empty">
        <span aria-hidden="true">◇</span>
        <h2>Il tuo taccuino è ancora vuoto.</h2>
        <p>Salva una scelta dal podio: resterà soltanto su questo dispositivo, senza creare un account.</p>
        <a href="/cerca/">Trova la tua top 3</a>
      </div>
    );
  }

  return (
    <div>
      <div className="saved-toolbar">
        <p aria-live="polite">{savedVenues.length} {savedVenues.length === 1 ? 'luogo salvato' : 'luoghi salvati'} su questo dispositivo.</p>
        <button type="button" onClick={() => persist([])}>Rimuovi tutti</button>
      </div>
      <ul className="saved-grid">
        {savedVenues.map((venue) => (
          <li key={venue.id}>
            <article className="saved-card">
              <a className="saved-card__media" href={`/locali/${venue.slug}/`}>
                <img src={venue.image} alt={venue.imageAlt} width={venue.imageWidth} height={venue.imageHeight} />
              </a>
              <div className="saved-card__body">
                <span>{venue.category} · {venue.neighborhood}</span>
                <h2><a href={`/locali/${venue.slug}/`}>{venue.name}</a></h2>
                <p>{venue.features.slice(0, 2).join(' · ')}</p>
                <div>
                  <strong>€{venue.averageSpend} · {venue.travelEstimate.minutes} min dal Duomo demo</strong>
                  <button type="button" aria-label={`Rimuovi ${venue.name} dai preferiti`} onClick={() => persist(saved.filter((id) => id !== venue.id))}>Rimuovi</button>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
