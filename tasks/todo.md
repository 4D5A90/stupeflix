# Plan — demander une série depuis son téléphone

> Statut : **plan seulement, rien n'est implémenté.** Phase 0 (vérifications) faite,
> tout est sourcé. À valider avant d'écrire une ligne.

## Besoin

Les utilisateurs du media server de la maison ajoutent une série depuis leur
téléphone (app ou bot Discord) et elle se télécharge. Sans compte
supplémentaire, et sans leur donner de droits d'admin.

## Pourquoi on change de moteur

MediaManager ne peut pas porter ce besoin :

- auto-download = **cron quotidien, jitter ±2 jours** (`scheduler.py`), aucun
  endpoint pour le déclencher ;
- **pas d'API key** — un client tiers stocke email + mot de passe et se relogue
  toutes les 24 h ;
- **aucune app mobile, aucune PWA** (issue #406, sans réponse), aucun bot tiers ;
- dernière release v1.12.3 (11/02/2026), et sa branche `master` **supprime les
  requests** (migration `e60ae827ed98_remove_requests.py`).

Overseerr et Jellyseerr ont fusionné en **Seerr** (v3.0.0 le 14/02/2026,
Overseerr archivé le 15/02). Tout le mobile vit là.

## Architecture retenue

**Sonarr + Radarr** (moteur) ← **Prowlarr** (indexers) → **Seerr** (porte
d'entrée multi-utilisateur), bot Discord optionnel par-dessus.

Les apps *arr natives (Ruddarr, Helmarr, nzb360) s'authentifient par clé d'API,
donc en admin complet : c'est pour toi, jamais pour un membre du foyer.

### Décision tranchée : Seerr se lie à Jellyfin, pas à Plex

Pas une préférence, une contrainte. `MediaServerType` est un **scalaire**
(`PLEX=1, JELLYFIN=2, EMBY=3, NOT_CONFIGURED=4`) : un seul serveur, jamais deux.
Et le bootstrap du premier admin passe **obligatoirement** par un login media
server (`POST /api/v1/auth/plex` ou `/auth/jellyfin`, gardés par
`!(await userRepository.count())`) — `POST /api/v1/auth/local` ne fait que
*connecter* un utilisateur existant, il n'en crée jamais.

Or Stupeflix détient les identifiants admin de Jellyfin
(`templates/jellyfin.yml` → `credentials.user` / `credentials.pass`, c'est lui
qui crée le compte via `POST /Startup/User`), et côté Plex seulement un claim
token. **Jellyfin est donc le seul côté automatisable de bout en bout.** Plex
reste installé et sert la lecture sur les mêmes dossiers.

## Phase 0 — vérifications ✅ faite

### Sonarr v4 / Radarr v5

- Triplet d'env identique à Prowlarr, **noms exacts** :
  `SONARR__AUTH__APIKEY` / `__AUTH__METHOD` / `__AUTH__REQUIRED`
  (idem `RADARR__`). Valeurs : `METHOD ∈ {None, Basic, Forms, External}`,
  `REQUIRED ∈ {Enabled, DisabledForLocalAddresses}`.
- ⚠️ **Casse sensible** : `Enum.TryParse` en overload 2 arguments. Une faute ne
  lève pas d'erreur — elle retombe sur `config.xml`, atterrit sur
  `AuthenticationType.None`, et Sonarr affiche l'écran d'authentification qu'on
  cherchait justement à éviter.
- ⚠️ **Ne jamais poser `__AUTH__ENABLED`** : ça force `Basic` et l'écrit dans
  `config.xml`. Laisser la variable absente.
- ⚠️ **Ne jamais relire la clé dans `config.xml`** : `SaveConfigDictionary` fait
  un `continue` explicite sur `ApiKey`, elle n'y est jamais écrite. Un
  `extract_from_config` rendrait une valeur périmée. La clé qu'on génère est la
  seule source de vérité.
- L'env **gagne à chaque boot** (propriétés recalculées), pas seulement à la
  création du config.
- Clé d'API : aucune contrainte validée côté serveur, mais garder la forme
  **32 hex** que génère l'app (les outils tiers la supposent).
- **`?apikey=<clé>` en query param marche** aussi bien que le header
  `X-Api-Key` (`options.QueryName = "apikey"`). ⭐ C'est ce qui rend `skipIf`
  utilisable : notre `skipIf: {url, match}` ne sait pas poser de header.
- Santé : **`/ping`, sans auth**, comme Prowlarr. Utiliser
  `match: '"OK"'` — il répond 500-avec-corps pendant la migration de sa base.
- Ports confirmés : Sonarr **8989**, Radarr **7878**.

### Corps JSON vérifiés (à recopier tels quels)

`POST /api/v3/rootfolder` → `{"path": "/media/<Library>"}`. Le dossier doit
**exister et être accessible en écriture** (`PathExistsValidator` +
`FolderWritableValidator`), et le chemin est celui vu **par le conteneur**.
Sonde : `GET /api/v3/rootfolder?apikey=…` → `[]` si vierge.

`POST /api/v3/downloadclient` — `implementation` est le **nom de classe** :
`"QBittorrent"` (Q majuscule, pas le nom d'affichage `"qBittorrent"`),
`configContract: "QBittorrentSettings"`. Un `fields[]` **partiel est légal**
(`SchemaBuilder` n'assigne que ce qu'il trouve, le reste prend les défauts C#,
et les noms inconnus sont ignorés). Minimum viable :

```json
{ "enable": true, "protocol": "torrent", "name": "qBittorrent",
  "implementation": "QBittorrent", "configContract": "QBittorrentSettings",
  "fields": [ {"name":"host","value":"…"}, {"name":"port","value":8080},
    {"name":"username","value":"…"}, {"name":"password","value":"…"},
    {"name":"tvCategory","value":"tv-sonarr"} ] }
```
Radarr : `movieCategory` au lieu de `tvCategory`. **Ne pas envoyer `apiKey`** :
son validateur exige alors un username vide.

`POST /api/v1/applications` (Prowlarr) : `implementation` `"Sonarr"`/`"Radarr"`,
`configContract` `"SonarrSettings"`/`"RadarrSettings"`, `syncLevel: "fullSync"`,
`fields[]` = `prowlarrUrl` (Prowlarr **vu par Sonarr**), `baseUrl` (Sonarr vu par
Prowlarr), `apiKey`. Les `syncCategories` peuvent être omises, les défauts
suffisent.

⚠️ **`?forceSave=true` ne saute PAS le test de connexion** (`Test(def, !forceSave)`
ne dégrade que les *warnings*). L'ordre des étapes est donc contraint, cf. Phase 1bis.

### Seerr

- Image `ghcr.io/seerr-team/seerr`, **épingler `v3.4.1`** (ou `v3`), port **5055**,
  config **`/app/config`**, SQLite embarqué (Postgres strictement optionnel —
  pas de sidecar, contrairement à MediaManager).
- ⚠️ **Pas de PUID/PGID** : le Dockerfile fige `USER node:node` (uid 1000). Ça
  détonne avec toutes les images linuxserver du stack → une ligne de `notes:`.
- ⚠️ **`init: true` requis** (les docs l'imposent).
- `GET /api/v1/settings/public` est **non authentifié** → parfait `wait_ready`,
  et sa clé `"initialized":true` fait la sonde `skipIf`.
- **`API_KEY` en variable d'env est pré-injectable**, et l'env **écrase** la
  valeur stockée à chaque chargement → `generate:` chez nous, consommable en
  `{{internal.seerr.api_key}}` par le bot Discord. Attention : la clé est
  **inerte tant que l'utilisateur 1 n'existe pas** (elle usurpe `id=1`), donc
  elle ne permet pas de sauter l'étape de bootstrap.
- **Le wizard navigateur est contournable**, séquence vérifiée dans la v3.4.1 :
  1. `POST /api/v1/auth/jellyfin` (non authentifié) —
     `{"username","password","hostname","port":8096,"useSsl":false,"urlBase":"","email","serverType":2}`.
     ⚠️ `hostname` est un **hôte nu, sans schéma**. Ce seul appel crée
     l'utilisateur 1 admin, fixe `mediaServerType` et **génère tout seul un
     token d'API Jellyfin**. Le compte Jellyfin doit être administrateur — le
     nôtre l'est, c'est le premier créé.
  2. `GET /api/v1/settings/jellyfin/library?sync=true`
  3. `GET /api/v1/settings/jellyfin/library?enable=<id1>,<id2>` — ⚠️ des GET
     **avec effet de bord**, et la liste **remplace** l'ensemble activé.
  4. `POST /api/v1/settings/sonarr` et `/settings/radarr`
  5. `POST /api/v1/settings/initialize` → débloque l'UI.
- ⭐ **`POST /api/v1/settings/main {"defaultPermissions": 160}`** (`REQUEST=32 |
  AUTO_APPROVE=128`) : c'est le réglage qui rend le « ça télécharge directement »
  vrai pour les nouveaux utilisateurs. N'affecte **que** les nouveaux comptes.
  Par utilisateur : `PUT /api/v1/user/:id {"permissions": …}`. Il n'y a pas de
  rôles, seulement défaut global + surcharge par utilisateur.
- ⭐ **Discord est un agent de notification natif**
  (`POST /api/v1/settings/notifications/discord`, `types` bitfield,
  `MEDIA_AVAILABLE = 8`). Pour un simple « c'est prêt », **le bot ne sert à
  rien** — il ne sert qu'à *demander* depuis Discord.

## Phase 1bis — deux primitives manquantes au schéma de templates

Ces deux-là commandent le reste : à faire **avant** les nouveaux templates.

### a) `requires:` / `recommends:` — dépendances déclaratives

Le besoin est général : `templates/mediamanager.yml:11` l'exprime déjà **en
prose**, dans un champ que rien ne vérifie.

```yaml
# seerr.yml — bloquant : son bootstrap est impossible sans media server
requires:
  - category: mediaServer
    reason: Seerr builds its user list from a media server — pick Jellyfin or Plex.

# sonarr.yml — bloquant pour le client, seulement conseillé pour l'indexer :
# Sonarr sait gérer ses propres indexers à la main, donc on n'interdit pas.
requires:
  - category: torrentClient
recommends:
  - category: indexer
```

**On dépend d'une catégorie, jamais d'un service nommé** — même philosophie que
`network:` (`lib/network.ts`), où ni le `provides` ni le `join` ne connaît
l'autre. Un futur `emby.yml` satisfera Seerr sans qu'on rouvre `seerr.yml`.

- [x] `packages/api/src/lib/requirements.ts` — résout contre les services
      activés, rend `{ missing, warnings }`. Générique : c'est ce qui préserve
      l'invariant « aucun fichier de `src/` ne nomme un service ».
- [x] Exposer dans `GET /registry` + `ServiceMeta` (`packages/web/src/types/setup.ts:28`).
- [x] `ServicesStep.tsx` : `requires` non satisfait = blocage, `recommends` =
      avertissement.
- [x] `lib/service-install.ts` : le Dashboard installe un service **seul** via
      `/install/:name`. L'API est la source de vérité, le front n'est que le
      confort.
- [x] `templates.test.ts` : toute catégorie citée existe dans `templates/`, pas
      de cycle.
- [x] Convertir les notes en prose de `mediamanager.yml:11` en déclarations.

**Cas limite à trancher** : supprimer Jellyfin alors que Seerr tourne rend le
besoin faux après coup. Avertir sans interdire — refuser une suppression parce
qu'un autre service en dépend piège son propriétaire.

### b) `if:` sur une étape de setup — corollaire direct de `recommends:`

Un pair *recommandé* peut être absent ; les étapes qui le touchent doivent alors
ne pas exister. Sans ça, `sonarr.yml` ne peut pas gérer « Prowlarr non coché ».

```yaml
- name: register_in_prowlarr
  if: "{{services.prowlarr.enabled}}"
  type: api_call
  ...
```

- [x] `setup-runner.ts` — sauter l'étape quand la valeur résolue n'est pas
      `"true"`. Quelques lignes, résolu par les variables existantes, aucun
      service nommé.

**Et un problème d'ordre à régler en même temps** : `routes/setup.ts:86` déroule
le `post_up` **template par template**, dans l'ordre de `getEnabledTemplates`.
Prowlarr (« p ») passe donc avant Sonarr (« s »), alors que
`POST /api/v1/applications` teste la connexion aux deux sens. Deux sorties
possibles, à trancher :

1. **Porter l'enregistrement dans `sonarr.yml`/`radarr.yml`** (Sonarr s'inscrit
   lui-même auprès de Prowlarr), avec un `wait_ready` sur Prowlarr et un `if:`.
   Aucun changement de moteur, l'ordre alphabétique joue en notre faveur.
2. Ordonner les templates par dépendance dans `getEnabledTemplates`. Plus
   correct sur le fond, mais ça ajoute un tri global pour un seul cas.

→ Préférence : **(1)**, tant qu'un seul cas le demande.

## Phase 1 — le moteur

- [x] `templates/sonarr.yml` — port 8989, `lscr.io/linuxserver/sonarr`,
      `generate: api_key` (hex 32), triplet d'env, volumes média partagés.
      Steps : `wait_ready /ping` (match `"OK"`) → root folder **`foreach:
      libraries`** (le runner sait déjà le faire, `setup-runner.ts:29`) →
      download client via `{{host.qbittorrent}}` → inscription Prowlarr sous
      `if:`.
- [x] `templates/radarr.yml` — idem, port 7878, `movieCategory`.
- [x] `templates/prowlarr.yml` — reformuler la `description` et les `notes:`
      qui nomment MediaManager.
- [x] `templates/mediamanager.yml` — épingler **v1.12.3** au lieu de `:latest`
      (une v1.13 issue de `master` casserait les installs), et le dire en
      `notes:`. On ne le supprime pas : un template que personne ne coche coûte
      zéro.

## Phase 2 — la porte d'entrée

- [x] `templates/seerr.yml` — `v3.4.1`, port 5055, `init: true`, pas de
      PUID/PGID, `generate: api_key` injectée en `API_KEY`, `requires:
      mediaServer`, et la séquence de bootstrap Jellyfin ci-dessus avec un
      `skipIf` sur `"initialized":true`.
- [x] Nouvelle catégorie `requests`. `CATEGORY_LABELS[c] ?? c` fait déjà un
      fallback, donc ça marche sans toucher au front — pour un libellé propre :
      `dashboard/categories.ts:5`, `steps/ServicesStep.tsx:19`, et l'ordre
      d'affichage `ServicesStep.tsx:65`.
- [x] Vérifier qu'aucune nouvelle catégorie n'a besoin d'entrer dans
      `SINGLE_SELECT_CATEGORIES` (`types/setup.ts:39`) — `mediaManager` n'y est
      pas, Sonarr et Radarr cohabitent sans rien changer.
- [ ] `info:` sur la carte Seerr : nombre de requêtes en attente.

## Phase 3 — Discord — **abandonnée** (décision du 2026-09-02)

Pas de bot pour le moment. La raison technique va dans le même sens : Seerr
notifie Discord nativement (`MEDIA_AVAILABLE`), donc un bot n'aurait servi qu'à
*demander* depuis Discord — ce que la PWA fait déjà.

Rien à défaire : la catégorie `bot` avait été retirée du code à la revue, faute
de template qui la déclare. Le jour où le besoin revient, c'est un seul fichier —
`doplarr.yml` sur `ghcr.io/activexray/doplarr_rs`, headless donc sans `port:`,
`requires: requests`, clé lue dans `{{internal.seerr.api_key}}` — plus la
catégorie à rouvrir dans `templates.test.ts`, `categories.ts` et
`ServicesStep.tsx`. Attention si ça revient : le Doplarr d'origine (Clojure) est
archivé depuis juin 2026, c'est la réécriture Rust.

## Phase 4 — preuve ✅ faite

Run réel du 2026-09-02, stack jetable (`stupeflix-e2e`, conteneurs suffixés
`-e2e`, base et compose à part), jamais contre un stack vivant. Six services :
qBittorrent, Prowlarr, Sonarr, Radarr, Jellyfin, Seerr.

- [x] `pnpm test` 143 verts, `pnpm lint` vert sur 79 fichiers, `pnpm build` vert.
- [x] **38 étapes sur 38** au second passage, sur un stack repartant de zéro.
- [x] Le refus de dépendance vérifié en vrai : Seerr sans media server → **400**,
      avec la phrase du template, et **la sélection refusée n'est pas persistée**.
- [x] `foreachType` prouvé : Sonarr n'a que `/media/TvShows`, Radarr que
      `/media/Movies`.
- [x] Prowlarr a bien les deux applications en `fullSync`, adressées
      `http://sonarr:8989` et `http://radarr:7878`.
- [x] Seerr : `initialized=true`, admin id=1 créé depuis les identifiants
      Jellyfin, token Jellyfin frappé automatiquement, `mediaServerType=2`,
      `defaultPermissions=160`.
- [x] **`POST /settings/sonarr/test` de Seerr → 200** : ce n'est pas « la ligne
      est enregistrée », c'est Seerr qui confirme parler à Sonarr.
- [ ] Reste non prouvé : une requête depuis un compte **non-admin** jusqu'au
      fichier importé. Il faudrait un indexer réel et un vrai téléchargement.

### Ce que seul le run réel pouvait trouver

1. **`priority` fait échouer le client de téléchargement.** C'est une propriété
   de premier niveau, pas un `field`, validée entre 1 et 50 — l'omettre envoie 0
   et Sonarr rejette tout l'appel en 400. La recherche décrivait bien un
   `fields[]` partiel comme sans risque ; elle avait raison, mais `priority` n'en
   fait pas partie. Corrigé dans les deux templates.
2. **Le branchement Seerr → Sonarr/Radarr est automatisable**, contrairement à ce
   que j'avais prudemment supposé. Testé contre l'instance vivante : **201** avec
   le profil `Any` (id 1, présent sur tout Sonarr neuf). Rapatrié dans
   `seerr.yml` en `foreach: libraries` + `foreachType`, ce qui traite zéro, une
   et plusieurs bibliothèques sans que le template ait à deviner le bon dossier.
   Ça a demandé que `if:` accepte une **liste** de conditions, puisque ces étapes
   ont besoin de Jellyfin *et* du downloader.

Reste donc une seule chose à la main dans Seerr : cocher les bibliothèques à
surveiller. Leurs identifiants n'existent qu'après le `sync`, et le runner n'a
pas d'étape « extraire depuis une réponse JSON ».

## Phase 5 — `foreach` remis d'aplomb ✅ faite

Ajoutée après coup, sur une remarque juste : `foreachType` figeait au sommet du
schéma un mot qui n'a de sens que pour **une** source. Le jour où un template
doit itérer autre chose que des bibliothèques, le vocabulaire global aurait
porté une option qui ne le concerne pas.

Tout vit désormais **dans** `foreach`, avec le raccourci scalaire pour le cas
courant (5 templates sur 6 n'ont aucune option) :

```yaml
foreach: libraries                # raccourci de { source: libraries }

foreach:
  source: libraries
  type: tvshows                   # ex-foreachType
  map: { movies: { … } }          # ex-typeMap
```

- [x] `ForeachSpec` dans le schéma, `foreachSpec()` normalise les deux formes.
- [x] `foreachType` et `typeMap` supprimés du vocabulaire global.
- [x] 7 occurrences migrées (`sonarr`, `radarr`, `seerr` ×2, `plex`).
- [x] **Gate** : `KNOWN_FOREACH_SOURCES` n'a **qu'une** entrée, et
      `templates.test.ts` refuse tout template nommant une source que le runner
      n'implémente pas — sans quoi elle tournerait une fois, en silence, comme
      s'il n'y avait pas de boucle.
- [x] `map` couvert par un test unitaire, puisque le seul template qui l'utilise
      (`plex.yml`) exige un claim token et ne peut pas passer en e2e.
- [x] **Re-run e2e complet : 38/38.** Les deux formes prouvées côte à côte —
      `jellyfin.add_library_{Movies,TvShows}` par le raccourci,
      `sonarr.root_folder_TvShows` seul par le filtre.

Aucune capacité ajoutée : rien n'est possible qui ne l'était pas avant. Une clé
de moins au sommet, un concept implicite rendu explicite.

## Ajout à chaud — vérifié

Scénario testé en vrai : stack Jellyfin + qBittorrent qui tourne, puis ajout de
services un par un via `POST /install/:name`.

- **Ajouter Seerr à chaud marche.** Bootstrap, sync, auto-approve, initialize :
  tout passe contre le Jellyfin déjà en place. Les étapes `connect_sonarr` /
  `connect_radarr` **n'apparaissent même pas** dans la liste de statuts, leur
  `if:` les ayant écartées.
- **Mais l'ordre compte.** Installer Sonarr *après* Seerr laisse Seerr à zéro
  instance : installer un service exécute ses étapes à lui, pas celles des
  autres. Un `reconfigure` de Seerr rattrape (vérifié : 1 instance,
  `sonarr:8989`).
- Documenté dans les `notes:` de Seerr plutôt que corrigé dans le moteur.
  Rattraper automatiquement supposerait de rejouer les étapes des autres
  services à chaque installation, en pariant qu'elles sont toutes idempotentes —
  beaucoup de machinerie et de risque pour un cas que le bouton Reconfigure
  traite déjà.

## Phase 6 — refonte de l'étape Services ✅ faite

Spec visuelle : artefact **The Services Step**
(`claude.ai/code/artifact/7b59350f-caef-451f-8637-24ebd505f3bb`), interactif.
Le problème de départ : 7 accordéons repliés pour 10 services, dont 4 catégories
qui n'en contiennent qu'un — rien de visible au repos.

**Ce qui est décidé :**

- **Une fourche exclusive en haut** — prendre une stack *ou* en construire une.
  Choisir un chemin replie l'autre ; jamais une porte qui se verrouille.
- **Les stacks sont des templates** : `stacks/*.yml` (`id`, `name`,
  `description`, `services[]`), chargées comme `templates/` et servies sur
  `GET /registry`. **Le dossier est le discriminant**, pas un champ `kind:` — un
  `kind` réclamerait une liste de valeurs valides lisible par un gate (une
  troisième après `KNOWN_CATEGORIES` et `KNOWN_FOREACH_SOURCES`), de la prose
  dans CLAUDE.md, et une décision sur ce que vaut un `kind:` absent.
- **`templates.test.ts` prouve chaque stack** : ids existants, aucun `requires`
  non satisfait. C'est ce qui autorise le chemin stack à n'avoir **aucune** zone
  d'alerte — une stack invalide ne peut pas être livrée.
- **Pas de `stacks/`, dossier vide, ou toutes écartées** : trois cas, une seule
  réponse — liste vide sur `/registry`, donc pas de fourche, pas de OR, pas de
  retour. L'écran demande si la liste est vide, jamais pourquoi.
- **Alertes en haut du panneau** : rouge bloquant (`requires`, Next mort),
  ambre informatif (`recommends`, on passe).
- **Un tableau, une ligne par service** : catégorie | nom | description | switch.
  Le nom et la description partagent une ligne au lieu de s'empiler — c'est ça
  qui divise la hauteur par deux, pas la mise en forme.
- **Un seul contrôle, le switch.** Mélanger switches et radios oblige l'œil à
  classer chaque ligne avant de la lire. La mono-sélection reste une règle sur
  les données, visible au premier clic.
- **Description tronquée à une ligne, volontairement** : elle répond « lequel
  est lequel » ; le texte complet vit déjà sur l'écran d'installation.
- **« Save as a stack »** après un setup réussi : nom + description, la liste de
  services vient de la sélection. Jamais de credentials, de chemins ni de
  secrets. Les stacks livrées sont des fichiers, les stacks enregistrées des
  **lignes en base** — `stacks/` vit dans l'image et un fichier écrit là meurt
  avec le conteneur, défaut que `POST /templates/upload` a déjà.

**Trois pièges de dessin, trouvés à la main, à ne pas réintroduire :**

1. **La teinte et le filet n'ont pas la même portée.** Le fond d'une ligne
   sélectionnée couvre *toute* la ligne, colonne catégorie comprise, sinon la
   sélection fait une marche. Le filet entre deux lignes part de la gouttière,
   sinon il découpe un libellé qui couvre trois services. D'où des
   pseudo-éléments plutôt qu'un `border-top`.
2. **Trois nombres doivent s'accorder** : largeur de la colonne catégorie,
   largeur de la gouttière, position des traits (au centre de la gouttière).
   Écrits à la main ils ont produit deux défauts d'affilée. En React, un seul
   endroit.
3. **`min-width: 0`** sur tout bloc de texte dans une ligne flex ou grid, sans
   quoi il refuse de se comprimer et pousse son voisin dehors — c'est ce qui
   sortait le switch de sa carte.

**Implémenté** — `stacks/{just-watch,automatic,household}.yml`,
`lib/stacks.ts`, `GET /stacks` (route à part plutôt qu'une clé dans `/registry`,
qui aurait changé une forme que le front consomme déjà), `useStacks`,
`ui/CategoryIcon.tsx`, et `ServicesStep.tsx` réécrit. 151 tests, lint et build
verts, et vérifié à l'écran : la fourche, le tableau, le blocage rouge avec
l'avertissement ambre, et le repli sans `stacks/`.

Deux écarts assumés par rapport à la maquette :

- **Les `notes:` reviennent sous le tableau**, pour les services cochés
  seulement. Elles n'ont plus leur place dans une ligne, mais CLAUDE.md dit
  qu'elles s'affichent dans le wizard — les retirer aurait été une régression
  silencieuse.
- **L'ordre des catégories reste en dur** dans `ServicesStep.tsx`, avec les
  catégories inconnues ajoutées à la fin plutôt qu'ignorées. Il décide désormais
  de ce qu'on voit en premier ; le faire venir des templates est un chantier à
  part.

## Risques

- La séquence de bootstrap Seerr est vérifiée dans le code de la v3.4.1 mais
  **jamais exécutée** ici. C'est la partie la plus susceptible de casser au
  premier run réel ; prévoir de la basculer en `notes:` manuelles si elle
  résiste.
- Web Push mobile exige HTTPS + PWA installée. Sans reverse proxy TLS, pas de
  notifications push.
- Seerr ne se lie qu'à un media server : Plex ne sera pas l'annuaire.

## Revue

**Fait** — phases 1bis, 1 et 2. `pnpm test` : 142 verts. `pnpm build` (dont
`tsc --noEmit`) : vert.

Trois choses que le plan n'avait pas vues, trouvées en écrivant :

1. **`{{host.*}}` n'existait que dans le bloc `compose`**, pas dans les étapes de
   setup. Or Sonarr doit donner à Prowlarr l'adresse de qBittorrent, **qui perd
   son nom DNS quand il passe par le VPN** — exactement le piège que le README
   décrit. `runSetupStep` résout désormais les mêmes hôtes que le compose.
2. **`foreach: libraries` itérait toutes les bibliothèques.** Sonarr se serait vu
   attribuer un dossier racine `Movies`. D'où `foreachType:`, qui filtre par type.
3. **Le raccourci clavier du wizard contournait le bouton désactivé** : Entrée
   appelait `onNext()` sans condition.

**Volontairement pas automatisé, et c'est un choix, pas un oubli :**

- **Le branchement Seerr → Sonarr/Radarr** reste une étape navigateur, portée par
  les `notes:` du template. `POST /api/v1/settings/sonarr` réclame un
  `activeProfileId` et un `activeDirectory` que je ne peux pas vérifier sans
  instance vivante, et une étape qui échoue fait échouer **toute** l'installation.
  À automatiser après un vrai run, là où on pourra lire la vraie réponse.
- **Le choix des bibliothèques que Seerr surveille** : leurs identifiants
  n'existent qu'après le `sync`, et le runner n'a pas d'étape « extraire depuis
  une réponse JSON » (seulement `storeToken`, qui rend une chaîne). Une case à
  cocher dans l'UI, documentée en `notes:`.
- **L'avertissement au retrait** d'un service dont un autre dépend (supprimer
  Jellyfin pendant que Seerr tourne). Rien ne le signale aujourd'hui.

**Dette constatée, hors périmètre :** `pnpm lint` était **déjà rouge** avant ce
chantier sur `packages/web/src/components/Wizard.tsx` et
`packages/web/src/components/steps/PathsStep.tsx` (formatage seul, aucun des deux
n'est touché ici). Le CLAUDE.md affirme pourtant que tout le repo est conforme.

**Revue qualité passée**, huit points remontés, huit traités :

1. **Bloquant** — `web/src/api/client.ts` lisait `error.message` alors que l'API
   renvoie `{ error }`. Toute la chaîne « le texte appartient au template »
   mourait là : l'utilisateur lisait « Conflict ». Corrigé.
2. **Bloquant** — le chemin d'ajout depuis le Dashboard n'avait ni porte ni
   indice : on remplissait le formulaire pour récupérer un 409 opaque.
   `ServiceSetupScreen` affiche maintenant les besoins non satisfaits et
   désactive le bouton.
3. **Bloquant** — les `notes:` de Seerr affirmaient « they sign in with their
   Jellyfin account » alors qu'avec Plex seul aucune étape ne tourne. Le
   commentaire du template disait la vérité, pas le texte lu par l'utilisateur.
   Réécrites.
4. `download_client` n'avait pas de `if:`, contrairement aux étapes Prowlarr : un
   reconfigure après retrait de qBittorrent l'aurait rejoué vers un conteneur
   disparu. Gardé.
5. **`mediamanager.yml` rétrogradé en `recommends`** — son compose coupe déjà ses
   intégrations tout seul et aucune de ses étapes ne touche un pair. C'était le
   seul `requires` du diff qui interdisait une configuration que le template
   gère lui-même. Sonarr et Radarr gardent le leur, dont l'étape
   `download_client` est, elle, réelle.
6. Catégorie `bot` retirée des trois endroits : aucun template ne la déclare.
7. L'assertion « adresse un pair par `{{host.x}}` » n'inspectait que `compose`.
   Élargie à `setup`, `actions` et `info`, puisque les steps résolvent désormais
   les mêmes hôtes. Zéro violation.
8. `/setup/complete` écrivait la sélection **avant** de la rejeter. La
   validation passe devant les `apply*`.

Sains, confirmés par la revue : invariant « aucun fichier de `src/` ne nomme un
service » tenu ; pas de cycle d'import (`network.ts` n'importe que des types) ;
les deux `checkRequirements` sont réellement d'accord.

**Reste ouvert :** rien de bloquant. Phase 3 abandonnée, phase 4 faite. Le seul
trou de preuve est une requête non-admin menée jusqu'au fichier importé, qui
demande un indexer réel.
