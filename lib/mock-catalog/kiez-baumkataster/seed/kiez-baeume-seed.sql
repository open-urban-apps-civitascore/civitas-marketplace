-- Seed for the Kiez-Baumkataster use case: the "Fachverfahren" side of the demo.
-- Target: the baumkataster-db container from the simulator repo's docker-compose
-- (database `fachverfahren`, user `kataster`). Idempotent — re-running upserts.
--
-- Apply with:
--   docker exec -i baumkataster-db psql -U kataster -d fachverfahren < kiez-baeume-seed.sql
--
-- Coordinates are WGS84 (lon/lat) around Münster's Hansaviertel, matching the
-- crs the target structure declares (EPSG:4326).

CREATE SCHEMA IF NOT EXISTS kataster;

CREATE TABLE IF NOT EXISTS kataster.kiez_baeume (
  baum_id             text PRIMARY KEY,
  gattung             text,
  art_deutsch         text,
  pflanzjahr          integer,
  kronendurchmesser_m numeric(4, 1),
  stammumfang_cm      numeric(5, 0),
  standort            text,
  lon                 double precision NOT NULL,
  lat                 double precision NOT NULL
);

INSERT INTO kataster.kiez_baeume
  (baum_id, gattung, art_deutsch, pflanzjahr, kronendurchmesser_m, stammumfang_cm, standort, lon, lat)
VALUES
  ('KB-001', 'Tilia',     'Winterlinde',    1962,  14.5, 285, 'Wolbecker Straße 45',   7.6362, 51.9561),
  ('KB-002', 'Tilia',     'Winterlinde',    1962,  13.0, 262, 'Wolbecker Straße 47',   7.6367, 51.9560),
  ('KB-003', 'Platanus',  'Platane',        1955,  17.5, 310, 'Hansaring 12',          7.6329, 51.9576),
  ('KB-004', 'Platanus',  'Platane',        1955,  16.0, 298, 'Hansaring 14',          7.6333, 51.9574),
  ('KB-005', 'Acer',      'Spitzahorn',     1978,  11.0, 190, 'Schillerstraße 3',      7.6350, 51.9552),
  ('KB-006', 'Acer',      'Spitzahorn',     1978,  10.5, 184, 'Schillerstraße 9',      7.6355, 51.9549),
  ('KB-007', 'Quercus',   'Stieleiche',     1948,  18.0, 340, 'Bremer Platz',          7.6395, 51.9556),
  ('KB-008', 'Quercus',   'Stieleiche',     1951,  16.5, 322, 'Bremer Platz',          7.6399, 51.9553),
  ('KB-009', 'Betula',    'Hängebirke',     1990,   8.0, 120, 'Dortmunder Straße 21',  7.6377, 51.9540),
  ('KB-010', 'Betula',    'Hängebirke',     1990,   7.5, 114, 'Dortmunder Straße 25',  7.6381, 51.9538),
  ('KB-011', 'Aesculus',  'Rosskastanie',   1935,  15.5, 355, 'Sonnenstraße 8',        7.6318, 51.9545),
  ('KB-012', 'Aesculus',  'Rosskastanie',   1935,  14.0, 341, 'Sonnenstraße 12',       7.6322, 51.9543),
  ('KB-013', 'Carpinus',  'Hainbuche',      1985,   9.0, 150, 'Hafenweg 6',            7.6410, 51.9532),
  ('KB-014', 'Carpinus',  'Hainbuche',      1985,   9.5, 156, 'Hafenweg 10',           7.6415, 51.9530),
  ('KB-015', 'Fraxinus',  'Gemeine Esche',  1970,  12.5, 230, 'Albersloher Weg 30',    7.6389, 51.9515),
  ('KB-016', 'Fraxinus',  'Gemeine Esche',  1970,  12.0, 224, 'Albersloher Weg 34',    7.6392, 51.9512),
  ('KB-017', 'Ginkgo',    'Ginkgo',         2005,   6.0,  95, 'Hansaplatz',            7.6341, 51.9565),
  ('KB-018', 'Ginkgo',    'Ginkgo',         2005,   5.5,  90, 'Hansaplatz',            7.6344, 51.9564),
  ('KB-019', 'Robinia',   'Robinie',        1968,  12.0, 245, 'Soester Straße 18',     7.6371, 51.9526),
  ('KB-020', 'Robinia',   'Robinie',        1972,  11.5, 232, 'Soester Straße 22',     7.6374, 51.9524),
  ('KB-021', 'Tilia',     'Sommerlinde',    2015,   4.5,  65, 'Wolbecker Straße 88',   7.6402, 51.9548),
  ('KB-022', 'Tilia',     'Sommerlinde',    2015,   4.0,  61, 'Wolbecker Straße 92',   7.6406, 51.9546),
  ('KB-023', 'Acer',      'Bergahorn',      1958,  15.0, 290, 'Von-Steuben-Straße 5',  7.6308, 51.9558),
  ('KB-024', 'Prunus',    'Vogelkirsche',   1998,   7.0, 110, 'Wienburgpark Südrand',  7.6285, 51.9702),
  ('KB-025', 'Quercus',   'Roteiche',       1988,  10.0, 175, 'Dortmunder Straße 60',  7.6398, 51.9535)
ON CONFLICT (baum_id) DO UPDATE SET
  gattung = EXCLUDED.gattung,
  art_deutsch = EXCLUDED.art_deutsch,
  pflanzjahr = EXCLUDED.pflanzjahr,
  kronendurchmesser_m = EXCLUDED.kronendurchmesser_m,
  stammumfang_cm = EXCLUDED.stammumfang_cm,
  standort = EXCLUDED.standort,
  lon = EXCLUDED.lon,
  lat = EXCLUDED.lat;
