-- Idempotent local-development baseline. No venue, contact, rating, image or
-- other simulated production record is seeded.
insert into public.municipalities(id, name) values
  (1, 'Municipio 1'), (2, 'Municipio 2'), (3, 'Municipio 3'),
  (4, 'Municipio 4'), (5, 'Municipio 5'), (6, 'Municipio 6'),
  (7, 'Municipio 7'), (8, 'Municipio 8'), (9, 'Municipio 9')
on conflict (id) do update set name = excluded.name;

insert into public.categories(slug, name, display_order) values
  ('cocktail-bar', 'Cocktail bar', 10), ('ristorante', 'Ristorante', 20),
  ('enoteca', 'Enoteca', 30), ('rooftop', 'Rooftop', 40), ('caffe', 'Caffè', 50),
  ('pasticceria', 'Pasticceria', 60), ('gelateria', 'Gelateria', 70),
  ('pub', 'Pub', 80), ('club', 'Club', 90), ('hotel', 'Hotel', 100),
  ('spazio-culturale', 'Spazio culturale', 110), ('mercato', 'Mercato', 120), ('altro', 'Altro', 999)
on conflict (slug) do update set name = excluded.name, display_order = excluded.display_order;

insert into public.services(slug, name) values
  ('accesso-sedia-rotelle', 'Accesso in sedia a rotelle'), ('bagno-accessibile', 'Bagno accessibile'),
  ('tavoli-esterni', 'Tavoli esterni'), ('terrazza', 'Terrazza'), ('prenotazione', 'Prenotazione'),
  ('asporto', 'Asporto'), ('consegna', 'Consegna'), ('wifi', 'Wi-Fi'),
  ('musica-live', 'Musica dal vivo'), ('opzioni-vegane', 'Opzioni vegane'),
  ('opzioni-senza-glutine', 'Opzioni senza glutine'), ('pet-friendly', 'Animali ammessi'),
  ('parcheggio', 'Parcheggio'), ('eventi-privati', 'Eventi privati')
on conflict (slug) do update set name = excluded.name;

-- Sources remain disabled after reset until a human records license, terms,
-- attribution and endpoint approval for the target environment.
update public.sources set enabled = false, next_refresh_at = null, updated_at = now();
