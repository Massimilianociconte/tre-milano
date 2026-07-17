-- Completa la tassonomia dei quartieri editoriali (22 zone, allineate a
-- src/domain/neighborhoods.ts) e mappa le etichette NIL amministrative del
-- Comune di Milano sulle zone canoniche. Le schede bronze promosse ricevono
-- il quartiere via backfill; i NIL periferici senza zona editoriale restano
-- volutamente NULL e il client mostra "Milano".

insert into public.neighborhoods (slug, name, aliases, published) values
  ('navigli', 'Navigli', array['Naviglio Grande', 'Naviglio Pavese', 'Porta Genova'], true),
  ('darsena', 'Darsena', array['Piazza XXIV Maggio'], true),
  ('porta-ticinese', 'Porta Ticinese', array['Ticinese', 'Colonne di San Lorenzo', 'PORTA TICINESE - CONCHETTA', 'PORTA TICINESE - CONCA DEL NAVIGLIO'], true),
  ('porta-romana', 'Porta Romana', array['PTA ROMANA', 'PORTA VIGENTINA - PORTA LODOVICA'], true),
  ('isola', 'Isola', array['ISOLA'], true),
  ('moscova', 'Moscova', array['GARIBALDI REPUBBLICA'], true),
  ('porta-garibaldi', 'Porta Garibaldi', array['Corso Como', 'Porta Nuova', 'Gae Aulenti', 'PORTA GARIBALDI - PORTA NUOVA'], true),
  ('sempione', 'Sempione', array['Parco Sempione', 'Arco della Pace', 'SEMPIONE'], true),
  ('tortona', 'Tortona', array['Zona Tortona', 'SAVONA - TORTONA'], true),
  ('nolo', 'NoLo', array['LORETO - CASORETTO - NOLO', 'PADOVA - TURRO - CRESCENZAGO'], true),
  ('cinque-vie', 'Cinque Vie', array['5 Vie', 'CARROBBIO'], true),
  ('magenta', 'Magenta', array['Corso Magenta', 'Conciliazione', 'MAGENTA - S. VITTORE', 'PORTA MAGENTA', 'PAGANO'], true),
  ('sarpi', 'Sarpi', array['Paolo Sarpi', 'Chinatown', 'SARPI'], true),
  ('bicocca', 'Bicocca', array['BICOCCA'], true),
  ('lambrate', 'Lambrate', array['Ventura', 'LAMBRATE', 'ORTICA'], true),
  ('sant-ambrogio', 'Sant’Ambrogio', array['S. AMBROGIO', 'SANT''AMBROGIO'], true),
  ('citta-studi', 'Città Studi', array['Piola', 'CITTA'' STUDI'], true)
on conflict (slug) do update set
  aliases = excluded.aliases,
  published = excluded.published;

update public.neighborhoods set aliases = array['Centro storico', 'Piazza del Duomo', 'DUOMO'], published = true where slug = 'duomo';
update public.neighborhoods set aliases = array['Porta Orientale', 'BUENOS AIRES - PORTA VENEZIA - PORTA MONFORTE', 'GIARDINI PORTA VENEZIA'], published = true where slug = 'porta-venezia';
update public.neighborhoods set aliases = array['Ceresio', 'Cimitero Monumentale', 'MONUMENTALE'], published = true where slug = 'monumentale';
update public.neighborhoods set aliases = array['Borgonuovo', 'BRERA'], published = true where slug = 'brera';
update public.neighborhoods set aliases = array['Montenapoleone', 'Via Manzoni', 'QUADRILATERO DELLA MODA'], published = true where slug = 'quadrilatero-della-moda';

-- Backfill: assegna la zona editoriale alle sedi promosse dalle anagrafiche
-- comunali abbinando il NIL dell'osservazione collegata (nome o alias,
-- confronto case-insensitive). Non tocca sedi con quartiere già assegnato.
update public.venue_addresses va
set neighborhood_id = matched.neighborhood_id,
    updated_at = now()
from (
  select distinct on (o.linked_venue_id) o.linked_venue_id, n.id as neighborhood_id
  from public.source_observations o
  join public.neighborhoods n on (
    upper(n.name) = upper(o.neighborhood_label)
    or upper(o.neighborhood_label) in (select upper(a) from unnest(n.aliases) a)
  )
  where o.linked_venue_id is not null
    and o.neighborhood_label is not null
) matched
where va.venue_id = matched.linked_venue_id
  and va.neighborhood_id is null;
