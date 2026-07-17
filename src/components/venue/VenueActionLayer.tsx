import { useEffect, useState } from 'react';
import styles from './VenueActionLayer.module.css';

export type VerifiedVenueActionLinks = {
  official?: string;
  menu?: string;
  reservation?: string;
  telephone?: string;
  directions?: string;
};

type Props = {
  venueName: string;
  actions: VerifiedVenueActionLinks;
};

type ActionIconName = 'share' | 'site' | 'menu' | 'calendar' | 'phone' | 'directions';

function ActionIcon({ name }: { name: ActionIconName }) {
  const paths: Record<ActionIconName, React.ReactNode> = {
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
    site: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9S14.5 18.5 12 21c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z" /></>,
    menu: <><path d="M6 3.5h10.5A1.5 1.5 0 0 1 18 5v15.5H7.5A1.5 1.5 0 0 1 6 19V3.5Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    phone: <path d="M7.2 3.6 9.8 8 7.9 9.8c1.2 2.7 3.4 4.9 6.1 6.1l1.9-1.9 4.4 2.6c.3.2.5.6.4 1-.4 2-1.7 3.4-3.5 3.4C9.4 21 3 14.6 3 6.8 3 5 4.4 3.7 6.4 3.3c.3-.1.7 0 .8.3Z" />,
    directions: <><path d="m12 2 9 9-9 9-9-9 9-9Z" /><path d="M8.5 12h6M12.5 8.5 16 12l-3.5 3.5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export default function VenueActionLayer({ venueName, actions }: Props) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const operationalCount = Object.values(actions).filter(Boolean).length;

  useEffect(() => {
    setReady(true);
  }, []);

  const shareVenue = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const shareUrl = url.toString();
    setManualUrl('');

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${venueName} · TRE Milano`,
          text: `Scheda venue passport di ${venueName} su TRE Milano.`,
          url: shareUrl,
        });
        setStatus('Pannello di condivisione aperto.');
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setStatus('Link copiato negli appunti.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('Condivisione annullata.');
        return;
      }
      setManualUrl(shareUrl);
      setStatus('Copia automatica non disponibile: seleziona il link qui sotto.');
    }
  };

  return (
    <section
      className={styles.layer}
      data-venue-action-layer
      data-client-ready={ready ? 'true' : 'false'}
      aria-labelledby="venue-actions-title"
      aria-busy={!ready}
    >
      <header>
        <div>
          <span>Azioni verificate</span>
          <h2 id="venue-actions-title">Organizza il prossimo passo</h2>
        </div>
        <p>{operationalCount
          ? 'Ogni collegamento operativo è mostrato solo finché la sua fonte resta valida.'
          : 'Questa scheda non contiene ancora collegamenti operativi verificati.'}</p>
      </header>

      <div className={styles.actions}>
        <button className={styles.shareButton} type="button" onClick={shareVenue} disabled={!ready}>
          <ActionIcon name="share" />
          <span>Condividi</span>
        </button>
        {actions.official ? (
          <a href={actions.official} target="_blank" rel="noopener noreferrer" aria-label={`Apri il sito ufficiale di ${venueName} in una nuova scheda`}>
            <ActionIcon name="site" /><span>Sito</span>
          </a>
        ) : null}
        {actions.menu ? (
          <a href={actions.menu} target="_blank" rel="noopener noreferrer" aria-label={`Apri il menu verificato di ${venueName} in una nuova scheda`}>
            <ActionIcon name="menu" /><span>Menu</span>
          </a>
        ) : null}
        {actions.reservation ? (
          <a href={actions.reservation} target="_blank" rel="noopener noreferrer" aria-label={`Apri la prenotazione verificata di ${venueName} in una nuova scheda`}>
            <ActionIcon name="calendar" /><span>Prenota</span>
          </a>
        ) : null}
        {actions.telephone ? (
          <a href={`tel:${actions.telephone}`} aria-label={`Chiama ${venueName}`}>
            <ActionIcon name="phone" /><span>Chiama</span>
          </a>
        ) : null}
        {actions.directions ? (
          <a href={actions.directions} target="_blank" rel="noopener noreferrer" aria-label={`Apri le indicazioni per ${venueName} in Google Maps, senza condividere la tua posizione con TRE Milano`}>
            <ActionIcon name="directions" /><span>Naviga</span>
          </a>
        ) : null}
      </div>

      {manualUrl ? (
        <label className={styles.manualLink}>
          <span>Link da copiare</span>
          <input readOnly value={manualUrl} onFocus={(event) => event.currentTarget.select()} />
        </label>
      ) : null}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </section>
  );
}
