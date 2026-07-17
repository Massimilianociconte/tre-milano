import { useEffect, useMemo, useState } from 'react';
import {
  GROUP_AREAS,
  GROUP_BUDGET_LEVELS,
  GROUP_INTENTS,
  GROUP_SESSION_MAX_PARTICIPANTS,
  GROUP_SESSION_MIN_PARTICIPANTS,
  aggregateGroupPreferences,
  canonicalGroupSession,
  createGroupParticipant,
  createGroupSession,
  createGroupSessionUrl,
  intersectGroupHardConstraints,
  readGroupSessionFromUrl,
  type GroupAreaId,
  type GroupBudgetLevel,
  type GroupIntentId,
  type GroupParticipant,
  type GroupSession,
} from '@/domain/group-session';
import styles from './GroupSessionPlanner.module.css';

const budgetLabel = (level: GroupBudgetLevel) => '€'.repeat(level);

function DiamondIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" />
      <path d="M12 7.5c.35 2.45 2.05 4.15 4.5 4.5-2.45.35-4.15 2.05-4.5 4.5-.35-2.45-2.05-4.15-4.5-4.5 2.45-.35 4.15-2.05 4.5-4.5Z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M10 13.8a4.4 4.4 0 0 0 6.2 0l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.5 1.5" />
      <path d="M14 10.2a4.4 4.4 0 0 0-6.2 0l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.5-1.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 20 6v5.6c0 4.3-2.7 7.7-8 9.4-5.3-1.7-8-5.1-8-9.4V6l8-3Z" />
      <path d="m8.8 12 2.1 2.1 4.6-4.7" />
    </svg>
  );
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(value);
}

type ParticipantEditorProps = {
  index: number;
  participant: GroupParticipant;
  canRemove: boolean;
  onChange: (participant: GroupParticipant) => void;
  onRemove: () => void;
};

function ParticipantEditor({ index, participant, canRemove, onChange, onRemove }: ParticipantEditorProps) {
  const toggleIntent = (intent: GroupIntentId) => {
    const selected = participant.intents.includes(intent);
    if (!selected && participant.intents.length >= 3) return;
    onChange({
      ...participant,
      intents: selected
        ? participant.intents.filter((item) => item !== intent)
        : [...participant.intents, intent],
      ...(participant.vote === intent && selected ? { vote: undefined } : {}),
    });
  };

  const toggleArea = (area: GroupAreaId) => {
    const selected = participant.hard.areas.includes(area);
    onChange({
      ...participant,
      hard: {
        ...participant.hard,
        areas: selected
          ? participant.hard.areas.filter((item) => item !== area)
          : [...participant.hard.areas, area],
      },
    });
  };

  const inputId = `group-participant-${index + 1}`;

  return (
    <article className={styles.participant} aria-labelledby={`${inputId}-title`}>
      <header className={styles.participantHeader}>
        <span className={styles.participantNumber} aria-hidden="true"><i>{index + 1}</i></span>
        <div>
          <h2 id={`${inputId}-title`}>Persona {index + 1}</h2>
          <p>Profilo anonimo · scegli fino a tre intenzioni</p>
        </div>
        {canRemove ? (
          <button className={styles.removeButton} type="button" onClick={onRemove} aria-label={`Rimuovi Persona ${index + 1}`}>
            Rimuovi
          </button>
        ) : null}
      </header>

      <fieldset className={styles.fieldset}>
        <legend>Che tipo di momento cerchi?</legend>
        <div className={styles.choiceGrid}>
          {GROUP_INTENTS.map(({ id, label }) => {
            const selected = participant.intents.includes(id);
            const disabled = !selected && participant.intents.length >= 3;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggleIntent(id)}
              >
                <span aria-hidden="true">{selected ? '✓' : '+'}</span>{label}
              </button>
            );
          })}
        </div>
        <p className={styles.fieldHint}>{participant.intents.length}/3 intenzioni selezionate</p>
      </fieldset>

      <div className={styles.preferenceRow}>
        <label htmlFor={`${inputId}-vote`}>
          <span>Prima scelta</span>
          <small>Voto locale opzionale</small>
        </label>
        <select
          id={`${inputId}-vote`}
          value={participant.vote ?? ''}
          onChange={(event) => onChange({
            ...participant,
            ...(event.target.value ? { vote: event.target.value as GroupIntentId } : { vote: undefined }),
          })}
        >
          <option value="">Nessun voto</option>
          {GROUP_INTENTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      <fieldset className={`${styles.fieldset} ${styles.hardFieldset}`}>
        <legend>Vincoli da rispettare</legend>
        <div className={styles.hardGrid}>
          <label htmlFor={`${inputId}-budget`}>
            <span>Budget massimo</span>
            <select
              id={`${inputId}-budget`}
              value={participant.hard.maxBudget ?? ''}
              onChange={(event) => onChange({
                ...participant,
                hard: {
                  ...participant.hard,
                  ...(event.target.value
                    ? { maxBudget: Number(event.target.value) as GroupBudgetLevel }
                    : { maxBudget: undefined }),
                },
              })}
            >
              <option value="">Nessun limite</option>
              {GROUP_BUDGET_LEVELS.map((level) => <option key={level} value={level}>Fino a {budgetLabel(level)}</option>)}
            </select>
          </label>
          <div className={styles.areaPicker}>
            <span>Zone accettabili</span>
            <small>Nessuna selezione significa tutta Milano</small>
            <div>
              {GROUP_AREAS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={participant.hard.areas.includes(id)}
                  onClick={() => toggleArea(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </fieldset>
    </article>
  );
}

export default function GroupSessionPlanner() {
  const [session, setSession] = useState<GroupSession>(() => createGroupSession());
  const [ready, setReady] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [importValue, setImportValue] = useState('');
  const [status, setStatus] = useState('Sessione locale pronta.');

  useEffect(() => {
    const imported = readGroupSessionFromUrl(window.location.href);
    const hasPayload = new URLSearchParams(window.location.hash.replace(/^#/, '')).has('g');
    if (imported) {
      setSession(imported);
      setShareUrl(createGroupSessionUrl(window.location.href, imported));
      setStatus('Sessione importata dal link. Nessun dato è stato inviato a un server.');
    } else if (hasPayload) {
      setStatus('Il link non contiene una sessione valida o usa una versione non supportata.');
    }
    setReady(true);
  }, []);

  const hardIntersection = useMemo(() => intersectGroupHardConstraints(session), [session]);
  const preferenceRanking = useMemo(() => aggregateGroupPreferences(session).slice(0, 3), [session]);
  const declaredSignals = session.participants.reduce((total, participant) => (
    total + participant.intents.length + Number(Boolean(participant.vote))
  ), 0);

  const clearAddressPayload = () => {
    if (!window.location.hash) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  const commitSession = (next: GroupSession, message = 'Modifiche attive solo in questa scheda. Genera un nuovo link per condividerle.') => {
    const canonical = canonicalGroupSession(next);
    if (!canonical) return;
    setSession(canonical);
    setShareUrl('');
    clearAddressPayload();
    setStatus(message);
  };

  const updateParticipant = (index: number, participant: GroupParticipant) => {
    const participants = session.participants.map((current, currentIndex) => currentIndex === index ? participant : current);
    commitSession({ ...session, participants });
  };

  const addParticipant = () => {
    if (session.participants.length >= GROUP_SESSION_MAX_PARTICIPANTS) return;
    commitSession({ ...session, participants: [...session.participants, createGroupParticipant()] }, 'Persona anonima aggiunta.');
  };

  const removeParticipant = (index: number) => {
    if (session.participants.length <= GROUP_SESSION_MIN_PARTICIPANTS) return;
    commitSession({ ...session, participants: session.participants.filter((_, currentIndex) => currentIndex !== index) }, 'Persona rimossa dalla sessione locale.');
  };

  const generateLink = () => {
    const nextUrl = createGroupSessionUrl(new URL('/gruppo/', window.location.origin), session);
    window.history.replaceState(null, '', nextUrl);
    setShareUrl(nextUrl);
    setStatus('Link aggiornato. Il payload è nel frammento # e non viene inviato al server.');
    return nextUrl;
  };

  const copyLink = async () => {
    const nextUrl = shareUrl || generateLink();
    try {
      await copyText(nextUrl);
      setStatus('Link copiato. Chi lo apre vedrà la stessa sessione anonima.');
    } catch {
      setStatus('Il browser non consente la copia automatica: seleziona il link mostrato qui sotto.');
    }
  };

  const shareSession = async () => {
    const nextUrl = shareUrl || generateLink();
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: 'Sessione gruppo · TRE Milano',
        text: 'Apri questa sessione locale per confrontare le preferenze del gruppo.',
        url: nextUrl,
      });
      setStatus('Pannello di condivisione aperto.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('Condivisione annullata. La sessione resta su questo dispositivo.');
      } else {
        setStatus('Condivisione non disponibile. Puoi usare “Copia link”.');
      }
    }
  };

  const importSession = () => {
    const imported = readGroupSessionFromUrl(importValue);
    if (!imported) {
      setStatus('Link non valido, incompleto o creato con una versione non supportata.');
      return;
    }
    const nextUrl = createGroupSessionUrl(new URL('/gruppo/', window.location.origin), imported);
    setSession(imported);
    setShareUrl(nextUrl);
    setImportValue('');
    window.history.replaceState(null, '', nextUrl);
    setStatus('Sessione importata. I dati restano in questa scheda e nel frammento del link.');
  };

  const resetSession = () => {
    setSession(createGroupSession());
    setShareUrl('');
    setImportValue('');
    clearAddressPayload();
    setStatus('Sessione cancellata da questa scheda.');
  };

  const summaryAreas = hardIntersection.areas === undefined
    ? 'Tutta Milano'
    : hardIntersection.areas.map((area) => GROUP_AREAS.find(({ id }) => id === area)?.label ?? area).join(', ');

  return (
    <section className={styles.page} aria-labelledby="group-session-title" aria-busy={!ready}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1 id="group-session-title">Decidete insieme,<br /> <em>senza perdere nessuno.</em></h1>
          <p>Da due a sei persone, preferenze esplicite e vincoli condivisi. TRE riassume il punto d’incontro con una regola trasparente: prima riduce lo svantaggio peggiore, poi premia il consenso medio.</p>
        </div>
        <aside className={styles.privacyPromise} aria-label="Privacy della sessione">
          <ShieldIcon />
          <div>
            <strong>Sessione locale</strong>
            <p>Niente account, nomi o testo libero. I dati restano in questa scheda; quando generi un link vengono inseriti dopo <code>#</code>, una parte che il browser non invia al server.</p>
          </div>
        </aside>
      </div>

      <div
        className={styles.workspace}
        data-group-workspace
        aria-busy={!ready}
        inert={!ready}
      >
        <div className={styles.participantColumn}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Preferenze individuali</span>
              <h2>Il tavolo</h2>
            </div>
            <p>{session.participants.length} di {GROUP_SESSION_MAX_PARTICIPANTS} persone</p>
          </div>

          <div className={styles.participantList}>
            {session.participants.map((participant, index) => (
              <ParticipantEditor
                key={index}
                index={index}
                participant={participant}
                canRemove={session.participants.length > GROUP_SESSION_MIN_PARTICIPANTS}
                onChange={(nextParticipant) => updateParticipant(index, nextParticipant)}
                onRemove={() => removeParticipant(index)}
              />
            ))}
          </div>

          <button
            className={styles.addButton}
            type="button"
            onClick={addParticipant}
            disabled={session.participants.length >= GROUP_SESSION_MAX_PARTICIPANTS}
          >
            <span aria-hidden="true">+</span>
            {session.participants.length >= GROUP_SESSION_MAX_PARTICIPANTS ? 'Limite di sei persone raggiunto' : 'Aggiungi una persona anonima'}
          </button>
        </div>

        <aside className={styles.resultColumn} aria-label="Sintesi della sessione">
          <div className={styles.resultPanel}>
            <header>
              <DiamondIcon />
              <div>
                <span>Punto d’incontro</span>
                <h2>Direzioni condivise</h2>
              </div>
            </header>

            {hardIntersection.conflicts.length ? (
              <div className={styles.conflict} role="alert">
                <strong>Le zone non coincidono.</strong>
                <p>Almeno due persone hanno scelto insiemi incompatibili. Allarga una selezione prima di continuare.</p>
              </div>
            ) : (
              <dl className={styles.hardSummary}>
                <div>
                  <dt>Zona comune</dt>
                  <dd>{summaryAreas}</dd>
                </div>
                <div>
                  <dt>Budget comune</dt>
                  <dd>{hardIntersection.maxBudget ? `Fino a ${budgetLabel(hardIntersection.maxBudget)}` : 'Nessun limite'}</dd>
                </div>
              </dl>
            )}

            {declaredSignals ? (
              <ol className={styles.ranking} aria-label="Prime tre intenzioni aggregate">
                {preferenceRanking.map((score, index) => (
                  <li key={score.intent}>
                    <span className={styles.rankNumber}>{index + 1}</span>
                    <div>
                      <strong>{score.label}</strong>
                      <span>{score.supporters}/{session.participants.length} preferenze forti · equilibrio {Math.round((1 - score.maxRegret) * 100)}%</span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={styles.emptyRanking}>
                <span aria-hidden="true">1 · 2 · 3</span>
                <p>Aggiungi almeno un’intenzione o un voto per vedere il punto d’incontro.</p>
              </div>
            )}

            <p className={styles.methodNote}>Queste sono direzioni tassonomiche, non locali consigliati. Nessun vincolo viene rilassato in silenzio.</p>

            <div className={styles.shareActions}>
              <button className={styles.primaryButton} type="button" onClick={generateLink}>
                <LinkIcon /> Genera link
              </button>
              <button type="button" onClick={copyLink}>Copia link</button>
              <button type="button" onClick={shareSession}>Condividi</button>
            </div>

            {shareUrl ? (
              <label className={styles.generatedLink}>
                <span>Link della sessione</span>
                <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            ) : null}

            <p className={styles.status} role="status" aria-live="polite">{status}</p>
          </div>

          <details className={styles.importPanel}>
            <summary>Hai già un link?</summary>
            <div>
              <label htmlFor="group-import">Incolla il link o il payload</label>
              <input
                id="group-import"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck="false"
                value={importValue}
                onChange={(event) => setImportValue(event.target.value)}
                placeholder="https://…/gruppo/#g=…"
              />
              <button type="button" onClick={importSession} disabled={!importValue.trim()}>Importa sessione</button>
            </div>
          </details>

          <button className={styles.resetButton} type="button" onClick={resetSession}>Cancella la sessione locale</button>
        </aside>
      </div>
    </section>
  );
}
