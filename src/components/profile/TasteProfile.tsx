import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  TASTE_INTERESTS,
  TASTE_PREFERENCES,
  TASTE_PROFILE_CHANGE_EVENT,
  TASTE_PROFILE_STORAGE_KEY,
  createEmptyTasteProfile,
  parseTasteProfile,
  persistTasteProfile,
  serialiseTasteProfile,
  tasteProfileSignalCount,
  type TasteInterest,
  type TastePreferenceKey,
  type TasteProfile as TasteProfileData,
  type TasteProfileChangeDetail,
} from '@/domain/taste-profile';
import styles from './TasteProfile.module.css';

const announceProfileChange = (profile: TasteProfileData | null) => {
  window.dispatchEvent(new CustomEvent<TasteProfileChangeDetail>(TASTE_PROFILE_CHANGE_EVENT, {
    detail: { profile },
  }));
};

function DeviceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="6" y="2.75" width="12" height="18.5" rx="2.25" />
      <path d="M10 17.75h4" />
    </svg>
  );
}

function DiamondMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" />
      <path d="M12 7.5c.35 2.45 2.05 4.15 4.5 4.5-2.45.35-4.15 2.05-4.5 4.5-.35-2.45-2.05-4.15-4.5-4.5 2.45-.35 4.15-2.05 4.5-4.5Z" />
    </svg>
  );
}

export default function TasteProfile() {
  const [profile, setProfile] = useState<TasteProfileData>(() => createEmptyTasteProfile());
  const profileRef = useRef(profile);
  const [profileExists, setProfileExists] = useState(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('Caricamento delle preferenze locali…');

  useEffect(() => {
    try {
      const storedPayload = window.localStorage.getItem(TASTE_PROFILE_STORAGE_KEY);
      const storedProfile = parseTasteProfile(storedPayload);
      if (storedProfile) {
        profileRef.current = storedProfile;
        setProfile(storedProfile);
        setProfileExists(true);
        const canonicalPayload = serialiseTasteProfile(storedProfile);
        if (storedPayload !== canonicalPayload) persistTasteProfile(window.localStorage, storedProfile);
        setStatus('Preferenze caricate da questo dispositivo.');
      } else {
        setStatus('Profilo pronto. Nessuna preferenza era stata salvata.');
      }
    } catch {
      setStatus('Lo spazio locale non è disponibile: le modifiche resteranno valide solo in questa scheda.');
    } finally {
      setReady(true);
    }

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== TASTE_PROFILE_STORAGE_KEY) return;
      const nextProfile = parseTasteProfile(event.newValue) ?? createEmptyTasteProfile();
      profileRef.current = nextProfile;
      setProfile(nextProfile);
      setProfileExists(Boolean(event.newValue));
      setDirty(false);
      setStatus('Preferenze sincronizzate da un’altra scheda.');
    };

    window.addEventListener('storage', syncAcrossTabs);
    return () => window.removeEventListener('storage', syncAcrossTabs);
  }, []);

  const signalCount = useMemo(() => tasteProfileSignalCount(profile), [profile]);

  const commitProfile = (
    update: (current: TasteProfileData) => TasteProfileData,
    successStatus = 'Modifiche salvate soltanto su questo dispositivo.',
  ) => {
    const nextProfile = update(profileRef.current);
    profileRef.current = nextProfile;
    setProfile(nextProfile);

    try {
      persistTasteProfile(window.localStorage, nextProfile);
      setProfileExists(true);
      setDirty(false);
      announceProfileChange(nextProfile);
      setStatus(successStatus);
    } catch {
      setDirty(true);
      setStatus('Impossibile salvare sul dispositivo: le modifiche restano attive solo in questa scheda.');
    }
  };

  const updatePreference = (key: TastePreferenceKey, value: number) => {
    commitProfile((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
  };

  const clearPreference = (key: TastePreferenceKey) => {
    commitProfile((current) => {
      const preferences = { ...current.preferences };
      delete preferences[key];
      return { ...current, preferences };
    }, 'Preferenza rimossa e salvata su questo dispositivo.');
  };

  const toggleInterest = (interest: TasteInterest) => {
    commitProfile((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }));
  };

  const resetProfile = () => {
    commitProfile(
      (current) => createEmptyTasteProfile(current.state),
      'Preferenze azzerate e salvate su questo dispositivo.',
    );
  };

  const toggleProfileState = () => {
    const nextState = profileRef.current.state === 'active' ? 'suspended' : 'active';
    commitProfile(
      (current) => ({ ...current, state: nextState }),
      nextState === 'active'
        ? 'Profilo riattivato e salvato su questo dispositivo.'
        : 'Profilo sospeso e salvato. Il podio non userà queste preferenze.',
    );
  };

  const deleteProfile = () => {
    try {
      window.localStorage.removeItem(TASTE_PROFILE_STORAGE_KEY);
      setStatus('Profilo locale eliminato da questo dispositivo.');
    } catch {
      setStatus('Il browser non consente di eliminare lo spazio locale.');
      return;
    }
    const emptyProfile = createEmptyTasteProfile();
    profileRef.current = emptyProfile;
    setProfile(emptyProfile);
    setProfileExists(false);
    setDirty(false);
    announceProfileChange(null);
  };

  const exportProfile = () => {
    const blob = new Blob([serialiseTasteProfile(profile, true)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'tre-milano-profilo-gusto.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setStatus('Copia JSON esportata. Nessun dato è stato inviato online.');
  };

  return (
    <section className={styles.page} aria-labelledby="taste-profile-title" aria-busy={!ready}>
      <div className={styles.frame}>
        <aside className={styles.rail} aria-label="Sezioni del profilo">
          <div className={styles.railHeading}>
            <DiamondMark />
            <span>Il mio profilo</span>
          </div>
          <nav>
            <a href="#preferenze" aria-current="page">Le mie preferenze</a>
            <a href="#interessi">I miei interessi</a>
            <a href="#trasparenza">Privacy e controllo</a>
          </nav>
        </aside>

        <div className={styles.content}>
          <header className={styles.header}>
            <p>Preferenze personali</p>
            <h1 id="taste-profile-title">Il tuo profilo di gusto</h1>
            <span>Più intenzione, più controllo. Solo le preferenze che dichiari vengono usate; i cursori non toccati restano neutri.</span>
            <div className={styles.profileState} data-state={profile.state}>
              <span><i aria-hidden="true" />{profile.state === 'active' ? 'Profilo attivo' : 'Profilo sospeso'}</span>
              <button type="button" onClick={toggleProfileState}>
                {profile.state === 'active' ? 'Sospendi' : 'Riattiva'}
              </button>
            </div>
          </header>

          <div className={styles.workspace}>
            <div className={styles.preferenceList} id="preferenze">
              {TASTE_PREFERENCES.map((preference) => {
                const declaredValue = profile.preferences[preference.key];
                const isDeclared = declaredValue !== undefined;
                const value = declaredValue ?? preference.neutralValue;
                const inputId = `taste-${preference.key}`;
                const currentLabel = isDeclared ? preference.values[value] : 'Non dichiarata';
                const maximum = preference.values.length - 1;
                const rangeStyle = { '--range-progress': `${(value / maximum) * 100}%` } as CSSProperties;

                return (
                  <div className={styles.preference} key={preference.key} data-declared={isDeclared}>
                    <div className={styles.preferenceHeading}>
                      <label htmlFor={inputId}>{preference.label}</label>
                      <div className={styles.preferenceValue}>
                        <output htmlFor={inputId}>{currentLabel}</output>
                        {isDeclared ? (
                          <button type="button" onClick={() => clearPreference(preference.key)} aria-label={`Rimuovi la preferenza ${preference.label}`}>
                            Rimuovi
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <input
                      className={styles.range}
                      id={inputId}
                      type="range"
                      min="0"
                      max={maximum}
                      step="1"
                      value={value}
                      aria-valuetext={currentLabel}
                      aria-description={isDeclared ? 'Preferenza dichiarata' : 'Sposta il cursore per dichiarare questa preferenza'}
                      style={rangeStyle}
                      onChange={(event) => updatePreference(preference.key, Number(event.target.value))}
                    />
                    <div className={styles.rangeLabels} aria-hidden="true">
                      <span>{preference.values[0]}</span>
                      <span>{preference.values[maximum]}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className={styles.sidePanel}>
              <section id="interessi" aria-labelledby="interest-title">
                <div className={styles.sideHeading}>
                  <h2 id="interest-title">I tuoi interessi</h2>
                  <span>{profile.interests.length} selezionati</span>
                </div>
                <p className={styles.sideIntro}>Scegli solo ciò che vuoi dichiarare esplicitamente.</p>
                <div className={styles.chips}>
                  {TASTE_INTERESTS.map((interest) => {
                    const selected = profile.interests.includes(interest);
                    return (
                      <button
                        key={interest}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleInterest(interest)}
                      >
                        {interest}
                        {selected && <span aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className={styles.transparency} id="trasparenza" aria-labelledby="transparency-title">
                <div className={styles.transparencyIcon}><DeviceIcon /></div>
                <div>
                  <h2 id="transparency-title">Sul tuo dispositivo</h2>
                  <p>Questo profilo usa soltanto il localStorage del browser. Non crea un account e non invia queste preferenze a un backend.</p>
                  <p className={styles.previewNote}>Quando è attivo, il profilo rifinisce il podio con un segnale lieve e spiegabile. Budget, distanza, esclusioni e requisiti della ricerca hanno sempre priorità.</p>
                </div>
              </section>
            </aside>
          </div>

          <footer className={styles.actions}>
            <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
              <span className={dirty ? styles.statusDotPending : styles.statusDot} aria-hidden="true" />
              {status}
            </p>
            <div className={styles.actionButtons}>
              <button type="button" onClick={exportProfile}>Esporta JSON</button>
              <button type="button" onClick={resetProfile} disabled={signalCount === 0 && !dirty}>Azzera preferenze</button>
              <button className={styles.dangerButton} type="button" onClick={deleteProfile} disabled={!profileExists && signalCount === 0}>Elimina profilo</button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
