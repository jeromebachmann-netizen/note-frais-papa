# Notes de frais (note-frais-papa)

Petite appli web pour enregistrer ses notes de frais : on photographie un ticket, l'OCR lit le montant, la date, l'enseigne et l'adresse, et l'appli classe le ticket par catégorie. Elle est utilisée sur téléphone (et PC), en français, pour un usage personnel.

## Architecture

- **Un seul fichier : `index.html`** (~1900 lignes) avec HTML, CSS et JS. Pas de build, pas de `package.json`, pas de framework. On modifie le fichier directement.
- **Hébergement : GitHub Pages**, servi depuis la branche `main` à la racine. Un push sur `main` met l'appli en ligne en une minute ou deux.
- **Données : 100 % locales**, dans IndexedDB du navigateur (base `notesFraisDB`, store `tickets`, version 1). Aucun serveur, aucun compte. Les photos sont stockées compressées avec le ticket.
- **Librairies chargées depuis jsDelivr** (internet requis) :
  - `tesseract.js@4.1.1` (OCR, langue `fra`)
  - `jspdf@2.5.1` (export PDF)
  - `xlsx@0.18.5` (export Excel, chargé à la demande via `loadScript`)

## Repères dans `index.html`

- `CATEGORIES` (~l.426) : source unique des catégories. Pour en ajouter une, ajouter une ligne ; l'interface, les totaux, le PDF et le CSV s'adaptent. **Ne jamais changer l'`id` d'une catégorie déjà utilisée**, sinon les tickets existants la perdent. La dernière catégorie sert de repli.
- Base de données : `openDB`, `loadEntries`, `saveEntry`, `deleteEntry`, `importEntries`.
- Rendu : `render`, `openSheet` (formulaire ticket), `populateMonthFilter`.
- OCR : `preprocessForOCR` (nettoyage de l'image), `runOCR`, puis les extracteurs `extractAmount`, `extractDate`, `extractBrand` (liste `KNOWN_BRANDS`), `extractFuelType`, `extractAddress`. C'est la partie la plus délicate : la lecture des tickets thermiques est imparfaite, d'où les heuristiques et la distance de Levenshtein.
- Exports : `generatePDF`, `generateCSV`, `generateXLSX` / `buildWorkbook`, plus la sauvegarde/restauration JSON (`notes_frais_sauvegarde_AAAA-MM-JJ.json`).

## Format d'un ticket

Objet avec au minimum `id`, `amount` (nombre), `date` (ISO `AAAA-MM-JJ`), `cat` (id de catégorie), plus lieu, adresse et photo. `importEntries` ignore les lignes qui n'ont pas ces champs.

## Règles à respecter

- **Ne pas casser les données existantes.** Les tickets vivent dans le navigateur de l'utilisateur. Si le schéma IndexedDB change, incrémenter `DB_VERSION` et écrire une migration. Garder la compatibilité de la sauvegarde JSON.
- Garder l'appli **autonome et simple** : un fichier, pas d'outil de build, sauf décision explicite.
- Interface et textes **en français**. Les chiffres au format français (`1 234,56 €`, dates `jj/mm/aaaa`).
- Les dates de ticket n'ont pas d'heure : éviter tout calcul dépendant du fuseau horaire (voir `excelSerial`, calculé en UTC).
- Penser **mobile d'abord** : gros boutons, `capture="environment"` pour la photo, zones de sécurité iOS.

## Tester

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur local (`python3 -m http.server`) puis aller sur `http://localhost:8000`. Tester avec de vraies photos de tickets (carburant, péage, restaurant, garage) à chaque retouche de l'OCR, et vérifier que l'ajout, la modification, la suppression, la sauvegarde/restauration et les trois exports fonctionnent. Les tests sur téléphone donnent le résultat le plus réaliste pour l'appareil photo.

## Historique

Le dépôt a été créé avec des envois de fichiers via l'interface web de GitHub (d'où les commits « Add files via upload »). Pour les prochaines mises à jour, passer par git en local et faire des commits clairs.
